"""Prepare Russian, reviewed OpenAssistant conversation paths for Helio SFT."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any

from datasets import load_dataset


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
OUTPUT_DIR = ROOT / "output" / "dataset"


def is_usable(row: dict[str, Any]) -> bool:
    if row.get("lang") != "ru" or row.get("deleted"):
        return False
    if row.get("review_result") is False:
        return False
    rank = row.get("rank")
    if rank is not None and int(rank) > 1:
        return False
    labels = row.get("labels") or {}
    if isinstance(labels, dict):
        pii = labels.get("pii") or {}
        if isinstance(pii, dict) and float(pii.get("value") or 0) > 0:
            return False
    text = str(row.get("text") or "").strip()
    return bool(text) and len(text) <= 6000


def make_examples(split: Any) -> list[dict[str, Any]]:
    rows = [dict(row) for row in split if is_usable(dict(row))]
    by_id = {row["message_id"]: row for row in rows}
    examples: list[dict[str, Any]] = []

    for answer in rows:
        if answer.get("role") != "assistant":
            continue
        chain: list[dict[str, Any]] = []
        current: dict[str, Any] | None = answer
        seen: set[str] = set()
        while current is not None:
            message_id = str(current.get("message_id") or "")
            if not message_id or message_id in seen:
                chain = []
                break
            seen.add(message_id)
            chain.append(current)
            parent_id = current.get("parent_id")
            current = by_id.get(parent_id) if parent_id else None

        chain.reverse()
        messages: list[dict[str, str]] = []
        for item in chain:
            role = "assistant" if item.get("role") == "assistant" else "user"
            content = str(item.get("text") or "").strip()
            if not content:
                continue
            if messages and messages[-1]["role"] == role:
                messages = []
                break
            messages.append({"role": role, "content": content})
        if (
            len(messages) >= 2
            and messages[0]["role"] == "user"
            and messages[-1]["role"] == "assistant"
        ):
            examples.append({"messages": messages})
    return examples


def read_local_examples(path: Path) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    if not path.exists():
        return examples
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        item = json.loads(line)
        messages = item.get("messages")
        if not isinstance(messages, list) or len(messages) < 2:
            raise ValueError(f"{path.name}:{line_number}: expected a messages array with at least two turns")
        examples.append(item)
    return examples


def write_jsonl(path: Path, examples: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        for example in examples:
            file.write(json.dumps(example, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-train", type=int, default=2500)
    parser.add_argument("--max-validation", type=int, default=200)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    print("Downloading the reviewed OpenAssistant dataset and selecting Russian conversations…")
    dataset = load_dataset("OpenAssistant/oasst1")
    train = make_examples(dataset["train"])
    validation = make_examples(dataset["validation"])

    rng = random.Random(args.seed)
    rng.shuffle(train)
    rng.shuffle(validation)
    train = train[: args.max_train]
    validation = validation[: args.max_validation]

    # Add a small, hand-written Helio-style set to shape tone and topic switching.
    train.extend(read_local_examples(DATA_DIR / "helio_train.jsonl"))
    validation.extend(read_local_examples(DATA_DIR / "helio_validation.jsonl"))
    rng.shuffle(train)

    if not train or not validation:
        raise RuntimeError("The prepared dataset is empty. Check the dataset fields and language filters.")

    write_jsonl(OUTPUT_DIR / "train.jsonl", train)
    write_jsonl(OUTPUT_DIR / "validation.jsonl", validation)
    print(f"Prepared {len(train)} train conversations and {len(validation)} validation conversations.")
    print(f"Files saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
