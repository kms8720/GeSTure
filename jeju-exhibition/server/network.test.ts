import test from 'node:test';
import assert from 'node:assert/strict';
import { networkInfo, validatePublicOrigin, validateConnectionMode, validateJoinEntryUrl } from './network.js';

test('public QR origins reject localhost, credentials and paths', () =>
{
  for (const value of ['http://localhost:3002', 'http://127.0.0.2:3002', 'http://0.0.0.0:3002',
    'http://[::1]:3002', 'ftp://192.168.1.10', 'http://secret@192.168.1.10',
    'http://192.168.1.10/join', 'http://192.168.1.10?token=secret', 'http://192.168.1.10#secret'])
  {
    assert.throws(() => validatePublicOrigin(value));
  }
  assert.equal(validatePublicOrigin('http://192.168.50.10:3002/'), 'http://192.168.50.10:3002');
});

test('internet mode requires an explicit HTTPS origin', () =>
{
  for (const origin of [undefined, '', 'http://gesture.example.org', 'https://localhost'])
    assert.throws(() => validateConnectionMode('internet', origin));
  assert.throws(() => validateConnectionMode('unknown'));
  assert.doesNotThrow(() => validateConnectionMode('internet', 'https://gesture.example.org'));
  assert.doesNotThrow(() => validateConnectionMode('lan'));
});

test('fixed Pages entry is preserved while the tunnel origin changes', () =>
{
  const old = process.env.JOIN_ENTRY_URL;
  process.env.JOIN_ENTRY_URL = 'https://kms8720.github.io/GeSTure/';
  try {
    for (const origin of ['https://first.trycloudflare.com', 'https://second.trycloudflare.com']) {
      const state = networkInfo(3002, origin, undefined, [], 'internet');
      assert.equal(state.joinUrl, process.env.JOIN_ENTRY_URL);
      assert.equal(state.checkUrl, `${origin}/check`);
    }
    for (const url of ['http://kms8720.github.io/GeSTure/', 'https://evil.test/', 'https://kms8720.github.io/GeSTure/?x=1'])
      assert.throws(() => validateJoinEntryUrl(url));
  } finally { if (old === undefined) delete process.env.JOIN_ENTRY_URL; else process.env.JOIN_ENTRY_URL = old; }
});

test('internet responses hide local addresses and Wi-Fi credentials', () =>
{
  const previous = { ssid: process.env.WIFI_SSID, password: process.env.WIFI_PASSWORD };
  process.env.WIFI_SSID = 'test-network';
  process.env.WIFI_PASSWORD = 'test-only-password';
  try
  {
    const state = networkInfo(3002, 'https://gesture.example.org', 'localhost', ['192.168.0.10'], 'internet');
    assert.equal(state.joinUrl, 'https://gesture.example.org/join');
    assert.equal(state.connectionMode, 'internet');
    assert.deepEqual(state.addresses, []);
    assert.equal(state.wifiSsid, '');
    assert.equal(state.wifiPassword, '');
    const lan = networkInfo(3002, 'http://192.168.0.10:3002', 'localhost', ['192.168.0.10'], 'lan');
    assert.equal(lan.wifiSsid, 'test-network');
    assert.equal(lan.wifiPassword, 'test-only-password');
  }
  finally
  {
    if (previous.ssid === undefined) delete process.env.WIFI_SSID;
    else process.env.WIFI_SSID = previous.ssid;
    if (previous.password === undefined) delete process.env.WIFI_PASSWORD;
    else process.env.WIFI_PASSWORD = previous.password;
  }
});

test('multiple network interfaces require a selection instead of guessing a QR', () =>
{
  const addresses = ['192.168.50.10', '10.1.1.5'];
  assert.equal(networkInfo(3002, undefined, 'localhost', addresses).joinUrl, null);
  assert.equal(networkInfo(3002, undefined, '192.168.50.10', addresses).joinUrl, 'http://192.168.50.10:3002/join');
  const fixed = networkInfo(4000, 'http://192.168.50.10:4000', 'localhost', addresses);
  assert.equal(fixed.joinUrl, 'http://192.168.50.10:4000/join');
  assert.equal(fixed.configured, true);
  assert.equal(networkInfo(3002, undefined, 'localhost', []).joinUrl, null);
});
