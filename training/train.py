"""QLoRA fine-tuning for Helio's Russian conversational adapter."""

from __future__ import annotations

import os
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "output" / "dataset"
BASE_MODEL = os.environ.get("HELIO_BASE_MODEL", "Qwen/Qwen3-1.7B")
OUTPUT_DIR = Path(os.environ.get("HELIO_OUTPUT_DIR", str(ROOT / "output" / "helio-gen1-lora")))


def main() -> None:
    if not torch.cuda.is_available():
        raise SystemExit(
            "A CUDA GPU is required for this training run. In Colab choose Runtime > Change runtime type > T4 GPU, then run all cells."
        )

    compute_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=compute_dtype,
        bnb_4bit_use_double_quant=True,
    )

    print(f"Loading {BASE_MODEL} in 4-bit mode…")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=quantization,
        torch_dtype=compute_dtype,
        device_map="auto",
    )
    model.config.use_cache = False

    data_files = {
        "train": str(DATA_DIR / "train.jsonl"),
        "validation": str(DATA_DIR / "validation.jsonl"),
    }
    dataset = load_dataset("json", data_files=data_files)

    peft_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules="all-linear",
        bias="none",
        task_type="CAUSAL_LM",
    )
    training_args = SFTConfig(
        output_dir=str(OUTPUT_DIR),
        num_train_epochs=float(os.environ.get("HELIO_EPOCHS", "2")),
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=8,
        learning_rate=1e-4,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        logging_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        max_length=1024,
        assistant_only_loss=True,
        gradient_checkpointing=True,
        bf16=compute_dtype == torch.bfloat16,
        fp16=compute_dtype == torch.float16,
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        processing_class=tokenizer,
        peft_config=peft_config,
    )
    trainer.train()
    trainer.save_model(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))
    print(f"Best adapter saved to: {OUTPUT_DIR}")

    trainer.model.gradient_checkpointing_disable()
    trainer.model.config.use_cache = True
    trainer.model.eval()
    prompt = tokenizer.apply_chat_template(
        [{"role": "user", "content": "Какой бы ты выбрал идеальный выходной?"}],
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
        enable_thinking=False,
    ).to(trainer.model.device)
    generated = trainer.model.generate(
        prompt,
        max_new_tokens=120,
        do_sample=True,
        temperature=0.7,
        top_p=0.9,
        pad_token_id=tokenizer.pad_token_id,
    )
    answer = tokenizer.decode(generated[0][prompt.shape[-1] :], skip_special_tokens=True)
    print("\nHelio sample reply:\n" + answer)


if __name__ == "__main__":
    main()
