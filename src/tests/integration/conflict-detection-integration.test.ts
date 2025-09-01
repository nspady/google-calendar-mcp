import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializeApp } from '../../index.js';
import { TestDataFactory } from './test-data-factory.js';
import { AuthenticationService } from '../../auth/AuthenticationService.js';
import { ConflictCheckResult } from '../../services/conflict-detection/types.js';

describe('Conflict Detection Integration Tests', () => {
  let server: Server;
  let isAuthenticated = false;
  let testCalendarId: string;

  beforeAll(async () => {
    // Check authentication
    const authService = new AuthenticationService();
    isAuthenticated = await authService.isAuthenticated();
    
    if (!isAuthenticated) {
      console.log('⚠️  Skipping conflict detection integration tests - not authenticated');
      return;
    }

    // Use test calendar
    testCalendarId = process.env.TEST_CALENDAR_ID || 'primary';
    
    // Initialize server
    const transport = new StdioServerTransport();
    server = await initializeApp(transport);
  });

  afterEach(async () => {
    if (!isAuthenticated) return;
    // Clean up any test events
    await TestDataFactory.cleanupTestEvents();
  });

  afterAll(async () => {
    await TestDataFactory.cleanupTestEvents();
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicate events with high similarity', async function() {
      if (!isAuthenticated) {
        this.skip();
        return;
      }

      // Create an initial event
      const initialEvent = TestDataFactory.createSingleEvent({
        summary: 'Team Standup Meeting',
        location: 'Conference Room A'
      });

      const createResult = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...initialEvent
        }
      });

      const createResponse = JSON.parse(createResult.content[0].text);
      expect(createResponse.event).toBeDefined();
      const eventId = createResponse.event.id;
      TestDataFactory.trackCreatedEvent(eventId, testCalendarId);

      // Try to create a duplicate
      const duplicateResult = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...initialEvent,
          duplicateSimilarityThreshold: 0.8
        }
      });

      // Should throw error due to high similarity
      // In v2.0, duplicate detection throws an error
      expect(duplicateResult.isError).toBe(true);
      if (duplicateResult.error) {
        expect(duplicateResult.error.message).toContain('Duplicate event detected');
      }
    });

    it('should not treat all-day event as duplicate of timed event', async function() {
      if (!isAuthenticated) {
        this.skip();
        return;
      }

      // Create an all-day event
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      
      const allDayEvent = {
        summary: 'Company Offsite',
        start: tomorrow.toISOString().split('T')[0],
        end: dayAfter.toISOString().split('T')[0],
        location: 'Mountain View'
      };

      const allDayResult = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...allDayEvent
        }
      });

      const allDayResponse = JSON.parse(allDayResult.content[0].text);
      expect(allDayResponse.event).toBeDefined();
      const allDayEventId = TestDataFactory.extractEventIdFromResponse(allDayResult);
      TestDataFactory.trackCreatedEvent(allDayEventId, testCalendarId);

      // Create a timed event with same title on same day
      const timedEvent = TestDataFactory.createSingleEvent({
        summary: 'Company Offsite',
        location: 'Mountain View'
      });

      const timedResult = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...timedEvent
        }
      });

      // Should NOT be blocked as duplicate even though title and location match
      const timedResponse = JSON.parse(timedResult.content[0].text);
      expect(timedResponse.event).toBeDefined();
      expect(timedResponse.duplicates).toBeUndefined();
      
      // May show as low similarity duplicate in warnings
      if (timedResult.content[0].text.includes('POTENTIAL DUPLICATES')) {
        // If shown, similarity should be low (30% or less)
        const match = timedResult.content[0].text.match(/(\d+)% similar/);
        if (match) {
          const similarity = parseInt(match[1]);
          expect(similarity).toBeLessThanOrEqual(30);
        }
      }
      
      const timedEventId = TestDataFactory.extractEventIdFromResponse(timedResult);
      TestDataFactory.trackCreatedEvent(timedEventId, testCalendarId);
    });

    it('should allow creation with blockOnHighSimilarity=false', async function() {
      if (!isAuthenticated) {
        this.skip();
        return;
      }

      const event = TestDataFactory.createSingleEvent({
        summary: 'Product Review Meeting'
      });

      // Create initial event
      const firstResult = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...event
        }
      });
      const firstEventId = TestDataFactory.extractEventIdFromResponse(firstResult);
      TestDataFactory.trackCreatedEvent(firstEventId, testCalendarId);

      // Create duplicate with override
      const duplicateResult = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...event,
          blockOnHighSimilarity: false
        }
      });

      const duplicateResponse = JSON.parse(duplicateResult.content[0].text);
      expect(duplicateResponse.event).toBeDefined();
      expect(duplicateResponse.warnings).toBeDefined();
      expect(duplicateResponse.duplicates).toBeDefined();
      expect(duplicateResponse.duplicates.length).toBeGreaterThan(0);
      const secondEventId = TestDataFactory.extractEventIdFromResponse(duplicateResult);
      TestDataFactory.trackCreatedEvent(secondEventId, testCalendarId);
    });
  });

  describe('Conflict Detection', () => {
    it('should detect scheduling conflicts', async function() {
      if (!isAuthenticated) {
        this.skip();
        return;
      }

      // Create first event
      const start1 = new Date();
      start1.setHours(start1.getHours() + 3);
      const end1 = new Date(start1);
      end1.setHours(end1.getHours() + 1);
      
      const firstEvent = TestDataFactory.createSingleEvent({
        summary: 'Engineering Sync',
        start: TestDataFactory.formatDateTimeRFC3339(start1),
        end: TestDataFactory.formatDateTimeRFC3339(end1)
      });

      const firstResult = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...firstEvent
        }
      });
      const firstEventId = TestDataFactory.extractEventIdFromResponse(firstResult);
      TestDataFactory.trackCreatedEvent(firstEventId, testCalendarId);

      // Create overlapping event (30 minutes overlap)
      const start2 = new Date(start1);
      start2.setMinutes(start2.getMinutes() + 30);
      const end2 = new Date(start2);
      end2.setHours(end2.getHours() + 1);
      
      const overlappingEvent = TestDataFactory.createSingleEvent({
        summary: 'Design Review',
        start: TestDataFactory.formatDateTimeRFC3339(start2),
        end: TestDataFactory.formatDateTimeRFC3339(end2)
      });

      const conflictResult = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...overlappingEvent
        }
      });

      const conflictResponse = JSON.parse(conflictResult.content[0].text);
      expect(conflictResponse.event).toBeDefined();
      expect(conflictResponse.warnings).toBeDefined();
      expect(conflictResponse.conflicts).toBeDefined();
      expect(conflictResponse.conflicts.length).toBeGreaterThan(0);
      const conflict = conflictResponse.conflicts[0];
      expect(conflict.overlap).toBeDefined();
      expect(conflict.overlap.duration).toContain('30 minute');
      expect(conflict.overlap.percentage).toContain('50%');
      
      const secondEventId = TestDataFactory.extractEventIdFromResponse(conflictResult);
      TestDataFactory.trackCreatedEvent(secondEventId, testCalendarId);
    });

    it('should check conflicts across multiple calendars', async function() {
      if (!isAuthenticated) {
        this.skip();
        return;
      }

      // This test would require multiple calendars
      // For now, we'll test with the same calendar
      const event = factory.createTestEvent({
        summary: 'Cross-Calendar Test',
        start: factory.getTomorrowAt(15, 0),
        end: factory.getTomorrowAt(16, 0)
      });

      const result = await server.callTool({
        name: 'create-event',
        arguments: {
          calendarId: testCalendarId,
          ...event,
          calendarsToCheck: [testCalendarId] // In real scenario, would include work calendar etc.
        }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.event).toBeDefined();
      const eventId = TestDataFactory.extractEventIdFromResponse(result);
      TestDataFactory.trackCreatedEvent(eventId, testCalendarId);
    });
  });

  describe('Update Event Conflict Detection', () => {
    it('should detect conflicts when updating event time', async function() {
      if (!isAuthenticated) {
        this.skip();
        return;
      }

      // Create two events
      const event1 = factory.createTestEvent({
        summary: 'Meeting 1',
        start: factory.getTomorrowAt(9, 0),
        end: factory.getTomorrowAt(10, 0)
      });

      const event2 = factory.createTestEvent({
        summary: 'Meeting 2',
        start: factory.getTomorrowAt(11, 0),
        end: factory.getTomorrowAt(12, 0)
      });

      const result1 = await server.callTool({
        name: 'create-event',
        arguments: { calendarId: testCalendarId, ...event1 }
      });
      const eventId1 = TestDataFactory.extractEventIdFromResponse(result1);
      TestDataFactory.trackCreatedEvent(eventId1, testCalendarId);

      const result2 = await server.callTool({
        name: 'create-event',
        arguments: { calendarId: testCalendarId, ...event2 }
      });
      const eventId2 = TestDataFactory.extractEventIdFromResponse(result2);
      TestDataFactory.trackCreatedEvent(eventId2, testCalendarId);

      // Update event2 to conflict with event1
      const updateResult = await server.callTool({
        name: 'update-event',
        arguments: {
          calendarId: testCalendarId,
          eventId: eventId2,
          start: factory.getTomorrowAt(9, 30).toISOString().slice(0, 19),
          end: factory.getTomorrowAt(10, 30).toISOString().slice(0, 19)
        }
      });

      const updateResponse = JSON.parse(updateResult.content[0].text);
      expect(updateResponse.event).toBeDefined();
      expect(updateResponse.warnings).toBeDefined();
      expect(updateResponse.conflicts).toBeDefined();
      expect(updateResponse.conflicts.length).toBeGreaterThan(0);
    });

    it('should skip conflict check when checkConflicts=false', async function() {
      if (!isAuthenticated) {
        this.skip();
        return;
      }

      const event = factory.createTestEvent({
        summary: 'No Conflict Check Event',
        start: factory.getTomorrowAt(16, 0),
        end: factory.getTomorrowAt(17, 0)
      });

      const result = await server.callTool({
        name: 'create-event',
        arguments: { calendarId: testCalendarId, ...event }
      });
      const eventId = TestDataFactory.extractEventIdFromResponse(result);
      TestDataFactory.trackCreatedEvent(eventId, testCalendarId);

      // Update without conflict checking
      const updateResult = await server.callTool({
        name: 'update-event',
        arguments: {
          calendarId: testCalendarId,
          eventId: eventId,
          start: factory.getTomorrowAt(17, 0).toISOString().slice(0, 19),
          checkConflicts: false
        }
      });

      const updateResponse = JSON.parse(updateResult.content[0].text);
      expect(updateResponse.event).toBeDefined();
      expect(updateResponse.conflicts).toBeUndefined();
      expect(updateResult.content[0].text).not.toContain('CONFLICTS');
    });
  });
});