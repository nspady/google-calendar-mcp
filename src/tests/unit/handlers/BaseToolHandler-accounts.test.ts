import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseToolHandler } from '../../../handlers/core/BaseToolHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Concrete implementation for testing
class TestHandler extends BaseToolHandler<{ account?: string; testParam: string }> {
  async runTool(args: { account?: string; testParam: string }, accounts: Map<string, OAuth2Client>) {
    const client = this.getClientForAccount(args.account, accounts);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Used account: ${args.account || 'default'}, client exists: ${!!client}`
        }
      ]
    };
  }
}

describe('BaseToolHandler - Multi-Account Support', () => {
  let handler: TestHandler;
  let workClient: OAuth2Client;
  let personalClient: OAuth2Client;
  let accounts: Map<string, OAuth2Client>;

  beforeEach(() => {
    handler = new TestHandler();
    workClient = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');
    personalClient = new OAuth2Client('client-id', 'client-secret', 'redirect-uri');

    workClient.setCredentials({ access_token: 'work-token' });
    personalClient.setCredentials({ access_token: 'personal-token' });

    accounts = new Map([
      ['work', workClient],
      ['personal', personalClient]
    ]);
  });

  describe('getClientForAccount', () => {
    it('should return specified account client', () => {
      const client = handler.getClientForAccount('work', accounts);
      expect(client).toBe(workClient);
      expect(client.credentials.access_token).toBe('work-token');
    });

    it('should return different client for different account', () => {
      const client = handler.getClientForAccount('personal', accounts);
      expect(client).toBe(personalClient);
      expect(client.credentials.access_token).toBe('personal-token');
    });

    it('should return first account when no account specified and single account exists', () => {
      const singleAccount = new Map([['work', workClient]]);
      const client = handler.getClientForAccount(undefined, singleAccount);
      expect(client).toBe(workClient);
    });

    it('should throw error when no account specified and multiple accounts exist', () => {
      expect(() => handler.getClientForAccount(undefined, accounts))
        .toThrow(/must specify.*account.*parameter/i);
    });

    it('should throw error when no accounts available', () => {
      expect(() => handler.getClientForAccount(undefined, new Map()))
        .toThrow(/no authenticated accounts/i);
    });

    it('should throw error when specified account does not exist', () => {
      expect(() => handler.getClientForAccount('nonexistent', accounts))
        .toThrow(/account.*nonexistent.*not found/i);
    });

    it('should validate account ID format', () => {
      expect(() => handler.getClientForAccount('../../../etc/passwd', accounts))
        .toThrow(/invalid account id/i);
    });
  });

  describe('runTool with account parameter', () => {
    it('should execute with specified account', async () => {
      const result = await handler.runTool(
        { account: 'work', testParam: 'test' },
        accounts
      );

      expect(result.content[0].text).toContain('Used account: work');
      expect(result.content[0].text).toContain('client exists: true');
    });

    it('should execute with default account when single account exists', async () => {
      const singleAccount = new Map([['work', workClient]]);
      const result = await handler.runTool(
        { testParam: 'test' },
        singleAccount
      );

      expect(result.content[0].text).toContain('client exists: true');
    });

    it('should fail when no account specified with multiple accounts', async () => {
      await expect(
        handler.runTool({ testParam: 'test' }, accounts)
      ).rejects.toThrow(/must specify.*account/i);
    });
  });

  describe('Account isolation', () => {
    it('should use correct tokens for different accounts', () => {
      const workClient = handler.getClientForAccount('work', accounts);
      const personalClient = handler.getClientForAccount('personal', accounts);

      expect(workClient.credentials.access_token).toBe('work-token');
      expect(personalClient.credentials.access_token).toBe('personal-token');
      expect(workClient).not.toBe(personalClient);
    });
  });
});
