# Compact Multi-Day View Design

## Overview

Enhance the multi-day view to show days collapsed by default with a calendar summary. Users can expand individual days to see the full event list.

## Collapsed Day State

Each collapsed day displays:
- **Date header**: day number, month/year, weekday
- **Calendar summary row**: For each calendar with events that day:
  - Color dot (using `backgroundColor` from event data)
  - Calendar name
  - Event count for that calendar
- **Expand indicator**: Chevron icon that rotates when expanded

Example:
```
2   FEB 2026, MON                                    ▼
    🟠 work · 3    🔵 personal · 5    🟢 family · 2
```

## Expanded Day State

When expanded:
- Chevron rotates (▲)
- Shows the existing event list items below the summary
- Calendar summary row remains visible as context

## Interaction & State

- Clicking date header row toggles that day's expanded state
- Each day's state is independent
- All days start collapsed
- State resets when new data loads

Accessibility:
- `role="button"` and `tabindex="0"` on date header
- Keyboard: Enter/Space toggles expand
- `aria-expanded` attribute reflects state

## Calendar Summary Computation

Group events by calendar and count:

```typescript
function computeCalendarSummary(events: MultiDayViewEvent[]): CalendarSummary[] {
  const byCalendar = new Map<string, {
    calendarId: string;
    calendarName: string;
    backgroundColor: string;
    count: number;
  }>();

  for (const event of events) {
    const key = event.calendarId;
    const existing = byCalendar.get(key);
    if (existing) {
      existing.count++;
    } else {
      byCalendar.set(key, {
        calendarId: event.calendarId,
        calendarName: event.calendarName || formatCalendarName(event.calendarId),
        backgroundColor: event.backgroundColor || 'var(--accent-color)',
        count: 1
      });
    }
  }

  return Array.from(byCalendar.values());
}
```

## HTML Structure

```html
<div class="date-group">
  <div class="date-header" role="button" tabindex="0" aria-expanded="false">
    <div class="date-number">2</div>
    <div class="date-text">FEB 2026, MON</div>
    <div class="date-expand-icon">▼</div>
  </div>
  <div class="calendar-summary">
    <div class="calendar-summary-item">
      <span class="color-dot" style="background: #f6911e"></span>
      <span class="calendar-name">work</span>
      <span class="calendar-count">· 3</span>
    </div>
  </div>
  <div class="date-events" style="display: none;">
    <!-- event list items -->
  </div>
</div>
```

## CSS Additions

- `.date-header`: `cursor: pointer`, hover state
- `.date-expand-icon`: rotation transition on expand
- `.calendar-summary`: flex row with wrap
- `.calendar-summary-item`: gap between dot, name, count
- `.date-events`: toggles `display: none/block`
