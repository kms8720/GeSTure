import { chromium } from 'playwright';
import { io } from 'socket.io-client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const displayUrl = args.url ?? 'http://127.0.0.1:5173/display';
const socketUrl = args.socket ?? 'http://127.0.0.1:3001';
const outPath = path.resolve(projectRoot, args.out ?? '../data/virtual_hand_capture.png');
const pose = args.pose ?? 'open';
const viewportWidth = Number(args.width ?? 1280);
const viewportHeight = Number(args.height ?? 900);
const zoomOutSteps = Number(args['zoom-out-steps'] ?? 0);
const debugConsole = Boolean(args['debug-console']);
const waitMs = Number(args['wait-ms'] ?? 6500);

const POSES = {
  open: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  half: { thumb: 50, index: 50, middle: 50, ring: 50, pinky: 50 },
  fist: { thumb: 100, index: 100, middle: 100, ring: 100, pinky: 100 },
  point: { thumb: 70, index: 0, middle: 100, ring: 100, pinky: 100 }
};

if (!POSES[pose]) {
  throw new Error(`Unknown pose "${pose}". Use one of: ${Object.keys(POSES).join(', ')}`);
}

await setHandPose(socketUrl, POSES[pose]);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: viewportWidth, height: viewportHeight },
    deviceScaleFactor: 1
  });
  if (debugConsole) {
    page.on('console', (message) => {
      console.log(`[browser:${message.type()}] ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      console.log(`[browser:error] ${error.message}`);
    });
  }
  await page.goto(displayUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.virtual-hand-stage canvas', { timeout: 15000 });
  await page.waitForTimeout(waitMs);
  if (zoomOutSteps > 0) {
    const canvas = page.locator('.virtual-hand-stage canvas');
    const canvasBox = await canvas.boundingBox();
    if (canvasBox) {
      await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
      for (let index = 0; index < zoomOutSteps; index += 1) {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(120);
      }
    }
    await page.waitForTimeout(600);
  }
  const virtualSkeletonStatus = await page.evaluate(() => {
    const skeleton = window.__ACC_VIRTUAL_SKELETON__;
    if (!skeleton) {
      return { available: false };
    }
    return {
      available: true,
      points: Array.isArray(skeleton.points) ? skeleton.points.length : 0,
      handedness: skeleton.handedness,
      firstPoint: skeleton.points?.[0] ?? null
    };
  });
  if (debugConsole) {
    console.log(`[virtual-skeleton] ${JSON.stringify(virtualSkeletonStatus)}`);
  }

  const stage = page.locator('.virtual-hand-stage');
  const box = await stage.boundingBox();
  if (!box) {
    throw new Error('Could not resolve .virtual-hand-stage bounds');
  }
  await page.screenshot({
    path: outPath,
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.max(1, box.width),
      height: Math.max(1, box.height)
    }
  });
  console.log(JSON.stringify({ ok: true, pose, displayUrl, socketUrl, outPath, viewportWidth, viewportHeight, zoomOutSteps, waitMs }, null, 2));
} finally {
  await browser.close();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      continue;
    }
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

async function setHandPose(socketUrl, handState) {
  const socket = io(socketUrl, { transports: ['websocket', 'polling'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Could not connect to ${socketUrl}`)), 10000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  for (const [finger, value] of Object.entries(handState)) {
    socket.emit('finger:update', { finger, value });
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
  socket.close();
}
