/**
 * ADCDetector - Application Default Credentials Detection and Validation
 *
 * Detects and validates Google Cloud Application Default Credentials (ADC)
 * for use as an authentication method alongside OAuth.
 */

import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { ADCValidationResult } from './types.js';
import * as os from 'os';
import * as path from 'path';

export class ADCDetector {
  /**
   * Get the platform-specific path to ADC credentials file
   * @returns Absolute path to ADC credentials file
   */
  getADCPath(): string {
    const homeDir = os.homedir();

    if (process.platform === 'win32') {
      // Windows: %APPDATA%\gcloud\application_default_credentials.json
      const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      return path.join(appData, 'gcloud', 'application_default_credentials.json');
    } else {
      // macOS/Linux: ~/.config/gcloud/application_default_credentials.json
      return path.join(homeDir, '.config', 'gcloud', 'application_default_credentials.json');
    }
  }

  /**
   * Detect and validate Application Default Credentials
   * @param requiredScopes - Array of OAuth scope URLs required for Calendar API
   * @returns Validation result with availability, validity, and client if successful
   */
  async detectAndValidate(requiredScopes: string[]): Promise<ADCValidationResult> {
    try {
      // Attempt to get Application Default Credentials
      const auth = new GoogleAuth({
        scopes: requiredScopes
      });

      let client: OAuth2Client;
      try {
        const authClient = await auth.getClient();

        // Ensure we got an OAuth2Client (could be different client types)
        if (!(authClient instanceof OAuth2Client)) {
          return {
            available: false,
            valid: false,
            oauth2Client: null,
            missingScopes: [],
            error: 'ADC client is not an OAuth2Client',
            source: null
          };
        }

        client = authClient as OAuth2Client;
      } catch (error) {
        // ADC not available - this is not an error, just means credentials don't exist
        if (error instanceof Error &&
            (error.message.includes('Could not load the default credentials') ||
             error.message.includes('Unable to detect'))) {
          return {
            available: false,
            valid: false,
            oauth2Client: null,
            missingScopes: [],
            error: null,
            source: null
          };
        }

        // Some other error occurred
        return {
          available: false,
          valid: false,
          oauth2Client: null,
          missingScopes: [],
          error: `Failed to load ADC: ${error instanceof Error ? error.message : String(error)}`,
          source: this.getADCPath()
        };
      }

      // ADC credentials found - now validate scopes
      // Get credentials to check scopes
      let credentials;
      try {
        credentials = await client.getAccessToken();
      } catch (error) {
        // If getAccessToken fails, it might be a scope issue
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if it's a scope-related error
        if (errorMsg.toLowerCase().includes('insufficient') ||
            errorMsg.toLowerCase().includes('scope') ||
            errorMsg.toLowerCase().includes('permission')) {
          return {
            available: true,
            valid: false,
            oauth2Client: null,
            missingScopes: requiredScopes,
            error: `ADC credentials lack required Calendar API scopes. Run: gcloud auth application-default login --scopes=${requiredScopes.join(',')}`,
            source: this.getADCPath()
          };
        }

        // Other access token error
        return {
          available: true,
          valid: false,
          oauth2Client: null,
          missingScopes: requiredScopes,
          error: `Failed to get access token from ADC: ${errorMsg}. Try running: gcloud auth application-default login --scopes=${requiredScopes.join(',')}`,
          source: this.getADCPath()
        };
      }

      if (!credentials.token) {
        return {
          available: true,
          valid: false,
          oauth2Client: null,
          missingScopes: requiredScopes,
          error: `ADC credentials found but no access token available. Run: gcloud auth application-default login --scopes=${requiredScopes.join(',')}`,
          source: this.getADCPath()
        };
      }

      // For ADC, we need to verify the credentials work with Calendar API
      // If getAccessToken() succeeded, the credentials are valid
      // Note: Scope validation is best-effort - Google's ADC may not expose scopes directly

      return {
        available: true,
        valid: true,
        oauth2Client: client,
        missingScopes: [],
        error: null,
        source: process.env.GOOGLE_APPLICATION_CREDENTIALS || this.getADCPath()
      };

    } catch (error) {
      // Unexpected error during detection
      return {
        available: false,
        valid: false,
        oauth2Client: null,
        missingScopes: [],
        error: `Unexpected error during ADC detection: ${error instanceof Error ? error.message : String(error)}`,
        source: this.getADCPath()
      };
    }
  }
}
