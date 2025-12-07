import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import { AuthServer } from "../../auth/server.js";
import { TokenManager } from "../../auth/tokenManager.js";
import { validateAccountId } from "../../auth/paths.js";
import {
  AddAccountResponse,
  AccountStatusResponse,
  AccountInfo,
  RemoveAccountResponse
} from "../../types/structured-responses.js";

export type ManageAccountsAction = 'list' | 'add' | 'remove';

export interface ManageAccountsArgs {
  action: ManageAccountsAction;
  account_id?: string;
}

export interface ServerContext {
  oauth2Client: OAuth2Client;
  tokenManager: TokenManager;
  authServer: AuthServer;
  accounts: Map<string, OAuth2Client>;
  reloadAccounts: () => Promise<Map<string, OAuth2Client>>;
}

/**
 * Unified handler for managing Google accounts.
 *
 * Supports three actions:
 * - list: Show all authenticated accounts and their status
 * - add: Add a new account via OAuth authentication
 * - remove: Remove an existing account
 */
export class ManageAccountsHandler {
  async runTool(args: ManageAccountsArgs, context: ServerContext): Promise<CallToolResult> {
    switch (args.action) {
      case 'list':
        return this.listAccounts(args.account_id, context);
      case 'add':
        return this.addAccount(args.account_id, context);
      case 'remove':
        return this.removeAccount(args.account_id, context);
      default:
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Invalid action: ${args.action}. Must be 'list', 'add', or 'remove'.`
        );
    }
  }

  // ============ LIST ACTION ============
  private async listAccounts(accountId: string | undefined, context: ServerContext): Promise<CallToolResult> {
    // Reload accounts to get the latest state
    const accounts = await context.reloadAccounts();

    // If specific account requested, filter to just that one
    if (accountId) {
      const normalizedId = accountId.toLowerCase();
      const client = accounts.get(normalizedId);

      if (!client) {
        const availableAccounts = Array.from(accounts.keys()).join(', ') || 'none';
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Account "${normalizedId}" not found. Available accounts: ${availableAccounts}`
        );
      }

      const accountInfo = await this.getAccountInfo(normalizedId, client);

      const response: AccountStatusResponse = {
        accounts: [accountInfo],
        total_accounts: 1,
        message: `Found account "${normalizedId}"`
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2)
        }]
      };
    }

    // Get info for all accounts
    if (accounts.size === 0) {
      const response: AccountStatusResponse = {
        accounts: [],
        total_accounts: 0,
        message: "No authenticated accounts found. Use manage-accounts with action 'add' and provide a nickname to connect a Google account."
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2)
        }]
      };
    }

    const accountInfos: AccountInfo[] = [];
    const errors: string[] = [];

    for (const [accId, client] of accounts) {
      try {
        const info = await this.getAccountInfo(accId, client);
        accountInfos.push(info);
      } catch (error) {
        errors.push(`${accId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        accountInfos.push({
          account_id: accId,
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to fetch account details'
        });
      }
    }

    const response: AccountStatusResponse = {
      accounts: accountInfos,
      total_accounts: accountInfos.length,
      message: errors.length > 0
        ? `Found ${accountInfos.length} account(s) with ${errors.length} error(s)`
        : `Found ${accountInfos.length} authenticated account(s)`
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  private async getAccountInfo(accountId: string, client: OAuth2Client): Promise<AccountInfo> {
    try {
      const calendar = google.calendar({ version: 'v3', auth: client });

      const calendarList = await calendar.calendarList.list();
      const calendars = calendarList.data.items || [];
      const primaryCalendar = calendars.find(c => c.primary);

      const credentials = client.credentials;
      const expiryDate = credentials.expiry_date;
      const isExpired = expiryDate ? Date.now() > expiryDate : false;

      const email = primaryCalendar?.id || 'unknown';

      return {
        account_id: accountId,
        status: isExpired ? 'expired' : 'active',
        email,
        calendar_count: calendars.length,
        primary_calendar: primaryCalendar ? {
          id: primaryCalendar.id || 'primary',
          name: primaryCalendar.summary || 'Primary Calendar',
          timezone: primaryCalendar.timeZone || 'UTC'
        } : undefined,
        token_expiry: expiryDate ? new Date(expiryDate).toISOString() : undefined
      };
    } catch (error) {
      const credentials = client.credentials;
      return {
        account_id: accountId,
        status: credentials.refresh_token ? 'active' : 'invalid',
        error: error instanceof Error ? error.message : 'Failed to verify account'
      };
    }
  }

  // ============ ADD ACTION ============
  private async addAccount(accountId: string | undefined, context: ServerContext): Promise<CallToolResult> {
    if (!accountId) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "account_id is required for 'add' action. Provide a nickname like 'work' or 'personal' to identify this account."
      );
    }

    const normalizedId = accountId.toLowerCase();

    // Validate account ID format
    try {
      validateAccountId(normalizedId);
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        error instanceof Error ? error.message : 'Invalid account nickname format'
      );
    }

    // Check if account already exists
    if (context.accounts.has(normalizedId)) {
      const response: AddAccountResponse = {
        status: 'already_authenticated',
        account_id: normalizedId,
        message: `An account with nickname "${normalizedId}" is already connected. Use action 'list' to view account details.`
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2)
        }]
      };
    }

    // Set the account mode for this authentication
    process.env.GOOGLE_ACCOUNT_MODE = normalizedId;
    context.tokenManager.setAccountMode(normalizedId);

    // Start the authentication server
    try {
      const started = await context.authServer.startForMcpTool(normalizedId);

      if (!started.success) {
        throw new McpError(
          ErrorCode.InternalError,
          started.error || 'Failed to start authentication server'
        );
      }

      const response: AddAccountResponse = {
        status: 'awaiting_authentication',
        account_id: normalizedId,
        auth_url: started.authUrl!,
        callback_url: started.callbackUrl!,
        instructions: `Visit the auth_url in your browser to connect your Google account. This will be saved with the nickname '${normalizedId}'.`,
        expires_in_minutes: 5,
        next_step: "After authenticating in your browser, use manage-accounts with action 'list' to verify the account was connected successfully."
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to start authentication: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ============ REMOVE ACTION ============
  private async removeAccount(accountId: string | undefined, context: ServerContext): Promise<CallToolResult> {
    if (!accountId) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "account_id is required for 'remove' action. Specify the nickname of the account to remove."
      );
    }

    const normalizedId = accountId.toLowerCase();

    // Validate account ID format
    try {
      validateAccountId(normalizedId);
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        error instanceof Error ? error.message : 'Invalid account nickname format'
      );
    }

    // Reload accounts to get current state
    const accounts = await context.reloadAccounts();

    // Check if account exists
    if (!accounts.has(normalizedId)) {
      const availableAccounts = Array.from(accounts.keys()).join(', ') || 'none';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Account "${normalizedId}" not found. Available accounts: ${availableAccounts}`
      );
    }

    // Prevent removing the last account
    if (accounts.size === 1) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Cannot remove the last authenticated account. Use action 'add' to connect another account first, then remove this one.`
      );
    }

    // Remove the account
    try {
      await context.tokenManager.removeAccount(normalizedId);

      // Reload accounts to confirm removal
      const updatedAccounts = await context.reloadAccounts();
      const remainingAccounts = Array.from(updatedAccounts.keys());

      const response: RemoveAccountResponse = {
        success: true,
        account_id: normalizedId,
        message: `Account "${normalizedId}" has been removed successfully.`,
        remaining_accounts: remainingAccounts
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(response, null, 2)
        }]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to remove account: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
