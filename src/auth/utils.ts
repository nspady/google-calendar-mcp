import * as path from 'path';
import { fileURLToPath } from 'url';

// Global variable to store CLI-provided credentials path
let cliCredentialsPath: string | undefined;

// Helper to get the project root directory reliably
function getProjectRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // In build output (e.g., build/bundle.js), __dirname is .../build
  // Go up ONE level to get the project root
  const projectRoot = path.join(__dirname, ".."); // Corrected: Go up ONE level
  return path.resolve(projectRoot); // Ensure absolute path
}

// Set the credentials path from CLI arguments
export function setCredentialsPath(credentialsPath: string): void {
  cliCredentialsPath = credentialsPath;
}

// Returns the absolute path for the saved token file.
export function getSecureTokenPath(): string {
  const projectRoot = getProjectRoot();
  const tokenPath = path.join(projectRoot, ".gcp-saved-tokens.json");
  return tokenPath; // Already absolute from getProjectRoot
}

// Returns the absolute path for the GCP OAuth keys file with priority:
// 1. CLI parameter (highest priority)
// 2. Environment variable GOOGLE_OAUTH_CREDENTIALS_FILE
// 3. Default file path (lowest priority)
export function getKeysFilePath(): string {
  // Priority 1: CLI parameter
  if (cliCredentialsPath) {
    return path.resolve(cliCredentialsPath);
  }
  
  // Priority 2: Environment variable
  const envCredentialsPath = process.env.GOOGLE_OAUTH_CREDENTIALS_FILE;
  if (envCredentialsPath) {
    return path.resolve(envCredentialsPath);
  }
  
  // Priority 3: Default file path
  const projectRoot = getProjectRoot();
  const keysPath = path.join(projectRoot, "gcp-oauth.keys.json");
  return keysPath; // Already absolute from getProjectRoot
}

// Interface for OAuth credentials
export interface OAuthCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

// Generate helpful error message for missing credentials
export function generateCredentialsErrorMessage(): string {
  return `
OAuth credentials not found. Please provide credentials using one of these methods:

1. CLI parameter:
   npx @nspady/google-calendar-mcp auth --credentials-file /path/to/gcp-oauth.keys.json

2. Environment variable:
   Set GOOGLE_OAUTH_CREDENTIALS_FILE to the path of your credentials file:
   export GOOGLE_OAUTH_CREDENTIALS_FILE="/path/to/gcp-oauth.keys.json"

3. Default file path:
   Place your gcp-oauth.keys.json file in the package root directory.

To get OAuth credentials:
1. Go to the Google Cloud Console (https://console.cloud.google.com/)
2. Create or select a project
3. Enable the Google Calendar API
4. Create OAuth 2.0 credentials
5. Download the credentials file as gcp-oauth.keys.json
`.trim();
}