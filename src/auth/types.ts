/**
 * Type definitions for authentication methods and credential management
 */

import { OAuth2Client } from 'google-auth-library';

/**
 * Authentication method enumeration
 */
export enum AuthMethod {
  GCLOUD = 'gcloud',
  OAUTH = 'oauth'
}

/**
 * Source of authentication credentials
 */
export interface CredentialSource {
  /** Which authentication method is active */
  method: AuthMethod;

  /** Google auth client instance */
  oauth2Client: OAuth2Client;

  /** Email address of authenticated account (if available) */
  accountEmail?: string;

  /** OAuth scopes available with these credentials */
  scopes: string[];

  /** Human-readable source description */
  source: string;
}

/**
 * Result of Application Default Credentials detection and validation
 */
export interface ADCValidationResult {
  /** Whether ADC credentials were found */
  available: boolean;

  /** Whether credentials have required scopes and are usable */
  valid: boolean;

  /** The authenticated client if valid, null otherwise */
  oauth2Client: OAuth2Client | null;

  /** Required scopes that are missing (if invalid) */
  missingScopes: string[];

  /** Error message if detection/validation failed */
  error: string | null;

  /** Where credentials were found (env var, gcloud config, metadata service) */
  source: string | null;
}

/**
 * Configuration for authentication method selection
 */
export interface AuthConfig {
  /** User's preferred authentication method */
  preferredMethod: AuthMethod | 'auto';

  /** Result of ADC availability check */
  adcValidation: ADCValidationResult;

  /** Whether OAuth tokens exist */
  oauthAvailable: boolean;

  /** Final authentication method chosen */
  selectedMethod: AuthMethod;
}
