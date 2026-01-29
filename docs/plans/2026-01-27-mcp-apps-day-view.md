# MCP Apps Day View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add interactive day view visualization to create-event and update-event responses using MCP Apps extension.

**Architecture:** Tools return `_meta.ui.resourceUri` pointing to a bundled HTML day view. The UI receives event data via `ontoolresult`, renders a single-column day view with the new event centered, and provides "Open in Google Calendar" links.

**Tech Stack:** `@modelcontextprotocol/ext-apps`, Vite with `vite-plugin-singlefile`, vanilla TypeScript for UI.

---

## Task 1: Add MCP Apps Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add dependencies**

```bash
cd /Users/nate/Projects/google-calendar-mcp/.worktrees/mcp-apps-day-view
npm install @modelcontextprotocol/ext-apps
npm install -D vite vite-plugin-singlefile
```

**Step 2: Verify installation**

Run: `npm ls @modelcontextprotocol/ext-apps`
Expected: Shows installed version

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add MCP Apps dependencies"
```

---

## Task 2: Create DayContext Types

**Files:**
- Create: `src/types/day-context.ts`

**Step 1: Write the type definitions**

Create `src/types/day-context.ts`:

```typescript
import { StructuredEvent } from './structured-responses.js';

/**
 * Simplified event for day view display
 */
export interface DayViewEvent {
  id: string;
  summary: string;
  start: string;           // ISO datetime or date
  end: string;             // ISO datetime or date
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  colorId?: string;
  calendarId: string;
  accountId?: string;
}

/**
 * Context data passed to the day view UI
 */
export interface DayContext {
  /** The date being displayed (YYYY-MM-DD) */
  date: string;
  /** Timezone for display */
  timezone: string;
  /** All events for the day */
  events: DayViewEvent[];
  /** ID of the newly created/updated event */
  focusEventId: string;
  /** Calculated time range to display */
  timeRange: {
    /** Start hour (0-23) */
    startHour: number;
    /** End hour (0-23) */
    endHour: number;
  };
  /** Link to open the day in Google Calendar */
  dayLink: string;
}

/**
 * Converts a StructuredEvent to DayViewEvent
 */
export function toDayViewEvent(event: StructuredEvent): DayViewEvent {
  const isAllDay = !event.start.dateTime && !!event.start.date;
  return {
    id: event.id,
    summary: event.summary || '(No title)',
    start: event.start.dateTime || event.start.date || '',
    end: event.end.dateTime || event.end.date || '',
    isAllDay,
    location: event.location,
    htmlLink: event.htmlLink || '',
    colorId: event.colorId,
    calendarId: event.calendarId || '',
    accountId: event.accountId,
  };
}
```

**Step 2: Run lint to verify**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add src/types/day-context.ts
git commit -m "feat: add DayContext types for day view UI"
```

---

## Task 3: Create DayContextService

**Files:**
- Create: `src/services/day-context/DayContextService.ts`
- Create: `src/services/day-context/index.ts`

**Step 1: Write the failing test**

Create `src/tests/unit/services/DayContextService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DayContextService } from '../../../services/day-context/DayContextService.js';
import { StructuredEvent } from '../../../types/structured-responses.js';

describe('DayContextService', () => {
  let service: DayContextService;

  beforeEach(() => {
    service = new DayContextService();
  });

  describe('calculateTimeRange', () => {
    it('should add 1 hour buffer on each side of events', () => {
      const events: StructuredEvent[] = [
        createEvent('1', '2026-01-27T10:00:00', '2026-01-27T11:00:00'),
        createEvent('2', '2026-01-27T14:00:00', '2026-01-27T15:00:00'),
      ];

      const range = service.calculateTimeRange(events);

      expect(range.startHour).toBe(9);  // 10:00 - 1 hour
      expect(range.endHour).toBe(16);   // 15:00 + 1 hour
    });

    it('should handle all-day events by using default range', () => {
      const events: StructuredEvent[] = [
        createAllDayEvent('1', '2026-01-27'),
      ];

      const range = service.calculateTimeRange(events);

      expect(range.startHour).toBe(8);   // Default start
      expect(range.endHour).toBe(18);    // Default end
    });

    it('should not go below hour 0 or above hour 24', () => {
      const events: StructuredEvent[] = [
        createEvent('1', '2026-01-27T00:30:00', '2026-01-27T23:30:00'),
      ];

      const range = service.calculateTimeRange(events);

      expect(range.startHour).toBe(0);
      expect(range.endHour).toBe(24);
    });
  });

  describe('buildDayContext', () => {
    it('should build context with focus event centered', () => {
      const focusEvent: StructuredEvent = createEvent(
        'focus-123',
        '2026-01-27T14:00:00',
        '2026-01-27T15:00:00'
      );
      const otherEvents: StructuredEvent[] = [
        createEvent('other-1', '2026-01-27T10:00:00', '2026-01-27T11:00:00'),
      ];

      const context = service.buildDayContext(
        focusEvent,
        otherEvents,
        'America/Los_Angeles'
      );

      expect(context.focusEventId).toBe('focus-123');
      expect(context.date).toBe('2026-01-27');
      expect(context.events).toHaveLength(2);
      expect(context.timezone).toBe('America/Los_Angeles');
    });

    it('should separate all-day events', () => {
      const focusEvent: StructuredEvent = createEvent(
        'focus-123',
        '2026-01-27T14:00:00',
        '2026-01-27T15:00:00'
      );
      const otherEvents: StructuredEvent[] = [
        createAllDayEvent('allday-1', '2026-01-27'),
      ];

      const context = service.buildDayContext(focusEvent, otherEvents, 'UTC');
      const allDayEvents = context.events.filter(e => e.isAllDay);
      const timedEvents = context.events.filter(e => !e.isAllDay);

      expect(allDayEvents).toHaveLength(1);
      expect(timedEvents).toHaveLength(1);
    });
  });
});

// Test helpers
function createEvent(id: string, start: string, end: string): StructuredEvent {
  return {
    id,
    summary: `Event ${id}`,
    start: { dateTime: start },
    end: { dateTime: end },
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    calendarId: 'primary',
  };
}

function createAllDayEvent(id: string, date: string): StructuredEvent {
  return {
    id,
    summary: `All Day ${id}`,
    start: { date },
    end: { date },
    htmlLink: `https://calendar.google.com/event?eid=${id}`,
    calendarId: 'primary',
  };
}
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/tests/unit/services/DayContextService.test.ts`
Expected: FAIL - module not found

**Step 3: Create directory structure**

```bash
mkdir -p src/services/day-context
```

**Step 4: Write the implementation**

Create `src/services/day-context/DayContextService.ts`:

```typescript
import { StructuredEvent } from '../../types/structured-responses.js';
import { DayContext, DayViewEvent, toDayViewEvent } from '../../types/day-context.js';

const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;
const BUFFER_HOURS = 1;

export class DayContextService {
  /**
   * Calculate the time range to display based on events
   */
  calculateTimeRange(events: StructuredEvent[]): { startHour: number; endHour: number } {
    const timedEvents = events.filter(e => e.start.dateTime);

    if (timedEvents.length === 0) {
      return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR };
    }

    let minHour = 24;
    let maxHour = 0;

    for (const event of timedEvents) {
      if (event.start.dateTime) {
        const startHour = new Date(event.start.dateTime).getHours();
        minHour = Math.min(minHour, startHour);
      }
      if (event.end.dateTime) {
        const endHour = new Date(event.end.dateTime).getHours();
        const endMinutes = new Date(event.end.dateTime).getMinutes();
        // If event ends at exactly on the hour, don't add extra hour
        maxHour = Math.max(maxHour, endMinutes > 0 ? endHour + 1 : endHour);
      }
    }

    return {
      startHour: Math.max(0, minHour - BUFFER_HOURS),
      endHour: Math.min(24, maxHour + BUFFER_HOURS),
    };
  }

  /**
   * Build the day context for the UI
   */
  buildDayContext(
    focusEvent: StructuredEvent,
    surroundingEvents: StructuredEvent[],
    timezone: string
  ): DayContext {
    // Extract date from focus event
    const dateStr = focusEvent.start.dateTime || focusEvent.start.date || '';
    const date = dateStr.split('T')[0];

    // Combine focus event with surrounding events, deduplicate by ID
    const eventMap = new Map<string, StructuredEvent>();
    eventMap.set(focusEvent.id, focusEvent);
    for (const event of surroundingEvents) {
      if (!eventMap.has(event.id)) {
        eventMap.set(event.id, event);
      }
    }
    const allEvents = Array.from(eventMap.values());

    // Convert to day view events
    const dayViewEvents: DayViewEvent[] = allEvents.map(toDayViewEvent);

    // Sort: all-day first, then by start time
    dayViewEvents.sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return a.start.localeCompare(b.start);
    });

    // Calculate time range
    const timeRange = this.calculateTimeRange(allEvents);

    // Build Google Calendar day link
    const dayLink = `https://calendar.google.com/calendar/r/day/${date.replace(/-/g, '/')}`;

    return {
      date,
      timezone,
      events: dayViewEvents,
      focusEventId: focusEvent.id,
      timeRange,
      dayLink,
    };
  }
}
```

Create `src/services/day-context/index.ts`:

```typescript
export { DayContextService } from './DayContextService.js';
export type { DayContext, DayViewEvent } from '../../types/day-context.js';
```

**Step 5: Run test to verify it passes**

Run: `npm test -- src/tests/unit/services/DayContextService.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/services/day-context/ src/tests/unit/services/DayContextService.test.ts
git commit -m "feat: add DayContextService for building day view data"
```

---

## Task 4: Create Vite Build Configuration for UI

**Files:**
- Create: `vite.config.ui.ts`
- Modify: `package.json` (scripts)
- Modify: `tsconfig.json` (include UI files)

**Step 1: Create vite config**

Create `vite.config.ui.ts`:

```typescript
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'build/ui',
    emptyDirFirst: true,
    rollupOptions: {
      input: process.env.UI_INPUT || 'src/ui/day-view/day-view.html',
    },
  },
});
```

**Step 2: Update package.json scripts**

Add to package.json scripts section:

```json
"build:ui": "vite build --config vite.config.ui.ts",
"build": "node scripts/build.js && npm run build:ui"
```

**Step 3: Create tsconfig for UI**

Create `tsconfig.ui.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "outDir": "build/ui"
  },
  "include": ["src/ui/**/*.ts"]
}
```

**Step 4: Commit**

```bash
git add vite.config.ui.ts tsconfig.ui.json package.json
git commit -m "feat: add Vite build config for MCP Apps UI"
```

---

## Task 5: Create Day View UI

**Files:**
- Create: `src/ui/day-view/day-view.html`
- Create: `src/ui/day-view/day-view.ts`
- Create: `src/ui/day-view/styles.css`

**Step 1: Create directory**

```bash
mkdir -p src/ui/day-view
```

**Step 2: Create HTML entry point**

Create `src/ui/day-view/day-view.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Day View</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div id="app">
    <div class="day-view-header">
      <h2 id="date-heading">Loading...</h2>
      <a id="day-link" href="#" target="_blank" class="open-calendar-btn">Open in Calendar</a>
    </div>
    <div id="all-day-section" class="all-day-section" style="display: none;">
      <div class="all-day-label">All day</div>
      <div id="all-day-events" class="all-day-events"></div>
    </div>
    <div id="time-grid" class="time-grid">
      <!-- Time slots and events rendered here -->
    </div>
  </div>
  <script type="module" src="./day-view.ts"></script>
</body>
</html>
```

**Step 3: Create styles**

Create `src/ui/day-view/styles.css`:

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --text-primary: #202124;
  --text-secondary: #5f6368;
  --border-color: #dadce0;
  --accent-color: #1a73e8;
  --hour-width: 60px;
  --row-height: 48px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #202124;
    --bg-secondary: #303134;
    --text-primary: #e8eaed;
    --text-secondary: #9aa0a6;
    --border-color: #5f6368;
    --accent-color: #8ab4f8;
  }
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.4;
}

#app {
  max-width: 600px;
  margin: 0 auto;
  padding: 16px;
}

.day-view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.day-view-header h2 {
  font-size: 18px;
  font-weight: 500;
}

.open-calendar-btn {
  color: var(--accent-color);
  text-decoration: none;
  font-size: 13px;
  padding: 6px 12px;
  border: 1px solid var(--accent-color);
  border-radius: 4px;
  transition: background 0.2s;
}

.open-calendar-btn:hover {
  background: rgba(26, 115, 232, 0.1);
}

.all-day-section {
  margin-bottom: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-color);
}

.all-day-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  margin-bottom: 8px;
  padding-left: var(--hour-width);
}

.all-day-events {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-left: var(--hour-width);
}

.all-day-event {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
}

.time-grid {
  position: relative;
}

.time-row {
  display: flex;
  height: var(--row-height);
  border-bottom: 1px solid var(--border-color);
}

.time-label {
  width: var(--hour-width);
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  padding-right: 8px;
  padding-top: 2px;
}

.time-slot {
  flex: 1;
  position: relative;
}

.event-block {
  position: absolute;
  left: 4px;
  right: 4px;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  overflow: hidden;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  border-left: 3px solid;
  transition: box-shadow 0.2s;
}

.event-block:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.event-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-time {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.event-location {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Google Calendar color mappings */
.event-color-1 { background: #a4bdfc; border-color: #7986cb; }
.event-color-2 { background: #7ae7bf; border-color: #33b679; }
.event-color-3 { background: #dbadff; border-color: #8e24aa; }
.event-color-4 { background: #ff887c; border-color: #e67c73; }
.event-color-5 { background: #fbd75b; border-color: #f6bf26; }
.event-color-6 { background: #ffb878; border-color: #f4511e; }
.event-color-7 { background: #46d6db; border-color: #039be5; }
.event-color-8 { background: #e1e1e1; border-color: #616161; }
.event-color-9 { background: #5484ed; border-color: #3f51b5; }
.event-color-10 { background: #51b749; border-color: #0b8043; }
.event-color-11 { background: #dc2127; border-color: #d50000; }
.event-color-default { background: var(--bg-secondary); border-color: var(--accent-color); }
```

**Step 4: Create TypeScript app logic**

Create `src/ui/day-view/day-view.ts`:

```typescript
import { App } from '@modelcontextprotocol/ext-apps';

interface DayViewEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  colorId?: string;
}

interface DayContext {
  date: string;
  timezone: string;
  events: DayViewEvent[];
  focusEventId: string;
  timeRange: {
    startHour: number;
    endHour: number;
  };
  dayLink: string;
}

// Initialize MCP App connection
const app = new App({ name: 'Calendar Day View', version: '1.0.0' });
app.connect();

// Handle tool result from server
app.ontoolresult = (result) => {
  try {
    // The day context is embedded in the tool result
    const textContent = result.content?.find(c => c.type === 'text');
    if (textContent && 'text' in textContent) {
      // Parse the response - it may have event + dayContext
      const data = JSON.parse(textContent.text);
      if (data.dayContext) {
        renderDayView(data.dayContext);
      }
    }
  } catch (error) {
    console.error('Failed to parse tool result:', error);
  }
};

function renderDayView(context: DayContext): void {
  // Update header
  const dateHeading = document.getElementById('date-heading');
  const dayLink = document.getElementById('day-link') as HTMLAnchorElement;

  if (dateHeading) {
    const date = new Date(context.date + 'T12:00:00');
    dateHeading.textContent = date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  if (dayLink) {
    dayLink.href = context.dayLink;
  }

  // Render all-day events
  renderAllDayEvents(context.events.filter(e => e.isAllDay));

  // Render time grid
  renderTimeGrid(context);
}

function renderAllDayEvents(events: DayViewEvent[]): void {
  const allDaySection = document.getElementById('all-day-section');
  const allDayContainer = document.getElementById('all-day-events');

  if (!allDaySection || !allDayContainer) return;

  if (events.length > 0) {
    allDaySection.style.display = 'block';
    // Clear and rebuild using DOM methods
    allDayContainer.replaceChildren();

    for (const event of events) {
      const link = document.createElement('a');
      link.href = event.htmlLink;
      link.target = '_blank';
      link.className = `all-day-event event-color-${event.colorId || 'default'}`;
      link.textContent = event.summary;
      allDayContainer.appendChild(link);
    }
  } else {
    allDaySection.style.display = 'none';
  }
}

function renderTimeGrid(context: DayContext): void {
  const timeGrid = document.getElementById('time-grid');
  if (!timeGrid) return;

  const { startHour, endHour } = context.timeRange;
  const timedEvents = context.events.filter(e => !e.isAllDay);

  // Clear grid
  timeGrid.replaceChildren();

  // Create hour rows
  for (let hour = startHour; hour < endHour; hour++) {
    const row = document.createElement('div');
    row.className = 'time-row';
    row.dataset.hour = String(hour);

    const label = document.createElement('div');
    label.className = 'time-label';
    label.textContent = formatHour(hour);

    const slot = document.createElement('div');
    slot.className = 'time-slot';

    row.appendChild(label);
    row.appendChild(slot);
    timeGrid.appendChild(row);
  }

  // Position events
  const firstSlot = timeGrid.querySelector('.time-slot');
  if (!firstSlot) return;

  for (const event of timedEvents) {
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);

    const startHourNum = startDate.getHours() + startDate.getMinutes() / 60;
    const endHourNum = endDate.getHours() + endDate.getMinutes() / 60;

    // Calculate position relative to grid
    const top = (startHourNum - startHour) * 48; // 48px per hour
    const height = Math.max((endHourNum - startHourNum) * 48, 24); // Min height 24px

    const eventEl = document.createElement('a');
    eventEl.href = event.htmlLink;
    eventEl.target = '_blank';
    eventEl.className = `event-block event-color-${event.colorId || 'default'}`;
    eventEl.style.top = `${top}px`;
    eventEl.style.height = `${height}px`;

    const titleDiv = document.createElement('div');
    titleDiv.className = 'event-title';
    titleDiv.textContent = event.summary;

    const timeDiv = document.createElement('div');
    timeDiv.className = 'event-time';
    timeDiv.textContent = `${formatTime(startDate)} - ${formatTime(endDate)}`;

    eventEl.appendChild(titleDiv);
    eventEl.appendChild(timeDiv);

    if (event.location) {
      const locationDiv = document.createElement('div');
      locationDiv.className = 'event-location';
      locationDiv.textContent = event.location;
      eventEl.appendChild(locationDiv);
    }

    firstSlot.appendChild(eventEl);
  }
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
```

**Step 5: Build the UI**

Run: `npm run build:ui`
Expected: Creates `build/ui/day-view.html`

**Step 6: Commit**

```bash
git add src/ui/
git commit -m "feat: add day view UI component"
```

---

## Task 6: Register UI Resource on Server

**Files:**
- Create: `src/ui/register-ui-resources.ts`
- Modify: `src/server.ts`

**Step 1: Create resource registration module**

Create `src/ui/register-ui-resources.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DAY_VIEW_RESOURCE_URI = 'ui://calendar/day-view.html';
const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Registers MCP Apps UI resources with the server
 */
export async function registerUIResources(server: McpServer): Promise<void> {
  // Register the day view resource
  server.resource(
    DAY_VIEW_RESOURCE_URI,
    DAY_VIEW_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const htmlPath = join(__dirname, '../build/ui/day-view.html');
      try {
        const html = await fs.readFile(htmlPath, 'utf-8');
        return {
          contents: [{
            uri: DAY_VIEW_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          }],
        };
      } catch (error) {
        // Return placeholder if UI not built
        return {
          contents: [{
            uri: DAY_VIEW_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: '<html><body>Day view UI not available. Run npm run build:ui</body></html>',
          }],
        };
      }
    }
  );
}
```

**Step 2: Import and call in server.ts**

In `src/server.ts`, add after line 11 (imports):

```typescript
import { registerUIResources } from './ui/register-ui-resources.js';
```

In `src/server.ts`, in the `initialize()` method, add after `this.registerTools();` (around line 56):

```typescript
    // 5. Register MCP Apps UI resources
    await registerUIResources(this.server);
```

**Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add src/ui/register-ui-resources.ts src/server.ts
git commit -m "feat: register day view UI resource with MCP server"
```

---

## Task 7: Update CreateEventHandler to Include Day Context

**Files:**
- Modify: `src/handlers/core/CreateEventHandler.ts`
- Modify: `src/types/structured-responses.ts`

**Step 1: Add dayContext to CreateEventResponse**

In `src/types/structured-responses.ts`, update the `CreateEventResponse` interface (around line 267):

```typescript
/**
 * Response format for creating a new event
 */
export interface CreateEventResponse {
  event: StructuredEvent;
  conflicts?: ConflictInfo[];
  duplicates?: DuplicateInfo[];
  warnings?: string[];
  /** Day context for MCP Apps UI visualization */
  dayContext?: import('./day-context.js').DayContext;
}
```

**Step 2: Update CreateEventHandler**

In `src/handlers/core/CreateEventHandler.ts`, add imports at top:

```typescript
import { DayContextService } from "../../services/day-context/index.js";
```

Add to the class (after `conflictDetectionService`):

```typescript
    private dayContextService: DayContextService;
```

In constructor, add:

```typescript
        this.dayContextService = new DayContextService();
```

In `runTool`, after `const event = await this.createEvent(...)` (around line 84), add logic to fetch day events and build context:

```typescript
        // Fetch surrounding events for day view
        const focusEventStructured = convertGoogleEventToStructured(event, resolvedCalendarId, selectedAccountId);
        let dayContext = undefined;
        try {
            const calendar = this.getCalendar(oauth2Client);
            const eventDate = event.start?.dateTime || event.start?.date || '';
            const dayStart = eventDate.split('T')[0] + 'T00:00:00';
            const dayEnd = eventDate.split('T')[0] + 'T23:59:59';

            const dayEventsResponse = await calendar.events.list({
                calendarId: resolvedCalendarId,
                timeMin: dayStart,
                timeMax: dayEnd,
                singleEvents: true,
                orderBy: 'startTime',
            });

            const dayEvents = (dayEventsResponse.data.items || [])
                .filter(e => e.id !== event.id)
                .map(e => convertGoogleEventToStructured(e, resolvedCalendarId, selectedAccountId));

            dayContext = this.dayContextService.buildDayContext(
                focusEventStructured,
                dayEvents,
                timezone
            );
        } catch {
            // Day context is optional - don't fail if we can't fetch it
        }
```

Update the response building (around line 88):

```typescript
        const response: CreateEventResponse = {
            event: focusEventStructured,
            conflicts: structuredConflicts.conflicts,
            duplicates: structuredConflicts.duplicates,
            warnings: createWarningsArray(conflicts),
            dayContext,
        };
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/handlers/core/CreateEventHandler.ts src/types/structured-responses.ts
git commit -m "feat: include day context in create-event response"
```

---

## Task 8: Update UpdateEventHandler to Include Day Context

**Files:**
- Modify: `src/handlers/core/UpdateEventHandler.ts`
- Modify: `src/types/structured-responses.ts`

**Step 1: Add dayContext to UpdateEventResponse**

In `src/types/structured-responses.ts`, update the `UpdateEventResponse` interface (around line 277):

```typescript
/**
 * Response format for updating an existing event
 */
export interface UpdateEventResponse {
  event: StructuredEvent;
  conflicts?: ConflictInfo[];
  warnings?: string[];
  /** Day context for MCP Apps UI visualization */
  dayContext?: import('./day-context.js').DayContext;
}
```

**Step 2: Update UpdateEventHandler**

Apply similar changes as CreateEventHandler:

Add imports:
```typescript
import { DayContextService } from "../../services/day-context/index.js";
```

Add to class:
```typescript
    private dayContextService: DayContextService;
```

In constructor:
```typescript
        this.dayContextService = new DayContextService();
```

After the event is updated, add day context fetching logic (similar pattern to CreateEventHandler).

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/handlers/core/UpdateEventHandler.ts src/types/structured-responses.ts
git commit -m "feat: include day context in update-event response"
```

---

## Task 9: Add _meta.ui to Tool Responses

**Files:**
- Modify: `src/utils/response-builder.ts`

**Step 1: Update createStructuredResponse to include UI metadata**

In `src/utils/response-builder.ts`, update the function:

```typescript
import { DAY_VIEW_RESOURCE_URI } from '../ui/register-ui-resources.js';

/**
 * Creates a structured JSON response for MCP tools
 * Optionally includes UI metadata for MCP Apps visualization
 */
export function createStructuredResponse<T>(
  data: T,
  options?: { includeUI?: boolean }
): CallToolResult {
  const result: CallToolResult = {
    content: [{
      type: "text",
      text: JSON.stringify(data)
    }]
  };

  // Add UI metadata if requested and data includes dayContext
  if (options?.includeUI && data && typeof data === 'object' && 'dayContext' in data) {
    (result as any)._meta = {
      ui: {
        resourceUri: DAY_VIEW_RESOURCE_URI
      }
    };
  }

  return result;
}
```

**Step 2: Update handler calls**

In `CreateEventHandler.ts`, update the return:
```typescript
return createStructuredResponse(response, { includeUI: true });
```

In `UpdateEventHandler.ts`, update the return:
```typescript
return createStructuredResponse(response, { includeUI: true });
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Build and verify**

Run: `npm run build`
Expected: Build completes successfully

**Step 5: Commit**

```bash
git add src/utils/response-builder.ts src/handlers/core/CreateEventHandler.ts src/handlers/core/UpdateEventHandler.ts
git commit -m "feat: add MCP Apps UI metadata to event responses"
```

---

## Task 10: Add Unit Tests for Day Context Integration

**Files:**
- Create: `src/tests/unit/handlers/CreateEventHandler.daycontext.test.ts`

**Step 1: Write integration test**

Create `src/tests/unit/handlers/CreateEventHandler.daycontext.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateEventHandler } from '../../../handlers/core/CreateEventHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { CalendarRegistry } from '../../../services/CalendarRegistry.js';

// Mock modules
vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        insert: vi.fn(),
        list: vi.fn()
      }
    }))
  },
  calendar_v3: {}
}));

vi.mock('../../../utils/event-id-validator.js');
vi.mock('../../../utils/datetime.js', () => ({
  createTimeObject: vi.fn((datetime, tz) => ({ dateTime: datetime, timeZone: tz }))
}));

describe('CreateEventHandler - Day Context', () => {
  let handler: CreateEventHandler;
  let mockOAuth2Client: OAuth2Client;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockCalendar: any;

  beforeEach(() => {
    CalendarRegistry.resetInstance();
    handler = new CreateEventHandler();
    mockOAuth2Client = new OAuth2Client();
    mockAccounts = new Map([['test', mockOAuth2Client]]);

    mockCalendar = {
      events: {
        insert: vi.fn(),
        list: vi.fn()
      }
    };

    vi.spyOn(handler as any, 'getCalendar').mockReturnValue(mockCalendar);
    vi.spyOn(handler as any, 'getCalendarTimezone').mockResolvedValue('America/Los_Angeles');
    vi.spyOn(handler as any, 'getClientWithAutoSelection').mockResolvedValue({
      client: mockOAuth2Client,
      accountId: 'test',
      calendarId: 'primary',
      wasAutoSelected: true
    });
  });

  it('should include dayContext in response when event is created', async () => {
    const createdEvent = {
      id: 'new-event-123',
      summary: 'Test Meeting',
      start: { dateTime: '2026-01-27T14:00:00' },
      end: { dateTime: '2026-01-27T15:00:00' },
      htmlLink: 'https://calendar.google.com/event?eid=123'
    };

    const existingEvents = {
      data: {
        items: [
          {
            id: 'existing-1',
            summary: 'Earlier Meeting',
            start: { dateTime: '2026-01-27T10:00:00' },
            end: { dateTime: '2026-01-27T11:00:00' },
            htmlLink: 'https://calendar.google.com/event?eid=existing-1'
          }
        ]
      }
    };

    mockCalendar.events.insert.mockResolvedValue({ data: createdEvent });
    mockCalendar.events.list.mockResolvedValue(existingEvents);

    // Mock conflict detection to return no conflicts
    vi.spyOn(handler as any, 'conflictDetectionService').mockReturnValue({
      checkConflicts: vi.fn().mockResolvedValue({
        hasConflicts: false,
        conflicts: [],
        duplicates: []
      })
    });

    const result = await handler.runTool({
      calendarId: 'primary',
      summary: 'Test Meeting',
      start: '2026-01-27T14:00:00',
      end: '2026-01-27T15:00:00'
    }, mockAccounts);

    const responseText = result.content[0];
    expect(responseText.type).toBe('text');

    const response = JSON.parse((responseText as any).text);
    expect(response.dayContext).toBeDefined();
    expect(response.dayContext.focusEventId).toBe('new-event-123');
    expect(response.dayContext.events.length).toBeGreaterThanOrEqual(1);
  });

  it('should include _meta.ui in response', async () => {
    const createdEvent = {
      id: 'new-event-123',
      summary: 'Test Meeting',
      start: { dateTime: '2026-01-27T14:00:00' },
      end: { dateTime: '2026-01-27T15:00:00' },
      htmlLink: 'https://calendar.google.com/event?eid=123'
    };

    mockCalendar.events.insert.mockResolvedValue({ data: createdEvent });
    mockCalendar.events.list.mockResolvedValue({ data: { items: [] } });

    vi.spyOn(handler as any, 'conflictDetectionService').mockReturnValue({
      checkConflicts: vi.fn().mockResolvedValue({
        hasConflicts: false,
        conflicts: [],
        duplicates: []
      })
    });

    const result = await handler.runTool({
      calendarId: 'primary',
      summary: 'Test Meeting',
      start: '2026-01-27T14:00:00',
      end: '2026-01-27T15:00:00'
    }, mockAccounts);

    expect((result as any)._meta).toBeDefined();
    expect((result as any)._meta.ui).toBeDefined();
    expect((result as any)._meta.ui.resourceUri).toBe('ui://calendar/day-view.html');
  });
});
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/tests/unit/handlers/CreateEventHandler.daycontext.test.ts
git commit -m "test: add unit tests for day context in CreateEventHandler"
```

---

## Task 11: Manual Testing

**Step 1: Build the project**

```bash
npm run build
```

**Step 2: Test with Claude Desktop (if available)**

Add to Claude Desktop config and test creating an event.

**Step 3: Test with basic-host (optional)**

Clone ext-apps repo and use the basic-host to test UI rendering.

**Step 4: Final commit if any fixes needed**

---

## Summary

This plan adds MCP Apps support to the Google Calendar MCP server with:

1. **Dependencies**: `@modelcontextprotocol/ext-apps`, Vite for UI bundling
2. **Day Context Service**: Builds context data for the day view
3. **Day View UI**: HTML/CSS/TS rendered in sandboxed iframe
4. **Handler Updates**: CreateEventHandler and UpdateEventHandler include day context
5. **UI Resource Registration**: Server serves the bundled UI HTML
6. **Tests**: Unit tests for DayContextService and handler integration

The UI shows a compact day view with:
- All-day events at top
- Time grid with events positioned by time
- Color coding by calendar
- Links to open events in Google Calendar
