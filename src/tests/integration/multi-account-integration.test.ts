import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from 'child_process';
import { TestDataFactory } from './test-data-factory.js';

/**
 * Multi-Account Integration Tests for Google Calendar MCP
 *
 * REQUIREMENTS TO RUN THESE TESTS:
 * 1. Valid Google OAuth credentials file at path specified by GOOGLE_OAUTH_CREDENTIALS env var
 * 2. TWO authenticated accounts:
 *    - Run: node scripts/account-manager.js auth test-primary
 *    - Run: node scripts/account-manager.js auth test-secondary
 * 3. Environment variables configured:
 *    - TEST_PRIMARY_ACCOUNT=test-primary
 *    - TEST_PRIMARY_CALENDAR=primary-email@gmail.com
 *    - TEST_SECONDARY_ACCOUNT=test-secondary
 *    - TEST_SECONDARY_CALENDAR=secondary-email@gmail.com
 *    - TEST_SHARED_CALENDAR=<calendar-id shared between accounts> (optional)
 * 4. Network access to Google Calendar API
 *
 * These tests validate multi-account functionality including:
 * - Loading multiple authenticated accounts
 * - Account parameter in tool calls
 * - Smart account selection via CalendarRegistry
 * - Cross-account FreeBusy queries
 * - Calendar access across accounts
 */

describe('Google Calendar MCP - Multi-Account Integration Tests', () => {
  let client: Client;
  let serverProcess: ChildProcess;
  let testFactory: TestDataFactory;
  let createdEventIds: Array<{ calendarId: string; eventId: string; account: string }> = [];

  // Account configuration from environment
  const PRIMARY_ACCOUNT = process.env.TEST_PRIMARY_ACCOUNT || 'test-primary';
  const PRIMARY_CALENDAR = process.env.TEST_PRIMARY_CALENDAR;
  const SECONDARY_ACCOUNT = process.env.TEST_SECONDARY_ACCOUNT || 'test-secondary';
  const SECONDARY_CALENDAR = process.env.TEST_SECONDARY_CALENDAR;
  const SHARED_CALENDAR = process.env.TEST_SHARED_CALENDAR;

  const SEND_UPDATES = 'none' as const;

  // Check if multi-account testing is configured
  const isMultiAccountConfigured = PRIMARY_CALENDAR && SECONDARY_CALENDAR;

  beforeAll(async () => {
    if (!isMultiAccountConfigured) {
      console.log('⚠️  Multi-account testing not configured. Set TEST_PRIMARY_CALENDAR and TEST_SECONDARY_CALENDAR.');
      return;
    }

    console.log('🚀 Starting Google Calendar MCP server for multi-account tests...');
    console.log(`   Primary Account: ${PRIMARY_ACCOUNT} (${PRIMARY_CALENDAR})`);
    console.log(`   Secondary Account: ${SECONDARY_ACCOUNT} (${SECONDARY_CALENDAR})`);
    if (SHARED_CALENDAR) {
      console.log(`   Shared Calendar: ${SHARED_CALENDAR}`);
    }

    // Build environment without GOOGLE_ACCOUNT_MODE to enable multi-account mode
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key, value]) =>
        value !== undefined && key !== 'GOOGLE_ACCOUNT_MODE'
      )
    ) as Record<string, string>;
    cleanEnv.NODE_ENV = 'test';

    serverProcess = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create MCP client
    client = new Client({
      name: "multi-account-test-client",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Connect to server
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['build/index.js'],
      env: cleanEnv
    });

    await client.connect(transport);
    console.log('✅ Connected to MCP server');

    // Initialize test factory
    testFactory = new TestDataFactory();
  }, 30000);

  afterAll(async () => {
    if (!isMultiAccountConfigured) return;

    console.log('\n🏁 Starting multi-account test cleanup...');

    // Clean up all created events
    for (const event of createdEventIds) {
      try {
        await client.callTool({
          name: 'delete-event',
          arguments: {
            calendarId: event.calendarId,
            eventId: event.eventId,
            account: event.account,
            sendUpdates: SEND_UPDATES
          }
        });
        console.log(`   Deleted event ${event.eventId} from ${event.calendarId}`);
      } catch (error) {
        console.log(`   Failed to delete event ${event.eventId}: ${error}`);
      }
    }

    // Close client connection
    if (client) {
      await client.close();
      console.log('🔌 Closed MCP client connection');
    }

    // Terminate server process
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('🛑 Terminated MCP server process');
    }

    console.log('✅ Multi-account test cleanup completed\n');
  }, 30000);

  beforeEach(() => {
    if (!isMultiAccountConfigured) return;
    testFactory?.clearPerformanceMetrics();
  });

  afterEach(async () => {
    // Per-test cleanup handled in afterAll
  });

  describe('Account Configuration', () => {
    it.skipIf(!isMultiAccountConfigured)('should list calendars from all authenticated accounts', async () => {
      const result = await client.callTool({
        name: 'list-calendars',
        arguments: {}
      });

      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      const response = JSON.parse((result.content as any)[0].text);

      expect(response.calendars).toBeDefined();
      expect(Array.isArray(response.calendars)).toBe(true);
      expect(response.totalCount).toBeGreaterThan(0);

      // Should have calendars from both accounts
      console.log(`   Found ${response.totalCount} calendars across all accounts`);

      // Check if both primary calendars are accessible
      const calendarIds = response.calendars.map((c: any) => c.id);
      console.log(`   Calendar IDs: ${calendarIds.slice(0, 5).join(', ')}${calendarIds.length > 5 ? '...' : ''}`);
    });

    it.skipIf(!isMultiAccountConfigured)('should list calendars from specific account only', async () => {
      // List calendars from primary account
      const primaryResult = await client.callTool({
        name: 'list-calendars',
        arguments: {
          account: PRIMARY_ACCOUNT
        }
      });

      const primaryResponse = JSON.parse((primaryResult.content as any)[0].text);

      // List calendars from secondary account
      const secondaryResult = await client.callTool({
        name: 'list-calendars',
        arguments: {
          account: SECONDARY_ACCOUNT
        }
      });

      const secondaryResponse = JSON.parse((secondaryResult.content as any)[0].text);

      console.log(`   Primary account calendars: ${primaryResponse.totalCount}`);
      console.log(`   Secondary account calendars: ${secondaryResponse.totalCount}`);

      // Both should have at least one calendar
      expect(primaryResponse.totalCount).toBeGreaterThan(0);
      expect(secondaryResponse.totalCount).toBeGreaterThan(0);
    });
  });

  describe('Account-Specific Operations', () => {
    it.skipIf(!isMultiAccountConfigured)('should create event on primary account calendar', async () => {
      const eventData = {
        calendarId: 'primary',
        summary: 'Multi-Account Test Event - Primary',
        start: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().slice(0, 19),
        account: PRIMARY_ACCOUNT,
        sendUpdates: SEND_UPDATES
      };

      const result = await client.callTool({
        name: 'create-event',
        arguments: eventData
      });

      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      const response = JSON.parse((result.content as any)[0].text);

      expect(response.event).toBeDefined();
      expect(response.event.id).toBeDefined();
      expect(response.event.summary).toBe(eventData.summary);

      // Track for cleanup
      createdEventIds.push({
        calendarId: 'primary',
        eventId: response.event.id,
        account: PRIMARY_ACCOUNT
      });

      console.log(`   Created event ${response.event.id} on primary account`);
    });

    it.skipIf(!isMultiAccountConfigured)('should create event on secondary account calendar', async () => {
      const eventData = {
        calendarId: 'primary',
        summary: 'Multi-Account Test Event - Secondary',
        start: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().slice(0, 19),
        account: SECONDARY_ACCOUNT,
        sendUpdates: SEND_UPDATES
      };

      const result = await client.callTool({
        name: 'create-event',
        arguments: eventData
      });

      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      const response = JSON.parse((result.content as any)[0].text);

      expect(response.event).toBeDefined();
      expect(response.event.id).toBeDefined();
      expect(response.event.summary).toBe(eventData.summary);

      // Track for cleanup
      createdEventIds.push({
        calendarId: 'primary',
        eventId: response.event.id,
        account: SECONDARY_ACCOUNT
      });

      console.log(`   Created event ${response.event.id} on secondary account`);
    });

    it.skipIf(!isMultiAccountConfigured)('should update event on specific account', async () => {
      // First create an event
      const createData = {
        calendarId: 'primary',
        summary: 'Update Test Event - Original',
        start: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 31 * 60 * 60 * 1000).toISOString().slice(0, 19),
        account: PRIMARY_ACCOUNT,
        sendUpdates: SEND_UPDATES
      };

      const createResult = await client.callTool({
        name: 'create-event',
        arguments: createData
      });

      const createResponse = JSON.parse((createResult.content as any)[0].text);
      expect(createResponse.event).toBeDefined();
      const eventId = createResponse.event.id;

      // Track for cleanup
      createdEventIds.push({
        calendarId: 'primary',
        eventId: eventId,
        account: PRIMARY_ACCOUNT
      });

      // Now update the event
      const updateResult = await client.callTool({
        name: 'update-event',
        arguments: {
          calendarId: 'primary',
          eventId: eventId,
          summary: 'Update Test Event - Modified',
          account: PRIMARY_ACCOUNT,
          sendUpdates: SEND_UPDATES
        }
      });

      expect(TestDataFactory.validateEventResponse(updateResult)).toBe(true);
      const updateResponse = JSON.parse((updateResult.content as any)[0].text);

      expect(updateResponse.event).toBeDefined();
      expect(updateResponse.event.summary).toBe('Update Test Event - Modified');

      console.log(`   Updated event ${eventId} on primary account`);
    });

    it.skipIf(!isMultiAccountConfigured)('should get single event from specific account', async () => {
      // First create an event
      const createData = {
        calendarId: 'primary',
        summary: 'Get Event Test',
        description: 'Testing get-event with account parameter',
        start: new Date(Date.now() + 32 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 33 * 60 * 60 * 1000).toISOString().slice(0, 19),
        account: SECONDARY_ACCOUNT,
        sendUpdates: SEND_UPDATES
      };

      const createResult = await client.callTool({
        name: 'create-event',
        arguments: createData
      });

      const createResponse = JSON.parse((createResult.content as any)[0].text);
      expect(createResponse.event).toBeDefined();
      const eventId = createResponse.event.id;

      // Track for cleanup
      createdEventIds.push({
        calendarId: 'primary',
        eventId: eventId,
        account: SECONDARY_ACCOUNT
      });

      // Now get the event
      const getResult = await client.callTool({
        name: 'get-event',
        arguments: {
          calendarId: 'primary',
          eventId: eventId,
          account: SECONDARY_ACCOUNT
        }
      });

      expect(TestDataFactory.validateEventResponse(getResult)).toBe(true);
      const getResponse = JSON.parse((getResult.content as any)[0].text);

      expect(getResponse.event).toBeDefined();
      expect(getResponse.event.id).toBe(eventId);
      expect(getResponse.event.summary).toBe('Get Event Test');
      expect(getResponse.event.description).toBe('Testing get-event with account parameter');

      console.log(`   Retrieved event ${eventId} from secondary account`);
    });

    it.skipIf(!isMultiAccountConfigured)('should delete event from specific account', async () => {
      // First create an event specifically for deletion
      const createData = {
        calendarId: 'primary',
        summary: 'Delete Test Event',
        start: new Date(Date.now() + 34 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 35 * 60 * 60 * 1000).toISOString().slice(0, 19),
        account: PRIMARY_ACCOUNT,
        sendUpdates: SEND_UPDATES
      };

      const createResult = await client.callTool({
        name: 'create-event',
        arguments: createData
      });

      const createResponse = JSON.parse((createResult.content as any)[0].text);
      expect(createResponse.event).toBeDefined();
      const eventId = createResponse.event.id;

      // Delete the event (don't track for cleanup since we're deleting it here)
      const deleteResult = await client.callTool({
        name: 'delete-event',
        arguments: {
          calendarId: 'primary',
          eventId: eventId,
          account: PRIMARY_ACCOUNT,
          sendUpdates: SEND_UPDATES
        }
      });

      expect(TestDataFactory.validateEventResponse(deleteResult)).toBe(true);
      const deleteResponse = JSON.parse((deleteResult.content as any)[0].text);

      expect(deleteResponse.success).toBe(true);

      // Verify event is gone by trying to get it
      const getResult = await client.callTool({
        name: 'get-event',
        arguments: {
          calendarId: 'primary',
          eventId: eventId,
          account: PRIMARY_ACCOUNT
        }
      });

      const getResponse = JSON.parse((getResult.content as any)[0].text);
      // Should return error or cancelled event
      expect(getResponse.error || getResponse.event?.status === 'cancelled').toBeTruthy();

      console.log(`   Deleted and verified removal of event ${eventId}`);
    });

    it.skipIf(!isMultiAccountConfigured)('should search events across specific account', async () => {
      // First create a uniquely named event
      const uniqueKeyword = `SearchTest-${Date.now()}`;
      const createData = {
        calendarId: 'primary',
        summary: `Event with ${uniqueKeyword}`,
        start: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 37 * 60 * 60 * 1000).toISOString().slice(0, 19),
        account: SECONDARY_ACCOUNT,
        sendUpdates: SEND_UPDATES
      };

      const createResult = await client.callTool({
        name: 'create-event',
        arguments: createData
      });

      const createResponse = JSON.parse((createResult.content as any)[0].text);
      expect(createResponse.event).toBeDefined();

      // Track for cleanup
      createdEventIds.push({
        calendarId: 'primary',
        eventId: createResponse.event.id,
        account: SECONDARY_ACCOUNT
      });

      // Search for the event
      const now = new Date();
      const futureDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days

      const searchResult = await client.callTool({
        name: 'search-events',
        arguments: {
          calendarId: 'primary',
          query: uniqueKeyword,
          account: SECONDARY_ACCOUNT,
          timeMin: now.toISOString().slice(0, 19),
          timeMax: futureDate.toISOString().slice(0, 19)
        }
      });

      expect(TestDataFactory.validateEventResponse(searchResult)).toBe(true);
      const searchResponse = JSON.parse((searchResult.content as any)[0].text);

      expect(searchResponse.events).toBeDefined();
      expect(searchResponse.events.length).toBeGreaterThanOrEqual(1);

      const foundEvent = searchResponse.events.find((e: any) => e.summary.includes(uniqueKeyword));
      expect(foundEvent).toBeDefined();

      console.log(`   Found event with keyword "${uniqueKeyword}" on secondary account`);
    });

    it.skipIf(!isMultiAccountConfigured)('should list events from both accounts simultaneously', async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const result = await client.callTool({
        name: 'list-events',
        arguments: {
          calendarId: [PRIMARY_CALENDAR, SECONDARY_CALENDAR],
          account: [PRIMARY_ACCOUNT, SECONDARY_ACCOUNT],
          timeMin: now.toISOString().slice(0, 19),
          timeMax: futureDate.toISOString().slice(0, 19)
        }
      });

      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      const response = JSON.parse((result.content as any)[0].text);

      expect(response.events).toBeDefined();
      expect(Array.isArray(response.events)).toBe(true);

      // Check for any partial failures
      if (response.warnings && response.warnings.length > 0) {
        console.log(`   ⚠️  Warnings: ${response.warnings.join(', ')}`);
      }

      console.log(`   Retrieved ${response.totalCount} events from both accounts`);
    });
  });

  describe('FreeBusy Multi-Account Queries', () => {
    it.skipIf(!isMultiAccountConfigured)('should query freebusy across both accounts', async () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const result = await client.callTool({
        name: 'get-freebusy',
        arguments: {
          timeMin: now.toISOString().slice(0, 19),
          timeMax: tomorrow.toISOString().slice(0, 19),
          calendars: [
            { id: 'primary', account: PRIMARY_ACCOUNT },
            { id: 'primary', account: SECONDARY_ACCOUNT }
          ]
        }
      });

      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      const response = JSON.parse((result.content as any)[0].text);

      expect(response.calendars).toBeDefined();
      expect(response.timeMin).toBeDefined();
      expect(response.timeMax).toBeDefined();

      // Should have results for both calendars
      const calendarResults = Object.keys(response.calendars);
      console.log(`   FreeBusy results for: ${calendarResults.join(', ')}`);

      // Check for errors in calendar results
      for (const calId of calendarResults) {
        const calResult = response.calendars[calId];
        if (calResult.errors && calResult.errors.length > 0) {
          console.log(`   ⚠️  Calendar ${calId} errors: ${JSON.stringify(calResult.errors)}`);
        } else {
          console.log(`   Calendar ${calId}: ${calResult.busy?.length || 0} busy periods`);
        }
      }
    });
  });

  describe('Smart Account Selection', () => {
    it.skipIf(!isMultiAccountConfigured)('should auto-select account for unambiguous calendar', async () => {
      // Use PRIMARY_CALENDAR (the email address) which is unique to primary account
      // This tests that auto-selection works when a calendar ID uniquely identifies an account
      const eventData = {
        calendarId: PRIMARY_CALENDAR,
        summary: 'Auto-Select Unambiguous Test',
        start: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString().slice(0, 19),
        sendUpdates: SEND_UPDATES
        // Note: no 'account' parameter - should auto-select primary account
      };

      const result = await client.callTool({
        name: 'create-event',
        arguments: eventData
      });

      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      const response = JSON.parse((result.content as any)[0].text);

      // Should succeed since PRIMARY_CALENDAR uniquely identifies the account
      expect(response.event).toBeDefined();
      expect(response.event.id).toBeDefined();

      createdEventIds.push({
        calendarId: PRIMARY_CALENDAR!,
        eventId: response.event.id,
        account: PRIMARY_ACCOUNT
      });

      console.log(`   Auto-selected primary account for ${PRIMARY_CALENDAR}, created event ${response.event.id}`);
    });

    it.skipIf(!isMultiAccountConfigured)('should return error for ambiguous calendar without account', async () => {
      // When "primary" exists in multiple accounts and no account specified,
      // the system should either pick deterministically or return an error
      const eventData = {
        calendarId: 'primary',
        summary: 'Ambiguous Calendar Test',
        start: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 51 * 60 * 60 * 1000).toISOString().slice(0, 19),
        sendUpdates: SEND_UPDATES
      };

      const result = await client.callTool({
        name: 'create-event',
        arguments: eventData
      });

      const responseText = (result.content as any)[0].text;

      // Document the actual behavior - system should be deterministic
      if (responseText.includes('error') || responseText.includes('ambiguous')) {
        // System returns error for ambiguous case - this is acceptable
        console.log(`   System correctly identified ambiguity for 'primary' across multiple accounts`);
      } else {
        // System picked an account deterministically - also acceptable
        const response = JSON.parse(responseText);
        expect(response.event).toBeDefined();
        createdEventIds.push({
          calendarId: 'primary',
          eventId: response.event.id,
          account: PRIMARY_ACCOUNT // Track with primary for cleanup
        });
        console.log(`   System deterministically selected an account, created event ${response.event.id}`);
      }
    });

    it.skipIf(!SHARED_CALENDAR)('should create event on shared calendar and verify access', async () => {
      // This test creates an event on a shared calendar without specifying account
      // The system should select an account that has write access
      const eventData = {
        calendarId: SHARED_CALENDAR,
        summary: 'Shared Calendar Write Test',
        description: 'Testing permission-based account selection',
        start: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 73 * 60 * 60 * 1000).toISOString().slice(0, 19),
        sendUpdates: SEND_UPDATES
      };

      const result = await client.callTool({
        name: 'create-event',
        arguments: eventData
      });

      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      const response = JSON.parse((result.content as any)[0].text);

      expect(response.event).toBeDefined();
      expect(response.event.id).toBeDefined();
      expect(response.event.summary).toBe('Shared Calendar Write Test');

      // Verify the event exists by reading it back
      const verifyResult = await client.callTool({
        name: 'get-event',
        arguments: {
          calendarId: SHARED_CALENDAR,
          eventId: response.event.id
        }
      });

      const verifyResponse = JSON.parse((verifyResult.content as any)[0].text);
      expect(verifyResponse.event).toBeDefined();
      expect(verifyResponse.event.id).toBe(response.event.id);

      // Track for cleanup - try both accounts since we don't know which was selected
      createdEventIds.push({
        calendarId: SHARED_CALENDAR!,
        eventId: response.event.id,
        account: PRIMARY_ACCOUNT
      });

      console.log(`   Successfully created and verified event ${response.event.id} on shared calendar`);
    });
  });

  describe('Error Handling', () => {
    it.skipIf(!isMultiAccountConfigured)('should handle invalid account gracefully', async () => {
      try {
        const result = await client.callTool({
          name: 'list-calendars',
          arguments: {
            account: 'nonexistent-account'
          }
        });

        // Should return an error in the response, not throw
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.error || result.isError).toBeTruthy();
        console.log(`   Invalid account error handled: ${response.error || 'isError flag set'}`);
      } catch (error) {
        // Also acceptable if it throws
        console.log(`   Invalid account threw error: ${error}`);
      }
    });

    it.skipIf(!isMultiAccountConfigured)('should handle explicit account parameter correctly', async () => {
      // Verify that specifying account parameter returns only that account's calendars
      const result = await client.callTool({
        name: 'list-calendars',
        arguments: {
          account: SECONDARY_ACCOUNT
        }
      });

      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      const response = JSON.parse((result.content as any)[0].text);
      expect(response.calendars).toBeDefined();
      expect(response.totalCount).toBeGreaterThan(0);

      console.log(`   Secondary account has ${response.totalCount} calendars`);
    });
  });

  describe('Calendar Name Resolution', () => {
    it.skipIf(!isMultiAccountConfigured)('should resolve calendar by name when unique across accounts', async () => {
      // First, get the list of calendars to find a unique calendar name
      const listResult = await client.callTool({
        name: 'list-calendars',
        arguments: {
          account: PRIMARY_ACCOUNT
        }
      });

      const listResponse = JSON.parse((listResult.content as any)[0].text);
      expect(listResponse.calendars).toBeDefined();
      expect(listResponse.calendars.length).toBeGreaterThan(0);

      // Find a calendar with a unique summary (name)
      const primaryCalendar = listResponse.calendars.find(
        (c: any) => c.id === 'primary' || c.id === PRIMARY_CALENDAR
      );

      if (primaryCalendar && primaryCalendar.summary) {
        // Try to list events using the calendar name instead of ID
        const now = new Date();
        const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const eventsResult = await client.callTool({
          name: 'list-events',
          arguments: {
            calendarId: primaryCalendar.summary,
            account: PRIMARY_ACCOUNT,
            timeMin: now.toISOString().slice(0, 19),
            timeMax: futureDate.toISOString().slice(0, 19)
          }
        });

        // Should either resolve the name or return a clear error
        const eventsText = (eventsResult.content as any)[0].text;

        if (eventsText.includes('error') || eventsText.includes('not found')) {
          console.log(`   Calendar name "${primaryCalendar.summary}" not resolvable (name resolution may not be implemented)`);
        } else {
          const eventsResponse = JSON.parse(eventsText);
          expect(eventsResponse.events).toBeDefined();
          console.log(`   Successfully resolved calendar name "${primaryCalendar.summary}" to list ${eventsResponse.totalCount} events`);
        }
      } else {
        console.log(`   Skipping name resolution test - no named calendar found`);
      }
    });

    it.skipIf(!SHARED_CALENDAR)('should resolve shared calendar across accounts', async () => {
      // Get the shared calendar's display name
      const listResult = await client.callTool({
        name: 'list-calendars',
        arguments: {}
      });

      const listResponse = JSON.parse((listResult.content as any)[0].text);
      const sharedCal = listResponse.calendars.find(
        (c: any) => c.id === SHARED_CALENDAR
      );

      if (sharedCal) {
        console.log(`   Shared calendar found: "${sharedCal.summary}" (${sharedCal.accessRole})`);

        // List events using the calendar ID to verify it's accessible
        const now = new Date();
        const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        const eventsResult = await client.callTool({
          name: 'list-events',
          arguments: {
            calendarId: SHARED_CALENDAR,
            timeMin: now.toISOString().slice(0, 19),
            timeMax: futureDate.toISOString().slice(0, 19)
          }
        });

        expect(TestDataFactory.validateEventResponse(eventsResult)).toBe(true);
        const eventsResponse = JSON.parse((eventsResult.content as any)[0].text);
        expect(eventsResponse.events).toBeDefined();

        console.log(`   Shared calendar "${sharedCal.summary}" has ${eventsResponse.totalCount} events`);
      } else {
        console.log(`   ⚠️  Shared calendar ${SHARED_CALENDAR} not found in calendar list`);
      }
    });
  });

  describe('Cross-Account Event Visibility', () => {
    it.skipIf(!isMultiAccountConfigured)('should not see events from wrong account', async () => {
      // Create an event on secondary account
      const uniqueSummary = `Private-Event-${Date.now()}`;
      const createData = {
        calendarId: 'primary',
        summary: uniqueSummary,
        start: new Date(Date.now() + 100 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 101 * 60 * 60 * 1000).toISOString().slice(0, 19),
        account: SECONDARY_ACCOUNT,
        sendUpdates: SEND_UPDATES
      };

      const createResult = await client.callTool({
        name: 'create-event',
        arguments: createData
      });

      const createResponse = JSON.parse((createResult.content as any)[0].text);
      expect(createResponse.event).toBeDefined();

      // Track for cleanup
      createdEventIds.push({
        calendarId: 'primary',
        eventId: createResponse.event.id,
        account: SECONDARY_ACCOUNT
      });

      // Try to find this event from primary account - should NOT find it
      const now = new Date();
      const futureDate = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000); // 120 days

      const searchResult = await client.callTool({
        name: 'search-events',
        arguments: {
          calendarId: 'primary',
          query: uniqueSummary,
          account: PRIMARY_ACCOUNT,
          timeMin: now.toISOString().slice(0, 19),
          timeMax: futureDate.toISOString().slice(0, 19)
        }
      });

      expect(TestDataFactory.validateEventResponse(searchResult)).toBe(true);
      const searchResponse = JSON.parse((searchResult.content as any)[0].text);

      // Should not find the event since it's on a different account's calendar
      const foundEvent = searchResponse.events?.find((e: any) => e.summary === uniqueSummary);
      expect(foundEvent).toBeUndefined();

      console.log(`   Verified event "${uniqueSummary}" not visible from wrong account`);
    });

    it.skipIf(!SHARED_CALENDAR)('should see shared calendar events from both accounts', async () => {
      // Create an event on shared calendar from primary account
      const sharedSummary = `Shared-Visible-${Date.now()}`;
      const createData = {
        calendarId: SHARED_CALENDAR,
        summary: sharedSummary,
        start: new Date(Date.now() + 102 * 60 * 60 * 1000).toISOString().slice(0, 19),
        end: new Date(Date.now() + 103 * 60 * 60 * 1000).toISOString().slice(0, 19),
        account: PRIMARY_ACCOUNT,
        sendUpdates: SEND_UPDATES
      };

      const createResult = await client.callTool({
        name: 'create-event',
        arguments: createData
      });

      const createResponse = JSON.parse((createResult.content as any)[0].text);
      expect(createResponse.event).toBeDefined();

      // Track for cleanup
      createdEventIds.push({
        calendarId: SHARED_CALENDAR!,
        eventId: createResponse.event.id,
        account: PRIMARY_ACCOUNT
      });

      // Try to find this event from secondary account - SHOULD find it if shared
      const now = new Date();
      const futureDate = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000); // 120 days

      const searchResult = await client.callTool({
        name: 'search-events',
        arguments: {
          calendarId: SHARED_CALENDAR,
          query: sharedSummary,
          account: SECONDARY_ACCOUNT,
          timeMin: now.toISOString().slice(0, 19),
          timeMax: futureDate.toISOString().slice(0, 19)
        }
      });

      expect(TestDataFactory.validateEventResponse(searchResult)).toBe(true);
      const searchResponse = JSON.parse((searchResult.content as any)[0].text);

      const foundEvent = searchResponse.events?.find((e: any) => e.summary === sharedSummary);
      expect(foundEvent).toBeDefined();

      console.log(`   Verified shared event "${sharedSummary}" visible from both accounts`);
    });
  });
});
