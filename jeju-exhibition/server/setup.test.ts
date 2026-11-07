import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('setup generates a private operator key from the blank template and preserves it on rerun', () =>
{
  const directory = mkdtempSync(path.join(os.tmpdir(), 'jeju-setup-'));
  try
  {
    mkdirSync(path.join(directory, 'scripts'));
    copyFileSync('scripts/setup-exhibition.mjs', path.join(directory, 'scripts/setup-exhibition.mjs'));
    copyFileSync('.env.example', path.join(directory, '.env.example'));
    const run = () => execFileSync(process.execPath, [path.join(directory, 'scripts/setup-exhibition.mjs')], { encoding: 'utf8' });
    const output = run();
    const file = path.join(directory, '.env');
    const first = readFileSync(file, 'utf8');
    const key = first.match(/^OPERATOR_TOKEN=([a-f0-9]{64})$/m)?.[1];
    assert.ok(key); assert.ok(!output.includes(key));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    run(); assert.equal(readFileSync(file, 'utf8'), first);
    writeFileSync(file, 'PUBLIC_ORIGIN=http://192.168.50.10:3002\nOPERATOR_TOKEN=""\n');
    run();
    assert.match(readFileSync(file, 'utf8'), /^PUBLIC_ORIGIN=http:\/\/192.168.50.10:3002/m);
    assert.match(readFileSync(file, 'utf8'), /^OPERATOR_TOKEN=[a-f0-9]{64}$/m);
  }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
