import { App, applyHostStyleVariables, applyHostFonts, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

/**
 * Day View Event interface matching DayViewEvent from types
 */
interface DayViewEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  colorId?: string;
  calendarId: string;
  accountId?: string;
}

/**
 * Day Context interface matching DayContext from types
 */
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

/**
 * Multi-Day View Event interface matching MultiDayViewEvent from types
 */
interface MultiDayViewEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  htmlLink: string;
  backgroundColor?: string;
  foregroundColor?: string;
  calendarId: string;
  calendarName?: string;
  accountId?: string;
}

/**
 * Multi-Day Context interface matching MultiDayContext from types
 */
interface MultiDayContext {
  dates: string[];
  timezone: string;
  eventsByDate: Record<string, MultiDayViewEvent[]>;
  totalEventCount: number;
  focusEventId?: string;
  timeRange?: { start: string; end: string };
  query?: string;
  calendarLink: string;
}

/**
 * Calendar summary for collapsed day view
 */
interface CalendarSummary {
  calendarId: string;
  calendarName: string;
  backgroundColor: string;
  count: number;
}

// DOM element references - Day view
const dayViewContainer = document.getElementById('day-view-container') as HTMLDivElement;
const dateHeading = document.getElementById('date-heading') as HTMLHeadingElement;
const dayLink = document.getElementById('day-link') as HTMLAnchorElement;
const allDaySection = document.getElementById('all-day-section') as HTMLDivElement;
const allDayEvents = document.getElementById('all-day-events') as HTMLDivElement;
const timeGrid = document.getElementById('time-grid') as HTMLDivElement;
const expandToggle = document.getElementById('expand-toggle') as HTMLButtonElement;
const toggleText = document.getElementById('toggle-text') as HTMLSpanElement;

// DOM element references - Multi-day view
const multiDayViewContainer = document.getElementById('multi-day-view-container') as HTMLDivElement;
const multiDayHeading = document.getElementById('multi-day-heading') as HTMLHeadingElement;
const multiDaySubheading = document.getElementById('multi-day-subheading') as HTMLDivElement;
const multiDayLink = document.getElementById('multi-day-link') as HTMLAnchorElement;
const multiDayEventsList = document.getElementById('multi-day-events-list') as HTMLDivElement;

// Global app instance for opening links (sandboxed iframe requires app.openLink)
let appInstance: App | null = null;

// Compact/expanded state for single-day view
let isExpanded = false;

// Expanded days state for multi-day view (tracks which dates are expanded)
let expandedDays: Set<string> = new Set();

// Host context for locale/timezone formatting
let hostLocale: string | undefined;
let hostTimeZone: string | undefined;

/**
 * Format hour for display (e.g., "9 AM", "12 PM", "5 PM")
 */
function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Format time for event display (e.g., "9:00 AM", "2:30 PM")
 * Uses host locale when available for localized formatting
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  // Use Intl.DateTimeFormat with host locale if available
  if (hostLocale) {
    return date.toLocaleTimeString(hostLocale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: hostTimeZone
    });
  }
  // Fallback to manual formatting
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHour}:${displayMinutes} ${ampm}`;
}

/**
 * Format date for heading (e.g., "Tuesday, January 27, 2025")
 * Uses host locale when available for localized formatting
 */
function formatDateHeading(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(hostLocale || 'en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Format all-day event date range
 * Returns single date for single-day events, or date range for multi-day
 */
function formatAllDayRange(startStr: string, endStr: string): { text: string; dateRange: string; isMultiDay: boolean } {
  // All-day events: start is inclusive, end is exclusive (next day)
  const start = new Date(startStr);
  const end = new Date(endStr);

  // Calculate the actual end date (exclusive end means subtract 1 day for display)
  const actualEnd = new Date(end);
  actualEnd.setDate(actualEnd.getDate() - 1);

  const formatOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startFormatted = start.toLocaleDateString(hostLocale || 'en-US', formatOptions);

  // Check if it's a single day event
  if (start.toDateString() === actualEnd.toDateString()) {
    return { text: 'All day', dateRange: startFormatted, isMultiDay: false };
  }

  // Multi-day event - format as date range with en-dash
  const endFormatted = actualEnd.toLocaleDateString(hostLocale || 'en-US', formatOptions);
  return { text: 'All day', dateRange: `${startFormatted}–${endFormatted}`, isMultiDay: true };
}

/**
 * Get event color class based on colorId
 */
function getEventColorClass(colorId?: string): string {
  if (!colorId) return '';
  const num = parseInt(colorId, 10);
  if (num >= 1 && num <= 11) {
    return `event-color-${num}`;
  }
  return '';
}

/**
 * Calculate event position in time grid
 */
function calculateEventPosition(
  event: DayViewEvent,
  startHour: number,
  endHour: number
): { top: string; height: string } {
  const ROW_HEIGHT = 48; // matches CSS --row-height
  const totalHours = endHour - startHour;

  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

  const startHourFloat = eventStart.getHours() + eventStart.getMinutes() / 60;
  const endHourFloat = eventEnd.getHours() + eventEnd.getMinutes() / 60;

  // Clamp to visible range
  const clampedStart = Math.max(startHourFloat, startHour);
  const clampedEnd = Math.min(endHourFloat, endHour);

  const topOffset = (clampedStart - startHour) * ROW_HEIGHT;
  const height = Math.max((clampedEnd - clampedStart) * ROW_HEIGHT, 24); // min 24px

  return {
    top: `${topOffset}px`,
    height: `${height}px`
  };
}

/**
 * Open a link using the MCP Apps API (required in sandboxed iframe)
 * The API expects an object with url property, not a raw string
 */
function openLink(url: string): void {
  if (appInstance) {
    // MCP Apps openLink expects { url: string }, not a raw string
    appInstance.openLink({ url }).catch((err) => {
      console.error('Failed to open link:', err);
    });
  } else {
    // Fallback for testing outside iframe
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Toggle between compact and expanded view
 */
function toggleExpanded(): void {
  isExpanded = !isExpanded;

  if (isExpanded) {
    timeGrid.classList.remove('compact');
    expandToggle.classList.add('expanded');
    toggleText.textContent = 'Show less';
  } else {
    timeGrid.classList.add('compact');
    expandToggle.classList.remove('expanded');
    toggleText.textContent = 'Show more';
  }

  // Notify host of size change
  if (appInstance) {
    // Let auto-resize handle it, or explicitly send size
    const height = document.documentElement.scrollHeight;
    appInstance.sendSizeChanged({ height }).catch(() => {
      // Ignore errors - host may not support this
    });
  }
}

/**
 * Create an event element (safe DOM methods, no innerHTML)
 * Uses click handlers with app.openLink() for sandboxed iframe compatibility
 */
function createEventElement(
  event: DayViewEvent,
  isFocused: boolean,
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
  element.addEventListener('click', () => openLink(event.htmlLink));
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLink(event.htmlLink);
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
 * Render all-day events section
 */
function renderAllDayEvents(events: DayViewEvent[], focusEventId: string): void {
  const allDayEvts = events.filter(e => e.isAllDay);

  if (allDayEvts.length === 0) {
    allDaySection.style.display = 'none';
    return;
  }

  allDaySection.style.display = 'flex';

  // Clear existing events
  while (allDayEvents.firstChild) {
    allDayEvents.removeChild(allDayEvents.firstChild);
  }

  // Add events
  for (const event of allDayEvts) {
    const isFocused = event.id === focusEventId;
    const element = createEventElement(event, isFocused, true);
    allDayEvents.appendChild(element);
  }
}

/**
 * Render time grid with events
 */
function renderTimeGrid(context: DayContext): void {
  const { events, focusEventId, timeRange } = context;
  const { startHour, endHour } = timeRange;

  // Clear existing content
  while (timeGrid.firstChild) {
    timeGrid.removeChild(timeGrid.firstChild);
  }

  // Filter timed events (not all-day)
  const timedEvents = events.filter(e => !e.isAllDay);

  // Create time rows
  for (let hour = startHour; hour < endHour; hour++) {
    const row = document.createElement('div');
    row.className = 'time-row';

    const hourLabel = document.createElement('div');
    hourLabel.className = 'hour-label';
    hourLabel.textContent = formatHour(hour);
    row.appendChild(hourLabel);

    const timeSlot = document.createElement('div');
    timeSlot.className = 'time-slot';
    row.appendChild(timeSlot);

    timeGrid.appendChild(row);
  }

  // Create events container (positioned over the grid)
  const eventsContainer = document.createElement('div');
  eventsContainer.style.position = 'absolute';
  eventsContainer.style.top = '0';
  eventsContainer.style.left = 'var(--hour-width)';
  eventsContainer.style.right = '0';
  eventsContainer.style.bottom = '0';
  eventsContainer.style.pointerEvents = 'none';

  // Position and add events
  for (const event of timedEvents) {
    const isFocused = event.id === focusEventId;
    const element = createEventElement(event, isFocused);
    const position = calculateEventPosition(event, startHour, endHour);

    element.style.top = position.top;
    element.style.height = position.height;
    element.style.pointerEvents = 'auto';

    eventsContainer.appendChild(element);
  }

  // Make time grid position relative for absolute positioning of events
  timeGrid.style.position = 'relative';
  timeGrid.appendChild(eventsContainer);
}

/**
 * Main render function for single-day view
 */
function renderDayView(context: DayContext): void {
  // Show day view, hide multi-day view
  showDayView();

  // Update header
  dateHeading.textContent = formatDateHeading(context.date);

  // Show and set up "Open in Calendar" button with click handler (sandboxed iframe)
  dayLink.style.display = '';
  dayLink.href = '#';
  dayLink.onclick = (e) => {
    e.preventDefault();
    openLink(context.dayLink);
  };

  // Render all-day events
  renderAllDayEvents(context.events, context.focusEventId);

  // Render time grid
  renderTimeGrid(context);

  // Show expand toggle and set up handler
  expandToggle.style.display = '';
  expandToggle.onclick = toggleExpanded;

  // Reset to compact state on new data
  isExpanded = false;
  timeGrid.classList.add('compact');
  expandToggle.classList.remove('expanded');
  toggleText.textContent = 'Show more';

  // Scroll focused event into view (after a short delay for render)
  setTimeout(() => {
    const focusedElement = document.querySelector('.focused');
    if (focusedElement) {
      focusedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

/**
 * Extract day context from tool result
 */
function extractDayContext(params: { content?: Array<{ type: string; text?: string }> }): DayContext | null {
  if (!params.content) return null;

  for (const block of params.content) {
    if (block.type === 'text' && block.text) {
      try {
        const parsed = JSON.parse(block.text);
        if (parsed.dayContext) {
          return parsed.dayContext as DayContext;
        }
      } catch {
        // Not JSON or doesn't have dayContext, continue
      }
    }
  }

  return null;
}

/**
 * Extract multi-day context from tool result
 */
function extractMultiDayContext(params: { content?: Array<{ type: string; text?: string }> }): MultiDayContext | null {
  if (!params.content) return null;

  for (const block of params.content) {
    if (block.type === 'text' && block.text) {
      try {
        const parsed = JSON.parse(block.text);
        if (parsed.multiDayContext) {
          return parsed.multiDayContext as MultiDayContext;
        }
      } catch {
        // Not JSON or doesn't have multiDayContext, continue
      }
    }
  }

  return null;
}

/**
 * Format date for multi-day view header (e.g., "22 OCT 2025, WED")
 */
function formatMultiDayDate(dateStr: string): { day: string; monthYearDay: string } {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDate().toString();
  const month = date.toLocaleDateString(hostLocale || 'en-US', { month: 'short' }).toUpperCase();
  const year = date.getFullYear();
  const weekday = date.toLocaleDateString(hostLocale || 'en-US', { weekday: 'short' }).toUpperCase();

  return {
    day,
    monthYearDay: `${month} ${year}, ${weekday}`
  };
}

/**
 * Check if a date string is today
 */
function isToday(dateStr: string): boolean {
  const today = new Date();
  const date = new Date(dateStr + 'T00:00:00');
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

/**
 * Format time for multi-day event display (e.g., "3:30 - 5pm")
 */
function formatMultiDayEventTime(event: MultiDayViewEvent): string {
  if (event.isAllDay) {
    return 'All day';
  }

  const startDate = new Date(event.start);
  const endDate = new Date(event.end);

  // Format start time
  const startOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: startDate.getMinutes() > 0 ? '2-digit' : undefined,
    timeZone: hostTimeZone
  };
  const startStr = startDate.toLocaleTimeString(hostLocale || 'en-US', startOptions);

  // Format end time (simpler, just hour + am/pm)
  const endOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: endDate.getMinutes() > 0 ? '2-digit' : undefined,
    timeZone: hostTimeZone
  };
  const endStr = endDate.toLocaleTimeString(hostLocale || 'en-US', endOptions);

  return `${startStr} - ${endStr}`;
}

/**
 * Format the calendar display name.
 * Shows calendarName if available, otherwise a friendly version of calendarId.
 */
function formatCalendarName(calendarId: string, calendarName?: string): string {
  if (calendarName) {
    return calendarName;
  }
  // For 'primary', show as 'Primary'
  if (calendarId === 'primary') {
    return 'Primary';
  }
  // For email-style IDs, show just the email
  if (calendarId.includes('@')) {
    return calendarId;
  }
  return calendarId;
}

/**
 * Compute calendar summary for a day's events (for collapsed view)
 * Groups by account nickname (accountId) for cleaner display
 */
function computeCalendarSummary(events: MultiDayViewEvent[]): CalendarSummary[] {
  const byAccount = new Map<string, CalendarSummary>();

  for (const event of events) {
    // Use accountId as the grouping key, fall back to calendarId if no account
    const key = event.accountId || event.calendarId;
    const existing = byAccount.get(key);
    if (existing) {
      existing.count++;
    } else {
      byAccount.set(key, {
        calendarId: event.calendarId,
        calendarName: event.accountId || formatCalendarName(event.calendarId),
        backgroundColor: event.backgroundColor || 'var(--accent-color)',
        count: 1
      });
    }
  }

  return Array.from(byAccount.values());
}

/**
 * Calculate time range for a day's events (for expanded time grid view)
 */
function calculateDayTimeRange(events: MultiDayViewEvent[]): { startHour: number; endHour: number } {
  const timedEvents = events.filter(e => !e.isAllDay);

  if (timedEvents.length === 0) {
    return { startHour: 8, endHour: 18 }; // Default business hours
  }

  let minHour = 24;
  let maxHour = 0;

  for (const event of timedEvents) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    minHour = Math.min(minHour, start.getHours());
    maxHour = Math.max(maxHour, end.getHours() + (end.getMinutes() > 0 ? 1 : 0));
  }

  // Add padding and clamp
  return {
    startHour: Math.max(0, minHour - 1),
    endHour: Math.min(24, maxHour + 1)
  };
}

/**
 * Calculate event position for multi-day time grid (uses compact row height)
 */
function calculateMultiDayEventPosition(
  event: MultiDayViewEvent,
  startHour: number,
  endHour: number
): { top: string; height: string } {
  const ROW_HEIGHT = 32; // Compact row height for multi-day expanded view

  const eventStart = new Date(event.start);
  const eventEnd = new Date(event.end);

  const startHourFloat = eventStart.getHours() + eventStart.getMinutes() / 60;
  const endHourFloat = eventEnd.getHours() + eventEnd.getMinutes() / 60;

  const clampedStart = Math.max(startHourFloat, startHour);
  const clampedEnd = Math.min(endHourFloat, endHour);

  const topOffset = (clampedStart - startHour) * ROW_HEIGHT;
  const height = Math.max((clampedEnd - clampedStart) * ROW_HEIGHT, 24);

  return {
    top: `${topOffset}px`,
    height: `${height}px`
  };
}

/**
 * Check if two events overlap in time
 */
function eventsOverlap(eventA: MultiDayViewEvent, eventB: MultiDayViewEvent): { overlaps: boolean; overlapMinutes: number } {
  if (eventA.isAllDay || eventB.isAllDay) return { overlaps: false, overlapMinutes: 0 };

  const startA = new Date(eventA.start).getTime();
  const endA = new Date(eventA.end).getTime();
  const startB = new Date(eventB.start).getTime();
  const endB = new Date(eventB.end).getTime();

  const overlaps = startA < endB && startB < endA;
  if (!overlaps) return { overlaps: false, overlapMinutes: 0 };

  // Calculate overlap duration
  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);
  const overlapMinutes = Math.round((overlapEnd - overlapStart) / (1000 * 60));

  return { overlaps: true, overlapMinutes };
}

/**
 * Format overlap duration for display
 */
function formatOverlapDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m overlap`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h overlap`;
  }
  return `${hours}h ${mins}m overlap`;
}

/**
 * Calculate event duration in minutes
 */
function getEventDurationMinutes(event: MultiDayViewEvent): number {
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  return Math.round((end - start) / (1000 * 60));
}

/**
 * Calculate proportional height for event based on duration
 * Min: 30 minutes = 44px (base height)
 * Max: 180 minutes (3 hours) = 120px
 * Scale linearly between those values
 */
function calculateEventHeight(durationMinutes: number): { height: number; continues: boolean } {
  const MIN_DURATION = 30;  // 30 minutes
  const MAX_DURATION = 180; // 3 hours
  const MIN_HEIGHT = 44;    // pixels
  const MAX_HEIGHT = 120;   // pixels

  const continues = durationMinutes > MAX_DURATION;
  const clampedDuration = Math.min(Math.max(durationMinutes, MIN_DURATION), MAX_DURATION);

  // Linear interpolation
  const ratio = (clampedDuration - MIN_DURATION) / (MAX_DURATION - MIN_DURATION);
  const height = MIN_HEIGHT + ratio * (MAX_HEIGHT - MIN_HEIGHT);

  return { height: Math.round(height), continues };
}

/**
 * Format duration for display (e.g., "2h 30m")
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

/**
 * Create an overlap group element that renders two overlapping events as a connected visual
 * Shows the first event, then the overlapping portion with both bars, then the second event continuation
 */
function createOverlapGroup(
  eventA: MultiDayViewEvent,
  eventB: MultiDayViewEvent,
  overlapMinutes: number,
  focusEventId?: string
): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'overlap-group';

  const colorA = eventA.backgroundColor || 'var(--accent-color)';
  const colorB = eventB.backgroundColor || 'var(--accent-color)';

  // Calculate heights for each segment
  const durationA = getEventDurationMinutes(eventA);
  const durationB = getEventDurationMinutes(eventB);

  // Height for first event's non-overlapping portion (before overlap starts)
  const startA = new Date(eventA.start).getTime();
  const startB = new Date(eventB.start).getTime();
  const endA = new Date(eventA.end).getTime();
  const beforeOverlapMinutes = Math.round((startB - startA) / (1000 * 60));
  const afterOverlapMinutes = Math.round((new Date(eventB.end).getTime() - endA) / (1000 * 60));

  const { height: heightBeforeOverlap } = calculateEventHeight(Math.max(beforeOverlapMinutes, 15));
  const { height: heightOverlap } = calculateEventHeight(Math.max(overlapMinutes, 15));
  const { height: heightAfterOverlap, continues: continuesB } = calculateEventHeight(Math.max(afterOverlapMinutes, 15));

  // --- First Event (before overlap) ---
  const firstRow = document.createElement('div');
  firstRow.className = 'overlap-event-first';
  firstRow.style.minHeight = `${heightBeforeOverlap}px`;
  firstRow.setAttribute('role', 'button');
  firstRow.setAttribute('tabindex', '0');
  firstRow.title = `${eventA.summary}\n${formatTime(eventA.start)} - ${formatTime(eventA.end)} (${formatDuration(durationA)})\nClick to open in Google Calendar`;
  firstRow.addEventListener('click', () => openLink(eventA.htmlLink));

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

  // --- Overlap Region (both bars side by side) ---
  const overlapRow = document.createElement('div');
  overlapRow.className = 'overlap-region';
  overlapRow.style.minHeight = `${heightOverlap}px`;

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

  const overlapLabel = document.createElement('div');
  overlapLabel.className = 'overlap-label';
  overlapLabel.textContent = formatOverlapDuration(overlapMinutes);
  overlapRow.appendChild(overlapLabel);

  group.appendChild(overlapRow);

  // --- Second Event (after overlap, inset) ---
  const secondRow = document.createElement('div');
  secondRow.className = 'overlap-event-second';
  secondRow.style.minHeight = `${heightAfterOverlap}px`;
  secondRow.setAttribute('role', 'button');
  secondRow.setAttribute('tabindex', '0');
  secondRow.title = `${eventB.summary}\n${formatTime(eventB.start)} - ${formatTime(eventB.end)} (${formatDuration(durationB)})\nClick to open in Google Calendar`;
  secondRow.addEventListener('click', () => openLink(eventB.htmlLink));

  const barSecond = document.createElement('div');
  barSecond.className = 'overlap-bar-second';
  barSecond.style.backgroundColor = colorB;

  // Add continues indicator if needed
  if (continuesB) {
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

  const timeColSecond = document.createElement('div');
  timeColSecond.className = 'event-time-col';
  const startTimeB = document.createElement('div');
  startTimeB.textContent = formatTime(eventB.start);
  timeColSecond.appendChild(startTimeB);
  const endTimeB = document.createElement('div');
  endTimeB.className = 'event-end-time';
  endTimeB.textContent = formatTime(eventB.end);
  timeColSecond.appendChild(endTimeB);
  if (continuesB) {
    const durationLabel = document.createElement('div');
    durationLabel.className = 'event-duration-label';
    durationLabel.textContent = formatDuration(durationB);
    timeColSecond.appendChild(durationLabel);
  }
  secondRow.appendChild(timeColSecond);

  const detailsSecond = document.createElement('div');
  detailsSecond.className = 'event-details';

  const titleRowSecond = document.createElement('div');
  titleRowSecond.className = 'event-item-title-row';
  const titleSecond = document.createElement('div');
  titleSecond.className = 'event-item-title';
  titleSecond.textContent = eventB.summary;
  titleRowSecond.appendChild(titleSecond);
  const calSecond = document.createElement('div');
  calSecond.className = 'event-item-calendar';
  calSecond.textContent = formatCalendarName(eventB.calendarId, eventB.calendarName);
  titleRowSecond.appendChild(calSecond);
  detailsSecond.appendChild(titleRowSecond);

  if (eventB.location) {
    const locSecond = document.createElement('div');
    locSecond.className = 'event-item-location';
    locSecond.textContent = eventB.location;
    detailsSecond.appendChild(locSecond);
  }
  secondRow.appendChild(detailsSecond);

  if (eventB.id === focusEventId) {
    secondRow.classList.add('focused');
  }

  group.appendChild(secondRow);

  return group;
}

/**
 * Create an event list element for an expanded day in multi-day view (compact list instead of time grid)
 */
function createDayEventList(events: MultiDayViewEvent[], focusEventId?: string): HTMLDivElement {
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

      item.addEventListener('click', () => openLink(event.htmlLink));
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openLink(event.htmlLink);
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
      const overlapGroup = createOverlapGroup(event, nextEvent, overlapWithNext.overlapMinutes, focusEventId);
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

    item.addEventListener('click', () => openLink(event.htmlLink));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLink(event.htmlLink);
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
 * Create calendar summary element for date header
 */
function createCalendarSummary(events: MultiDayViewEvent[]): HTMLDivElement {
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
 * Toggle expanded state for a day in multi-day view
 */
function toggleDayExpanded(dateStr: string): void {
  const group = document.querySelector(`[data-date="${dateStr}"]`) as HTMLDivElement | null;
  if (!group) return;

  const header = group.querySelector('.date-header') as HTMLDivElement | null;
  const eventsContainer = group.querySelector('.date-events') as HTMLDivElement | null;

  if (!header || !eventsContainer) return;

  const isCurrentlyExpanded = expandedDays.has(dateStr);

  if (isCurrentlyExpanded) {
    expandedDays.delete(dateStr);
    header.classList.remove('expanded');
    header.setAttribute('aria-expanded', 'false');
    eventsContainer.classList.add('collapsed');
  } else {
    expandedDays.add(dateStr);
    header.classList.add('expanded');
    header.setAttribute('aria-expanded', 'true');
    eventsContainer.classList.remove('collapsed');
  }

  // Notify host of size change
  if (appInstance) {
    setTimeout(() => {
      const height = document.documentElement.scrollHeight;
      appInstance?.sendSizeChanged({ height }).catch(() => {});
    }, 50);
  }
}

/**
 * Create an event list item element for multi-day view
 */
function createEventListItem(
  event: MultiDayViewEvent,
  isFocused: boolean
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
  element.addEventListener('click', () => openLink(event.htmlLink));
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openLink(event.htmlLink);
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
  timeDiv.textContent = formatMultiDayEventTime(event);
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
 * Create a date group element for multi-day view
 */
function createDateGroup(
  dateStr: string,
  events: MultiDayViewEvent[],
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
  const dayEventList = createDayEventList(events, focusEventId);
  dayEventList.className = 'date-events collapsed';

  group.appendChild(dayEventList);

  return group;
}

/**
 * Format time range for multi-day view subheading
 */
function formatTimeRangeSubheading(context: MultiDayContext): string {
  const parts: string[] = [];

  if (context.query) {
    parts.push(`Search: "${context.query}"`);
  }

  if (context.timeRange?.start && context.timeRange?.end) {
    const startDate = new Date(context.timeRange.start);
    const endDate = new Date(context.timeRange.end);
    const formatOptions: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    };
    const startStr = startDate.toLocaleDateString(hostLocale || 'en-US', formatOptions);
    const endStr = endDate.toLocaleDateString(hostLocale || 'en-US', formatOptions);
    parts.push(`${startStr} - ${endStr}`);
  }

  parts.push(`${context.totalEventCount} event${context.totalEventCount !== 1 ? 's' : ''}`);

  return parts.join(' · ');
}

/**
 * Render multi-day view
 */
function renderMultiDayView(context: MultiDayContext): void {
  // Reset expanded days state
  expandedDays.clear();

  // Hide day view, show multi-day view
  dayViewContainer.style.display = 'none';
  multiDayViewContainer.style.display = '';

  // Update header
  multiDayHeading.textContent = context.query ? 'Search Results' : 'Events';

  // Update subheading
  multiDaySubheading.textContent = formatTimeRangeSubheading(context);

  // Set up calendar link
  multiDayLink.href = '#';
  multiDayLink.onclick = (e) => {
    e.preventDefault();
    openLink(context.calendarLink);
  };

  // Clear existing content
  while (multiDayEventsList.firstChild) {
    multiDayEventsList.removeChild(multiDayEventsList.firstChild);
  }

  // Render date groups
  if (context.totalEventCount === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'multi-day-empty';
    if (context.query) {
      emptyState.textContent = `No results found for "${context.query}"`;
    } else if (context.timeRange?.start && context.timeRange?.end) {
      // Format the date range for the empty message
      const startDate = new Date(context.timeRange.start);
      const endDate = new Date(context.timeRange.end);
      const formatOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      const startStr = startDate.toLocaleDateString(hostLocale || 'en-US', formatOptions);
      const endStr = endDate.toLocaleDateString(hostLocale || 'en-US', formatOptions);
      emptyState.textContent = `No events from ${startStr} to ${endStr}`;
    } else {
      emptyState.textContent = 'No events found';
    }
    multiDayEventsList.appendChild(emptyState);
  } else {
    for (const date of context.dates) {
      const events = context.eventsByDate[date] || [];
      if (events.length > 0) {
        const dateGroup = createDateGroup(date, events, context.focusEventId);
        multiDayEventsList.appendChild(dateGroup);
      }
    }
  }

  // Scroll focused event into view
  setTimeout(() => {
    const focusedElement = document.querySelector('.event-list-item.focused');
    if (focusedElement) {
      focusedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

/**
 * Show day view container and hide multi-day view
 */
function showDayView(): void {
  dayViewContainer.style.display = '';
  multiDayViewContainer.style.display = 'none';
}

/**
 * Apply host styles and context if available
 */
function applyHostStyles(app: App): void {
  const context = app.getHostContext();
  if (!context) return;

  // Store locale and timezone for date/time formatting
  if (context.locale) {
    hostLocale = context.locale;
  }
  if (context.timeZone) {
    hostTimeZone = context.timeZone;
  }

  // Apply style variables from host
  if (context.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }

  // Apply host fonts
  if (context.styles?.css?.fonts) {
    applyHostFonts(context.styles.css.fonts);
  }

  // Apply theme using the proper helper (sets data-theme and color-scheme)
  if (context.theme) {
    applyDocumentTheme(context.theme);
  }
}

/**
 * Show loading state while tool executes
 */
function showLoadingState(): void {
  // Show day view container for loading message, hide multi-day
  showDayView();
  dateHeading.textContent = 'Loading...';
  allDaySection.style.display = 'none';
  while (timeGrid.firstChild) {
    timeGrid.removeChild(timeGrid.firstChild);
  }
  dayLink.style.display = 'none';
  expandToggle.style.display = 'none';
}

/**
 * Show cancelled state when tool is cancelled
 */
function showCancelledState(reason?: string): void {
  // Show day view container for cancelled message, hide multi-day
  showDayView();
  dateHeading.textContent = reason ? `Cancelled: ${reason}` : 'Cancelled';
  allDaySection.style.display = 'none';
  while (timeGrid.firstChild) {
    timeGrid.removeChild(timeGrid.firstChild);
  }
  dayLink.style.display = 'none';
  expandToggle.style.display = 'none';
}

/**
 * Initialize the app
 */
async function init(): Promise<void> {
  const app = new App(
    { name: 'DayView', version: '1.0.0' },
    {} // No special capabilities needed
  );

  // Store app instance globally for openLink calls
  appInstance = app;

  // Handle tool input - show loading state while tool executes
  app.ontoolinput = () => {
    showLoadingState();
  };

  // Handle tool results
  app.ontoolresult = (params) => {
    // Check for multi-day context first (multi-day queries, search results)
    const multiDayContext = extractMultiDayContext(params);
    if (multiDayContext) {
      renderMultiDayView(multiDayContext);
      return;
    }

    // Check for single-day context (single-day queries)
    const dayContext = extractDayContext(params);
    if (dayContext) {
      renderDayView(dayContext);
    }
  };

  // Handle tool cancellation
  app.ontoolcancelled = (params) => {
    showCancelledState(params.reason);
  };

  // Handle host context changes (theme, locale, etc.)
  app.onhostcontextchanged = () => {
    applyHostStyles(app);
  };

  // Handle graceful teardown
  app.onteardown = async () => {
    // Clean up any resources if needed
    appInstance = null;
    return {};
  };

  try {
    await app.connect();
    applyHostStyles(app);
  } catch (error) {
    console.error('Failed to connect to host:', error);
    dateHeading.textContent = 'Failed to connect';
  }
}

// Start the app
init();
