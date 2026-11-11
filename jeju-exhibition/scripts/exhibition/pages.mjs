import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const exec = promisify(execFile);
export const REPO = 'kms8720/GeSTure';
export const BRANCH = 'exhibition-pages';
export const ENTRY = 'https://kms8720.github.io/GeSTure/';
export async function api(route, method = 'GET', body) {
  const args = ['api', `repos/${REPO}/${route}`, '--method', method];
  if (body !== undefined) args.push('--input', '-');
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { const status = stderr.match(/HTTP \d{3}/)?.[0] ?? '연결 오류'; const failure = new Error(`GitHub 요청 실패: ${route} — ${status} (gh 인증·권한·GitHub 배포 상태를 확인하세요)`); failure.notFound = stderr.includes('HTTP 404'); reject(failure); }
      else { try { resolve(stdout.trim() ? JSON.parse(stdout) : null); } catch { reject(new Error('GitHub 응답 형식 오류')); } }
    });
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
export async function getEndpoint(ref = BRANCH) {
  try { const file = await api(`contents/endpoint.json?ref=${encodeURIComponent(ref)}`); return JSON.parse(Buffer.from(file.content, 'base64').toString()); }
  catch (error) { if (error.notFound) return null; throw error; }
}
export async function publish(endpoint, { initialize = false, expectedSessionId } = {}) {
  let ref;
  try { ref = await api(`git/ref/heads/${BRANCH}`); } catch (error) { if (!error.notFound || !initialize) throw error; }
  const parent = ref?.object.sha;
  if (expectedSessionId !== undefined) {
    const current = parent ? await getEndpoint(parent) : null;
    if ((current?.sessionId ?? null) !== expectedSessionId) throw new Error('다른 전시 세션이 입구를 갱신했습니다. 덮어쓰지 않고 중단합니다.');
  }
  const commit = parent ? await api(`git/commits/${parent}`) : null;
  const tree = [{ path: 'endpoint.json', mode: '100644', type: 'blob', content: JSON.stringify(endpoint, null, 2) + '\n' }];
  if (initialize) for (const file of ['index.html', 'entry.js']) tree.push({ path: file, mode: '100644', type: 'blob', content: await readFile(new URL(`../../entry-page/${file}`, import.meta.url), 'utf8') });
  if (initialize) tree.push({ path: '.nojekyll', mode: '100644', type: 'blob', content: '' });
  const created = await api('git/trees', 'POST', { ...(commit ? { base_tree: commit.tree.sha } : {}), tree });
  const next = await api('git/commits', 'POST', { message: endpoint.origin ? 'ops: connect exhibition entrance' : 'ops: exhibition entrance standby', tree: created.sha, parents: parent ? [parent] : [] });
  // A concurrent update creates a sibling commit: non-force update rejects it instead of overwriting.
  if (parent) await api(`git/refs/heads/${BRANCH}`, 'PATCH', { sha: next.sha, force: false });
  else await api('git/refs', 'POST', { ref: `refs/heads/${BRANCH}`, sha: next.sha });
}
export async function checkPages() {
  const page = await api('pages');
  if (page.source?.branch !== BRANCH || page.source?.path !== '/' || page.cname || page.build_type === 'workflow') throw new Error('GitHub Pages를 exhibition-pages 브랜치의 / 폴더로 설정해야 합니다. HANDOFF의 최초 준비를 확인하세요.');
  return page;
}
export async function initializePages() {
  let page;
  try { page = await api('pages'); } catch (error) { if (!error.notFound) throw error; }
  if (page) await checkPages(); // Never replace an existing site's configuration.
  const endpoint = await getEndpoint();
  if (endpoint?.origin && Date.parse(endpoint.expiresAt) > Date.now()) throw new Error('이미 전시 주소가 게시되어 있습니다. 운영 중에는 초기화하지 마세요.');
  await publish({ origin: null, sessionId: null, expiresAt: null }, { initialize: true, expectedSessionId: endpoint?.sessionId ?? null });
  if (!page) await api('pages', 'POST', { build_type: 'legacy', source: { branch: BRANCH, path: '/' } });
  const configured = await checkPages();
  if (!configured.https_enforced) await api('pages', 'PUT', { https_enforced: true });
  return ENTRY;
}
export async function checkAuth() { await exec('gh', ['api', `repos/${REPO}`, '--jq', '.permissions.push'], { timeout: 30000 }).then(({stdout}) => { if (stdout.trim() !== 'true') throw new Error('GeSTure 저장소 쓰기 권한이 필요합니다.'); }); }
