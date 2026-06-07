from dataclasses import asdict, dataclass
import json
import re
from typing import Any
from urllib import error, request

from gesture_pipeline.hangul import CHOSEONG, JONGSEONG, JUNGSEONG


DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen3:14b"
DEFAULT_CORRECTION_VOCABULARY = [
    "안녕",
    "안녕하세요",
    "반가워요",
    "고마워요",
    "좋아요",
    "괜찮아요",
    "사랑",
    "행복",
    "희망",
    "평화",
    "소통",
    "마음",
    "함께",
    "미래",
    "가치",
    "감사",
    "친구",
    "가족",
    "학교",
    "사람",
    "우리",
    "오늘",
    "내일",
    "꿈",
    "빛",
    "손",
    "목소리",
    "용기",
    "변화",
]


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
                        "Even when the recognition input is very noisy, choose a natural Korean word "
                        "or short Korean phrase that a visitor can read. "
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
- 입력된 자모/음절이 많이 깨져 있어도 관객이 읽을 수 있는 자연스러운 한국어 단어 또는 짧은 어절로 보정하세요.
- corrected_text는 반드시 완성된 한글 음절로 된 말이 되는 한국어여야 합니다.
- ㄱ, ㅏ 같은 낱자 자모를 corrected_text에 그대로 넣지 마세요.
- 입력이 너무 불확실하면 원문을 그대로 두지 말고, 발음/형태가 조금이라도 가까운 흔한 한국어 단어 후보를 고르세요.
- 단어 후보가 여러 개 가능하면 전시 맥락에 어울리는 긍정적이고 쉬운 단어를 우선하세요.
- 입력에 낱자 자모가 섞여 심하게 깨진 경우에는 아래 안전 단어장 안에서 가장 가까운 단어를 고르세요.
- 로마자, 영어, 중국어, 일본어, 음역 표기를 절대 사용하지 마세요.
- corrected_text와 candidates는 완성형 한글 음절, 공백, 기본 문장부호만 포함해야 합니다.
- JSON만 출력하세요.
- JSON 키와 문자열 값은 반드시 큰따옴표를 사용하세요.

안전 단어장:
{", ".join(DEFAULT_CORRECTION_VOCABULARY)}

입력:
- raw_jamo: {raw_jamo}
- composed_text: {composed_text}

출력 JSON 형식:
{{
  "corrected_text": "완성된 한국어 단어",
  "candidates": ["완성된 후보1", "완성된 후보2"],
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


_KOREAN_TEXT_RE = re.compile(r"^[가-힣\s.,!?~'\"()\\-]*$")
_COMPAT_JAMO_RE = re.compile(r"[ㄱ-ㅎㅏ-ㅣ]")


def _validate_correction(
    composed_text: str,
    corrected_text: str,
    candidates: list[str],
) -> tuple[str, list[str]]:
    valid_candidates = [candidate for candidate in candidates if _is_allowed_korean_text(candidate)]
    if _is_allowed_korean_text(corrected_text):
        selected = corrected_text
    elif valid_candidates:
        selected = valid_candidates[0]
    else:
        raise ValueError(f"LLM correction contains unsupported characters: {corrected_text}")

    if selected not in valid_candidates:
        valid_candidates.insert(0, selected)
    if not valid_candidates and selected:
        valid_candidates = [selected]

    if _source_looks_noisy(composed_text):
        vocabulary_hit = _first_vocabulary_hit([selected, *valid_candidates])
        if vocabulary_hit is None:
            vocabulary_hit = _pick_vocabulary_fallback(composed_text, [selected, *valid_candidates])
        selected = vocabulary_hit
        valid_candidates = [candidate for candidate in [selected, *valid_candidates] if candidate in DEFAULT_CORRECTION_VOCABULARY]
        valid_candidates = list(dict.fromkeys(valid_candidates))
    return selected, valid_candidates


def _is_allowed_korean_text(text: str) -> bool:
    stripped = text.strip()
    return bool(stripped and _KOREAN_TEXT_RE.fullmatch(stripped) and re.search(r"[가-힣]", stripped))


def _source_looks_noisy(composed_text: str) -> bool:
    return bool(_COMPAT_JAMO_RE.search(composed_text))


def _first_vocabulary_hit(candidates: list[str]) -> str | None:
    for candidate in candidates:
        stripped = candidate.strip()
        if stripped in DEFAULT_CORRECTION_VOCABULARY:
            return stripped
    return None


def _pick_vocabulary_fallback(composed_text: str, candidates: list[str]) -> str:
    source = _decompose_hangul_to_jamo(composed_text)
    best_word = DEFAULT_CORRECTION_VOCABULARY[0]
    best_score = None
    for word in DEFAULT_CORRECTION_VOCABULARY:
        target = _decompose_hangul_to_jamo(word)
        score = _edit_distance(source, target)
        if any(word in candidate or candidate in word for candidate in candidates):
            score -= 2
        if best_score is None or score < best_score:
            best_score = score
            best_word = word
    return best_word


def _decompose_hangul_to_jamo(text: str) -> str:
    output: list[str] = []
    for char in text:
        codepoint = ord(char)
        if 0xAC00 <= codepoint <= 0xD7A3:
            offset = codepoint - 0xAC00
            choseong_index = offset // (21 * 28)
            jungseong_index = (offset % (21 * 28)) // 28
            jongseong_index = offset % 28
            output.append(CHOSEONG[choseong_index])
            output.append(JUNGSEONG[jungseong_index])
            if JONGSEONG[jongseong_index]:
                output.append(JONGSEONG[jongseong_index])
        elif _COMPAT_JAMO_RE.fullmatch(char):
            output.append(char)
    return "".join(output)


def _edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_char in enumerate(right, start=1):
            insertion = current[right_index - 1] + 1
            deletion = previous[right_index] + 1
            substitution = previous[right_index - 1] + (left_char != right_char)
            current.append(min(insertion, deletion, substitution))
        previous = current
    return previous[-1]


def _fallback_result(composed_text: str, model: str, status: str, note: str) -> WordCorrectionResult:
    candidates = [composed_text] if composed_text else []
    return WordCorrectionResult(
        corrected_text=composed_text,
        candidates=candidates,
        note=note,
        model=model,
        status=status,
    )
