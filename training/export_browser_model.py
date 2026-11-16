"""Export a trained Helio GPT model for the Transformers.js browser runtime."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VARIANT = os.environ.get("HELIO_VARIANT", "flash").strip().lower()
SOURCE = Path(os.environ.get("HELIO_SOURCE_DIR", str(ROOT / "output" / f"helio-gen1-{VARIANT}")))
WEB_MODELS = ROOT.parent / "web" / "models"
DESTINATION = WEB_MODELS / f"helio-gen1-{VARIANT}"


def main() -> None:
    if VARIANT not in {"flash", "pro"}:
        raise SystemExit("HELIO_VARIANT должен быть flash или pro.")
    if not (SOURCE / "config.json").is_file() or not (SOURCE / "tokenizer.json").is_file():
        raise SystemExit(f"Не найдена обученная модель в {SOURCE}. Сначала запусти training/train.py.")
    DESTINATION.mkdir(parents=True, exist_ok=True)
    onnx_dir = DESTINATION / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)

    command = [
        "optimum-cli",
        "export",
        "onnx",
        "--model",
        str(SOURCE),
        "--task",
        "text-generation",
        str(onnx_dir),
    ]
    print("Экспортирую собственные веса Helio в ONNX…")
    subprocess.run(command, check=True)

    model_path = onnx_dir / "model.onnx"
    if not model_path.is_file():
        candidates = list(onnx_dir.glob("*.onnx"))
        if len(candidates) != 1:
            raise SystemExit(f"Ожидал один файл model.onnx, найдено: {[p.name for p in candidates]}")
        model_path = candidates[0]
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantized_path = onnx_dir / "model_quantized.onnx"
    print("Делаю компактную динамическую INT8-копию для браузеров и планшетов…")
    quantize_dynamic(
        model_input=str(model_path),
        model_output=str(quantized_path),
        weight_type=QuantType.QInt8,
    )
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "generation_config.json"):
        source_file = SOURCE / name
        if source_file.is_file():
            shutil.copy2(source_file, DESTINATION / name)

    size_mib = sum(path.stat().st_size for path in DESTINATION.rglob("*") if path.is_file()) / (1024 * 1024)
    print(f"Готово: {DESTINATION} ({size_mib:.1f} MiB)")
    print("Добавь содержимое web/models в репозиторий и опубликуй GitHub Pages, чтобы сайт загрузил Helio без Qwen.")


if __name__ == "__main__":
    main()

