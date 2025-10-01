import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import { getKeysFilePath, generateCredentialsErrorMessage, OAuthCredentials } from './utils.js';
import { AuthMethod, CredentialSource } from './types.js';
import { ADCDetector } from './adcDetector.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

async function loadCredentialsFromFile(): Promise<OAuthCredentials> {
  const keysContent = await fs.readFile(getKeysFilePath(), "utf-8");
  const keys = JSON.parse(keysContent);

  if (keys.installed) {
    // Standard OAuth credentials file format
    const { client_id, client_secret, redirect_uris } = keys.installed;
    return { client_id, client_secret, redirect_uris };
  } else if (keys.client_id && keys.client_secret) {
    // Direct format
    return {
      client_id: keys.client_id,
      client_secret: keys.client_secret,
      redirect_uris: keys.redirect_uris || ['http://localhost:3000/oauth2callback']
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
    throw new Error(`${errorMessage}\n\nOriginal error: ${fileError instanceof Error ? fileError.message : fileError}`);
  }
}

export async function initializeOAuth2Client(): Promise<OAuth2Client> {
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

/**
 * Read and parse the GOOGLE_AUTH_METHOD environment variable
 * @returns AuthMethod value, 'auto' for default behavior, or null if invalid
 */
export function readAuthMethodPreference(): AuthMethod | 'auto' | null {
  const envValue = process.env.GOOGLE_AUTH_METHOD;

  if (!envValue) {
    return 'auto';
  }

  const normalized = envValue.toLowerCase().trim();

  if (normalized === AuthMethod.GCLOUD) {
    return AuthMethod.GCLOUD;
  }

  if (normalized === AuthMethod.OAUTH) {
    return AuthMethod.OAUTH;
  }

  // Invalid value - log warning and return null
  process.stderr.write(`WARNING: Invalid GOOGLE_AUTH_METHOD value '${envValue}'. Valid values: gcloud, oauth. Falling back to auto-detection.\n`);
  return null;
}

/**
 * Select and initialize authentication method based on environment and availability
 * @param requiredScopes - Array of OAuth scope URLs required for Calendar API
 * @returns CredentialSource with selected OAuth2Client
 * @throws McpError if selected method unavailable or invalid
 */
export async function selectAuthMethod(requiredScopes: string[]): Promise<CredentialSource> {
  const preference = readAuthMethodPreference();
  const detector = new ADCDetector();

  // Try to detect ADC
  const adcValidation = await detector.detectAndValidate(requiredScopes);

  // Check if OAuth tokens are available (we'll need to check token manager)
  // For now, we'll try to load OAuth client and catch errors
  let oauthAvailable = false;
  let oauthClient: OAuth2Client | null = null;

  try {
    oauthClient = await initializeOAuth2Client();
    oauthAvailable = true;
  } catch {
    oauthAvailable = false;
  }

  // Handle explicit GCLOUD preference
  if (preference === AuthMethod.GCLOUD) {
    if (!adcValidation.valid) {
      const errorMsg = adcValidation.error || 'ADC not found or invalid';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `GOOGLE_AUTH_METHOD is set to 'gcloud' but Application Default Credentials are not available or invalid.\n\n` +
        `Error: ${errorMsg}\n\n` +
        `To fix, run:\n` +
        `  gcloud auth application-default login --scopes=${requiredScopes.join(',')}\n\n` +
        `Or unset GOOGLE_AUTH_METHOD to fall back to OAuth flow.`
      );
    }

    process.stderr.write('GOOGLE_AUTH_METHOD=gcloud\n');
    process.stderr.write('Using Application Default Credentials for authentication\n');

    return {
      method: AuthMethod.GCLOUD,
      oauth2Client: adcValidation.oauth2Client!,
      scopes: requiredScopes,
      source: 'Application Default Credentials'
    };
  }

  // Handle explicit OAUTH preference
  if (preference === AuthMethod.OAUTH) {
    if (!oauthAvailable || !oauthClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `GOOGLE_AUTH_METHOD is set to 'oauth' but OAuth tokens are not available.\n\n` +
        `To fix, run:\n` +
        `  npm run auth\n\n` +
        `Or unset GOOGLE_AUTH_METHOD to try Application Default Credentials.`
      );
    }

    process.stderr.write('GOOGLE_AUTH_METHOD=oauth\n');

    return {
      method: AuthMethod.OAUTH,
      oauth2Client: oauthClient,
      scopes: requiredScopes,
      source: 'OAuth tokens from ~/.config/google-calendar-mcp'
    };
  }

  // Auto-detection mode (preference === 'auto' or null)
  // Prefer gcloud if available, otherwise fall back to OAuth

  if (adcValidation.valid && adcValidation.oauth2Client) {
    process.stderr.write('Using Application Default Credentials for authentication (auto-detected)\n');

    return {
      method: AuthMethod.GCLOUD,
      oauth2Client: adcValidation.oauth2Client,
      scopes: requiredScopes,
      source: 'Application Default Credentials (auto-detected)'
    };
  }

  // Fall back to OAuth
  if (oauthAvailable && oauthClient) {
    if (adcValidation.available && !adcValidation.valid) {
      process.stderr.write(`Note: ADC credentials found but not valid (${adcValidation.error}). Using OAuth tokens instead.\n`);
    }

    return {
      method: AuthMethod.OAUTH,
      oauth2Client: oauthClient,
      scopes: requiredScopes,
      source: 'OAuth tokens (ADC not available)'
    };
  }

  // Neither auth method available
  throw new McpError(
    ErrorCode.InvalidRequest,
    `No valid authentication credentials available.\n\n` +
    `Please either:\n` +
    `1. Run: gcloud auth application-default login --scopes=${requiredScopes.join(',')}\n` +
    `2. Run: npm run auth\n\n` +
    `For more information, see the README.md`
  );
}