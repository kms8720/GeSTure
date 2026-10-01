import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const destination = new URL('../.env', import.meta.url);
let contents = readFileSync(existsSync(destination) ? destination : new URL('../.env.example', import.meta.url), 'utf8');
const current = contents.match(/^OPERATOR_TOKEN[ \t]*=[ \t]*(.*)$/m)?.[1]?.trim();
if (!current || current === '""' || current === "''" || current.startsWith('#'))
{
  contents = contents.replace(/^OPERATOR_TOKEN=.*\r?\n?/m, '');
  contents += `\nOPERATOR_TOKEN=${randomBytes(32).toString('hex')}\n`;
}
writeFileSync(destination, contents, { mode: 0o600 });
chmodSync(destination, 0o600);
console.log('.env 준비 완료. 운영자 키는 파일에만 저장했습니다.');
console.log('전용 공유기 준비 후 PUBLIC_ORIGIN, WIFI_SSID, WIFI_PASSWORD를 입력하고 서버를 재시작해 주세요.');
