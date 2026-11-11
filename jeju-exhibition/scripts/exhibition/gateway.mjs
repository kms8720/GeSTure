import http from 'node:http';
export function allowedPath(raw) {
  if (/%|\\|\.\./.test(raw.split('?')[0])) return false;
  const path = raw.split('?')[0];
  return ['/join', '/check', '/network-info', '/health', '/socket.io/'].includes(path) || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(path);
}
export function createGateway({ port, sessionId, allowedOrigin }) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url.split('?')[0] === '/entry-health' && req.method === 'GET') {
      res.setHeader('Access-Control-Allow-Origin', 'https://kms8720.github.io');
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
        if (!health.ok || !(await health.json()).ok) throw new Error();
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, sessionId }));
      } catch { res.writeHead(503); res.end('Exhibition unavailable'); }
      return;
    }
    // Public gateway only exposes audience GET routes. Operator writes and views stay local.
    if (!['GET', 'HEAD'].includes(req.method) || !allowedPath(req.url)) { res.writeHead(404); res.end(); return; }
    const proxy = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method,
      headers: { host: `127.0.0.1:${port}`, accept: req.headers.accept ?? '*/*' } }, upstream => {
      res.writeHead(upstream.statusCode ?? 502, { ...upstream.headers, 'cache-control': 'no-store' });
      upstream.on('error', () => res.destroy()); upstream.pipe(res);
    });
    proxy.setTimeout(10000, () => proxy.destroy());
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('aborted', () => proxy.destroy()); proxy.end();
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url.split('?')[0] !== '/socket.io/' || (req.headers.origin && req.headers.origin !== allowedOrigin())) { socket.destroy(); return; }
    const proxy = http.request({ host: '127.0.0.1', port, path: req.url, headers: {
      host: `127.0.0.1:${port}`, connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-key': req.headers['sec-websocket-key'], 'sec-websocket-version': '13'
    }});
    proxy.on('upgrade', (response, upstream, upstreamHead) => {
      proxy.setTimeout(0);
      const headers = Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
      socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
      upstream.on('error', () => socket.destroy());
    });
    proxy.setTimeout(10000, () => proxy.destroy());
    proxy.on('response', () => socket.destroy()); proxy.on('error', () => socket.destroy());
    socket.on('error', () => proxy.destroy()); proxy.end();
  });
  return server;
}
