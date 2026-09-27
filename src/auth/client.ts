import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import { isTestEnvironment } from '../config/AppConfig.js';
import { getKeysFilePath, generateCredentialsErrorMessage, OAuthCredentials } from './utils.js';
import {
  detectServiceAccountKey,
  initializeServiceAccountClient,
  ServiceAccountKey
} from './serviceAccount.js';

/**
 * Announce which credentials were chosen.
 *
 * Two files can plausibly satisfy this server, so "why is it authenticating as
 * that?" has to be answerable from the logs rather than by guessing. stderr, not
 * stdout: stdout is the stdio transport's MCP channel.
 */
function reportAuthMode(description: string): void {
  if (isTestEnvironment()) return;
  process.stderr.write(`Authenticating with ${description}\n`);
}

const DEFAULT_REDIRECT_URIS = ['http://localhost:3000/oauth2callback'];

async function loadCredentialsFromFile(): Promise<OAuthCredentials> {
  const keysContent = await fs.readFile(getKeysFilePath(), "utf-8");
  const keys = JSON.parse(keysContent);

  if (keys.installed) {
    // Standard OAuth credentials file format
    const { client_id, client_secret, redirect_uris } = keys.installed;
    if (!client_id || !client_secret) {
      throw new Error('Invalid credentials file: "installed" object is missing client_id or client_secret.');
    }
    return {
      client_id,
      client_secret,
      redirect_uris: Array.isArray(redirect_uris) && redirect_uris.length > 0 ? redirect_uris : DEFAULT_REDIRECT_URIS
    };
  } else if (keys.client_id && keys.client_secret) {
    // Direct format
    return {
      client_id: keys.client_id,
      client_secret: keys.client_secret,
      redirect_uris: keys.redirect_uris || DEFAULT_REDIRECT_URIS
    };
  } else {
    throw new Error('Invalid credentials file format. Expected either "installed" object or direct client_id/client_secret fields.');
  }
}

async function loadCredentialsWithFallback(): Promise<OAuthCredentials> {
  // Load credentials from file (CLI param, env var, or default path)
  try {
    return await loadCredentialsFromFile();
  } catch (fileError) {
    // Generate helpful error message
    const errorMessage = generateCredentialsErrorMessage();
    throw new Error(`${errorMessage}\n\nCredentials file: ${getKeysFilePath()}\nOriginal error: ${fileError instanceof Error ? fileError.message : fileError}`);
  }
}

/**
 * @param serviceAccount A key the caller already detected. Passing it avoids a
 *   second detection pass — and a second read of the key file — during startup.
 *   Omit it to detect here; pass null to force the OAuth path.
 */
export async function initializeOAuth2Client(
  serviceAccount?: ServiceAccountKey | null
): Promise<OAuth2Client> {
  // A service account key short-circuits the OAuth flow entirely. JWT extends
  // OAuth2Client, so callers are unaffected.
  const detected =
    serviceAccount === undefined ? await detectServiceAccountKey() : serviceAccount;
  if (detected) {
    reportAuthMode(`service account ${detected.email} from ${detected.source}`);
    return initializeServiceAccountClient(detected);
  }

  reportAuthMode(`OAuth client credentials from ${getKeysFilePath()}`);

  // Always use real OAuth credentials - no mocking.
  // Unit tests should mock at the handler level, integration tests need real credentials.
  try {
    const credentials = await loadCredentialsWithFallback();
    
    // Use the first redirect URI as the default for the base client
    return new OAuth2Client({
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      redirectUri: credentials.redirect_uris[0],
    });
  } catch (error) {
    throw new Error(`Error loading OAuth keys: ${error instanceof Error ? error.message : error}`);
  }
}

export async function loadCredentials(): Promise<{ client_id: string; client_secret: string }> {
  try {
    const credentials = await loadCredentialsWithFallback();
    
    if (!credentials.client_id || !credentials.client_secret) {
        throw new Error('Client ID or Client Secret missing in credentials.');
    }
    return {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret
    };
  } catch (error) {
    throw new Error(`Error loading credentials: ${error instanceof Error ? error.message : error}`);
  }
}
