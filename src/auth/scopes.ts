/**
 * OAuth 2.0 scope configuration for Google APIs
 *
 * This module manages the OAuth scopes required by the MCP server.
 * Scopes are requested conditionally based on enabled features.
 */

// Calendar API scope - always required
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

// Tasks API scope - only required when Tasks feature is enabled
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';

/**
 * Get the OAuth scopes required for the current configuration.
 *
 * @param enableTasks - Whether the Tasks feature is enabled
 * @returns Array of OAuth scope URLs
 */
export function getRequiredScopes(enableTasks = false): string[] {
  const scopes = [CALENDAR_SCOPE];

  if (enableTasks) {
    scopes.push(TASKS_SCOPE);
  }

  return scopes;
}

/**
 * Check if the granted scopes satisfy the required scopes.
 *
 * @param grantedScopes - Array of scopes that were granted during auth
 * @param requiredScopes - Array of scopes required for current config
 * @returns Object with validation result and missing scopes
 */
export function validateScopes(
  grantedScopes: string[] | undefined,
  requiredScopes: string[]
): { valid: boolean; missingScopes: string[] } {
  if (!grantedScopes || grantedScopes.length === 0) {
    // No scope information available - assume valid for backward compatibility
    // Tokens created before scope tracking won't have this field
    return { valid: true, missingScopes: [] };
  }

  const grantedSet = new Set(grantedScopes);
  const missingScopes = requiredScopes.filter(scope => !grantedSet.has(scope));

  return {
    valid: missingScopes.length === 0,
    missingScopes
  };
}

/**
 * Get a human-readable description of what permissions are missing.
 *
 * @param missingScopes - Array of missing OAuth scope URLs
 * @returns Human-readable message
 */
export function getMissingScopesMessage(missingScopes: string[]): string {
  const scopeDescriptions: Record<string, string> = {
    [CALENDAR_SCOPE]: 'Google Calendar',
    [TASKS_SCOPE]: 'Google Tasks'
  };

  const missingFeatures = missingScopes
    .map(scope => scopeDescriptions[scope] || scope)
    .join(', ');

  return `Your current authentication is missing permissions for: ${missingFeatures}. Please re-authenticate to grant access.`;
}
