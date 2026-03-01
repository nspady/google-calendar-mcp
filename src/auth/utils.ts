import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { getSecureTokenPath as getSharedSecureTokenPath, getLegacyTokenPath as getSharedLegacyTokenPath, getAccountMode as getSharedAccountMode } from './paths.js';

// Helper to get the project root directory reliably
function getProjectRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // In build output (e.g., build/bundle.js), __dirname is .../build
  // Go up ONE level to get the project root
  const projectRoot = path.join(__dirname, ".."); // Corrected: Go up ONE level
  return path.resolve(projectRoot); // Ensure absolute path
}

// Get the current account mode - delegates to shared implementation
// Now supports arbitrary account IDs instead of just 'normal' and 'test'
export function getAccountMode(): string {
  return getSharedAccountMode();
}

// Returns the absolute path for the saved token file - delegates to shared implementation
export function getSecureTokenPath(): string {
  return getSharedSecureTokenPath();
}

// Returns the legacy token path for backward compatibility - delegates to shared implementation  
export function getLegacyTokenPath(): string {
  return getSharedLegacyTokenPath();
}

// Returns the absolute path for the GCP OAuth keys file with priority:
// 1. Environment variable GOOGLE_OAUTH_CREDENTIALS (highest priority)
// 2. Default file path (lowest priority)
export function getKeysFilePath(): string {
  // Priority 1: Environment variable (only if it's a file path, not inline JSON)
  const envCredentials = process.env.GOOGLE_OAUTH_CREDENTIALS;
  if (envCredentials && !envCredentials.trimStart().startsWith('{')) {
    return path.resolve(envCredentials);
  }

  // Priority 2: Default file path
  const projectRoot = getProjectRoot();
  const keysPath = path.join(projectRoot, "gcp-oauth.keys.json");
  return keysPath; // Already absolute from getProjectRoot
}

// Loads the raw credentials JSON string with priority:
// 1. GOOGLE_OAUTH_CREDENTIALS as inline JSON (starts with '{')
// 2. GOOGLE_OAUTH_CREDENTIALS as a file path
// 3. Default file path (gcp-oauth.keys.json in project root)
export function loadCredentialsContent(): string {
  const envCredentials = process.env.GOOGLE_OAUTH_CREDENTIALS;
  if (envCredentials && envCredentials.trimStart().startsWith('{')) {
    return envCredentials;
  }
  return fs.readFileSync(getKeysFilePath(), 'utf-8');
}

// Helper to determine if we're currently in test mode
export function isTestMode(): boolean {
  return getAccountMode() === 'test';
}

// Interface for OAuth credentials
export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

// Interface for credentials file with project_id
export interface OAuthCredentialsWithProject {
  installed?: {
    project_id?: string;
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  project_id?: string;
  client_id?: string;
  client_secret?: string;
  redirect_uris?: string[];
}

// Get project ID from OAuth credentials file
// Returns undefined if credentials file doesn't exist, is invalid, or missing project_id
export function getCredentialsProjectId(): string | undefined {
  try {
    const credentialsContent = loadCredentialsContent();
    const credentials: OAuthCredentialsWithProject = JSON.parse(credentialsContent);

    // Extract project_id from installed format or direct format
    if (credentials.installed?.project_id) {
      return credentials.installed.project_id;
    } else if (credentials.project_id) {
      return credentials.project_id;
    }

    return undefined;
  } catch (error) {
    // If we can't read project ID, return undefined (backward compatibility)
    return undefined;
  }
}

// Generate helpful error message for missing credentials
export function generateCredentialsErrorMessage(): string {
  return `
OAuth credentials not found. Please provide credentials using one of these methods:

1. Environment variable (file path):
   export GOOGLE_OAUTH_CREDENTIALS="/path/to/gcp-oauth.keys.json"

2. Environment variable (inline JSON, for cloud deployment):
   export GOOGLE_OAUTH_CREDENTIALS='{"installed":{"client_id":"...","client_secret":"..."}}'

3. Default file path:
   Place your gcp-oauth.keys.json file in the package root directory.

Token storage:
- Tokens are saved to: ${getSecureTokenPath()}
- To use a custom token location, set GOOGLE_CALENDAR_MCP_TOKEN_PATH environment variable

To get OAuth credentials:
1. Go to the Google Cloud Console (https://console.cloud.google.com/)
2. Create or select a project
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials
5. Download the credentials file as gcp-oauth.keys.json
`.trim();
}
