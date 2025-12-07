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
 *
 * When running from bundled code (build/index.js), __dirname is "build/"
 * and web files are in "build/web/". When running from source, __dirname
 * is "src/web/" and files are in the same directory.
 */
export async function loadWebFile(fileName: string): Promise<string> {
  // Possible locations for web files:
  // 1. Same directory as this file (source: src/web/)
  // 2. "web" subdirectory (bundled: build/web/)
  const locations = [
    path.join(__dirname, fileName),         // src/web/file.html (source)
    path.join(__dirname, 'web', fileName),  // build/web/file.html (bundled)
  ];

  for (const filePath of locations) {
    try {
      await fs.access(filePath);
      return fs.readFile(filePath, 'utf-8');
    } catch {
      // Try next location
    }
  }

  throw new Error(`Web file not found: ${fileName}. Tried: ${locations.join(', ')}`);
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

  // Build account info section - email is prominent, account ID is secondary
  let accountInfoSection: string;
  if (params.email) {
    accountInfoSection = `
      <p class="account-email">${escapeHtml(params.email)}</p>
      <p class="account-label">Saved as <code>${safeAccountId}</code></p>`;
  } else {
    accountInfoSection = `
      <p class="account-email">Account connected</p>
      <p class="account-label">Saved as <code>${safeAccountId}</code></p>`;
  }

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
    .replace('{{accountInfo}}', accountInfoSection)
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
