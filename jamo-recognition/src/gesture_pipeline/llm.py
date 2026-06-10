from dataclasses import asdict, dataclass
import json
import re
from typing import Any
from urllib import error, request


DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen3:14b"
DEFAULT_FALLBACK_WORD = "안녕"


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

        try:
            response = self._chat(prompt)
        except (OSError, error.URLError) as exc:
            return _fallback_result(composed_text, self.model, "unavailable", f"Ollama unavailable: {exc}")
        except Exception as exc:
            return _fallback_result(composed_text, self.model, "error", f"Ollama request failed: {exc}")

        try:
            corrected_text, candidates, note = _parse_and_validate_response(response, composed_text)
        except Exception as first_exc:
            try:
                response = self._chat(_build_repair_prompt(raw_jamo, composed_text, str(first_exc)))
                corrected_text, candidates, note = _parse_and_validate_response(response, composed_text)
                note = f"repaired after invalid first response: {note}"
            except Exception as second_exc:
                return _fallback_result(
                    DEFAULT_FALLBACK_WORD,
                    self.model,
                    "error",
                    f"Invalid LLM response: {first_exc}; retry failed: {second_exc}",
                )

        try:
            checked_response = self._chat(_build_semantic_check_prompt(raw_jamo, composed_text, corrected_text, candidates))
            checked_text, checked_candidates, checked_note = _parse_and_validate_response(
                checked_response,
                corrected_text,
            )
            if checked_text != corrected_text or checked_candidates != candidates:
                note = f"{note}; semantic check: {checked_note}".strip("; ")
            corrected_text = checked_text
            candidates = _merge_checked_candidates(corrected_text, checked_candidates)
        except Exception as exc:
            note = f"{note}; semantic check skipped: {exc}".strip("; ")

        return WordCorrectionResult(
            corrected_text=corrected_text,
            candidates=candidates,
            note=note,
            model=self.model,
            status="ok",
        )

    def _chat(self, prompt: str) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You convert noisy Korean jamo/fingerspelling recognition into one meaningful Korean word. "
                        "The final corrected_text must be exactly one Korean word between 1 and 4 Hangul syllables. "
                        "Return only valid JSON with double-quoted keys and string values. "
                        "Do not write explanations outside JSON."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
        }
        return self._post_json("/api/chat", payload)

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


def _parse_and_validate_response(response: dict[str, Any], composed_text: str) -> tuple[str, list[str], str]:
    content = response["message"]["content"]
    parsed = _parse_json_object(str(content))
    corrected_text = str(parsed.get("corrected_text") or composed_text).strip()
    candidates = parsed.get("candidates")
    if not isinstance(candidates, list):
        candidates = [corrected_text] if corrected_text else []
    candidates = [str(candidate).strip() for candidate in candidates if str(candidate).strip()]
    corrected_text, candidates = _validate_correction(corrected_text, candidates)
    note = str(parsed.get("note") or "")
    return corrected_text, candidates, note


class DisabledWordCorrector:
    def __init__(self, model: str = "disabled") -> None:
        self.model = model

    def correct(self, raw_jamo: str, composed_text: str) -> WordCorrectionResult:
        return _fallback_result(composed_text, self.model, "unavailable", "LLM disabled")


def _build_word_correction_prompt(raw_jamo: str, composed_text: str) -> str:
    return f"""다음은 전시용 손 지화 인식 결과입니다.

목표:
- 입력된 raw_jamo와 composed_text를 보고, 입력에 포함된 자모/음절과 가장 많이 겹치거나 발음/형태가 가장 가까운 의미 있는 한국어 단어 하나를 고르세요.
- corrected_text는 반드시 1글자에서 4글자 사이의 완성형 한글 단어여야 합니다.
- corrected_text에는 공백, 문장부호, 낱자 자모(ㄱ, ㅏ 등), 영어, 로마자, 숫자, 한자, 일본어를 넣지 마세요.
- 문장, 어절, 설명문, 음역, 새로 만든 조합어를 출력하지 마세요.
- corrected_text는 한국어 화자가 실제로 쓰는 흔한 단어여야 합니다. 입력 조각을 억지로 붙인 새 단어는 금지입니다.
- 입력이 심하게 깨져 있어도 원문을 그대로 두지 말고, 입력 자모와 가장 많이 닮은 흔하고 의미 있는 한국어 단어를 선택하세요.
- 입력이 너무 불확실하면 조합어를 만들지 말고, 입력과 일부라도 닮은 실제 한국어 단어를 고르세요.
- 긴 조합어가 어색하면 1~2글자의 더 짧고 확실한 실제 단어를 우선하세요.
- 잘못된 예: "양파하야", "양파해배", "아파일", "애프리"처럼 입력 조각을 붙인 어색한 말
- 좋은 예: "양파", "사랑", "강", "마음", "답변"처럼 실제로 쓰이는 단어
- candidates도 모두 1~4글자의 완성형 한글 단어만 넣으세요.
- 후보가 여러 개 가능하면 입력 자모와 가장 많이 겹치는 단어를 먼저, 그 다음 전시 맥락에 어울리는 쉽고 긍정적인 단어를 고르세요.
- JSON만 출력하세요.
- JSON 키와 문자열 값은 반드시 큰따옴표를 사용하세요.

입력:
- raw_jamo: {raw_jamo}
- composed_text: {composed_text}

출력 JSON 형식:
{{
  "corrected_text": "단어",
  "candidates": ["후보1", "후보2", "후보3"],
  "note": "짧은 근거"
}}
"""


def _build_semantic_check_prompt(
    raw_jamo: str,
    composed_text: str,
    corrected_text: str,
    candidates: list[str],
) -> str:
    return f"""다음 LLM 보정 결과를 검수하세요.

검수 기준:
- corrected_text는 1~4글자의 완성형 한글 단어여야 합니다.
- 한국어 화자가 실제로 쓰는 의미 있는 단어여야 합니다.
- 입력 조각을 억지로 붙인 새 조합어, 어색한 합성어, 뜻이 불분명한 단어는 실패입니다.
- "양파하야", "양파해배", "아파일", "애프리"처럼 입력 조각을 이어 붙인 말은 실패입니다.
- 실패하면 더 짧더라도 확실히 실제로 쓰는 단어를 고르세요. 예: 양파, 사랑, 마음, 답변
- 실패한 단어는 candidates에 다시 넣지 마세요.
- 실패라면 raw_jamo/composed_text와 가장 많이 닮은 실제 한국어 단어로 교체하세요.
- 성공이라면 corrected_text를 그대로 유지하세요.
- JSON만 출력하세요.

입력:
- raw_jamo: {raw_jamo}
- composed_text: {composed_text}
- corrected_text: {corrected_text}
- candidates: {", ".join(candidates)}

출력 JSON 형식:
{{
  "corrected_text": "단어",
  "candidates": ["후보1", "후보2", "후보3"],
  "note": "검수 결과"
}}
"""


def _build_repair_prompt(raw_jamo: str, composed_text: str, reason: str) -> str:
    return f"""이전 응답이 규칙을 어겼습니다.

실패 이유:
{reason}

반드시 아래 규칙을 지켜 다시 출력하세요.
- corrected_text는 1~4글자의 의미 있는 한국어 단어 하나여야 합니다.
- 완성형 한글 음절만 허용합니다. 예: 안녕, 사랑, 평화, 마음
- 공백, 문장부호, 낱자 자모, 영어, 숫자, 한자, 일본어는 금지입니다.
- 입력 자모와 가장 많이 닮은 단어를 고르세요.
- JSON만 출력하세요.

입력:
- raw_jamo: {raw_jamo}
- composed_text: {composed_text}

출력 JSON 형식:
{{
  "corrected_text": "단어",
  "candidates": ["후보1", "후보2", "후보3"],
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


_KOREAN_WORD_RE = re.compile(r"^[가-힣]{1,4}$")


def _validate_correction(
    corrected_text: str,
    candidates: list[str],
) -> tuple[str, list[str]]:
    valid_candidates = [candidate for candidate in candidates if _is_valid_korean_word(candidate)]
    if _is_valid_korean_word(corrected_text):
        selected = corrected_text
    elif valid_candidates:
        selected = valid_candidates[0]
    else:
        raise ValueError(f"LLM correction is not a 1-4 syllable Korean word: {corrected_text}")

    if selected not in valid_candidates:
        valid_candidates.insert(0, selected)
    return selected, list(dict.fromkeys(valid_candidates))


def _merge_checked_candidates(corrected_text: str, candidates: list[str]) -> list[str]:
    return [corrected_text]


def _is_valid_korean_word(text: str) -> bool:
    return bool(_KOREAN_WORD_RE.fullmatch(text.strip()))


def _fallback_result(composed_text: str, model: str, status: str, note: str) -> WordCorrectionResult:
    candidates = [composed_text] if composed_text else []
    return WordCorrectionResult(
        corrected_text=composed_text,
        candidates=candidates,
        note=note,
        model=model,
        status=status,
    )
