import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm, readFile, writeFile, readdir, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createBrowser, browsePage, recoverBrowse, isPublicAddress } from '../lib/browse.mjs';
import { nativeRecover } from '../lib/native.mjs';

async function fixture(t, handler, overrides = {}) {
  const home = await mkdtemp(join(tmpdir(), 'traqiva-browse-test-'));
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(home, { recursive: true, force: true }); });
  const observed = [];
  // Only the injected test transport reaches loopback. Production URL/DNS checks
  // remain unchanged and receive a public fixture hostname and public DNS result.
  const browser = createBrowser({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: (url, address, options) => {
      observed.push({ url: url.href, address, options });
      return new Promise((done, reject) => {
        const request = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: url.pathname + url.search, signal: options.signal }, done);
        request.on('error', reject); request.end();
      });
    },
    compress: async (_config, text) => ({ compressedText: text, changed: false, token_basis: 'estimated', recovery_verified: true, runtime: 'test_fixture' }),
    ...overrides,
  });
  return { browser, home, observed };
}

test('Browse extracts readable public HTML and retains exact source plus provenance', async (t) => {
  const html = '<!doctype html><html><head><title>Research &amp; facts</title><script>steal()</script></head><body><nav>Noise</nav><main><h1>Funding</h1><p>Raised &euro;10m &#38; opened Madrid.</p><script>alert(1)</script></main></body></html>';
  const { browser, home, observed } = await fixture(t, (_request, response) => response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html));
  const result = await browser(null, 'https://research.example.org/article', { home });
  assert.equal(result.title, 'Research & facts');
  assert.match(result.compressedText, /Funding\nRaised €10m & opened Madrid\./);
  assert.doesNotMatch(result.compressedText, /Noise|steal|alert/);
  assert.equal(result.original_url, 'https://research.example.org/article');
  assert.equal(result.source.content_type, 'text/html');
  assert.equal(result.source.bytes, Buffer.byteLength(html));
  assert.match(result.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.automatic_script_execution, false);
  assert.equal((await recoverBrowse(result.browse_recovery_handle, { home })).original, html);
  assert.equal((await recoverBrowse(result.browse_recovery_handle, { home })).readable_text, result.compressedText);
  assert.equal(observed[0].address.address, '93.184.216.34');
});

test('public address classifier rejects private, mapped, metadata and special ranges', () => {
  assert.equal(isPublicAddress('168.63.129.16'), false, 'Azure platform virtual metadata address');
  for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.31.0.2', '192.168.2.1', '100.64.0.1', '198.19.1.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', 'fe80::1%eth0', '2001:db8::1', '2001:0db8:0:0:0:0:0:1', '2001:0000::1', '2001:01ff::1', '2002:7f00:1::']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
});

test('production denies local URL variants before network and fixtures cannot bypass hostname checks', async () => {
  for (const url of ['http://localhost/', 'http://127.1/', 'http://2130706433/', 'http://[::1]/', 'http://169.254.169.254/', 'file:///etc/passwd', 'https://u:p@example.com/', 'https://public.example.org:8080/', 'http://service.local/']) {
    await assert.rejects(browsePage(null, url), /public|HTTP|credentials|port/i, url);
  }
});

test('DNS results are all checked and redirects are validated again before fetching', async (t) => {
  const { browser, home, observed } = await fixture(t, (_request, response) => response.writeHead(302, { location: 'http://127.0.0.1/secret' }).end());
  await assert.rejects(browser(null, 'https://public.example.org/', { home }), /public/i);
  assert.equal(observed.length, 1);
  const mixed = createBrowser({ resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], request: () => assert.fail('must not request mixed private DNS') });
  await assert.rejects(mixed(null, 'https://public.example.org/'), /public/i);
});

test('redirects retain original and final URLs but stop loops', async (t) => {
  const { browser, home, observed } = await fixture(t, (request, response) => request.url === '/start' ? response.writeHead(301, { location: '/final' }).end() : response.writeHead(200, { 'content-type': 'text/plain' }).end('Final facts'));
  const result = await browser(null, 'https://public.example.org/start', { home });
  assert.equal(result.final_url, 'https://public.example.org/final');
  assert.equal(result.original_url, 'https://public.example.org/start');
  assert.equal(observed.length, 2);
  const loop = await fixture(t, (_request, response) => response.writeHead(302, { location: '/' }).end());
  await assert.rejects(loop.browser(null, 'https://public.example.org/', { home: loop.home }), /redirect/);
  assert.ok(loop.observed.length <= 6);
});

test('limits reject non-text, HTTP errors, compressed responses, oversized bodies and slow responses', async (t) => {
  for (const [headers, body, status, expected] of [
    [{ 'content-type': 'application/octet-stream' }, 'data', 200, /content type/i],
    [{ 'content-type': 'text/plain' }, 'missing', 404, /HTTP 404/],
    [{ 'content-type': 'text/plain', 'content-encoding': 'gzip' }, 'compressed', 200, /encoding/],
    [{ 'content-type': 'text/plain' }, 'a'.repeat(2048), 200, /size|limit/i],
  ]) {
    const { browser, home } = await fixture(t, (_request, response) => response.writeHead(status, headers).end(body));
    await assert.rejects(browser(null, 'https://public.example.org/', { home, maxBytes: 1024 }), expected);
    assert.deepEqual(await readdir(home), []);
  }
  const slow = await fixture(t, (_request, response) => { setTimeout(() => response.writeHead(200, { 'content-type': 'text/plain' }).end('late'), 100); });
  await assert.rejects(slow.browser(null, 'https://public.example.org/', { home: slow.home, timeoutMs: 25 }), /time|abort/i);
});

test('source recovery refuses traversal and verifies integrity', async (t) => {
  const { browser, home } = await fixture(t, (_request, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('Public facts'));
  const result = await browser(null, 'https://public.example.org/', { home });
  await assert.rejects(recoverBrowse('browse:../config', { home }), /handle/);
  const file = join(home, 'browse', result.browse_recovery_handle.slice(7) + '.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.original = 'tampered'; await writeFile(file, JSON.stringify(record));
  await assert.rejects(recoverBrowse(result.browse_recovery_handle, { home }), /integrity/);
});

test('source recovery preserves exact original bytes for BOM and legacy charsets', async (t) => {
  for (const [body, charset] of [[Buffer.from('\ufeffExact source\r\n'), 'utf-8'], [Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'windows-1252']]) {
    const { browser, home } = await fixture(t, (_request, response) => response.writeHead(200, { 'content-type': 'text/plain; charset=' + charset }).end(body));
    const result = await browser(null, 'https://public.example.org/', { home });
    const recovered = await recoverBrowse(result.browse_recovery_handle, { home });
    assert.deepEqual(Buffer.from(recovered.original_base64, 'base64'), body);
    assert.equal(recovered.source.bytes, body.length);
  }
});

test('recovery verifies extracted text as well as the exact source', async (t) => {
  const { browser, home } = await fixture(t, (_request, response) => response.writeHead(200, { 'content-type': 'text/plain' }).end('Exact public facts'));
  const result = await browser(null, 'https://public.example.org/', { home });
  const file = join(home, 'browse', result.browse_recovery_handle.slice(7) + '.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.readable_text = 'invented'; await writeFile(file, JSON.stringify(record));
  await assert.rejects(recoverBrowse(result.browse_recovery_handle, { home }), /integrity/);
});

const windowsBuild = fileURLToPath(new URL('../../runtime/build/traqiva-engine-0.1.0-windows-amd64.exe', import.meta.url));
test('real native Browse pipeline compresses static HTML and recovers both readable text and exact HTML', { skip: process.platform !== 'win32' || !existsSync(windowsBuild) }, async (t) => {
  const html = '<html><title>Published report</title><body><nav>Navigation</nav><main><h1>Published report</h1>' + Array.from({ length: 40 }, (_, index) => '<p>Section ' + index + ': ' + 'The company reported routine operational updates and general background details. '.repeat(8) + '</p>').join('') + '<p>IMPORTANT: Madrid office opens in June.</p></main></body></html>';
  const { browser, home } = await fixture(t, (_request, response) => response.writeHead(200, { 'content-type': 'text/html' }).end(html), { compress: undefined });
  const previous = process.env.TRAQIVA_HOME;
  process.env.TRAQIVA_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.TRAQIVA_HOME; else process.env.TRAQIVA_HOME = previous; });
  await mkdir(join(home, 'bin'));
  await copyFile(windowsBuild, join(home, 'bin', 'traqiva-engine.exe'));
  await writeFile(join(home, 'engine.json'), JSON.stringify({ version: '0.1.0', sha256: createHash('sha256').update(await readFile(windowsBuild)).digest('hex') }));
  const result = await browser(null, 'https://public.example.org/report', { home });
  assert.equal(result.runtime, 'native');
  assert.equal(result.changed, true);
  assert.equal(result.recovery_verified, true);
  assert.ok(result.optimized_tokens_estimate < result.original_tokens_estimate);
  const source = await recoverBrowse(result.browse_recovery_handle, { home });
  assert.equal(source.original, html);
  assert.deepEqual(Buffer.from(source.original_base64, 'base64'), Buffer.from(html));
  assert.equal((await nativeRecover(result.recovery_handle)).original, source.readable_text);
  assert.match(result.compressedText, /Madrid office opens/);
});
