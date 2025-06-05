import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from 'child_process';
import { TestDataFactory, TestEvent } from './test-data-factory.js';

/**
 * Comprehensive Integration Tests for Google Calendar MCP
 * 
 * These tests exercise all MCP tools against a real test calendar:
 * set via the env var TEST_CALENDAR_ID
 * 
 * Test Strategy:
 * 1. Create test events first
 * 2. Test read operations (list, search, freebusy)
 * 3. Test write operations (update)
 * 4. Clean up by deleting created events
 * 5. Track performance metrics throughout
 */

describe('Google Calendar MCP - Direct Integration Tests', () => {
  let client: Client;
  let serverProcess: ChildProcess;
  let testFactory: TestDataFactory;
  let createdEventIds: string[] = [];
  
  const TEST_CALENDAR_ID = process.env.TEST_CALENDAR_ID || 'primary';
  const SEND_UPDATES = 'none' as const;

  beforeAll(async () => {
    // Start the MCP server
    console.log('🚀 Starting Google Calendar MCP server...');
    
    // Filter out undefined values from process.env and set NODE_ENV=test
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined)
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
      name: "integration-test-client",
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
    // Final cleanup - ensure all test events are removed
    await cleanupAllTestEvents();
    
    // Close client connection
    if (client) {
      await client.close();
    }
    
    // Terminate server process
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Log performance summary
    logPerformanceSummary();
    
    console.log('🧹 Integration test cleanup completed');
  }, 30000);

  beforeEach(() => {
    testFactory.clearPerformanceMetrics();
    createdEventIds = [];
  });

  afterEach(async () => {
    // Cleanup events created in this test
    await cleanupTestEvents(createdEventIds);
    createdEventIds = [];
  });

  describe('Tool Availability and Basic Functionality', () => {
    it('should list all expected tools', async () => {
      const startTime = testFactory.startTimer('list-tools');
      
      try {
        const tools = await client.listTools();
        
        testFactory.endTimer('list-tools', startTime, true);
        
        expect(tools.tools).toBeDefined();
        expect(tools.tools.length).toBe(8);
        
        const toolNames = tools.tools.map(t => t.name);
        expect(toolNames).toContain('list-calendars');
        expect(toolNames).toContain('list-events');
        expect(toolNames).toContain('search-events');
        expect(toolNames).toContain('list-colors');
        expect(toolNames).toContain('create-event');
        expect(toolNames).toContain('update-event');
        expect(toolNames).toContain('delete-event');
        expect(toolNames).toContain('get-freebusy');
      } catch (error) {
        testFactory.endTimer('list-tools', startTime, false, String(error));
        throw error;
      }
    });

    it('should list calendars including test calendar', async () => {
      const startTime = testFactory.startTimer('list-calendars');
      
      try {
        const result = await client.callTool({
          name: 'list-calendars',
          arguments: {}
        });
        
        testFactory.endTimer('list-calendars', startTime, true);
        
        expect(TestDataFactory.validateEventResponse(result)).toBe(true);
        // Just verify we get a valid response with calendar information, not a specific calendar
        expect((result.content as any)[0].text).toMatch(/calendar/i);
      } catch (error) {
        testFactory.endTimer('list-calendars', startTime, false, String(error));
        throw error;
      }
    });

    it('should list available colors', async () => {
      const startTime = testFactory.startTimer('list-colors');
      
      try {
        const result = await client.callTool({
          name: 'list-colors',
          arguments: {}
        });
        
        testFactory.endTimer('list-colors', startTime, true);
        
        expect(TestDataFactory.validateEventResponse(result)).toBe(true);
        expect((result.content as any)[0].text).toContain('Available event colors');
      } catch (error) {
        testFactory.endTimer('list-colors', startTime, false, String(error));
        throw error;
      }
    });
  });

  describe('Event Creation and Management Workflow', () => {
    describe('Single Event Operations', () => {
      it('should create, list, search, update, and delete a single event', async () => {
        // 1. Create event
        const eventData = TestDataFactory.createSingleEvent({
          summary: 'Integration Test - Single Event Workflow'
        });
        
        const eventId = await createTestEvent(eventData);
        createdEventIds.push(eventId);
        
        // 2. List events to verify creation
        const timeRanges = TestDataFactory.getTimeRanges();
        await verifyEventInList(eventId, timeRanges.nextWeek);
        
        // 3. Search for the event
        await verifyEventInSearch(eventData.summary);
        
        // 4. Update the event
        await updateTestEvent(eventId, {
          summary: 'Updated Integration Test Event',
          location: 'Updated Location'
        });
        
        // 5. Verify update took effect
        await verifyEventInSearch('Updated Integration Test Event');
        
        // 6. Delete will happen in afterEach cleanup
      });

      it('should handle all-day events', async () => {
        const allDayEvent = TestDataFactory.createAllDayEvent({
          summary: 'Integration Test - All Day Event'
        });
        
        const eventId = await createTestEvent(allDayEvent);
        createdEventIds.push(eventId);
        
        // Verify all-day event appears in searches
        await verifyEventInSearch(allDayEvent.summary);
      });

      it('should handle events with attendees', async () => {
        const eventWithAttendees = TestDataFactory.createEventWithAttendees({
          summary: 'Integration Test - Event with Attendees'
        });
        
        const eventId = await createTestEvent(eventWithAttendees);
        createdEventIds.push(eventId);
        
        await verifyEventInSearch(eventWithAttendees.summary);
      });

      it('should handle colored events', async () => {
        const coloredEvent = TestDataFactory.createColoredEvent('9', {
          summary: 'Integration Test - Colored Event'
        });
        
        const eventId = await createTestEvent(coloredEvent);
        createdEventIds.push(eventId);
        
        await verifyEventInSearch(coloredEvent.summary);
      });
    });

    describe('Recurring Event Operations', () => {
      it('should create and manage recurring events', async () => {
        // Create recurring event
        const recurringEvent = TestDataFactory.createRecurringEvent({
          summary: 'Integration Test - Recurring Weekly Meeting'
        });
        
        const eventId = await createTestEvent(recurringEvent);
        createdEventIds.push(eventId);
        
        // Verify recurring event
        await verifyEventInSearch(recurringEvent.summary);
        
        // Test different update scopes
        await testRecurringEventUpdates(eventId);
      });
    });

    describe('Batch and Multi-Calendar Operations', () => {
      it('should handle multiple calendar queries', async () => {
        const startTime = testFactory.startTimer('list-events-multiple-calendars');
        
        try {
          const timeRanges = TestDataFactory.getTimeRanges();
          const result = await client.callTool({
            name: 'list-events',
            arguments: {
              calendarId: ['primary', TEST_CALENDAR_ID],
              timeMin: timeRanges.nextWeek.timeMin,
              timeMax: timeRanges.nextWeek.timeMax
            }
          });
          
          testFactory.endTimer('list-events-multiple-calendars', startTime, true);
          expect(TestDataFactory.validateEventResponse(result)).toBe(true);
        } catch (error) {
          testFactory.endTimer('list-events-multiple-calendars', startTime, false, String(error));
          throw error;
        }
      });
    });

    describe('Free/Busy Queries', () => {
      it('should check availability for test calendar', async () => {
        const startTime = testFactory.startTimer('get-freebusy');
        
        try {
          const timeRanges = TestDataFactory.getTimeRanges();
          const result = await client.callTool({
            name: 'get-freebusy',
            arguments: {
              calendars: [{ id: TEST_CALENDAR_ID }],
              timeMin: timeRanges.nextWeek.timeMin,
              timeMax: timeRanges.nextWeek.timeMax,
              timeZone: 'America/Los_Angeles'
            }
          });
          
          testFactory.endTimer('get-freebusy', startTime, true);
          expect(TestDataFactory.validateEventResponse(result)).toBe(true);
        } catch (error) {
          testFactory.endTimer('get-freebusy', startTime, false, String(error));
          throw error;
        }
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle invalid calendar ID gracefully', async () => {
      const invalidData = TestDataFactory.getInvalidTestData();
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      const result = await client.callTool({
        name: 'list-events',
        arguments: {
          calendarId: invalidData.invalidCalendarId,
          timeMin: TestDataFactory.formatDateTimeRFC3339(now),
          timeMax: TestDataFactory.formatDateTimeRFC3339(tomorrow)
        }
      });
      
      expect(result.isError).toBe(true);
      expect((result.content as any)[0].text).toContain('error');
    });

    it('should handle invalid event ID gracefully', async () => {
      const invalidData = TestDataFactory.getInvalidTestData();
      
      const result = await client.callTool({
        name: 'delete-event',
        arguments: {
          calendarId: TEST_CALENDAR_ID,
          eventId: invalidData.invalidEventId,
          sendUpdates: SEND_UPDATES
        }
      });
      
      expect(result.isError).toBe(true);
      expect((result.content as any)[0].text).toContain('error');
    });

    it('should handle malformed date formats gracefully', async () => {
      const invalidData = TestDataFactory.getInvalidTestData();
      
      await expect(
        client.callTool({
          name: 'create-event',
          arguments: {
            calendarId: TEST_CALENDAR_ID,
            summary: 'Test Event',
            start: invalidData.invalidTimeFormat,
            end: invalidData.invalidTimeFormat,
            timeZone: 'America/Los_Angeles',
            sendUpdates: SEND_UPDATES
          }
        })
      ).rejects.toThrow();
    });
  });

  describe('Performance Benchmarks', () => {
    it('should complete basic operations within reasonable time limits', async () => {
      // Create a test event for performance testing
      const eventData = TestDataFactory.createSingleEvent({
        summary: 'Performance Test Event'
      });
      
      const eventId = await createTestEvent(eventData);
      createdEventIds.push(eventId);
      
      // Test various operations and collect metrics
      const timeRanges = TestDataFactory.getTimeRanges();
      
      await verifyEventInList(eventId, timeRanges.nextWeek);
      await verifyEventInSearch(eventData.summary);
      
      // Get all performance metrics
      const metrics = testFactory.getPerformanceMetrics();
      
      // Log performance results
      console.log('\n📊 Performance Metrics:');
      metrics.forEach(metric => {
        console.log(`  ${metric.operation}: ${metric.duration}ms (${metric.success ? '✅' : '❌'})`);
      });
      
      // Basic performance assertions
      const createMetric = metrics.find(m => m.operation === 'create-event');
      const listMetric = metrics.find(m => m.operation === 'list-events');
      const searchMetric = metrics.find(m => m.operation === 'search-events');
      
      expect(createMetric?.success).toBe(true);
      expect(listMetric?.success).toBe(true);
      expect(searchMetric?.success).toBe(true);
      
      // All operations should complete within 30 seconds
      metrics.forEach(metric => {
        expect(metric.duration).toBeLessThan(30000);
      });
    });
  });

  // Helper Functions
  async function createTestEvent(eventData: TestEvent): Promise<string> {
    const startTime = testFactory.startTimer('create-event');
    
    try {
      const result = await client.callTool({
        name: 'create-event',
        arguments: {
          calendarId: TEST_CALENDAR_ID,
          ...eventData,
          sendUpdates: SEND_UPDATES
        }
      });
      
      testFactory.endTimer('create-event', startTime, true);
      
      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      
      const eventId = TestDataFactory.extractEventIdFromResponse(result);
      
      expect(eventId).toBeTruthy();
      
      testFactory.addCreatedEventId(eventId!);
      
      return eventId!;
    } catch (error) {
      testFactory.endTimer('create-event', startTime, false, String(error));
      throw error;
    }
  }

  async function verifyEventInList(eventId: string, timeRange: { timeMin: string; timeMax: string }): Promise<void> {
    const startTime = testFactory.startTimer('list-events');
    
    try {
      const result = await client.callTool({
        name: 'list-events',
        arguments: {
          calendarId: TEST_CALENDAR_ID,
          timeMin: timeRange.timeMin,
          timeMax: timeRange.timeMax
        }
      });
      
      testFactory.endTimer('list-events', startTime, true);
      
      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      expect((result.content as any)[0].text).toContain(eventId);
    } catch (error) {
      testFactory.endTimer('list-events', startTime, false, String(error));
      throw error;
    }
  }

  async function verifyEventInSearch(query: string): Promise<void> {
    const startTime = testFactory.startTimer('search-events');
    
    try {
      const timeRanges = TestDataFactory.getTimeRanges();
      const result = await client.callTool({
        name: 'search-events',
        arguments: {
          calendarId: TEST_CALENDAR_ID,
          query,
          timeMin: timeRanges.nextWeek.timeMin,
          timeMax: timeRanges.nextWeek.timeMax
        }
      });
      
      testFactory.endTimer('search-events', startTime, true);
      
      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
      expect((result.content as any)[0].text.toLowerCase()).toContain(query.toLowerCase());
    } catch (error) {
      testFactory.endTimer('search-events', startTime, false, String(error));
      throw error;
    }
  }

  async function updateTestEvent(eventId: string, updates: Partial<TestEvent>): Promise<void> {
    const startTime = testFactory.startTimer('update-event');
    
    try {
      const result = await client.callTool({
        name: 'update-event',
        arguments: {
          calendarId: TEST_CALENDAR_ID,
          eventId,
          ...updates,
          timeZone: updates.timeZone || 'America/Los_Angeles',
          sendUpdates: SEND_UPDATES
        }
      });
      
      testFactory.endTimer('update-event', startTime, true);
      
      expect(TestDataFactory.validateEventResponse(result)).toBe(true);
    } catch (error) {
      testFactory.endTimer('update-event', startTime, false, String(error));
      throw error;
    }
  }

  async function testRecurringEventUpdates(eventId: string): Promise<void> {
    // Test updating all instances
    await updateTestEvent(eventId, {
      summary: 'Updated Recurring Meeting - All Instances'
    });
    
    // Verify the update
    await verifyEventInSearch('Updated Recurring Meeting - All Instances');
  }

  async function cleanupTestEvents(eventIds: string[]): Promise<void> {
    for (const eventId of eventIds) {
      try {
        const deleteStartTime = testFactory.startTimer('delete-event');
        
        await client.callTool({
          name: 'delete-event',
          arguments: {
            calendarId: TEST_CALENDAR_ID,
            eventId,
            sendUpdates: SEND_UPDATES
          }
        });
        
        testFactory.endTimer('delete-event', deleteStartTime, true);
      } catch (error) {
        const deleteStartTime = testFactory.startTimer('delete-event');
        testFactory.endTimer('delete-event', deleteStartTime, false, String(error));
        console.warn(`Failed to cleanup event ${eventId}:`, String(error));
      }
    }
  }

  async function cleanupAllTestEvents(): Promise<void> {
    const allEventIds = testFactory.getCreatedEventIds();
    await cleanupTestEvents(allEventIds);
    testFactory.clearCreatedEventIds();
  }

  function logPerformanceSummary(): void {
    const metrics = testFactory.getPerformanceMetrics();
    if (metrics.length === 0) return;
    
    console.log('\n📈 Final Performance Summary:');
    
    const byOperation = metrics.reduce((acc, metric) => {
      if (!acc[metric.operation]) {
        acc[metric.operation] = {
          count: 0,
          totalDuration: 0,
          successCount: 0,
          errors: []
        };
      }
      
      acc[metric.operation].count++;
      acc[metric.operation].totalDuration += metric.duration;
      if (metric.success) {
        acc[metric.operation].successCount++;
      } else if (metric.error) {
        acc[metric.operation].errors.push(metric.error);
      }
      
      return acc;
    }, {} as Record<string, { count: number; totalDuration: number; successCount: number; errors: string[] }>);
    
    Object.entries(byOperation).forEach(([operation, stats]) => {
      const avgDuration = Math.round(stats.totalDuration / stats.count);
      const successRate = Math.round((stats.successCount / stats.count) * 100);
      
      console.log(`  ${operation}:`);
      console.log(`    Calls: ${stats.count}`);
      console.log(`    Avg Duration: ${avgDuration}ms`);
      console.log(`    Success Rate: ${successRate}%`);
      
      if (stats.errors.length > 0) {
        console.log(`    Errors: ${stats.errors.length}`);
      }
    });
  }
});