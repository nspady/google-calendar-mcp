/**
 * DOM builder functions for creating event elements
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { DayViewEvent, MultiDayViewEvent, CalendarSummary } from './types.js';
import {
  formatTime,
  formatDuration,
  formatOverlapDuration,
  formatAllDayRange,
  formatMultiDayDate,
  formatCalendarName
} from './formatting.js';
import {
  getEventColorClass,
  openLink,
  isToday,
  computeCalendarSummary
} from './utilities.js';
import {
  calculateEventHeight,
  getEventDurationMinutes
} from './positioning.js';
import { eventsOverlap } from './overlap-detection.js';

/**
 * Create an event element (safe DOM methods, no innerHTML)
 * Uses click handlers with app.openLink() for sandboxed iframe compatibility
 */
export function createEventElement(
  event: DayViewEvent,
  isFocused: boolean,
  appInstance: App | null,
  isAllDay: boolean = false
): HTMLDivElement {
  const element = document.createElement('div');
  element.style.cursor = 'pointer';
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');

  // Build detailed tooltip
  const tooltipParts = [event.summary];
  if (!isAllDay) {
    tooltipParts.push(`${formatTime(event.start)} - ${formatTime(event.end)}`);
  }
  if (event.location) {
    tooltipParts.push(event.location);
  }
  tooltipParts.push('Click to open in Google Calendar');
  element.title = tooltipParts.join('\n');

  // Handle click to open in Google Calendar
  element.addEventListener('click', () => openLink(event.htmlLink, appInstance));
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLink(event.htmlLink, appInstance);
    }
  });

  const colorClass = getEventColorClass(event.colorId);

  if (isAllDay) {
    element.className = `all-day-event ${colorClass} ${isFocused ? 'focused' : ''}`.trim();
    element.textContent = event.summary;
  } else {
    element.className = `event-block ${colorClass} ${isFocused ? 'focused' : ''}`.trim();

    // Content wrapper for horizontal layout
    const contentDiv = document.createElement('div');
    contentDiv.className = 'event-content';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'event-title';
    titleDiv.textContent = event.summary;
    contentDiv.appendChild(titleDiv);

    const timeDiv = document.createElement('div');
    timeDiv.className = 'event-time';
    timeDiv.textContent = `${formatTime(event.start)} - ${formatTime(event.end)}`;
    contentDiv.appendChild(timeDiv);

    element.appendChild(contentDiv);

    if (event.location) {
      const locationDiv = document.createElement('div');
      locationDiv.className = 'event-location';
      locationDiv.textContent = event.location;
      element.appendChild(locationDiv);
    }
  }

  return element;
}

/**
 * Create an overlap group element that renders two overlapping events as a connected visual
 * Shows the first event, then the overlapping portion with both bars, then continuation of whichever event ends later
 */
export function createOverlapGroup(
  eventA: MultiDayViewEvent,
  eventB: MultiDayViewEvent,
  overlapMinutes: number,
  appInstance: App | null,
  focusEventId?: string
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'overlap-group';

  // Calculate which event ends later for proper bar styling
  const endA = new Date(eventA.end).getTime();
  const endB = new Date(eventB.end).getTime();
  const aEndsAfterB = endA > endB;

  // Add modifier class for CSS bar styling
  if (aEndsAfterB) {
    group.classList.add('first-continues');
  } else {
    group.classList.add('second-continues');
  }

  const colorA = eventA.backgroundColor || 'var(--accent-color)';
  const colorB = eventB.backgroundColor || 'var(--accent-color)';

  // Calculate timestamps
  const startA = new Date(eventA.start).getTime();
  const startB = new Date(eventB.start).getTime();

  // Calculate durations for tooltips
  const durationA = getEventDurationMinutes(eventA);
  const durationB = getEventDurationMinutes(eventB);

  // Calculate segment durations
  const beforeOverlapMinutes = Math.round((startB - startA) / (1000 * 60));
  // After overlap: time from when the shorter event ends to when the longer event ends
  const afterOverlapMinutes = aEndsAfterB
    ? Math.round((endA - endB) / (1000 * 60))  // A continues after B ends
    : Math.round((endB - endA) / (1000 * 60)); // B continues after A ends

  const { height: heightBeforeOverlap } = calculateEventHeight(Math.max(beforeOverlapMinutes, 15));
  const { height: heightOverlap } = calculateEventHeight(Math.max(overlapMinutes, 15));
  const { height: heightAfterOverlap, continues: continuesAfter } = calculateEventHeight(Math.max(afterOverlapMinutes, 15));

  // --- First Event (before overlap) ---
  const firstRow = document.createElement('div');
  firstRow.className = 'overlap-event-first';
  firstRow.style.minHeight = `${heightBeforeOverlap}px`;
  firstRow.setAttribute('role', 'button');
  firstRow.setAttribute('tabindex', '0');
  firstRow.title = `${eventA.summary}\n${formatTime(eventA.start)} - ${formatTime(eventA.end)} (${formatDuration(durationA)})\nClick to open in Google Calendar`;
  firstRow.addEventListener('click', () => openLink(eventA.htmlLink, appInstance));

  const barFirst = document.createElement('div');
  barFirst.className = 'overlap-bar-first';
  barFirst.style.backgroundColor = colorA;
  firstRow.appendChild(barFirst);

  const timeColFirst = document.createElement('div');
  timeColFirst.className = 'event-time-col';
  const startTimeA = document.createElement('div');
  startTimeA.textContent = formatTime(eventA.start);
  timeColFirst.appendChild(startTimeA);
  const endTimeA = document.createElement('div');
  endTimeA.className = 'event-end-time';
  endTimeA.textContent = formatTime(eventA.end);
  timeColFirst.appendChild(endTimeA);
  firstRow.appendChild(timeColFirst);

  const detailsFirst = document.createElement('div');
  detailsFirst.className = 'event-details';

  const titleRowFirst = document.createElement('div');
  titleRowFirst.className = 'event-item-title-row';
  const titleFirst = document.createElement('div');
  titleFirst.className = 'event-item-title';
  titleFirst.textContent = eventA.summary;
  titleRowFirst.appendChild(titleFirst);
  const calFirst = document.createElement('div');
  calFirst.className = 'event-item-calendar';
  calFirst.textContent = formatCalendarName(eventA.calendarId, eventA.calendarName);
  titleRowFirst.appendChild(calFirst);
  detailsFirst.appendChild(titleRowFirst);

  if (eventA.location) {
    const locFirst = document.createElement('div');
    locFirst.className = 'event-item-location';
    locFirst.textContent = eventA.location;
    detailsFirst.appendChild(locFirst);
  }
  firstRow.appendChild(detailsFirst);

  if (eventA.id === focusEventId) {
    firstRow.classList.add('focused');
  }

  group.appendChild(firstRow);

  // --- Overlap Region with Event B info ---
  const overlapRow = document.createElement('div');
  overlapRow.className = 'overlap-region overlap-region-with-event';
  overlapRow.style.minHeight = `${heightOverlap}px`;
  overlapRow.setAttribute('role', 'button');
  overlapRow.setAttribute('tabindex', '0');
  overlapRow.title = `${eventB.summary}\n${formatTime(eventB.start)} - ${formatTime(eventB.end)} (${formatDuration(durationB)})\nClick to open in Google Calendar`;
  overlapRow.addEventListener('click', () => openLink(eventB.htmlLink, appInstance));

  const overlapBars = document.createElement('div');
  overlapBars.className = 'overlap-bars';

  const barOverlapA = document.createElement('div');
  barOverlapA.className = 'overlap-bar bar-first';
  barOverlapA.style.backgroundColor = colorA;
  overlapBars.appendChild(barOverlapA);

  const barOverlapB = document.createElement('div');
  barOverlapB.className = 'overlap-bar bar-second';
  barOverlapB.style.backgroundColor = colorB;
  overlapBars.appendChild(barOverlapB);

  overlapRow.appendChild(overlapBars);

  // Overlap duration label (positioned after bars for prominence)
  const overlapLabel = document.createElement('div');
  overlapLabel.className = 'overlap-label';
  overlapLabel.textContent = formatOverlapDuration(overlapMinutes);
  overlapRow.appendChild(overlapLabel);

  // Event B time column
  const timeColB = document.createElement('div');
  timeColB.className = 'event-time-col';
  const startTimeBEl = document.createElement('div');
  startTimeBEl.textContent = formatTime(eventB.start);
  timeColB.appendChild(startTimeBEl);
  const endTimeBEl = document.createElement('div');
  endTimeBEl.className = 'event-end-time';
  endTimeBEl.textContent = formatTime(eventB.end);
  timeColB.appendChild(endTimeBEl);
  overlapRow.appendChild(timeColB);

  // Event B details
  const detailsB = document.createElement('div');
  detailsB.className = 'event-details';

  const titleRowB = document.createElement('div');
  titleRowB.className = 'event-item-title-row';
  const titleB = document.createElement('div');
  titleB.className = 'event-item-title';
  titleB.textContent = eventB.summary;
  titleRowB.appendChild(titleB);
  const calB = document.createElement('div');
  calB.className = 'event-item-calendar';
  calB.textContent = formatCalendarName(eventB.calendarId, eventB.calendarName);
  titleRowB.appendChild(calB);
  detailsB.appendChild(titleRowB);

  if (eventB.location) {
    const locB = document.createElement('div');
    locB.className = 'event-item-location';
    locB.textContent = eventB.location;
    detailsB.appendChild(locB);
  }
  overlapRow.appendChild(detailsB);

  if (eventB.id === focusEventId) {
    overlapRow.classList.add('focused');
  }

  group.appendChild(overlapRow);

  // --- Continuation section (whichever event ends later) ---
  if (afterOverlapMinutes > 0) {
    if (aEndsAfterB) {
      // Event A continues after Event B ends - show A's bar continuing
      const continuationRow = document.createElement('div');
      continuationRow.className = 'overlap-event-continuation';
      continuationRow.style.minHeight = `${heightAfterOverlap}px`;
      continuationRow.setAttribute('role', 'button');
      continuationRow.setAttribute('tabindex', '0');
      continuationRow.title = `${eventA.summary} continues\n${formatTime(eventA.start)} - ${formatTime(eventA.end)} (${formatDuration(durationA)})\nClick to open in Google Calendar`;
      continuationRow.addEventListener('click', () => openLink(eventA.htmlLink, appInstance));

      const barContinuation = document.createElement('div');
      barContinuation.className = 'overlap-bar-continuation';
      barContinuation.style.backgroundColor = colorA;

      // Add continues indicator if the continuation is capped
      if (continuesAfter) {
        barContinuation.classList.add('event-continues');
        const dashes = document.createElement('div');
        dashes.className = 'event-continues-dashes';
        for (let d = 0; d < 2; d++) {
          const dash = document.createElement('div');
          dash.className = 'dash';
          dash.style.backgroundColor = colorA;
          dashes.appendChild(dash);
        }
        barContinuation.appendChild(dashes);
      }

      continuationRow.appendChild(barContinuation);

      // Show "continues until X" label
      const continueLabel = document.createElement('div');
      continueLabel.className = 'continuation-label';
      continueLabel.textContent = `continues until ${formatTime(eventA.end)}`;
      continuationRow.appendChild(continueLabel);

      if (eventA.id === focusEventId) {
        continuationRow.classList.add('focused');
      }

      group.appendChild(continuationRow);
    } else {
      // Event B continues after Event A ends - show B's continuation (original behavior)
      const secondRow = document.createElement('div');
      secondRow.className = 'overlap-event-second';
      secondRow.style.minHeight = `${heightAfterOverlap}px`;
      secondRow.setAttribute('role', 'button');
      secondRow.setAttribute('tabindex', '0');
      secondRow.title = `${eventB.summary}\n${formatTime(eventB.start)} - ${formatTime(eventB.end)} (${formatDuration(durationB)})\nClick to open in Google Calendar`;
      secondRow.addEventListener('click', () => openLink(eventB.htmlLink, appInstance));

      const barSecond = document.createElement('div');
      barSecond.className = 'overlap-bar-second';
      barSecond.style.backgroundColor = colorB;

      // Add continues indicator if needed
      if (continuesAfter) {
        barSecond.classList.add('event-continues');
        const dashes = document.createElement('div');
        dashes.className = 'event-continues-dashes';
        for (let d = 0; d < 2; d++) {
          const dash = document.createElement('div');
          dash.className = 'dash';
          dash.style.backgroundColor = colorB;
          dashes.appendChild(dash);
        }
        barSecond.appendChild(dashes);
      }

      secondRow.appendChild(barSecond);

      // Show "continues until X" label
      const continueLabel = document.createElement('div');
      continueLabel.className = 'continuation-label';
      continueLabel.textContent = `continues until ${formatTime(eventB.end)}`;
      secondRow.appendChild(continueLabel);

      if (eventB.id === focusEventId) {
        secondRow.classList.add('focused');
      }

      group.appendChild(secondRow);
    }
  }

  return group;
}

/**
 * Create calendar summary element for date header
 */
export function createCalendarSummary(events: MultiDayViewEvent[]): HTMLDivElement {
  const summary = computeCalendarSummary(events);

  const container = document.createElement('div');
  container.className = 'calendar-summary';

  for (const cal of summary) {
    const item = document.createElement('div');
    item.className = 'calendar-summary-item';

    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.backgroundColor = cal.backgroundColor;
    item.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'calendar-name';
    name.textContent = cal.calendarName;
    item.appendChild(name);

    const count = document.createElement('span');
    count.className = 'calendar-count';
    count.textContent = `· ${cal.count}`;
    item.appendChild(count);

    container.appendChild(item);
  }

  return container;
}

/**
 * Create an event list item element for multi-day view
 */
export function createEventListItem(
  event: MultiDayViewEvent,
  isFocused: boolean,
  appInstance: App | null
): HTMLDivElement {
  const element = document.createElement('div');
  element.className = `event-list-item ${isFocused ? 'focused' : ''}`.trim();
  element.style.cursor = 'pointer';
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');

  // Detailed tooltip
  const tooltipParts = [event.summary];
  if (event.isAllDay) {
    tooltipParts.push('All day');
  } else {
    tooltipParts.push(`${formatTime(event.start)} - ${formatTime(event.end)}`);
  }
  if (event.location) tooltipParts.push(event.location);
  tooltipParts.push('Click to open in Google Calendar');
  element.title = tooltipParts.join('\n');

  // Handle click to open in Google Calendar
  element.addEventListener('click', () => openLink(event.htmlLink, appInstance));
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLink(event.htmlLink, appInstance);
    }
  });

  // Color dot
  const colorDot = document.createElement('div');
  colorDot.className = 'color-dot';
  if (event.backgroundColor) {
    colorDot.style.backgroundColor = event.backgroundColor;
  }
  element.appendChild(colorDot);

  // Content container
  const content = document.createElement('div');
  content.className = 'event-list-content';

  // Title
  const titleDiv = document.createElement('div');
  titleDiv.className = 'event-list-title';
  titleDiv.textContent = event.summary;
  content.appendChild(titleDiv);

  // Time
  const timeDiv = document.createElement('div');
  timeDiv.className = 'event-list-time';
  timeDiv.textContent = formatTime(event.start) + ' - ' + formatTime(event.end);
  if (event.isAllDay) {
    timeDiv.textContent = 'All day';
  }
  content.appendChild(timeDiv);

  // Location (if present)
  if (event.location) {
    const locationDiv = document.createElement('div');
    locationDiv.className = 'event-list-location';
    locationDiv.textContent = event.location;
    content.appendChild(locationDiv);
  }

  // Account and calendar info
  const sourceDiv = document.createElement('div');
  sourceDiv.className = 'event-list-source';
  const calendarName = formatCalendarName(event.calendarId, event.calendarName);
  if (event.accountId) {
    sourceDiv.textContent = `${event.accountId} · ${calendarName}`;
  } else {
    sourceDiv.textContent = calendarName;
  }
  content.appendChild(sourceDiv);

  element.appendChild(content);

  return element;
}

/**
 * Create an event list element for an expanded day in multi-day view (compact list instead of time grid)
 */
export function createDayEventList(
  events: MultiDayViewEvent[],
  appInstance: App | null,
  focusEventId?: string
): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'expanded-day-list';

  const allDayEvents = events.filter(e => e.isAllDay);
  const timedEvents = events.filter(e => !e.isAllDay).sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  // All-day events section
  if (allDayEvents.length > 0) {
    const allDaySection = document.createElement('div');
    allDaySection.className = 'all-day-list-section';

    const allDayLabel = document.createElement('div');
    allDayLabel.className = 'all-day-list-label';
    allDayLabel.textContent = 'All day';
    allDaySection.appendChild(allDayLabel);

    for (const event of allDayEvents) {
      const isFocused = event.id === focusEventId;
      const allDayRange = formatAllDayRange(event.start, event.end);

      const item = document.createElement('div');
      item.className = `expanded-event-item ${isFocused ? 'focused' : ''}`.trim();
      item.style.cursor = 'pointer';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      // Tooltip
      const tooltipParts = [event.summary];
      tooltipParts.push(allDayRange.dateRange ? `All day (${allDayRange.dateRange})` : 'All day');
      if (event.location) tooltipParts.push(event.location);
      tooltipParts.push('Click to open in Google Calendar');
      item.title = tooltipParts.join('\n');

      item.addEventListener('click', () => openLink(event.htmlLink, appInstance));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openLink(event.htmlLink, appInstance);
        }
      });

      // Color bar
      const colorBar = document.createElement('div');
      colorBar.className = 'event-color-bar';
      colorBar.style.backgroundColor = event.backgroundColor || 'var(--accent-color)';
      item.appendChild(colorBar);

      // Time column - show date or date range
      const timeCol = document.createElement('div');
      timeCol.className = 'event-time-col';
      timeCol.textContent = allDayRange.dateRange;
      item.appendChild(timeCol);

      // Event details
      const details = document.createElement('div');
      details.className = 'event-details';

      const title = document.createElement('div');
      title.className = 'event-item-title';
      title.textContent = event.summary;
      details.appendChild(title);

      if (event.location) {
        const location = document.createElement('div');
        location.className = 'event-item-location';
        location.textContent = event.location;
        details.appendChild(location);
      }

      item.appendChild(details);
      allDaySection.appendChild(item);
    }

    container.appendChild(allDaySection);
  }

  // Timed events with overlap detection and proportional heights
  // Track which events have been rendered (to skip events that were part of an overlap group)
  const renderedEventIds = new Set<string>();

  for (let i = 0; i < timedEvents.length; i++) {
    const event = timedEvents[i];

    // Skip if already rendered as part of an overlap group
    if (renderedEventIds.has(event.id)) {
      continue;
    }

    const nextEvent = i < timedEvents.length - 1 ? timedEvents[i + 1] : null;

    // Check for overlap with next event
    const overlapWithNext = nextEvent ? eventsOverlap(event, nextEvent) : { overlaps: false, overlapMinutes: 0 };

    // If overlapping with next, render as an overlap group
    if (overlapWithNext.overlaps && nextEvent) {
      const overlapGroup = createOverlapGroup(event, nextEvent, overlapWithNext.overlapMinutes, appInstance, focusEventId);
      container.appendChild(overlapGroup);
      // Mark both events as rendered
      renderedEventIds.add(event.id);
      renderedEventIds.add(nextEvent.id);
      continue;
    }

    // Otherwise render as a regular event row
    const durationMinutes = getEventDurationMinutes(event);
    const { height, continues } = calculateEventHeight(durationMinutes);

    const isFocused = event.id === focusEventId;
    const item = document.createElement('div');

    // Build class list
    const classes = ['expanded-event-item'];
    if (isFocused) classes.push('focused');
    if (continues) classes.push('event-continues-row');
    item.className = classes.join(' ');

    // Apply proportional height
    item.style.minHeight = `${height}px`;

    item.style.cursor = 'pointer';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    // Detailed tooltip
    const tooltipParts = [event.summary];
    tooltipParts.push(`${formatTime(event.start)} - ${formatTime(event.end)} (${formatDuration(durationMinutes)})`);
    if (event.location) tooltipParts.push(event.location);
    tooltipParts.push('Click to open in Google Calendar');
    item.title = tooltipParts.join('\n');

    item.addEventListener('click', () => openLink(event.htmlLink, appInstance));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLink(event.htmlLink, appInstance);
      }
    });

    // Color indicator bar
    const colorBar = document.createElement('div');
    const eventColor = event.backgroundColor || 'var(--accent-color)';
    colorBar.className = 'event-color-bar';
    colorBar.style.backgroundColor = eventColor;

    // Add "continues" indicator for events longer than 3 hours
    if (continues) {
      colorBar.classList.add('event-continues');
      const dashes = document.createElement('div');
      dashes.className = 'event-continues-dashes';
      for (let d = 0; d < 2; d++) {
        const dash = document.createElement('div');
        dash.className = 'dash';
        dash.style.backgroundColor = eventColor;
        dashes.appendChild(dash);
      }
      colorBar.appendChild(dashes);
    }

    item.appendChild(colorBar);

    // Time column
    const timeCol = document.createElement('div');
    timeCol.className = 'event-time-col';
    const startTime = document.createElement('div');
    startTime.textContent = formatTime(event.start);
    timeCol.appendChild(startTime);
    const endTime = document.createElement('div');
    endTime.className = 'event-end-time';
    endTime.textContent = formatTime(event.end);
    timeCol.appendChild(endTime);
    if (continues) {
      const durationLabel = document.createElement('div');
      durationLabel.className = 'event-duration-label';
      durationLabel.textContent = formatDuration(durationMinutes);
      timeCol.appendChild(durationLabel);
    }
    item.appendChild(timeCol);

    // Event details
    const details = document.createElement('div');
    details.className = 'event-details';

    // Title row with calendar label inline
    const titleRow = document.createElement('div');
    titleRow.className = 'event-item-title-row';

    const title = document.createElement('div');
    title.className = 'event-item-title';
    title.textContent = event.summary;
    titleRow.appendChild(title);

    const calendarLabel = document.createElement('div');
    calendarLabel.className = 'event-item-calendar';
    calendarLabel.textContent = formatCalendarName(event.calendarId, event.calendarName);
    titleRow.appendChild(calendarLabel);

    details.appendChild(titleRow);

    if (event.location) {
      const location = document.createElement('div');
      location.className = 'event-item-location';
      location.textContent = event.location;
      details.appendChild(location);
    }

    item.appendChild(details);
    container.appendChild(item);
  }

  return container;
}

/**
 * Create a date group element for multi-day view
 */
export function createDateGroup(
  dateStr: string,
  events: MultiDayViewEvent[],
  appInstance: App | null,
  toggleDayExpanded: (dateStr: string) => void,
  focusEventId?: string
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'date-group';
  group.setAttribute('data-date', dateStr);

  // Date header (clickable to expand/collapse)
  const header = document.createElement('div');
  header.className = 'date-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');

  const { day, monthYearDay } = formatMultiDayDate(dateStr);

  // Day number (circled if today)
  const dayNumber = document.createElement('div');
  dayNumber.className = `date-number ${isToday(dateStr) ? 'today' : ''}`.trim();
  dayNumber.textContent = day;
  header.appendChild(dayNumber);

  // Month, year, weekday
  const dateText = document.createElement('div');
  dateText.className = 'date-text';
  dateText.textContent = monthYearDay;
  header.appendChild(dateText);

  // Calendar summary (inline in header)
  const calendarSummary = createCalendarSummary(events);
  header.appendChild(calendarSummary);

  // Expand icon (using SVG for the chevron)
  const expandIcon = document.createElement('div');
  expandIcon.className = 'date-expand-icon';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '6 9 12 15 18 9');
  svg.appendChild(polyline);
  expandIcon.appendChild(svg);
  header.appendChild(expandIcon);

  // Click handler for expand/collapse
  header.addEventListener('click', () => {
    toggleDayExpanded(dateStr);
  });

  // Keyboard handler
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleDayExpanded(dateStr);
    }
  });

  group.appendChild(header);

  // Day event list (starts collapsed)
  const eventsList = createDayEventList(events, appInstance, focusEventId);
  eventsList.className = 'date-events collapsed';
  group.appendChild(eventsList);

  return group;
}
