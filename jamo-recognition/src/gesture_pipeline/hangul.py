CHOSEONG = [
    "ㄱ",
    "ㄲ",
    "ㄴ",
    "ㄷ",
    "ㄸ",
    "ㄹ",
    "ㅁ",
    "ㅂ",
    "ㅃ",
    "ㅅ",
    "ㅆ",
    "ㅇ",
    "ㅈ",
    "ㅉ",
    "ㅊ",
    "ㅋ",
    "ㅌ",
    "ㅍ",
    "ㅎ",
]

JUNGSEONG = [
    "ㅏ",
    "ㅐ",
    "ㅑ",
    "ㅒ",
    "ㅓ",
    "ㅔ",
    "ㅕ",
    "ㅖ",
    "ㅗ",
    "ㅘ",
    "ㅙ",
    "ㅚ",
    "ㅛ",
    "ㅜ",
    "ㅝ",
    "ㅞ",
    "ㅟ",
    "ㅠ",
    "ㅡ",
    "ㅢ",
    "ㅣ",
]

JONGSEONG = [
    "",
    "ㄱ",
    "ㄲ",
    "ㄳ",
    "ㄴ",
    "ㄵ",
    "ㄶ",
    "ㄷ",
    "ㄹ",
    "ㄺ",
    "ㄻ",
    "ㄼ",
    "ㄽ",
    "ㄾ",
    "ㄿ",
    "ㅀ",
    "ㅁ",
    "ㅂ",
    "ㅄ",
    "ㅅ",
    "ㅆ",
    "ㅇ",
    "ㅈ",
    "ㅊ",
    "ㅋ",
    "ㅌ",
    "ㅍ",
    "ㅎ",
]

CHOSEONG_INDEX = {jamo: index for index, jamo in enumerate(CHOSEONG)}
JUNGSEONG_INDEX = {jamo: index for index, jamo in enumerate(JUNGSEONG)}
JONGSEONG_INDEX = {jamo: index for index, jamo in enumerate(JONGSEONG)}

CONSONANTS = set(CHOSEONG_INDEX)
VOWELS = set(JUNGSEONG_INDEX)


def compose_jamo(tokens: list[str]) -> str:
    output: list[str] = []
    index = 0
    while index < len(tokens):
        current = tokens[index]
        next_token = tokens[index + 1] if index + 1 < len(tokens) else None

        if current in CONSONANTS and next_token in VOWELS:
            choseong = current
            jungseong = next_token
            index += 2

            jongseong = ""
            final_candidate = tokens[index] if index < len(tokens) else None
            following = tokens[index + 1] if index + 1 < len(tokens) else None
            if final_candidate in JONGSEONG_INDEX and following not in VOWELS:
                jongseong = final_candidate
                index += 1

            output.append(compose_syllable(choseong, jungseong, jongseong))
            continue

        output.append(current)
        index += 1
    return "".join(output)


def compose_syllable(choseong: str, jungseong: str, jongseong: str = "") -> str:
    choseong_index = CHOSEONG_INDEX[choseong]
    jungseong_index = JUNGSEONG_INDEX[jungseong]
    jongseong_index = JONGSEONG_INDEX[jongseong]
    codepoint = 0xAC00 + ((choseong_index * 21) + jungseong_index) * 28 + jongseong_index
    return chr(codepoint)


class HangulComposer:
    def __init__(self) -> None:
        self.tokens: list[str] = []

    def append(self, jamo: str) -> None:
        self.tokens.append(jamo)

    def backspace(self) -> None:
        if self.tokens:
            self.tokens.pop()

    def clear(self) -> None:
        self.tokens.clear()

    @property
    def raw(self) -> str:
        return "".join(self.tokens)

    @property
    def text(self) -> str:
        return compose_jamo(self.tokens)
