import { createServer } from 'node:http';
import { once } from 'node:events';
import { MAX_BYTES } from './client.mjs';

const routes = new Set(['/v1/chat/completions', '/v1/responses', '/v1/messages']);
const requestHeaders = ['authorization', 'x-api-key', 'content-type', 'anthropic-version', 'anthropic-beta'];
const responseHeaders = ['content-type', 'cache-control', 'retry-after', 'x-request-id', 'request-id', 'x-traqiva-request-id', 'x-traqiva-optimization', 'x-traqiva-token-basis'];

export async function serveProxy(config, port) {
  const server = createServer(async (incoming, outgoing) => {
    const fail = (status, message) => {
      if (outgoing.headersSent) { outgoing.destroy(); return; }
      outgoing.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify({ error: { message } }));
    };
    if (incoming.method === 'GET' && incoming.url === '/health') { outgoing.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, mode: 'api-key-only', project_id: config.project })); return; }
    if (incoming.method !== 'POST' || !routes.has(incoming.url)) { fail(404, 'Unsupported Traqiva provider route.'); return; }
    if (incoming.headers.origin) { fail(403, 'Browser-origin requests are not accepted by the local bridge.'); return; }
    if (!incoming.headers.authorization && !incoming.headers['x-api-key']) { fail(401, 'A provider API key is required. ChatGPT subscription routing is not supported.'); return; }
    if (!(incoming.headers['content-type'] || '').startsWith('application/json')) { fail(415, 'Use application/json.'); return; }
    if (Number(incoming.headers['content-length']) > MAX_BYTES) { fail(413, 'Request exceeds 1 MiB.'); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > MAX_BYTES) { fail(413, 'Request exceeds 1 MiB.'); return; }
        chunks.push(chunk);
      }
      const headers = { 'x-traqiva-key': config.key };
      for (const header of requestHeaders) if (typeof incoming.headers[header] === 'string') headers[header] = incoming.headers[header];
      const controller = new AbortController();
      outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
      const upstream = await fetch(config.url + incoming.url, { method: 'POST', headers, body: Buffer.concat(chunks), redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]) });
      outgoing.statusCode = upstream.status;
      for (const header of responseHeaders) if (upstream.headers.has(header)) outgoing.setHeader(header, upstream.headers.get(header));
      outgoing.setHeader('cache-control', 'no-store');
      if (upstream.body) {
        for await (const chunk of upstream.body) if (!outgoing.write(Buffer.from(chunk))) await once(outgoing, 'drain');
      }
      outgoing.end();
    } catch {
      fail(502, 'The configured Traqiva gateway could not complete the provider request.');
    }
  });
  server.requestTimeout = 310_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 40;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  process.stderr.write(JSON.stringify({ listening: `http://127.0.0.1:${server.address().port}`, project_id: config.project, mode: 'api-key-only', automatic_agent_configuration: false }) + '\n');
  const close = () => { server.closeAllConnections(); server.close(() => process.exit(0)); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  return server;
}
