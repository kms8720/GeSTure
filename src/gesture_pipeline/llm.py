from dataclasses import asdict, dataclass
import json
import re
from typing import Any
from urllib import error, request


DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen3:14b"


@dataclass(frozen=True)
class WordCorrectionResult:
    corrected_text: str
    candidates: list[str]
    note: str
    model: str
    status: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class OllamaWordCorrector:
    def __init__(self, base_url: str = DEFAULT_OLLAMA_URL, model: str = DEFAULT_OLLAMA_MODEL) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    def correct(self, raw_jamo: str, composed_text: str) -> WordCorrectionResult:
        prompt = _build_word_correction_prompt(raw_jamo, composed_text)
        payload = {
            "model": self.model,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You correct Korean words from noisy fingerspelling recognition. "
                        "Return only valid JSON with double-quoted keys and string values. "
                        "Do not write explanations outside JSON."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        }

        try:
            response = self._post_json("/api/chat", payload)
        except (OSError, error.URLError) as exc:
            return _fallback_result(composed_text, self.model, "unavailable", f"Ollama unavailable: {exc}")
        except Exception as exc:
            return _fallback_result(composed_text, self.model, "error", f"Ollama request failed: {exc}")

        try:
            content = response["message"]["content"]
            parsed = _parse_json_object(str(content))
            corrected_text = str(parsed.get("corrected_text") or composed_text)
            candidates = parsed.get("candidates")
            if not isinstance(candidates, list):
                candidates = [corrected_text] if corrected_text else []
            candidates = [str(candidate) for candidate in candidates if str(candidate)]
            corrected_text, candidates = _validate_correction(composed_text, corrected_text, candidates)
            note = str(parsed.get("note") or "")
        except Exception as exc:
            return _fallback_result(composed_text, self.model, "error", f"Invalid LLM response: {exc}")

        return WordCorrectionResult(
            corrected_text=corrected_text,
            candidates=candidates,
            note=note,
            model=self.model,
            status="ok",
        )

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        http_request = request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(http_request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))


class DisabledWordCorrector:
    def __init__(self, model: str = "disabled") -> None:
        self.model = model

    def correct(self, raw_jamo: str, composed_text: str) -> WordCorrectionResult:
        return _fallback_result(composed_text, self.model, "unavailable", "LLM disabled")


def _build_word_correction_prompt(raw_jamo: str, composed_text: str) -> str:
    return f"""다음은 전시용 손 지화 인식 결과입니다.

목표:
- 창작 문장을 만들지 마세요.
- 입력된 자모/음절을 가장 자연스러운 한국어 단어 또는 짧은 어절 후보로 보정하세요.
- 확실하지 않으면 composed_text를 그대로 유지하세요.
- 로마자, 영어, 중국어, 일본어, 음역 표기를 절대 사용하지 마세요.
- corrected_text와 candidates는 한글, 공백, 기본 문장부호만 포함해야 합니다.
- JSON만 출력하세요.
- JSON 키와 문자열 값은 반드시 큰따옴표를 사용하세요.

입력:
- raw_jamo: {raw_jamo}
- composed_text: {composed_text}

출력 JSON 형식:
{{
  "corrected_text": "보정된 텍스트",
  "candidates": ["후보1", "후보2"],
  "note": "짧은 근거"
}}
"""


def _parse_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.startswith("json"):
            stripped = stripped[4:].strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("JSON object not found")
    parsed = json.loads(stripped[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("LLM response must be a JSON object")
    return parsed


_KOREAN_TEXT_RE = re.compile(r"^[가-힣ㄱ-ㅎㅏ-ㅣ\s.,!?~'\"()\\-]*$")


def _validate_correction(
    composed_text: str,
    corrected_text: str,
    candidates: list[str],
) -> tuple[str, list[str]]:
    if not _is_allowed_korean_text(corrected_text):
        raise ValueError(f"LLM correction contains unsupported characters: {corrected_text}")

    valid_candidates = [candidate for candidate in candidates if _is_allowed_korean_text(candidate)]
    if not valid_candidates and corrected_text:
        valid_candidates = [corrected_text]
    return corrected_text, valid_candidates


def _is_allowed_korean_text(text: str) -> bool:
    return bool(_KOREAN_TEXT_RE.fullmatch(text))


def _fallback_result(composed_text: str, model: str, status: str, note: str) -> WordCorrectionResult:
    candidates = [composed_text] if composed_text else []
    return WordCorrectionResult(
        corrected_text=composed_text,
        candidates=candidates,
        note=note,
        model=model,
        status=status,
    )
