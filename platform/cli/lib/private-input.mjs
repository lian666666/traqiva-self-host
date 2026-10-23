import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const invalidKey = () => new Error('Use a project key of 8 to 4096 characters, without whitespace or control characters.');
function checkedKey(value) {
  const key = value.trim();
  if (key.length < 8 || key.length > 4096 || /[\u0000-\u0020\u007f-\u009f]/.test(key)) throw invalidKey();
  return key;
}
function requireTerminal(input, output) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Open a private interactive terminal and run connect --url ORIGIN --project ID --key-prompt there. Key entry is unavailable in an agent pipe; never paste the key into chat.');
  }
}

export async function readProjectKey() {
  if (process.platform !== 'win32') return readTerminalKey();
  requireTerminal(process.stdin, process.stderr);
  // Let Windows own its console's password input. No generated file, shell
  // interpolation, credential argument or parent Node console read is needed.
  const script = String.raw`$ErrorActionPreference = 'Stop'
$privateValue = $null
$privatePointer = [IntPtr]::Zero
try {
  $privateValue = Read-Host -AsSecureString
  $privatePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($privateValue)
  [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($privatePointer))
} catch {
  exit 1
} finally {
  if ($privatePointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($privatePointer) }
  if ($null -ne $privateValue) { $privateValue.Dispose() }
}`;
  process.stderr.write('Project key (input hidden; Ctrl+C cancels): ');
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-Command', script], { stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true });
      const chunks = []; let bytes = 0;
      const failed = () => reject(new Error('Private key entry cancelled or unavailable. No connection was saved.'));
      child.once('error', failed);
      child.stdout.on('error', failed);
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16384) { child.kill(); reject(invalidKey()); }
        else chunks.push(chunk);
      });
      child.once('close', code => {
        try { if (code !== 0) failed(); else resolve(checkedKey(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
        finally { for (const chunk of chunks) chunk.fill(0); }
      });
    });
  } finally { process.stderr.write('\n'); }
}

// Readline owns terminal editing and raw-mode handling. Its output goes to a
// private sink, so typed/pasted credentials are never echoed to either stream.
export async function readTerminalKey({ input = process.stdin, output = process.stderr } = {}) {
  requireTerminal(input, output);
  const wasRaw = input.isRaw === true, wasFlowing = input.readableFlowing === true;
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const reader = createInterface({ input, output: silent, terminal: true, historySize: 0 });
  let guard, inputError;
  try {
    output.write('Project key (input hidden; Ctrl+C cancels): ');
    return await new Promise((resolve, reject) => {
      let settled = false;
      const closed = () => finish(new Error('Key entry ended before submission. No connection was saved.'));
      const finish = (error, key) => {
        if (settled) return;
        settled = true;
        reader.off('close', closed);
        // Stop reading immediately when submitted or cancelled.
        reader.close();
        if (error) reject(error); else resolve(key);
      };
      const invalid = () => finish(invalidKey());
      reader.once('line', line => {
        try { finish(null, checkedKey(line)); } catch (error) { finish(error); }
      });
      reader.once('SIGINT', () => finish(new Error('Key entry cancelled. No connection was saved.')));
      reader.once('close', closed);
      inputError = () => finish(new Error('Private terminal input failed. No connection was saved.'));
      input.once('error', inputError);
      reader.once('error', inputError);
      guard = () => { if (reader.line.length > 4096) invalid(); };
      input.on('data', guard);
    });
  } finally {
    reader.close();
    reader.removeAllListeners();
    if (guard) input.off('data', guard);
    if (inputError) input.off('error', inputError);
    silent.destroy();
    if (input.isRaw !== wasRaw) input.setRawMode(wasRaw);
    if (wasFlowing) input.resume(); else input.pause();
    output.write('\n');
  }
}
