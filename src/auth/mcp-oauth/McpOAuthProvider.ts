import crypto from 'crypto';
import { Response } from 'express';
import { OAuth2Client } from 'google-auth-library';

import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { InvalidTokenError, InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

import { McpClientsStore } from './McpClientsStore.js';
import { McpTokenStore } from './McpTokenStore.js';
import { MCP_AUTH_STATE_TYPE, isSessionExpired } from './persistence.js';
import { TokenManager } from '../tokenManager.js';
import { loadCredentials } from '../client.js';
import { CalendarRegistry } from '../../services/CalendarRegistry.js';

interface PendingAuthSession {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state?: string;
  createdAt: number;
}

export interface McpOAuthProviderOptions {
  tokenManager: TokenManager;
  issuerUrl: string;
}

const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class McpOAuthProvider implements OAuthServerProvider {
  private _clientsStore: McpClientsStore;
  private _tokenStore: McpTokenStore;
  private pendingSessions = new Map<string, PendingAuthSession>();
  private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private tokenManager: TokenManager;
  private issuerUrl: string;

  constructor(options: McpOAuthProviderOptions) {
    this._clientsStore = new McpClientsStore();
    this._tokenStore = new McpTokenStore();
    this.tokenManager = options.tokenManager;
    this.issuerUrl = options.issuerUrl;
  }

  async initialize(): Promise<void> {
    await this._clientsStore.initialize();
    await this._tokenStore.initialize();

    this.sessionCleanupTimer = setInterval(() => {
      for (const [id, session] of this.pendingSessions) {
        if (isSessionExpired(session.createdAt)) {
          this.pendingSessions.delete(id);
        }
      }
    }, SESSION_CLEANUP_INTERVAL_MS);
    if (this.sessionCleanupTimer.unref) {
      this.sessionCleanupTimer.unref();
    }
  }

  shutdown(): void {
    this._tokenStore.shutdown();
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
    }
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  /**
   * Begins the MCP OAuth authorization flow by redirecting to Google OAuth.
   * Stores the MCP auth params (code challenge, redirect URI, state) in a pending session,
   * then redirects the user to Google's consent screen.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const sessionId = crypto.randomUUID();

    this.pendingSessions.set(sessionId, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      state: params.state,
      createdAt: Date.now(),
    });

    // Build Google OAuth URL
    const { client_id, client_secret } = await loadCredentials();
    const redirectUri = `${this.issuerUrl}/oauth2callback`;
    const googleClient = new OAuth2Client(client_id, client_secret, redirectUri);

    const googleState = Buffer.from(JSON.stringify({
      type: MCP_AUTH_STATE_TYPE,
      sessionId,
      account: 'default',
    })).toString('base64url');

    const authUrl = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      prompt: 'consent',
      state: googleState,
    });

    res.redirect(authUrl);
  }

  /**
   * Returns the code challenge that was used when the authorization began.
   */
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const stored = this._tokenStore.getAuthCode(authorizationCode);
    if (!stored) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    return stored.codeChallenge;
  }

  /**
   * Exchanges an MCP authorization code for tokens.
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL
  ): Promise<OAuthTokens> {
    const stored = this._tokenStore.consumeAuthCode(authorizationCode);
    if (!stored) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }

    if (stored.clientId !== client.client_id) {
      throw new InvalidGrantError('Authorization code was not issued to this client');
    }

    const refreshToken = this._tokenStore.createRefreshToken(client.client_id, []);
    const accessToken = this._tokenStore.createAccessToken(
      client.client_id,
      [],
      refreshToken.token
    );

    return {
      access_token: accessToken.token,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken.token,
    };
  }

  /**
   * Exchanges a refresh token for a new access token.
   */
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    _resource?: URL
  ): Promise<OAuthTokens> {
    const stored = this._tokenStore.getRefreshToken(refreshToken);
    if (!stored) {
      throw new InvalidGrantError('Invalid or expired refresh token');
    }

    if (stored.clientId !== client.client_id) {
      throw new InvalidGrantError('Refresh token was not issued to this client');
    }

    const accessToken = this._tokenStore.createAccessToken(
      client.client_id,
      stored.scopes,
      refreshToken
    );

    return {
      access_token: accessToken.token,
      token_type: 'Bearer',
      expires_in: 3600,
    };
  }

  /**
   * Verifies an MCP access token and returns auth info.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = this._tokenStore.getAccessToken(token);
    if (!stored) {
      throw new InvalidTokenError('Invalid or expired access token');
    }

    return {
      token: stored.token,
      clientId: stored.clientId,
      scopes: stored.scopes,
      expiresAt: Math.floor(stored.expiresAt / 1000),
    };
  }

  /**
   * Revokes an access or refresh token.
   */
  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const { token, token_type_hint } = request;

    if (token_type_hint === 'refresh_token') {
      this._tokenStore.revokeTokensByRefreshToken(token);
    } else if (token_type_hint === 'access_token') {
      this._tokenStore.revokeAccessToken(token);
    } else {
      if (!this._tokenStore.revokeAccessToken(token)) {
        this._tokenStore.revokeTokensByRefreshToken(token);
      }
    }
  }

  // --- Google OAuth Callback Handling ---

  /**
   * Parses the Google OAuth state parameter to determine if this is an MCP auth callback.
   * Returns the parsed state data if it's an MCP flow, undefined otherwise.
   */
  static parseMcpAuthState(stateParam: string | null): { type: string; sessionId: string; account: string } | undefined {
    if (!stateParam) return undefined;

    try {
      const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
      if (decoded?.type === MCP_AUTH_STATE_TYPE && decoded?.sessionId) {
        return decoded;
      }
    } catch {
      // Not a valid MCP state
    }
    return undefined;
  }

  /**
   * Completes the MCP OAuth flow after Google OAuth callback.
   * Exchanges Google auth code for tokens, stores them, generates MCP auth code,
   * and redirects to Claude's callback URI.
   */
  async completeMcpAuth(
    googleCode: string,
    sessionId: string,
    accountId: string,
    res: Response
  ): Promise<void> {
    const session = this.pendingSessions.get(sessionId);
    if (!session) {
      res.status(400).send('Invalid or expired MCP auth session');
      return;
    }

    this.pendingSessions.delete(sessionId);

    try {
      // Exchange Google code for tokens
      const { client_id, client_secret } = await loadCredentials();
      const redirectUri = `${this.issuerUrl}/oauth2callback`;
      const googleClient = new OAuth2Client(client_id, client_secret, redirectUri);
      const { tokens } = await googleClient.getToken(googleCode);

      // Get user email
      googleClient.setCredentials(tokens);
      let email: string | undefined;
      try {
        const tokenInfo = await googleClient.getTokenInfo(tokens.access_token || '');
        email = tokenInfo.email || undefined;
      } catch {
        // Email retrieval failed
      }

      // Store Google tokens for calendar access
      const originalMode = this.tokenManager.getAccountMode();
      try {
        this.tokenManager.setAccountMode(accountId);
        await this.tokenManager.saveTokens(tokens, email);
      } finally {
        this.tokenManager.setAccountMode(originalMode);
      }

      CalendarRegistry.getInstance().clearCache();

      // Generate MCP authorization code
      const mcpCode = this._tokenStore.createAuthCode(
        session.clientId,
        session.codeChallenge,
        session.redirectUri,
        sessionId
      );

      // Redirect to Claude's callback URI with MCP auth code
      const redirectUrl = new URL(session.redirectUri);
      redirectUrl.searchParams.set('code', mcpCode);
      if (session.state) {
        redirectUrl.searchParams.set('state', session.state);
      }

      res.redirect(redirectUrl.toString());
    } catch (error) {
      try {
        const redirectUrl = new URL(session.redirectUri);
        redirectUrl.searchParams.set('error', 'server_error');
        redirectUrl.searchParams.set(
          'error_description',
          error instanceof Error ? error.message : 'Failed to complete authentication'
        );
        if (session.state) {
          redirectUrl.searchParams.set('state', session.state);
        }
        res.redirect(redirectUrl.toString());
      } catch {
        res.status(500).send('Authentication failed');
      }
    }
  }
}
