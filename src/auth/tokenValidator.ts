import { OAuth2Client } from 'google-auth-library';

export interface TokenValidationResult {
  valid: boolean;
  error?: string;
  expiresAt?: number;
  userId?: string;
  email?: string;
  scopes?: string[];
}

/**
 * Validates a Google OAuth2 access token
 */
export class TokenValidator {
  /**
   * Validate an access token by checking it with Google
   * @param token - The access token to validate
   * @returns Validation result with token info
   */
  static async validateAccessToken(token: string): Promise<TokenValidationResult> {
    try {
      const client = new OAuth2Client();

      // Get token info from Google
      const tokenInfo = await client.getTokenInfo(token);

      // Check if token is expired
      const expiresAt = tokenInfo.expiry_date;
      const now = Date.now();

      if (expiresAt && expiresAt <= now) {
        return {
          valid: false,
          error: 'Token has expired'
        };
      }

      return {
        valid: true,
        expiresAt,
        userId: tokenInfo.user_id,
        email: tokenInfo.email,
        scopes: tokenInfo.scopes
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Token validation failed'
      };
    }
  }

  /**
   * Validate that a token has the required scopes for calendar operations
   * @param token - The access token to validate
   * @returns True if token has required scopes
   */
  static async hasCalendarScopes(token: string): Promise<boolean> {
    const result = await this.validateAccessToken(token);

    if (!result.valid || !result.scopes) {
      return false;
    }

    // Check for required calendar scopes
    const requiredScopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    // Token needs at least one of the required scopes
    return result.scopes.some(scope =>
      requiredScopes.some(required =>
        scope.includes(required) || required.includes(scope)
      )
    );
  }

  /**
   * Quick validation to check if token format is valid (basic check)
   * @param token - The access token to check
   * @returns True if format appears valid
   */
  static isValidTokenFormat(token: string): boolean {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // Google access tokens are typically 100+ characters
    if (token.length < 50) {
      return false;
    }

    // Should contain alphanumeric characters, dots, hyphens, underscores
    const validTokenPattern = /^[A-Za-z0-9._-]+$/;
    return validTokenPattern.test(token);
  }

  /**
   * Extract token info without making an API call
   * Useful for debugging and logging (don't use for security decisions)
   * @param token - The access token
   * @returns Basic token info
   */
  static getTokenInfo(token: string): { length: number; prefix: string; suffix: string } {
    return {
      length: token.length,
      prefix: token.substring(0, 10) + '...',
      suffix: '...' + token.substring(token.length - 10)
    };
  }
}
