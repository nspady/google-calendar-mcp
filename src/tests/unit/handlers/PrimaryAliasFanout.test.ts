/**
 * Regression: the implicit default calendar 'primary' (calendarId omitted and
 * GOOGLE_CALENDAR_MCP_DEFAULT_CALENDAR_ID unset) is a per-account keyword alias.
 * With multiple accounts selected it must fan out to every account's primary
 * calendar. Previously it was routed through CalendarRegistry, whose deduplication
 * resolves one calendar to a single preferred account — silently dropping the
 * other accounts' primaries from the results.
 *
 * These tests drive the real CalendarRegistry (routing is not stubbed) so the
 * deduplication path cannot mask the bug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';

const mocks = vi.hoisted(() => ({
    byAuth: new Map<any, any>()
}));

vi.mock('googleapis', () => ({
    google: {
        calendar: vi.fn((config: any) => mocks.byAuth.get(config.auth))
    },
    calendar_v3: {}
}));

import { ListEventsHandler } from '../../../handlers/core/ListEventsHandler.js';
import { SearchEventsHandler } from '../../../handlers/core/SearchEventsHandler.js';
import { CalendarRegistry } from '../../../services/CalendarRegistry.js';

function makeAccountMock(events: Array<Record<string, unknown>>, email: string) {
    return {
        events: { list: vi.fn().mockResolvedValue({ data: { items: events } }) },
        calendarList: {
            get: vi.fn().mockResolvedValue({ data: { timeZone: 'UTC' } }),
            list: vi.fn().mockResolvedValue({
                data: {
                    items: [{ id: email, summary: email, summaryOverride: `${email} Primary`, primary: true, accessRole: 'owner' }]
                }
            })
        },
        calendars: {
            get: vi.fn().mockRejectedValue(new Error('not found'))
        }
    };
}

describe('multi-account primary alias fan-out', () => {
    const emailWork = 'alice@corp.example';
    const emailPersonal = 'alice@personal.example';

    let workMocks: ReturnType<typeof makeAccountMock>;
    let personalMocks: ReturnType<typeof makeAccountMock>;
    let accounts: Map<string, OAuth2Client>;

    const newClient = (): OAuth2Client =>
        ({ getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-token' }) }) as unknown as OAuth2Client;

    beforeEach(() => {
        delete process.env.GOOGLE_CALENDAR_MCP_DEFAULT_CALENDAR_ID;
        mocks.byAuth.clear();
        CalendarRegistry.getInstance().clearCache();

        workMocks = makeAccountMock([{ id: 'evt-work-1', summary: 'Work standup' }], emailWork);
        personalMocks = makeAccountMock([{ id: 'evt-personal-1', summary: 'Personal dentist' }], emailPersonal);
        accounts = new Map<string, OAuth2Client>();
        // Distinct client instances per account
        const workClient = newClient();
        const personalClient = newClient();
        mocks.byAuth.set(workClient, workMocks);
        mocks.byAuth.set(personalClient, personalMocks);
        accounts.set('work', workClient);
        accounts.set('personal', personalClient);
    });

    it('list-events returns both accounts\' primary calendars when calendarId is omitted', async () => {
        const handler = new ListEventsHandler();
        const result = await handler.runTool({}, accounts);

        const parsed = JSON.parse(result.content[0].text);
        // Both primaries must be queried — not just the registry-preferred account.
        expect(workMocks.events.list).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'primary' }));
        expect(personalMocks.events.list).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'primary' }));
        expect(parsed.totalCount).toBe(2);
        expect(parsed.events.map((e: { id: string }) => e.id).sort()).toEqual(['evt-personal-1', 'evt-work-1']);
        expect(parsed.accounts).toEqual(['work', 'personal']);
    });

    it('list-events returns both accounts\' primary calendars when calendarId=primary is explicit', async () => {
        const handler = new ListEventsHandler();
        const result = await handler.runTool({ calendarId: 'primary' }, accounts);

        const parsed = JSON.parse(result.content[0].text);
        expect(workMocks.events.list).toHaveBeenCalledTimes(1);
        expect(personalMocks.events.list).toHaveBeenCalledTimes(1);
        expect(parsed.totalCount).toBe(2);
    });

    it('search-events returns matches from both accounts\' primary calendars', async () => {
        const handler = new SearchEventsHandler();
        const result = await handler.runTool(
            { query: 'meeting', timeMin: '2026-01-01T00:00:00Z', timeMax: '2026-12-31T23:59:59Z' },
            accounts
        );

        const parsed = JSON.parse(result.content[0].text);
        expect(workMocks.events.list).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'primary', q: 'meeting' }));
        expect(personalMocks.events.list).toHaveBeenCalledWith(expect.objectContaining({ calendarId: 'primary', q: 'meeting' }));
        expect(parsed.totalCount).toBe(2);
    });

    it('named calendars still route through the registry to a single preferred account', async () => {
        // Fan-out must be scoped to the 'primary' keyword only: a named/ID calendar
        // resolves to one preferred account as before.
        const handler = new ListEventsHandler();
        const result = await handler.runTool({ calendarId: emailWork }, accounts);

        const parsed = JSON.parse(result.content[0].text);
        expect(workMocks.events.list).toHaveBeenCalledWith(expect.objectContaining({ calendarId: emailWork }));
        expect(personalMocks.events.list).not.toHaveBeenCalled();
        expect(parsed.totalCount).toBe(1);
    });
});
