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
 * CalendarRegistry service for managing calendar deduplication and permission-based account selection
 */
export class CalendarRegistry {
  private cache: Map<string, { data: UnifiedCalendar[]; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
   * Fetch all calendars from all accounts and build unified registry
   */
  async getUnifiedCalendars(accounts: Map<string, OAuth2Client>): Promise<UnifiedCalendar[]> {
    // Check cache
    const cacheKey = Array.from(accounts.keys()).sort().join(',');
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

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
          summaryOverride: cal.summaryOverride
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
   * Clear cache (useful for testing or when accounts change)
   */
  clearCache(): void {
    this.cache.clear();
  }
}
