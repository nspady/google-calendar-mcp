import { describe, it, expect } from 'vitest';
import { generateEventUrl, getEventUrl } from '../../../utils/event-url.js';
import { calendar_v3 } from 'googleapis';

describe('Event URL Utilities', () => {
    describe('generateEventUrl', () => {
        it('should generate a proper Google Calendar event URL', () => {
            const calendarId = 'user@example.com';
            const eventId = 'abc123def456';
            const url = generateEventUrl(calendarId, eventId);
            
            expect(url).toBe('https://calendar.google.com/calendar/event?eid=abc123def456&cid=user%40example.com');
        });

        it('should properly encode special characters in calendar ID', () => {
            const calendarId = 'user@test-calendar.com';
            const eventId = 'event123';
            const url = generateEventUrl(calendarId, eventId);
            
            expect(url).toBe('https://calendar.google.com/calendar/event?eid=event123&cid=user%40test-calendar.com');
        });

        it('should properly encode special characters in event ID', () => {
            const calendarId = 'user@example.com';
            const eventId = 'event+with+special&chars';
            const url = generateEventUrl(calendarId, eventId);
            
            expect(url).toBe('https://calendar.google.com/calendar/event?eid=event%2Bwith%2Bspecial%26chars&cid=user%40example.com');
        });
    });

    describe('getEventUrl', () => {
        const mockEvent: calendar_v3.Schema$Event = {
            id: 'test123',
            summary: 'Test Event',
            start: { dateTime: '2024-03-15T10:00:00-07:00' },
            end: { dateTime: '2024-03-15T11:00:00-07:00' },
            location: 'Conference Room A',
            description: 'Test meeting'
        };

        it('should use htmlLink when available', () => {
            const eventWithHtmlLink = {
                ...mockEvent,
                htmlLink: 'https://calendar.google.com/event?eid=existing123'
            };
            
            const result = getEventUrl(eventWithHtmlLink);
            expect(result).toBe('https://calendar.google.com/event?eid=existing123');
        });

        it('should generate URL when htmlLink is not available but calendarId is provided', () => {
            const result = getEventUrl(mockEvent, 'user@example.com');
            expect(result).toBe('https://calendar.google.com/calendar/event?eid=test123&cid=user%40example.com');
        });

        it('should return null when htmlLink is not available and calendarId is not provided', () => {
            const result = getEventUrl(mockEvent);
            expect(result).toBeNull();
        });

        it('should return null when event has no ID', () => {
            const eventWithoutId = { ...mockEvent, id: undefined };
            const result = getEventUrl(eventWithoutId, 'user@example.com');
            expect(result).toBeNull();
        });
    });
});