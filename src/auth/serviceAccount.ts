import { JWT } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getKeysFilePath } from './utils.js';
import { getCredentialsPathSetting, getServiceAccountConfig } from '../config/AppConfig.js';

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
  /** Which setting pointed at this file, for the startup log. */
  source: string;
  /**
   * Private key read from that same file.
   *
   * Carried here so the whole startup reads the key exactly once: detection and
   * client construction used to open it separately.
   */
  privateKey: string;
}

/**
 * A detected key without its secret, for callers that only need to know a service
 * account is in use and which one.
 */
export type ServiceAccountSummary = Omit<ServiceAccountKey, 'privateKey'>;

/** What a candidate file turned out to be. */
type KeyReadResult =
  | { kind: 'service-account'; key: ServiceAccountKey }
  /** OAuth-like client credentials that take precedence over ambient credentials. */
  | { kind: 'other-credentials' }
  /** Absent, unreadable, not JSON, or a malformed service account key. */
  | { kind: 'unusable' };

interface KeyCandidate {
  path: string;
  source: string;
  /**
   * Whether a broken file here is a fatal configuration error.
   *
   * Only GOOGLE_SERVICE_ACCOUNT_KEY is strict: it names *this server's* service
   * account key, so a typo in it is worth failing on. Every other path is shared
   * or ambient, and a problem there must never take down an install that is
   * using OAuth perfectly well.
   */
  strict: boolean;
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function readCandidate(candidate: KeyCandidate): Promise<KeyReadResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(candidate.path, 'utf-8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (candidate.strict) {
      throw new Error(
        `${candidate.source} points at ${candidate.path}, which could not be read as JSON: ${reason}`
      );
    }

    // A missing default credentials file is ordinary — the OAuth flow reports it
    // with a far better message. A *named* path that does not work is worth a
    // line, because a silent fallback is what makes such a typo hard to find.
    if (candidate.source !== 'credentials file') {
      warn(`Ignoring ${candidate.source} (${candidate.path}): not readable as JSON (${reason}).`);
    }
    return { kind: 'unusable' };
  }

  const key = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;

  if (!key || key.type !== 'service_account') {
    if (candidate.strict) {
      throw new Error(
        `${candidate.source} points at ${candidate.path}, which is not a service account key ` +
          `(expected "type": "service_account").`
      );
    }
    if (key && ((key.installed && typeof key.installed === 'object' && !Array.isArray(key.installed))
      || typeof key.client_id === 'string')) {
      return { kind: 'other-credentials' };
    }
    return { kind: 'unusable' };
  }

  if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string') {
    const problem =
      `${candidate.path} declares "type": "service_account" but is missing ` +
      `client_email or private_key.`;

    if (candidate.strict) {
      throw new Error(problem);
    }

    // Declared itself a service account key and is not one. Always worth saying,
    // but not worth killing an OAuth install over.
    warn(`Ignoring ${candidate.source}: ${problem}`);
    return { kind: 'unusable' };
  }

  return {
    kind: 'service-account',
    key: {
      path: candidate.path,
      email: key.client_email,
      source: candidate.source,
      privateKey: key.private_key
    }
  };
}

/**
 * Detect whether the server should run in service account mode.
 *
 * Detection is by file *content* rather than by a mode flag: a service account key
 * is unambiguously identified by `"type": "service_account"`, so an operator only
 * has to point the server at the right file. Returns null when no service account
 * key is present, in which case the normal OAuth flow applies.
 *
 * Precedence, and the reason for it:
 *
 * 1. `GOOGLE_SERVICE_ACCOUNT_KEY` — an explicit demand for service account mode.
 * 2. This server's own credentials file — `GOOGLE_OAUTH_CREDENTIALS` when set,
 *    otherwise the default `gcp-oauth.keys.json`. Content-checked, so dropping a
 *    service account key in that same path stays a one-file change. If it holds
 *    ordinary OAuth client credentials, *that is the answer*: the operator has an
 *    OAuth setup, and an ambient variable must not override it.
 * 3. `GOOGLE_APPLICATION_CREDENTIALS` — the shared Google variable, often set for
 *    unrelated tooling. Consulted only when this server has no credentials file of
 *    its own, so a restart can never silently switch a working OAuth install over.
 */
export async function detectServiceAccountKey(): Promise<ServiceAccountKey | null> {
  const config = getServiceAccountConfig();
  const explicitPath = config.keyPath;
  if (explicitPath) {
    // Strict: anything other than a usable key throws out of readCandidate.
    const explicit = await readCandidate({
      path: path.resolve(explicitPath),
      source: 'GOOGLE_SERVICE_ACCOUNT_KEY',
      strict: true
    });
    if (explicit.kind === 'service-account') return explicit.key;
  }

  const own = await readCandidate({
    path: getKeysFilePath(),
    source: getCredentialsPathSetting() ? 'GOOGLE_OAUTH_CREDENTIALS' : 'credentials file',
    strict: false
  });
  if (own.kind === 'service-account') return own.key;
  if (own.kind === 'other-credentials') return null;

  const ambientPath = config.applicationCredentialsPath;
  if (ambientPath) {
    const ambient = await readCandidate({
      path: path.resolve(ambientPath),
      source: 'GOOGLE_APPLICATION_CREDENTIALS',
      strict: false
    });
    if (ambient.kind === 'service-account') return ambient.key;
  }

  return null;
}

/**
 * Build an authenticated client from an already-detected key.
 *
 * JWT extends OAuth2Client, so the result is a drop-in replacement everywhere the
 * server already expects an OAuth2Client, and token acquisition happens lazily on
 * the first API call.
 *
 * Takes the detected key rather than a path so startup does not open the file a
 * second time.
 *
 * GOOGLE_SERVICE_ACCOUNT_SUBJECT is optional and only meaningful with Google
 * Workspace domain-wide delegation, where the service account impersonates a user.
 * Without it the service account acts as itself.
 */
export function initializeServiceAccountClient(key: ServiceAccountKey): JWT {
  const subject = getServiceAccountConfig().subject;

  return new JWT({
    email: key.email,
    key: key.privateKey,
    scopes: SERVICE_ACCOUNT_SCOPES,
    ...(subject ? { subject } : {})
  });
}
