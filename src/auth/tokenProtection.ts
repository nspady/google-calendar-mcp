import { execFile } from 'child_process';
import { getWindowsPowerShellPath, TokenProtection } from '../config/AppConfig.js';

const FORMAT = 'google-calendar-mcp-dpapi';
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Secrets travel on stdin/stdout, never command-line arguments or temporary files.
 * PowerShell errors are deliberately not attached to exceptions or logs.
 * DPAPI CurrentUser protects at rest, not against programs running as that user.
 */
async function transform(input: Buffer, operation: 'Protect' | 'Unprotect'): Promise<Buffer> {
  const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $data = [Convert]::FromBase64String([Console]::In.ReadToEnd())
  $result = [System.Security.Cryptography.ProtectedData]::${operation}(
    $data, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { exit 1 }
`;
  if (input.length > MAX_BYTES) throw new Error('Token data exceeds the encryption size limit');
  return new Promise((resolve, reject) => {
    const child = execFile(getWindowsPowerShellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15000, maxBuffer: MAX_BYTES * 2, encoding: 'utf8' },
      (error, stdout) => {
        if (error || !stdout || !/^[A-Za-z0-9+/]+={0,2}$/.test(stdout)) {
          reject(new Error(`Windows DPAPI ${operation.toLowerCase()} failed; no plaintext fallback was used`));
          return;
        }
        resolve(Buffer.from(stdout, 'base64'));
      });
    // Handle a broken pipe without leaking process output or leaving an unhandled error.
    child.stdin?.on('error', () => reject(new Error('Windows DPAPI input failed')));
    child.stdin?.end(input.toString('base64'));
  });
}

export async function encodeTokenFile(plaintext: string, mode: TokenProtection): Promise<string> {
  if (mode === 'plaintext') return plaintext;
  const encrypted = await transform(Buffer.from(plaintext, 'utf8'), 'Protect');
  return JSON.stringify({ format: FORMAT, version: 1, ciphertext: encrypted.toString('base64') });
}

export async function decodeTokenFile(content: string, mode: TokenProtection): Promise<string> {
  if (mode === 'plaintext') {
    // Do not accidentally interpret an encrypted envelope as account records.
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { return content; }
    if (parsed && typeof parsed === 'object' && 'format' in parsed && parsed.format === FORMAT) {
      throw new Error('Encrypted tokens require GOOGLE_CALENDAR_MCP_TOKEN_PROTECTION=dpapi');
    }
    return content;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch {
    throw new Error('Invalid encrypted token file; re-authenticate instead of using plaintext tokens');
  }
  if (!parsed || typeof parsed !== 'object'
    || !('format' in parsed) || parsed.format !== FORMAT
    || !('version' in parsed) || parsed.version !== 1
    || !('ciphertext' in parsed) || typeof parsed.ciphertext !== 'string'
    || parsed.ciphertext.length > MAX_BYTES * 2
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.ciphertext)) {
    throw new Error('Invalid encrypted token envelope; plaintext tokens are not accepted in DPAPI mode');
  }
  return (await transform(Buffer.from(parsed.ciphertext, 'base64'), 'Unprotect')).toString('utf8');
}
