import crypto from 'crypto';

/** How long an issued state stays valid. Matches the AuthServer MCP-tool flow timeout. */
export const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

/** Upper bound on in-flight flows so repeated "add account" clicks can't grow memory unbounded. */
export const MAX_PENDING_OAUTH_FLOWS = 64;

interface PendingOAuthFlow {
  accountId: string;
  codeVerifier: string;
  expiresAt: number;
}

export type OAuthStateRejection = 'missing' | 'unknown' | 'expired';

export type ConsumeOAuthStateResult =
  | { ok: true; accountId: string; codeVerifier: string }
  | { ok: false; reason: OAuthStateRejection; message: string };

const REJECTION_MESSAGES: Record<OAuthStateRejection, string> = {
  missing: 'OAuth state parameter missing. Start the sign-in again from the accounts page.',
  unknown: 'Unknown or already-used OAuth state parameter. This may indicate a CSRF attempt or a reused link. Start the sign-in again from the accounts page.',
  expired: 'This sign-in link has expired. Start the sign-in again from the accounts page.'
};

/**
 * Server-side map of OAuth `state` values to the account (and PKCE verifier) of
 * the flow that issued them. States are random, expire after a TTL, and are
 * single-use: consume() removes the entry whether or not it was still valid.
 */
export class OAuthStateStore {
  private pending = new Map<string, PendingOAuthFlow>();
  private readonly ttlMs: number;
  private readonly maxPending: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxPending?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? OAUTH_STATE_TTL_MS;
    this.maxPending = options.maxPending ?? MAX_PENDING_OAUTH_FLOWS;
    this.now = options.now ?? Date.now;
  }

  /** Issues a new random state bound to the account and PKCE verifier. */
  issue(accountId: string, codeVerifier: string): string {
    this.pruneExpired();
    while (this.pending.size >= this.maxPending) {
      // Map iteration is insertion order, so the first key is the oldest flow.
      const oldest = this.pending.keys().next().value as string;
      this.pending.delete(oldest);
    }

    const state = crypto.randomBytes(32).toString('hex');
    this.pending.set(state, {
      accountId,
      codeVerifier,
      expiresAt: this.now() + this.ttlMs
    });
    return state;
  }

  /** Validates and removes a state returned to the callback. */
  consume(state: string | null | undefined): ConsumeOAuthStateResult {
    if (!state) {
      return this.reject('missing');
    }

    const flow = this.pending.get(state);
    if (!flow) {
      return this.reject('unknown');
    }
    this.pending.delete(state);

    if (this.now() >= flow.expiresAt) {
      return this.reject('expired');
    }

    return { ok: true, accountId: flow.accountId, codeVerifier: flow.codeVerifier };
  }

  get size(): number {
    return this.pending.size;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [state, flow] of this.pending) {
      if (now >= flow.expiresAt) {
        this.pending.delete(state);
      }
    }
  }

  private reject(reason: OAuthStateRejection): ConsumeOAuthStateResult {
    return { ok: false, reason, message: REJECTION_MESSAGES[reason] };
  }
}
