import { App, applyHostStyleVariables, applyHostFonts, getDocumentTheme } from '@modelcontextprotocol/ext-apps';

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

// DOM element references
const dateHeading = document.getElementById('date-heading') as HTMLHeadingElement;
const dayLink = document.getElementById('day-link') as HTMLAnchorElement;
const allDaySection = document.getElementById('all-day-section') as HTMLDivElement;
const allDayEvents = document.getElementById('all-day-events') as HTMLDivElement;
const timeGrid = document.getElementById('time-grid') as HTMLDivElement;
const expandToggle = document.getElementById('expand-toggle') as HTMLButtonElement;
const toggleText = document.getElementById('toggle-text') as HTMLSpanElement;

// Global app instance for opening links (sandboxed iframe requires app.openLink)
let appInstance: App | null = null;

// Compact/expanded state
let isExpanded = false;

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
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${displayHour}:${displayMinutes} ${ampm}`;
}

/**
 * Format date for heading (e.g., "Tuesday, January 27, 2025")
 */
function formatDateHeading(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
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
  element.title = `Click to open in Google Calendar`;

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

    const titleDiv = document.createElement('div');
    titleDiv.className = 'event-title';
    titleDiv.textContent = event.summary;
    element.appendChild(titleDiv);

    const timeDiv = document.createElement('div');
    timeDiv.className = 'event-time';
    timeDiv.textContent = `${formatTime(event.start)} - ${formatTime(event.end)}`;
    element.appendChild(timeDiv);

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
 * Main render function
 */
function renderDayView(context: DayContext): void {
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
 * Apply host styles if available
 */
function applyHostStyles(app: App): void {
  const context = app.getHostContext();
  if (!context?.styles) return;

  if (context.styles.variables) {
    applyHostStyleVariables(context.styles.variables);
  }

  if (context.styles.css?.fonts) {
    applyHostFonts(context.styles.css.fonts);
  }

  // Apply theme class if needed
  const theme = getDocumentTheme();
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  }
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

  // Handle tool results
  app.ontoolresult = (params) => {
    const context = extractDayContext(params);
    if (context) {
      renderDayView(context);
    }
  };

  // Handle host context changes (theme, etc.)
  app.onhostcontextchanged = () => {
    applyHostStyles(app);
  };

  try {
    await app.connect();
    applyHostStyles(app);

    // Check if we already have context from initialization
    const hostContext = app.getHostContext();
    if (hostContext) {
      applyHostStyles(app);
    }
  } catch (error) {
    console.error('Failed to connect to host:', error);
    dateHeading.textContent = 'Failed to connect';
  }
}

// Start the app
init();
