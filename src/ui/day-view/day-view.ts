import { App, applyHostStyleVariables, applyHostFonts, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

// Import types
import type {
  DayViewEvent,
  DayContext,
  MultiDayViewEvent,
  MultiDayContext,
  CalendarSummary
} from './modules/types.js';

// Import formatting functions
import {
  setHostContext,
  formatHour,
  formatTime,
  formatDateHeading,
  formatTimeRangeSubheading,
  formatMultiDayDate,
  formatMultiDayEventTime,
  formatCalendarName
} from './modules/formatting.js';

// Import utilities
import { openLink, isToday } from './modules/utilities.js';

// Import positioning functions
import { calculateEventPosition } from './modules/positioning.js';

// Import DOM builders
import {
  createEventElement,
  createDateGroup,
  createCalendarSummary,
  createDayEventList,
  createEventListItem
} from './modules/dom-builders.js';

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
// Maximum number of expanded days to prevent unbounded memory growth
const MAX_EXPANDED_DAYS = 50;
let expandedDays: Set<string> = new Set();

// Host context for locale/timezone formatting (stored here, used by imported modules)
let hostLocale: string | undefined;
let hostTimeZone: string | undefined;

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
    const element = createEventElement(event, isFocused, appInstance, true);
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
    const element = createEventElement(event, isFocused, appInstance);
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
    openLink(context.dayLink, appInstance);
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
    // Check if we're at the limit before adding
    if (expandedDays.size >= MAX_EXPANDED_DAYS) {
      // Remove the oldest entry (first item in Set iteration order)
      const oldest = Array.from(expandedDays)[0];
      expandedDays.delete(oldest);
      // Also collapse the oldest day's UI
      const oldestGroup = document.querySelector(`[data-date="${oldest}"]`) as HTMLDivElement | null;
      if (oldestGroup) {
        const oldestHeader = oldestGroup.querySelector('.date-header') as HTMLDivElement | null;
        const oldestContainer = oldestGroup.querySelector('.date-events') as HTMLDivElement | null;
        if (oldestHeader) {
          oldestHeader.classList.remove('expanded');
          oldestHeader.setAttribute('aria-expanded', 'false');
        }
        if (oldestContainer) {
          oldestContainer.classList.add('collapsed');
        }
      }
    }
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
    openLink(context.calendarLink, appInstance);
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
        const dateGroup = createDateGroup(date, events, appInstance, toggleDayExpanded, context.focusEventId);
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

  // Store locale and timezone for date/time formatting (in both local vars and formatting module)
  if (context.locale) {
    hostLocale = context.locale;
  }
  if (context.timeZone) {
    hostTimeZone = context.timeZone;
  }
  setHostContext(hostLocale, hostTimeZone);

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
