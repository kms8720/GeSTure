import test from 'node:test';
import assert from 'node:assert/strict';
import { networkInfo, validatePublicOrigin } from './network.js';

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
