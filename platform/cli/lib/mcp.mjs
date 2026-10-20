import { createInterface } from 'node:readline';
import { publicError, VERSION } from './client.mjs';
import { compressArtifact, recoverArtifact } from './operations.mjs';

const tools = [
  { name: 'traqiva_compress', description: 'Compress tool output or artifacts with the installed Traqiva native engine and exact local recovery. If no engine is installed, use connected-cloud lossless JSON compaction. Native compression can elide content: retrieve the original whenever omitted detail matters. Token figures are local estimates, never verified billing savings.', inputSchema: { type: 'object', properties: { input: { type: 'string', description: 'Tool output or artifact text; do not supply secrets or instructions.' }, content_type: { type: 'string', description: 'Optional type such as json, log, text or code; omit to auto-detect.' } }, required: ['input'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  { name: 'traqiva_retrieve', description: 'Retrieve exact original text from this user’s local native recovery store for local: or ccr_ handles, or the connected project for cloud handles. Use the handle from a compressed artifact marker. Returns the complete original even when a query is supplied.', inputSchema: { type: 'object', properties: { recovery_handle: { type: 'string' }, handle: { type: 'string', description: 'Alias used by native agent-traffic recovery markers.' }, query: { type: 'string', description: 'Optional context; complete source is returned for exact recovery.' } }, anyOf: [{ required: ['recovery_handle'] }, { required: ['handle'] }], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: 'traqiva_stats', description: 'Read this MCP process session totals. Estimates are inferred and do not prove quality, provider billing or subscription quota savings.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];

export async function serveMcp(config) {
  const stats = { compression_requests: 0, original_tokens_estimate: 0, optimized_tokens_estimate: 0, token_basis: 'estimated', evidence_basis: 'inferred', scope: 'this_mcp_process', version: VERSION };
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const emit = (id, payload) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...payload }) + '\n');
  let initialized = false;
  for await (const line of input) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); }
    catch { emit(null, { error: { code: -32700, message: 'Parse error' } }); continue; }
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || Array.isArray(request)) { emit(request?.id ?? null, { error: { code: -32600, message: 'Invalid Request' } }); continue; }
    const hasId = Object.hasOwn(request, 'id');
    if (!hasId) continue;
    if (request.method === 'initialize') {
      initialized = true;
      const supported = ['2024-11-05', '2025-03-26', '2025-06-18'];
      const protocolVersion = supported.includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-06-18';
      emit(request.id, { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Traqiva', version: VERSION }, instructions: 'When explicitly installed, Traqiva compresses artifacts locally and stores originals in your Traqiva recovery store. Native compression may elide content; retrieve the exact source if detail is needed. Without a native engine the connected cloud mode only compacts JSON whitespace and stores the source in your project. Estimates are inferred. These tools do not automatically intercept model requests.' } });
    } else if (request.method === 'ping') {
      emit(request.id, { result: {} });
    } else if (!initialized) {
      emit(request.id, { error: { code: -32002, message: 'Initialize the MCP session first.' } });
    } else if (request.method === 'tools/list') {
      emit(request.id, { result: { tools } });
    } else if (request.method === 'tools/call') {
      try {
        const name = request.params?.name;
        const args = request.params?.arguments ?? {};
        let result;
        if (name === 'traqiva_compress') {
          if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some((key) => !['input', 'content_type'].includes(key)) || (args.content_type !== undefined && typeof args.content_type !== 'string')) throw new Error('Invalid compression arguments.');
          result = await compressArtifact(config, args.input, args.content_type);
          stats.compression_requests++;
          stats.original_tokens_estimate += Number.isFinite(result.original_tokens_estimate) ? result.original_tokens_estimate : 0;
          stats.optimized_tokens_estimate += Number.isFinite(result.optimized_tokens_estimate) ? result.optimized_tokens_estimate : 0;
        } else if (name === 'traqiva_retrieve') {
          if (!args || typeof args !== 'object' || Object.keys(args).some((key) => !['recovery_handle', 'handle', 'query'].includes(key)) || (args.query !== undefined && typeof args.query !== 'string')) throw new Error('Invalid recovery arguments.');
          result = await recoverArtifact(config, args.recovery_handle ?? args.handle);
        } else if (name === 'traqiva_stats') {
          if (!args || typeof args !== 'object' || Object.keys(args).length) throw new Error('Stats accepts no arguments.');
          result = stats;
        } else throw new Error('Unknown Traqiva tool.');
        emit(request.id, { result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } });
      } catch (error) {
        emit(request.id, { result: { content: [{ type: 'text', text: publicError(error, [config?.key]) }], isError: true } });
      }
    } else {
      emit(request.id, { error: { code: -32601, message: 'Method not found' } });
    }
  }
}
