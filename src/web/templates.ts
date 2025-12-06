import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, char => htmlEscapes[char]);
}

/**
 * Load a file from the web directory (handles build vs source paths)
 */
export async function loadWebFile(fileName: string): Promise<string> {
  // Try build location first, then source location
  let filePath = path.join(__dirname, fileName); // build location
  try {
    await fs.access(filePath);
  } catch {
    // Build location doesn't exist, try source location
    filePath = path.join(__dirname, '..', 'web', fileName);
  }
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Load a template file
 */
async function loadTemplate(templateName: string): Promise<string> {
  return loadWebFile(templateName);
}

export interface AuthSuccessParams {
  accountId: string;
  email?: string;
  tokenPath?: string;
  showCloseButton?: boolean;
  postMessageOrigin?: string;
}

/**
 * Render the authentication success page
 */
export async function renderAuthSuccess(params: AuthSuccessParams): Promise<string> {
  const template = await loadTemplate('auth-success.html');
  const safeAccountId = escapeHtml(params.accountId);

  // Build optional sections
  const emailSection = params.email
    ? `<p class="email">${escapeHtml(params.email)}</p>`
    : '';

  const tokenPathSection = params.tokenPath
    ? `<p>Tokens saved to:</p><p class="token-path"><code>${escapeHtml(params.tokenPath)}</code></p>`
    : '';

  const closeButtonSection = params.showCloseButton
    ? `<button onclick="window.close()">Close Window</button>`
    : '';

  const scriptSection = params.postMessageOrigin
    ? `<script>
        if (window.opener) {
          window.opener.postMessage({ type: 'auth-success', accountId: '${safeAccountId}' }, '${escapeHtml(params.postMessageOrigin)}');
        }
        setTimeout(() => window.close(), 3000);
      </script>`
    : '';

  return template
    .replace(/\{\{accountId\}\}/g, safeAccountId)
    .replace('{{email}}', emailSection)
    .replace('{{tokenPath}}', tokenPathSection)
    .replace('{{closeButton}}', closeButtonSection)
    .replace('{{script}}', scriptSection);
}

export interface AuthErrorParams {
  errorMessage: string;
  showCloseButton?: boolean;
}

/**
 * Render the authentication error page
 */
export async function renderAuthError(params: AuthErrorParams): Promise<string> {
  const template = await loadTemplate('auth-error.html');
  const safeError = escapeHtml(params.errorMessage);

  const closeButtonSection = params.showCloseButton
    ? `<button onclick="window.close()">Close Window</button>`
    : '';

  return template
    .replace('{{errorMessage}}', safeError)
    .replace('{{closeButton}}', closeButtonSection);
}

export interface AuthLandingParams {
  accountId: string;
  authUrl: string;
}

/**
 * Render the authentication landing page (click to authenticate)
 */
export async function renderAuthLanding(params: AuthLandingParams): Promise<string> {
  const template = await loadTemplate('auth-landing.html');
  const safeAccountId = escapeHtml(params.accountId);
  const safeAuthUrl = escapeHtml(params.authUrl);

  return template
    .replace(/\{\{accountId\}\}/g, safeAccountId)
    .replace('{{authUrl}}', safeAuthUrl);
}
