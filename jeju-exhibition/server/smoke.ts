/**
 * 파이프라인 점검용 스크립트.
 *   npx tsx server/smoke.ts
 *
 * 인식기, 도달 균등화, 단어장 대체 경로, Ollama 경로를 차례로 확인한다.
 */
import { FINGERS, HandState, POSE_CLASSES } from './poseClasses.js';
import { recognizePose, rankPoses } from './poseRecognizer.js';
import { JamoSlot, correctWord, matchVocabulary } from './wordCorrection.js';

function hand(values: number[]): HandState
{
  return Object.fromEntries(FINGERS.map((finger, index) => [finger, values[index]])) as HandState;
}

function line(label: string): void
{
  console.log(`\n${'='.repeat(78)}\n${label}\n${'='.repeat(78)}`);
}

line(`1. 포즈 클래스 ${POSE_CLASSES.length}개`);
POSE_CLASSES.forEach((entry) =>
{
  const flex = FINGERS.map((finger) => String(Math.round(entry.flexion[finger])).padStart(3)).join(' ');
  console.log(`  ${entry.jamo.join('/').padEnd(16)} [${flex}]  bias ${String(entry.bias).padStart(7)}  도달 ${entry.reachShare}%`);
});

line('2. 각 클래스의 대표 굽힘을 그대로 넣으면 그 클래스로 인식되는가');
let hit = 0;
POSE_CLASSES.forEach((entry) =>
{
  const result = recognizePose(hand(FINGERS.map((finger) => entry.flexion[finger])));
  const ok = result.classId === entry.id;
  if (ok)
  {
    hit += 1;
  }
  else
  {
    console.log(`  X ${entry.jamo.join('/')} -> ${result.jamoCandidates.join('/')} (bias 때문에 밀림)`);
  }
});
console.log(`  ${hit}/${POSE_CLASSES.length} 자기 클래스로 인식`);

line('3. rest pose 판정');
console.log('  100,100,100,100,100 ->', recognizePose(hand([100, 100, 100, 100, 100])).status);
console.log('   90, 90, 90, 90, 90 ->', recognizePose(hand([90, 90, 90, 90, 90])).status);
console.log('   84, 90, 90, 90, 90 ->', recognizePose(hand([84, 90, 90, 90, 90])).status);

line('4. 무작위 손 상태 5개의 인식 결과');
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
const next = rng(20260808);
const sampled: JamoSlot[] = [];
for (let i = 0; i < 8; i += 1)
{
  const values = FINGERS.map(() => Math.round(next() * 100));
  const result = recognizePose(hand(values));
  if (result.status === 'recognized' && !sampled.some((slot) => slot.classId === result.classId))
  {
    sampled.push({ classId: result.classId as string, candidates: result.jamoCandidates });
  }
  if (i < 5)
  {
    console.log(
      `  [${values.map((v) => String(v).padStart(3)).join(' ')}] -> ` +
      `${result.status === 'rest' ? 'REST' : result.jamoCandidates.join('/')} (확신도 ${result.confidence.toFixed(2)})`
    );
  }
}

const slots = sampled.slice(0, 6);
line('5. 이 슬롯들로 단어 만들기');
console.log('  슬롯:', slots.map((slot) => `[${slot.candidates.join('')}]`).join(''));
console.log('  조합 가능한 자모열 수:', slots.reduce((total, slot) => total * slot.candidates.length, 1));

console.log('\n  단어장 대체 경로 (LLM 없이):');
matchVocabulary(slots, 5).forEach((match) =>
{
  console.log(`    ${match.word.padEnd(6)} 덮인 비율 ${Math.round(match.coverage * 100)}%  (${match.jamo.join('')})`);
});

const run = async (): Promise<void> =>
{
  console.log('\n  Ollama 경로:');
  const correction = await correctWord(slots);
  console.log(`    source        ${correction.source} / status ${correction.status}`);
  console.log(`    correctedWord ${correction.correctedWord}`);
  console.log(`    chosenJamo    ${correction.chosenJamo.join('')}`);
  console.log(`    composedText  ${correction.composedText}`);
  console.log(`    candidates    ${correction.candidates.join(', ')}`);
  console.log(`    note          ${correction.note}`);
  console.log(`    elapsed       ${correction.elapsedMs}ms`);

  line('6. 손이 모든 자모를 만들 수 있는 슬롯으로 한 번 더');
  const wide: JamoSlot[] = [
    { classId: 'a', candidates: ['ㅅ'] },
    { classId: 'b', candidates: ['ㅏ', 'ㅓ'] },
    { classId: 'c', candidates: ['ㄹ'] },
    { classId: 'd', candidates: ['ㅏ', 'ㅗ'] },
    { classId: 'e', candidates: ['ㅇ'] },
    { classId: 'f', candidates: ['ㅁ', 'ㄴ'] }
  ];
  console.log('  슬롯:', wide.map((slot) => `[${slot.candidates.join('')}]`).join(''));
  const second = await correctWord(wide);
  console.log(`    ${second.source} -> ${second.correctedWord} (${second.chosenJamo.join('')}) ${second.elapsedMs}ms`);
  console.log('    단어장 상위:', matchVocabulary(wide, 3).map((m) => `${m.word}(${Math.round(m.coverage * 100)}%)`).join(', '));
};

void run();
