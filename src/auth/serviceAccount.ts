import { JWT } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getKeysFilePath } from './utils.js';

/**
 * Service account authentication.
 *
 * A service account carries its own long-lived key, so this path has no browser
 * consent step and no refresh token that expires — which is what makes it useful
 * for headless deployments and for OAuth apps left in "Testing" publishing status,
 * where Google invalidates refresh tokens after seven days.
 *
 * Access is granted by *sharing a calendar with the service account's e-mail
 * address*, so this works with ordinary @gmail.com calendars and does not require
 * Google Workspace or domain-wide delegation. See docs for the limitations.
 */

export const SERVICE_ACCOUNT_SCOPES = ['https://www.googleapis.com/auth/calendar'];

export interface ServiceAccountKey {
  /** Absolute path of the key file that was detected. */
  path: string;
  /** The service account's e-mail — the address a calendar must be shared with. */
  email: string;
}

/**
 * Explicit key path, if the user set one.
 *
 * GOOGLE_SERVICE_ACCOUNT_KEY is checked first so a service account key can live
 * alongside OAuth client credentials without either shadowing the other.
 * GOOGLE_APPLICATION_CREDENTIALS is honoured too, since that is the variable the
 * Google client libraries already use for this purpose.
 */
function getExplicitKeyPaths(): string[] {
  return [process.env.GOOGLE_SERVICE_ACCOUNT_KEY, process.env.GOOGLE_APPLICATION_CREDENTIALS]
    .filter((value): value is string => Boolean(value))
    .map((value) => path.resolve(value));
}

async function readServiceAccountKey(keyPath: string): Promise<ServiceAccountKey | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(keyPath, 'utf-8'));
  } catch {
    // Unreadable or not JSON. Not an error here: the caller falls back to OAuth,
    // and OAuth reports its own, more specific failure.
    return null;
  }

  const key = parsed as Record<string, unknown> | null;
  if (!key || key.type !== 'service_account') return null;

  if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    throw new Error(
      `${keyPath} declares "type": "service_account" but is missing client_email or private_key.`
    );
  }

  return { path: keyPath, email: key.client_email };
}

/**
 * Detect whether the server should run in service account mode.
 *
 * Detection is by file *content* rather than by a mode flag: a service account key
 * is unambiguously identified by `"type": "service_account"`, so an operator only
 * has to point the server at the right file. Returns null when no service account
 * key is present, in which case the normal OAuth flow applies.
 */
export async function detectServiceAccountKey(): Promise<ServiceAccountKey | null> {
  for (const candidate of getExplicitKeyPaths()) {
    const key = await readServiceAccountKey(candidate);
    if (key) return key;
  }

  // Also accept a service account key supplied through the regular credentials
  // path, so switching an existing install over is a one-file change.
  return await readServiceAccountKey(getKeysFilePath());
}

/**
 * Build an authenticated client for a service account key.
 *
 * JWT extends OAuth2Client, so the result is a drop-in replacement everywhere the
 * server already expects an OAuth2Client, and token acquisition happens lazily on
 * the first API call.
 *
 * GOOGLE_SERVICE_ACCOUNT_SUBJECT is optional and only meaningful with Google
 * Workspace domain-wide delegation, where the service account impersonates a user.
 * Without it the service account acts as itself.
 */
export async function initializeServiceAccountClient(keyPath: string): Promise<JWT> {
  const raw = JSON.parse(await fs.readFile(keyPath, 'utf-8'));
  const subject = process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT;

  return new JWT({
    email: raw.client_email,
    key: raw.private_key,
    scopes: SERVICE_ACCOUNT_SCOPES,
    ...(subject ? { subject } : {})
  });
}
