import { describe, it, expect } from 'vitest';
import { OAuthStateStore, OAUTH_STATE_TTL_MS } from '../../../auth/oauthStateStore.js';

function makeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => { current += ms; }
  };
}

describe('OAuthStateStore', () => {
  describe('issue', () => {
    it('issues a 256-bit hex state', () => {
      const store = new OAuthStateStore();
      const state = store.issue('work', 'verifier');
      expect(state).toMatch(/^[0-9a-f]{64}$/);
      expect(store.size).toBe(1);
    });

    it('issues a distinct state for every flow, even for the same account', () => {
      const store = new OAuthStateStore();
      const states = new Set(Array.from({ length: 20 }, () => store.issue('work', 'verifier')));
      expect(states.size).toBe(20);
    });

    it('evicts the oldest pending flow once the cap is reached', () => {
      const store = new OAuthStateStore({ maxPending: 2 });
      const first = store.issue('a', 'va');
      const second = store.issue('b', 'vb');
      const third = store.issue('c', 'vc');

      expect(store.size).toBe(2);
      expect(store.consume(first)).toMatchObject({ ok: false, reason: 'unknown' });
      expect(store.consume(second)).toMatchObject({ ok: true, accountId: 'b' });
      expect(store.consume(third)).toMatchObject({ ok: true, accountId: 'c' });
    });

    it('prunes expired flows when issuing a new one', () => {
      const clock = makeClock();
      const store = new OAuthStateStore({ ttlMs: 1000, now: clock.now });
      store.issue('a', 'va');
      clock.advance(1000);
      store.issue('b', 'vb');
      expect(store.size).toBe(1);
    });
  });

  describe('consume', () => {
    it('returns the account and PKCE verifier bound to a valid state', () => {
      const store = new OAuthStateStore();
      const state = store.issue('work', 'the-verifier');
      expect(store.consume(state)).toEqual({ ok: true, accountId: 'work', codeVerifier: 'the-verifier' });
    });

    it('maps concurrent flows to their own accounts', () => {
      const store = new OAuthStateStore();
      const work = store.issue('work', 'v-work');
      const personal = store.issue('personal', 'v-personal');
      expect(store.consume(personal)).toMatchObject({ ok: true, accountId: 'personal', codeVerifier: 'v-personal' });
      expect(store.consume(work)).toMatchObject({ ok: true, accountId: 'work', codeVerifier: 'v-work' });
    });

    it('is single-use: a replayed state is rejected as unknown', () => {
      const store = new OAuthStateStore();
      const state = store.issue('work', 'verifier');
      expect(store.consume(state).ok).toBe(true);
      expect(store.consume(state)).toMatchObject({ ok: false, reason: 'unknown' });
      expect(store.size).toBe(0);
    });

    it.each([null, undefined, ''])('rejects a missing state (%s)', (missing) => {
      const store = new OAuthStateStore();
      store.issue('work', 'verifier');
      const result = store.consume(missing);
      expect(result).toMatchObject({ ok: false, reason: 'missing' });
      expect(store.size).toBe(1);
    });

    it('rejects a state the server never issued', () => {
      const store = new OAuthStateStore();
      store.issue('work', 'verifier');
      const result = store.consume('f'.repeat(64));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('unknown');
        expect(result.message).toMatch(/CSRF/);
      }
    });

    it('accepts a state just before the TTL elapses', () => {
      const clock = makeClock();
      const store = new OAuthStateStore({ now: clock.now });
      const state = store.issue('work', 'verifier');
      clock.advance(OAUTH_STATE_TTL_MS - 1);
      expect(store.consume(state).ok).toBe(true);
    });

    it('rejects an expired state and removes it', () => {
      const clock = makeClock();
      const store = new OAuthStateStore({ now: clock.now });
      const state = store.issue('work', 'verifier');
      clock.advance(OAUTH_STATE_TTL_MS);

      const result = store.consume(state);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('expired');
        expect(result.message).toMatch(/expired/);
      }
      expect(store.size).toBe(0);
    });
  });
});
