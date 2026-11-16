"""Train Helio's tiny GPT-2-style language model from random initialization.

No pretrained language-model weights are loaded. The tokenizer and every model
parameter are learned/initialized inside this training run.
"""

from __future__ import annotations

import json
import os
import random
from pathlib import Path

import torch
from datasets import Dataset
from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers
from transformers import (
    DataCollatorForLanguageModeling,
    GPT2Config,
    GPT2LMHeadModel,
    PreTrainedTokenizerFast,
    Trainer,
    TrainingArguments,
)


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "output" / "dataset"
OUTPUT_ROOT = Path(os.environ.get("HELIO_OUTPUT_ROOT", str(ROOT / "output")))
VARIANT = os.environ.get("HELIO_VARIANT", "flash").strip().lower()
VOCAB_SIZE = int(os.environ.get("HELIO_VOCAB_SIZE", "8000"))
CONTEXT_LENGTH = int(os.environ.get("HELIO_CONTEXT_LENGTH", "512"))
EPOCHS = float(os.environ.get("HELIO_EPOCHS", "5"))

SPECIAL_TOKENS = [
    "<|pad|>",
    "<|unk|>",
    "<|bos|>",
    "<|end|>",
    "<|system|>",
    "<|user|>",
    "<|assistant|>",
]
PERSONA = (
    "Ты Helio — доброжелательный русскоязычный собеседник и школьный помощник. "
    "Отвечай естественно, по смыслу и на языке пользователя. Учитывай контекст "
    "переписки. Будь тёплым, но не льсти без причины: отмечай реальные усилия "
    "и успехи. Если человеку трудно, сначала отнесись с пониманием, потом "
    "предложи один понятный следующий шаг. Если пользователь пишет неформально, "
    "тоже можно говорить неформально; на лёгкую брань отвечай максимум одним "
    "мягким словом вроде «блин» или «капец». Не используй оскорбления, "
    "травлю, угрозы и грубую брань. Не делай вид, что ты человек."
)

VARIANTS = {
    "flash": {"layers": 4, "width": 256, "heads": 4, "batch": 8},
    "pro": {"layers": 8, "width": 384, "heads": 6, "batch": 4},
}


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        raise SystemExit(f"Не найден файл {path}. Сначала запусти training/prepare_oasst.py.")
    with path.open(encoding="utf-8") as file:
        rows = [json.loads(line) for line in file if line.strip()]
    if not rows:
        raise SystemExit(f"В файле {path} нет примеров.")
    return rows


def conversation_text(example: dict) -> str:
    parts = [f"<|system|>\n{PERSONA}<|end|>\n"]
    for message in example.get("messages", []):
        role = message.get("role")
        if role not in {"user", "assistant"}:
            continue
        text = str(message.get("content") or "").strip()
        if text:
            parts.append(f"<|{role}|>\n{text}<|end|>\n")
    return "".join(parts)


def train_tokenizer(texts: list[str]) -> PreTrainedTokenizerFast:
    tokenizer = Tokenizer(models.BPE(unk_token="<|unk|>"))
    tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tokenizer.decoder = decoders.ByteLevel()
    tokenizer.train_from_iterator(
        texts,
        trainers.BpeTrainer(
            vocab_size=VOCAB_SIZE,
            min_frequency=2,
            special_tokens=SPECIAL_TOKENS,
            initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
        ),
    )
    fast_tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        bos_token="<|bos|>",
        eos_token="<|end|>",
        unk_token="<|unk|>",
        pad_token="<|pad|>",
        additional_special_tokens=["<|system|>", "<|user|>", "<|assistant|>"],
        model_max_length=CONTEXT_LENGTH,
    )
    fast_tokenizer.chat_template = (
        "{% for message in messages %}"
        "{% if message['role'] == 'system' %}<|system|>\n{{ message['content'] }}<|end|>\n"
        "{% elif message['role'] == 'user' %}<|user|>\n{{ message['content'] }}<|end|>\n"
        "{% elif message['role'] == 'assistant' %}<|assistant|>\n{{ message['content'] }}<|end|>\n"
        "{% endif %}{% endfor %}"
        "{% if add_generation_prompt %}<|assistant|>\n{% endif %}"
    )
    return fast_tokenizer


def encode_chunks(examples: list[dict], tokenizer: PreTrainedTokenizerFast) -> list[list[int]]:
    chunks: list[list[int]] = []
    for example in examples:
        text = conversation_text(example)
        if not text:
            continue
        token_ids = tokenizer(text, add_special_tokens=False)["input_ids"]
        chunks.extend(
            token_ids[start : start + CONTEXT_LENGTH]
            for start in range(0, len(token_ids), CONTEXT_LENGTH)
            if len(token_ids[start : start + CONTEXT_LENGTH]) >= 16
        )
    return chunks


def main() -> None:
    if VARIANT not in VARIANTS:
        raise SystemExit("HELIO_VARIANT должен быть flash или pro.")
    if not torch.cuda.is_available():
        raise SystemExit(
            "Для обучения с нуля нужна NVIDIA GPU. В Google Colab выбери "
            "Среда выполнения → Сменить тип среды выполнения → T4 GPU."
        )

    random.seed(42)
    torch.manual_seed(42)
    train_examples = read_jsonl(DATA_DIR / "train.jsonl")
    validation_examples = read_jsonl(DATA_DIR / "validation.jsonl")
    train_texts = [conversation_text(item) for item in train_examples]
    tokenizer = train_tokenizer(train_texts)
    train_chunks = encode_chunks(train_examples, tokenizer)
    validation_chunks = encode_chunks(validation_examples, tokenizer)
    if not train_chunks or not validation_chunks:
        raise SystemExit("Не получилось собрать токены обучения и проверки.")

    settings = VARIANTS[VARIANT]
    config = GPT2Config(
        vocab_size=len(tokenizer),
        n_positions=CONTEXT_LENGTH,
        n_ctx=CONTEXT_LENGTH,
        n_embd=settings["width"],
        n_layer=settings["layers"],
        n_head=settings["heads"],
        bos_token_id=tokenizer.bos_token_id,
        eos_token_id=tokenizer.eos_token_id,
        pad_token_id=tokenizer.pad_token_id,
        resid_pdrop=0.1,
        embd_pdrop=0.1,
        attn_pdrop=0.1,
    )
    # from_config initializes every weight randomly; this does not download a base model.
    model = GPT2LMHeadModel(config)
    model.config.use_cache = False
    parameter_count = sum(parameter.numel() for parameter in model.parameters())
    output_dir = OUTPUT_ROOT / f"helio-gen1-{VARIANT}"
    output_dir.mkdir(parents=True, exist_ok=True)
    tokenizer.save_pretrained(output_dir)

    print(f"Helio Gen 1 {VARIANT.title()}: {parameter_count:,} randomly initialized parameters")
    print(f"Training chunks: {len(train_chunks):,}; validation chunks: {len(validation_chunks):,}")
    train_dataset = Dataset.from_dict({"input_ids": train_chunks})
    validation_dataset = Dataset.from_dict({"input_ids": validation_chunks})
    use_bf16 = torch.cuda.is_bf16_supported()
    training_args = TrainingArguments(
        output_dir=str(output_dir / "checkpoints"),
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=settings["batch"],
        per_device_eval_batch_size=settings["batch"],
        gradient_accumulation_steps=4,
        learning_rate=3e-4,
        weight_decay=0.1,
        warmup_ratio=0.05,
        lr_scheduler_type="cosine",
        logging_steps=20,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        bf16=use_bf16,
        fp16=not use_bf16,
        gradient_checkpointing=True,
        report_to="none",
        seed=42,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=validation_dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
    )
    trainer.train()
    trainer.model.config.use_cache = True
    trainer.save_model(str(output_dir))
    tokenizer.save_pretrained(output_dir)
    print(f"Собственные веса Helio сохранены: {output_dir}")


if __name__ == "__main__":
    main()

