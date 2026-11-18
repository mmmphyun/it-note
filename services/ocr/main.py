"""한국어 손글씨 인식(jysvai/ko-hand-ocr) 전용 Python HTTP 사이드카 서버."""

import base64
import time
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="It!note ko-hand-ocr Sidecar", version="0.1.0")

_reader: Optional[object] = None


class OcrRequest(BaseModel):
    imageBase64: str


class OcrResponse(BaseModel):
    text: str
    latencyMs: float
    model: str = "jysvai/ko-hand-ocr"


def _get_reader():
    """최초 요청 시 localdeel/ko-hand-ocr 모델 가중치를 지연 로드한다."""
    global _reader
    if _reader is None:
        from huggingface_hub import snapshot_download
        from kohandocr.reader import Reader

        folder = snapshot_download(
            "localdeel/ko-hand-ocr",
            ignore_patterns=["ensemble/*", "assets/*"],
        )
        _reader = Reader(folder, device="cpu")
    return _reader


def _decode_base64_image(data_url_or_b64: str) -> bytes:
    """Data URL 접두사를 제거하고 순수 이미지 바이트를 디코딩한다."""
    raw = data_url_or_b64.strip()
    if "," in raw and raw.startswith("data:image/"):
        raw = raw.split(",", 1)[1]
    return base64.b64decode(raw)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": "jysvai/ko-hand-ocr"}


@app.post("/ocr", response_model=OcrResponse)
def recognize_handwriting(req: OcrRequest) -> OcrResponse:
    if not req.imageBase64.strip():
        raise HTTPException(status_code=400, detail="imageBase64 is required")

    started = time.perf_counter()
    try:
        image_bytes = _decode_base64_image(req.imageBase64)
        reader = _get_reader()
        result = reader.read_photo(image_bytes)
        text = result if isinstance(result, str) else " ".join(map(str, result))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"OCR inference failed: {exc}") from exc

    latency_ms = round((time.perf_counter() - started) * 1000.0, 2)
    return OcrResponse(text=text.strip(), latencyMs=latency_ms)
