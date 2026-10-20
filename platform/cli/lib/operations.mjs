import { api, compress, recover } from './client.mjs';
import { engineStatus, nativeCompress, nativeRecover } from './native.mjs';

export async function compressArtifact(config, text, contentType) {
  const native = await engineStatus();
  if (native.integrity_error) throw new Error(native.note);
  if (native.installed) {
    const receipt = await nativeCompress(text, contentType);
    if (config) {
      try {
        await api(config, '/api/compression-events', { project_id: config.project, algorithm: receipt.algorithm, source: 'native', input_bytes: Buffer.byteLength(text), output_bytes: Buffer.byteLength(receipt.compressedText), original_tokens_estimate: receipt.original_tokens_estimate, optimized_tokens_estimate: receipt.optimized_tokens_estimate, ...(receipt.recovery_handle ? { recovery_handle: receipt.recovery_handle } : {}) });
        receipt.telemetry = 'counts_uploaded';
      } catch { receipt.telemetry = 'counts_not_uploaded'; }
    } else receipt.telemetry = 'local_only';
    return receipt;
  }
  if (!config) throw new Error('Install the native engine explicitly for local compression, or connect a Traqiva project for cloud lossless JSON mode.');
  return { ...(await compress(config, text, ['json', 'text'].includes(contentType) ? contentType : undefined)), runtime: 'cloud', lossless_to_model: true };
}

export async function recoverArtifact(config, handle) {
  if (typeof handle === 'string' && /^(local:|ccr_|ccr:\/\/)/.test(handle)) return await nativeRecover(handle);
  if (!config) throw new Error('Connect the project that owns this cloud recovery handle.');
  return await recover(config, handle);
}
