import { OAuth2Client } from 'google-auth-library';
import { calendar_v3, google } from 'googleapis';
import { getCredentialsProjectId } from '../auth/utils.js';

/**
 * Represents a calendar accessible from a specific account
 */
export interface CalendarAccess {
  accountId: string;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  primary: boolean;
  summary: string;
  summaryOverride?: string;
}

/**
 * Represents a unified view of a calendar across multiple accounts
 */
export interface UnifiedCalendar {
  calendarId: string;
  accounts: CalendarAccess[];
  preferredAccount: string; // Account with highest permission
  displayName: string; // Primary account's name (summaryOverride > summary)
}

/**
 * Permission ranking for calendar access
 */
const PERMISSION_RANK: Record<string, number> = {
  'owner': 4,
  'writer': 3,
  'reader': 2,
  'freeBusyReader': 1,
};

/**
 * CalendarRegistry service for managing calendar deduplication and permission-based account selection.
 * Implemented as a singleton to ensure cache is shared across all handlers
 * and can be properly invalidated when accounts change.
 */
export class CalendarRegistry {
  private static instance: CalendarRegistry | null = null;

  private cache: Map<string, { data: UnifiedCalendar[]; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Track in-flight requests to prevent duplicate API calls during concurrent access
  private inFlightRequests: Map<string, Promise<UnifiedCalendar[]>> = new Map();

  /**
   * Get the singleton instance of CalendarRegistry
   */
  static getInstance(): CalendarRegistry {
    if (!CalendarRegistry.instance) {
      CalendarRegistry.instance = new CalendarRegistry();
    }
    return CalendarRegistry.instance;
  }

  /**
   * Reset the singleton instance (useful for testing or when accounts change)
   * Clears the cache and resets the instance
   */
  static resetInstance(): void {
    if (CalendarRegistry.instance) {
      CalendarRegistry.instance.clearCache();
    }
    CalendarRegistry.instance = null;
  }

  /**
   * Get calendar client for a specific account
   */
  private getCalendar(auth: OAuth2Client): calendar_v3.Calendar {
    const quotaProjectId = getCredentialsProjectId();
    const config: any = {
      version: 'v3',
      auth,
      timeout: 3000
    };
    if (quotaProjectId) {
      config.quotaProjectId = quotaProjectId;
    }
    return google.calendar(config);
  }

  /**
   * Fetch all calendars from all accounts and build unified registry.
   * Uses in-flight request tracking to prevent duplicate API calls during concurrent access.
   */
  async getUnifiedCalendars(accounts: Map<string, OAuth2Client>): Promise<UnifiedCalendar[]> {
    const cacheKey = Array.from(accounts.keys()).sort().join(',');

    // Check if there's already an in-flight request for this cache key
    const inFlight = this.inFlightRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Create new request and track it
    const requestPromise = this.fetchAndBuildUnifiedCalendars(accounts, cacheKey);
    this.inFlightRequests.set(cacheKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      // Remove from in-flight tracking once complete
      this.inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * Internal method to fetch calendars and build the unified registry
   */
  private async fetchAndBuildUnifiedCalendars(
    accounts: Map<string, OAuth2Client>,
    cacheKey: string
  ): Promise<UnifiedCalendar[]> {
    // Fetch calendars from all accounts in parallel
    const calendarsByAccount = await Promise.all(
      Array.from(accounts.entries()).map(async ([accountId, client]) => {
        try {
          const calendar = this.getCalendar(client);
          const response = await calendar.calendarList.list();
          return {
            accountId,
            calendars: response.data.items || []
          };
        } catch (error) {
          // If one account fails, continue with others
          return {
            accountId,
            calendars: [] as calendar_v3.Schema$CalendarListEntry[]
          };
        }
      })
    );

    // Build calendar map: calendarId -> CalendarAccess[]
    const calendarMap = new Map<string, CalendarAccess[]>();

    for (const { accountId, calendars } of calendarsByAccount) {
      for (const cal of calendars) {
        if (!cal.id) continue;

        const access: CalendarAccess = {
          accountId,
          accessRole: (cal.accessRole as CalendarAccess['accessRole']) || 'reader',
          primary: cal.primary || false,
          summary: cal.summary || cal.id,
          summaryOverride: cal.summaryOverride ?? undefined
        };

        const existing = calendarMap.get(cal.id) || [];
        existing.push(access);
        calendarMap.set(cal.id, existing);
      }
    }

    // Convert to UnifiedCalendar[]
    const unified: UnifiedCalendar[] = Array.from(calendarMap.entries()).map(([calendarId, accounts]) => {
      // Find preferred account (highest permission)
      const sortedAccounts = [...accounts].sort((a, b) => {
        const rankA = PERMISSION_RANK[a.accessRole] || 0;
        const rankB = PERMISSION_RANK[b.accessRole] || 0;
        return rankB - rankA; // Descending order
      });

      const preferredAccount = sortedAccounts[0].accountId;

      // Determine display name (prefer primary account's override, then summary)
      const primaryAccess = accounts.find(a => a.primary);
      const preferredAccess = sortedAccounts[0];
      const displayName =
        primaryAccess?.summaryOverride ||
        preferredAccess.summaryOverride ||
        preferredAccess.summary;

      return {
        calendarId,
        accounts,
        preferredAccount,
        displayName
      };
    });

    // Cache results
    this.cache.set(cacheKey, {
      data: unified,
      timestamp: Date.now()
    });

    return unified;
  }

  /**
   * Find which account to use for a specific calendar
   * For write operations, returns account with highest permission
   * For read operations, returns any account with access (prefers higher permission)
   */
  async getAccountForCalendar(
    calendarId: string,
    accounts: Map<string, OAuth2Client>,
    operationType: 'read' | 'write' = 'read'
  ): Promise<{ accountId: string; accessRole: string } | null> {
    const unified = await this.getUnifiedCalendars(accounts);
    const calendar = unified.find(c => c.calendarId === calendarId);

    if (!calendar) {
      return null;
    }

    if (operationType === 'write') {
      // For write operations, use account with highest permission
      const preferredAccess = calendar.accounts.find(a => a.accountId === calendar.preferredAccount);
      if (!preferredAccess) return null;

      // Check if account has write permission
      if (preferredAccess.accessRole === 'owner' || preferredAccess.accessRole === 'writer') {
        return {
          accountId: preferredAccess.accountId,
          accessRole: preferredAccess.accessRole
        };
      }
      return null; // No write access available
    }

    // For read operations, use preferred account (highest permission)
    const preferredAccess = calendar.accounts.find(a => a.accountId === calendar.preferredAccount);
    if (!preferredAccess) return null;

    return {
      accountId: preferredAccess.accountId,
      accessRole: preferredAccess.accessRole
    };
  }

  /**
   * Get all accounts that have access to a specific calendar
   */
  async getAccountsForCalendar(
    calendarId: string,
    accounts: Map<string, OAuth2Client>
  ): Promise<CalendarAccess[]> {
    const unified = await this.getUnifiedCalendars(accounts);
    const calendar = unified.find(c => c.calendarId === calendarId);
    return calendar?.accounts || [];
  }

  /**
   * Clear cache and in-flight requests (useful for testing or when accounts change)
   */
  clearCache(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
  }

  /**
   * Resolve a calendar name or ID to a calendar ID and preferred account
   * Searches across all accounts for matching calendars by name
   * Returns the account with highest permissions for the matched calendar
   *
   * @param nameOrId Calendar name (summary/summaryOverride) or ID
   * @param accounts Map of available accounts
   * @param operationType 'read' or 'write' operation type
   * @returns Calendar ID and account info, or null if not found
   */
  async resolveCalendarNameToId(
    nameOrId: string,
    accounts: Map<string, OAuth2Client>,
    operationType: 'read' | 'write' = 'read'
  ): Promise<{ calendarId: string; accountId: string; accessRole: string } | null> {
    // Special case: "primary" is an alias for each account's primary calendar
    // When only one account exists, use it directly without registry lookup
    if (nameOrId === 'primary') {
      if (accounts.size === 1) {
        const [accountId] = accounts.keys();
        // Primary calendar always has owner access for the account owner
        return { calendarId: 'primary', accountId, accessRole: 'owner' };
      }
      // Multiple accounts: try to find best match via registry
      // Each account's primary calendar ID is typically the account email
      const result = await this.getAccountForCalendar(nameOrId, accounts, operationType);
      if (result) {
        return { calendarId: nameOrId, ...result };
      }
      // If registry lookup fails with multiple accounts, use first account as fallback
      // This maintains backwards compatibility while still working
      const [firstAccountId] = accounts.keys();
      return { calendarId: 'primary', accountId: firstAccountId, accessRole: 'owner' };
    }

    // If it looks like an ID (contains @), use getAccountForCalendar
    if (nameOrId.includes('@')) {
      const result = await this.getAccountForCalendar(nameOrId, accounts, operationType);
      if (result) {
        return { calendarId: nameOrId, ...result };
      }
      return null;
    }

    // It's a name - search across all calendars
    const unified = await this.getUnifiedCalendars(accounts);
    const lowerName = nameOrId.toLowerCase();

    // Search for matching calendar by name
    // Priority: exact summaryOverride > case-insensitive summaryOverride > exact summary > case-insensitive summary
    let match: UnifiedCalendar | undefined;

    // Priority 1: Exact match on any account's summaryOverride
    match = unified.find(cal =>
      cal.accounts.some(a => a.summaryOverride === nameOrId)
    );

    // Priority 2: Case-insensitive match on summaryOverride
    if (!match) {
      match = unified.find(cal =>
        cal.accounts.some(a => a.summaryOverride?.toLowerCase() === lowerName)
      );
    }

    // Priority 3: Exact match on displayName (primary account's name)
    if (!match) {
      match = unified.find(cal => cal.displayName === nameOrId);
    }

    // Priority 4: Case-insensitive match on displayName
    if (!match) {
      match = unified.find(cal => cal.displayName.toLowerCase() === lowerName);
    }

    // Priority 5: Exact match on any account's summary
    if (!match) {
      match = unified.find(cal =>
        cal.accounts.some(a => a.summary === nameOrId)
      );
    }

    // Priority 6: Case-insensitive match on summary
    if (!match) {
      match = unified.find(cal =>
        cal.accounts.some(a => a.summary.toLowerCase() === lowerName)
      );
    }

    if (!match) {
      return null;
    }

    // Check write access if needed
    if (operationType === 'write') {
      const preferredAccess = match.accounts.find(a => a.accountId === match!.preferredAccount);
      if (!preferredAccess || (preferredAccess.accessRole !== 'owner' && preferredAccess.accessRole !== 'writer')) {
        return null; // No write access available
      }
      return {
        calendarId: match.calendarId,
        accountId: preferredAccess.accountId,
        accessRole: preferredAccess.accessRole
      };
    }

    // For read operations, return preferred account
    const preferredAccess = match.accounts.find(a => a.accountId === match!.preferredAccount);
    if (!preferredAccess) {
      return null;
    }

    return {
      calendarId: match.calendarId,
      accountId: preferredAccess.accountId,
      accessRole: preferredAccess.accessRole
    };
  }

  /**
   * Resolve multiple calendar names/IDs to their owning accounts.
   * For each calendar, determines which account has access (using highest permission).
   * Returns a routing map of accountId -> calendarIds for efficient multi-account queries.
   *
   * @param namesOrIds Array of calendar names or IDs to resolve
   * @param accounts Map of available accounts
   * @param options.restrictToAccounts Only resolve on these specific accounts (for strict mode)
   * @returns Routing map and warnings for calendars not found
   */
  async resolveCalendarsToAccounts(
    namesOrIds: string[],
    accounts: Map<string, OAuth2Client>,
    options?: { restrictToAccounts?: string[] }
  ): Promise<{
    resolved: Map<string, string[]>;  // accountId -> calendarIds for that account
    warnings: string[];               // calendars not found on any account
  }> {
    const resolved = new Map<string, string[]>();
    const warnings: string[] = [];

    // Filter accounts if restricted
    const availableAccounts = options?.restrictToAccounts
      ? new Map(Array.from(accounts.entries()).filter(([id]) => options.restrictToAccounts!.includes(id)))
      : accounts;

    for (const nameOrId of namesOrIds) {
      // Use existing resolution logic which finds the preferred (highest permission) account
      const resolution = await this.resolveCalendarNameToId(nameOrId, availableAccounts, 'read');

      if (!resolution) {
        warnings.push(`Calendar "${nameOrId}" not found on any account`);
        continue;
      }

      const { calendarId, accountId } = resolution;

      // Add to routing map
      const accountCalendars = resolved.get(accountId) || [];
      if (!accountCalendars.includes(calendarId)) {
        accountCalendars.push(calendarId);
      }
      resolved.set(accountId, accountCalendars);
    }

    return { resolved, warnings };
  }
}
