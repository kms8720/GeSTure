export const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const JUNGSEONG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
export const JONGSEONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const CHOSEONG_INDEX = new Map(CHOSEONG.map((jamo, index) => [jamo, index]));
const JUNGSEONG_INDEX = new Map(JUNGSEONG.map((jamo, index) => [jamo, index]));
const JONGSEONG_INDEX = new Map(JONGSEONG.map((jamo, index) => [jamo, index]));

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;

/** 겹받침을 낱자로 풀어 쓴다. 이 전시가 만들 수 있는 자모는 31개 기본 낱자뿐이다 */
const JONGSEONG_PARTS: Record<string, string[]> = {
  'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'],
  'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'],
  'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'],
  'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'],
  'ㄲ': ['ㄱ', 'ㄱ'], 'ㅆ': ['ㅅ', 'ㅅ']
};

/** 복합 모음을 기본 모음으로 풀어 쓴다 */
const JUNGSEONG_PARTS: Record<string, string[]> = {
  'ㅘ': ['ㅗ', 'ㅏ'], 'ㅙ': ['ㅗ', 'ㅐ'], 'ㅝ': ['ㅜ', 'ㅓ'], 'ㅞ': ['ㅜ', 'ㅔ']
};

/** 쌍자음을 기본 자음으로 풀어 쓴다 */
const CHOSEONG_PARTS: Record<string, string[]> = {
  'ㄲ': ['ㄱ', 'ㄱ'], 'ㄸ': ['ㄷ', 'ㄷ'], 'ㅃ': ['ㅂ', 'ㅂ'],
  'ㅆ': ['ㅅ', 'ㅅ'], 'ㅉ': ['ㅈ', 'ㅈ']
};

export function composeSyllable(choseong: string, jungseong: string, jongseong: string): string
{
  const choseongIndex = CHOSEONG_INDEX.get(choseong);
  const jungseongIndex = JUNGSEONG_INDEX.get(jungseong);
  const jongseongIndex = JONGSEONG_INDEX.get(jongseong);

  if (choseongIndex === undefined || jungseongIndex === undefined || jongseongIndex === undefined)
  {
    return `${choseong}${jungseong}${jongseong}`;
  }

  return String.fromCharCode(SYLLABLE_BASE + ((choseongIndex * 21) + jungseongIndex) * 28 + jongseongIndex);
}

/** 자모 낱자 배열을 완성형 한글로 조합한다. 조합되지 않는 낱자는 그대로 남는다 */
export function composeJamo(tokens: string[]): string
{
  const output: string[] = [];
  let index = 0;

  while (index < tokens.length)
  {
    const current = tokens[index];
    const nextToken = tokens[index + 1];

    if (CHOSEONG_INDEX.has(current) && nextToken && JUNGSEONG_INDEX.has(nextToken))
    {
      index += 2;

      let jongseong = '';
      const finalCandidate = tokens[index];
      const following = tokens[index + 1];
      if (finalCandidate && JONGSEONG_INDEX.has(finalCandidate) && !JUNGSEONG_INDEX.has(following ?? ''))
      {
        jongseong = finalCandidate;
        index += 1;
      }

      output.push(composeSyllable(current, nextToken, jongseong));
      continue;
    }

    output.push(current);
    index += 1;
  }

  return output.join('');
}

/**
 * 한글 단어를 이 전시가 표현할 수 있는 31개 기본 자모 낱자 배열로 분해한다.
 * 쌍자음, 겹받침, 복합 모음은 기본 낱자로 풀어 쓴다.
 */
export function decomposeWord(word: string): string[]
{
  const out: string[] = [];

  for (const char of word)
  {
    const code = char.charCodeAt(0);

    if (code < SYLLABLE_BASE || code > SYLLABLE_LAST)
    {
      out.push(char);
      continue;
    }

    const offset = code - SYLLABLE_BASE;
    const choseong = CHOSEONG[Math.floor(offset / (21 * 28))];
    const jungseong = JUNGSEONG[Math.floor(offset / 28) % 21];
    const jongseong = JONGSEONG[offset % 28];

    out.push(...(CHOSEONG_PARTS[choseong] ?? [choseong]));
    out.push(...(JUNGSEONG_PARTS[jungseong] ?? [jungseong]));
    if (jongseong)
    {
      out.push(...(JONGSEONG_PARTS[jongseong] ?? [jongseong]));
    }
  }

  return out;
}

export const KOREAN_WORD_PATTERN = /^[가-힣]{1,4}$/;

export function isValidKoreanWord(value: string): boolean
{
  return KOREAN_WORD_PATTERN.test(value.trim());
}
