import { CloudSentence, WordCloudState, sentenceText, sentenceWords } from '../../../shared/wordCloud';

const hash = (word: string): number => [...word].reduce((number, char) => (number * 31 + char.codePointAt(0)!) >>> 0, 7);
const CYCLE_MS = 10_000;

/** 첨부 WordCloud의 궤도 → 정렬 → 문장 → 해산 연출. React 갱신과 애니메이션 프레임을 분리한다. */
export function createWordCloudScene(stage: HTMLElement, layer: HTMLElement, sentenceBox: HTMLElement, title: HTMLElement, announcer: HTMLElement)
{
  let state: WordCloudState = { words: [], latestWord: '', sentences: [], generating: false, storageAvailable: true };
  const nodes = new Map<string, HTMLSpanElement>();
  let selected = new Map<string, { node: HTMLSpanElement; slot: HTMLSpanElement; surface: string }>();
  let currentSentence: CloudSentence | null = null;
  let lastSentence = '';
  let phase: 'orbit' | 'halt' | 'arrange' | 'sentence' | 'release' = 'orbit';
  let cycleStart = performance.now();
  let lastFrame = 0;
  let frame = 0;
  let width = stage.clientWidth;
  let height = stage.clientHeight;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function position(word: string, now: number)
  {
    const index = state.words.indexOf(word);
    const seed = hash(word);
    const angle = index / Math.max(state.words.length, 1) * Math.PI * 2 + seed % 100 / 110 + (reducedMotion.matches ? 0 : now * (seed % 2 ? 0.000045 : -0.000038));
    const ring = 0.72 + seed % 31 / 100;
    // 글자 너비를 고려해 세로 화면에서도 단어가 화면 밖으로 잘리지 않게 한다.
    const half = Math.min(width * 0.4, word.length * (20 + seed % 15) * 0.5);
    return {
      x: Math.max(half + 16, Math.min(width - half - 16, width * (0.5 + Math.cos(angle) * 0.405 * ring))),
      y: Math.max(100, Math.min(height - 95, height * (0.55 + Math.sin(angle) * 0.375 * ring)))
    };
  }

  function place(node: HTMLElement, point: { x: number; y: number }): void
  {
    node.style.left = `${point.x}px`;
    node.style.top = `${point.y}px`;
  }

  function orbitStyle(node: HTMLSpanElement, word: string): void
  {
    node.textContent = word;
    node.style.fontSize = `${20 + hash(word) % 15}px`;
    node.style.opacity = `${0.66 + hash(word) % 24 / 100}`;
    node.className = `wc-floating-word${word === state.latestWord ? ' is-newest' : ''}`;
  }

  function reset(now: number): void
  {
    phase = 'orbit';
    stage.dataset.phase = phase;
    currentSentence = null;
    selected.clear();
    sentenceBox.replaceChildren();
    sentenceBox.classList.remove('is-visible');
    title.classList.remove('is-speaking');
    nodes.forEach((node, word) => { orbitStyle(node, word); place(node, position(word, now)); });
    cycleStart = now;
  }

  function attention(): void
  {
    const available = state.sentences.filter((sentence) => sentenceWords(sentence).every((word) => nodes.has(word)));
    const reviewed = available.filter((sentence) => sentence.origin === 'model');
    const pool = reviewed.length ? reviewed : available;
    const fresh = pool.filter((sentence) => sentenceText(sentence) !== lastSentence);
    const preferred = fresh.filter((sentence) => sentenceWords(sentence).includes(state.latestWord));
    const choices = preferred.length ? preferred : fresh.length ? fresh : pool;
    if (!choices.length) return;
    currentSentence = choices[Math.floor(Math.random() * choices.length)];
    lastSentence = sentenceText(currentSentence);
    sentenceBox.classList.toggle('is-long', lastSentence.length > 38);
    sentenceBox.replaceChildren();
    selected = new Map();
    currentSentence.parts.forEach((piece) =>
    {
      const slot = document.createElement('span');
      slot.textContent = piece.text;
      slot.className = piece.source ? 'wc-slot' : 'wc-filler';
      if (piece.source) selected.set(piece.source, { node: nodes.get(piece.source)!, slot, surface: piece.text });
      sentenceBox.append(slot);
    });
    nodes.forEach((node) => node.classList.add('is-staging'));
    title.classList.add('is-speaking');
    phase = 'halt';
  }

  function arrange(): void
  {
    const stageRect = stage.getBoundingClientRect();
    const sentenceStyle = getComputedStyle(sentenceBox);
    const fontSize = sentenceStyle.fontSize;
    // 등장 전 문장의 13px 이동을 빼고, 등장 완료 위치에 단어를 정렬한다.
    const offsetY = sentenceStyle.transform === 'none' ? 0 : new DOMMatrixReadOnly(sentenceStyle.transform).m42;
    nodes.forEach((node, word) =>
    {
      const entry = selected.get(word);
      if (!entry) { node.classList.add('is-resting'); return; }
      const rect = entry.slot.getBoundingClientRect();
      node.textContent = entry.surface;
      node.style.fontSize = fontSize;
      node.style.opacity = '1';
      node.classList.add('is-featured');
      place(node, { x: rect.left - stageRect.left + rect.width / 2, y: rect.top - stageRect.top + rect.height / 2 - offsetY });
    });
    phase = 'arrange';
  }

  function release(now: number): void
  {
    sentenceBox.classList.remove('is-visible');
    title.classList.remove('is-speaking');
    nodes.forEach((node, word) => { orbitStyle(node, word); node.classList.add('is-staging'); place(node, position(word, now)); });
    phase = 'release';
  }

  function tick(now: number): void
  {
    frame = requestAnimationFrame(tick);
    if (now - lastFrame < 1000 / 30) return;
    lastFrame = now;
    let elapsed = now - cycleStart;
    if (elapsed >= CYCLE_MS) { reset(now); elapsed = 0; }
    if (phase === 'orbit')
    {
      nodes.forEach((node, word) => place(node, position(word, now)));
      if (elapsed >= 5200) attention();
    }
    if (phase === 'halt' && elapsed >= 5390) arrange();
    if (phase === 'arrange' && elapsed >= 6600)
    {
      phase = 'sentence';
      sentenceBox.classList.add('is-visible');
      announcer.textContent = currentSentence ? sentenceText(currentSentence) : '';
    }
    if (phase === 'sentence' && elapsed >= 9000) release(now);
    stage.dataset.phase = phase;
  }

  const observer = new ResizeObserver(() =>
  {
    width = stage.clientWidth;
    height = stage.clientHeight;
    reset(performance.now());
  });
  observer.observe(stage);
  function visibility(): void
  {
    cancelAnimationFrame(frame);
    if (!document.hidden) { reset(performance.now()); frame = requestAnimationFrame(tick); }
  }
  document.addEventListener('visibilitychange', visibility);
  if (!document.hidden) frame = requestAnimationFrame(tick);

  return {
    update(next: WordCloudState): void
    {
      state = next;
      const wanted = new Set(state.words);
      nodes.forEach((node, word) => { if (!wanted.has(word)) { node.remove(); nodes.delete(word); } });
      const invalidCurrent = currentSentence && !state.sentences.some((sentence) => sentence.id === currentSentence!.id);
      state.words.forEach((word) =>
      {
        if (nodes.has(word)) return;
        const node = document.createElement('span');
        node.dataset.word = word;
        nodes.set(word, node);
        orbitStyle(node, word);
        place(node, position(word, performance.now()));
        if (phase !== 'orbit' && phase !== 'release') node.classList.add('is-resting');
        layer.append(node);
      });
      nodes.forEach((node, word) => node.classList.toggle('is-newest', word === state.latestWord));
      if (invalidCurrent) reset(performance.now());
    },
    destroy(): void
    {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      layer.replaceChildren();
      sentenceBox.replaceChildren();
    }
  };
}
