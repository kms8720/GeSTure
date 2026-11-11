import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { allowedPath, createGateway } from './gateway.mjs';

test('public route allowlist rejects operator, traversal and encoded bypass paths', () => {
  for (const path of ['/join?finger=thumb', '/socket.io/?EIO=4&transport=websocket', '/assets/index-ab12.js', '/network-info']) assert.equal(allowedPath(path), true);
  for (const path of ['/monitor', '/operator/session', '/hand-state', '/recognition/reset', '/assets/../monitor', '/assets/%2e%2e/monitor', '/assets/sub/file.js', '//monitor', '/display/hand']) assert.equal(allowedPath(path), false);
});

test('gateway blocks operator requests and reports unavailable rather than ready when app is offline', async () => {
  const gateway = createGateway({ port: 1, sessionId: 'test-session', allowedOrigin: () => 'https://example.trycloudflare.com' });
  gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  try {
    for (const route of ['/monitor', '/operator/session', '/hand-state']) {
      const response = await fetch(origin + route, { method: 'POST' });
      assert.equal(response.status, 404);
    }
    assert.equal((await fetch(origin + '/join', { method: 'POST' })).status, 404);
    const health = await fetch(origin + '/entry-health');
    assert.equal(health.status, 503);
    assert.equal(health.headers.get('access-control-allow-origin'), 'https://kms8720.github.io');
  } finally { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
});
