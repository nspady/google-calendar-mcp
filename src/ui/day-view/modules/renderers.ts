/**
 * Rendering functions for day view and multi-day view
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { DayViewEvent, DayContext, MultiDayContext, AvailableSlot, SchedulingMode, CalendarFilter } from './types.js';
import { formatHour, formatDateHeading, formatTimeRangeSubheading, formatSlotTime } from './formatting.js';
import { openLink, calculateAvailableSlots, computeCalendarFilters, filterVisibleEvents, isToday } from './utilities.js';
import { calculateEventPosition, calculateOverlapColumns } from './positioning.js';
import { createEventElement, createDateGroup, createCalendarLegend } from './dom-builders.js';

/**
 * DOM References interface
 */
export interface DOMRefs {
  // Day view
  dayViewContainer: HTMLDivElement;
  dayViewHeader: HTMLDivElement;
  dateHeading: HTMLHeadingElement;
  dayLink: HTMLAnchorElement;
  calendarLegendContainer: HTMLDivElement;
  allDaySection: HTMLDivElement;
  allDayEvents: HTMLDivElement;
  timeGrid: HTMLDivElement;
  expandToggle: HTMLButtonElement;
  toggleText: HTMLSpanElement;

  // Multi-day view
  multiDayViewContainer: HTMLDivElement;
  multiDayHeading: HTMLHeadingElement;
  multiDaySubheading: HTMLDivElement;
  multiDayLink: HTMLAnchorElement;
  multiDayEventsList: HTMLDivElement;
}

/**
 * Show day view container and hide multi-day view
 */
export function showDayView(domRefs: DOMRefs): void {
  domRefs.dayViewContainer.style.display = '';
  domRefs.multiDayViewContainer.style.display = 'none';
}

/**
 * Show loading state while tool executes
 */
export function showLoadingState(domRefs: DOMRefs): void {
  // Show day view container for loading message, hide multi-day
  showDayView(domRefs);
  domRefs.dateHeading.textContent = 'Loading...';
  domRefs.dateHeading.classList.add('loading-shimmer');
  domRefs.allDaySection.style.display = 'none';
  while (domRefs.timeGrid.firstChild) {
    domRefs.timeGrid.removeChild(domRefs.timeGrid.firstChild);
  }
  domRefs.expandToggle.style.display = 'none';
}

/**
 * Show skeleton preview from partial tool input arguments.
 * Renders empty time grid with hour labels and date heading if available.
 */
export function renderSkeletonView(
  domRefs: DOMRefs,
  hints: { date?: string; timeZone?: string; query?: string }
): void {
  showDayView(domRefs);

  // Show date heading if we extracted a date, otherwise generic loading
  if (hints.query) {
    domRefs.dateHeading.textContent = `Searching for "${hints.query}"...`;
  } else if (hints.date) {
    domRefs.dateHeading.textContent = formatDateHeading(hints.date);
  } else {
    domRefs.dateHeading.textContent = 'Loading...';
  }
  domRefs.dateHeading.classList.add('loading-shimmer');

  domRefs.allDaySection.style.display = 'none';
  domRefs.dayLink.style.display = 'none';
  domRefs.expandToggle.style.display = 'none';

  // Clear legend safely
  while (domRefs.calendarLegendContainer.firstChild) {
    domRefs.calendarLegendContainer.removeChild(domRefs.calendarLegendContainer.firstChild);
  }

  // Clear and render skeleton time grid (business hours 8-18)
  while (domRefs.timeGrid.firstChild) {
    domRefs.timeGrid.removeChild(domRefs.timeGrid.firstChild);
  }

  for (let hour = 8; hour < 18; hour++) {
    const row = document.createElement('div');
    row.className = 'time-row skeleton';

    const hourLabel = document.createElement('div');
    hourLabel.className = 'hour-label';
    hourLabel.textContent = formatHour(hour);
    row.appendChild(hourLabel);

    const timeSlot = document.createElement('div');
    timeSlot.className = 'time-slot';
    row.appendChild(timeSlot);

    domRefs.timeGrid.appendChild(row);
  }

  domRefs.timeGrid.classList.add('compact');
  domRefs.timeGrid.style.position = 'relative';
}

/**
 * Show cancelled state when tool is cancelled
 */
export function showCancelledState(domRefs: DOMRefs, reason?: string): void {
  // Show day view container for cancelled message, hide multi-day
  showDayView(domRefs);
  domRefs.dateHeading.classList.remove('loading-shimmer');
  domRefs.dateHeading.textContent = reason ? `Cancelled: ${reason}` : 'Cancelled';
  domRefs.allDaySection.style.display = 'none';
  while (domRefs.timeGrid.firstChild) {
    domRefs.timeGrid.removeChild(domRefs.timeGrid.firstChild);
  }
  domRefs.dayLink.style.display = 'none';
  domRefs.expandToggle.style.display = 'none';
}

/**
 * Render all-day events section
 */
export function renderAllDayEvents(
  events: DayViewEvent[],
  focusEventId: string,
  appInstance: App | null,
  domRefs: DOMRefs,
  onEventClick?: (event: DayViewEvent) => void
): void {
  const allDayEvts = events.filter(e => e.isAllDay);

  // Clear existing events
  while (domRefs.allDayEvents.firstChild) {
    domRefs.allDayEvents.removeChild(domRefs.allDayEvents.firstChild);
  }

  if (allDayEvts.length === 0) {
    domRefs.allDaySection.style.display = 'none';
    return;
  }

  domRefs.allDaySection.style.display = 'flex';

  // Add events with borders matching the event color
  for (const event of allDayEvts) {
    const isFocused = event.id === focusEventId;
    const element = createEventElement(event, isFocused, appInstance, true, onEventClick);
    domRefs.allDayEvents.appendChild(element);
  }
}

/**
 * Calculate slot position on the time grid (same logic as events)
 */
function calculateSlotPosition(
  slot: AvailableSlot,
  startHour: number,
  endHour: number
): { top: string; height: string } {
  const ROW_HEIGHT = 48;
  const gridStartMinutes = startHour * 60;
  const gridEndMinutes = endHour * 60;

  const clampedStart = Math.max(slot.startMinutes, gridStartMinutes);
  const clampedEnd = Math.min(slot.endMinutes, gridEndMinutes);

  const topOffset = ((clampedStart - gridStartMinutes) / 60) * ROW_HEIGHT;
  const height = Math.max(((clampedEnd - clampedStart) / 60) * ROW_HEIGHT, 24);

  return { top: `${topOffset}px`, height: `${height}px` };
}

/**
 * Create a slot element for the time grid (positioned block)
 */
function createTimeGridSlotElement(
  slot: AvailableSlot,
  onSelect?: (slot: AvailableSlot) => void
): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'time-grid-slot';
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.title = `Available: ${formatSlotTime(slot.startMinutes)} - ${formatSlotTime(slot.endMinutes)}\nClick to select`;

  const label = document.createElement('div');
  label.className = 'slot-grid-label';
  label.textContent = 'Available';
  element.appendChild(label);

  const time = document.createElement('div');
  time.className = 'slot-grid-time';
  time.textContent = `${formatSlotTime(slot.startMinutes)} - ${formatSlotTime(slot.endMinutes)}`;
  element.appendChild(time);

  const handleSelect = (): void => {
    document.querySelectorAll('.time-grid-slot.selected').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    if (onSelect) {
      onSelect(slot);
    }
  };

  element.addEventListener('click', handleSelect);
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelect();
    }
  });

  return element;
}

/**
 * Render time grid with events
 */
export function renderTimeGrid(
  context: DayContext,
  appInstance: App | null,
  domRefs: DOMRefs,
  visibleEvents?: DayViewEvent[],
  schedulingMode?: SchedulingMode,
  onSlotSelect?: (slot: AvailableSlot) => void,
  onEventClick?: (event: DayViewEvent) => void
): void {
  const { focusEventId, timeRange } = context;
  const events = visibleEvents || context.events;
  const { startHour, endHour } = timeRange;

  // Clear existing content
  while (domRefs.timeGrid.firstChild) {
    domRefs.timeGrid.removeChild(domRefs.timeGrid.firstChild);
  }

  // Filter timed events (not all-day)
  const timedEvents = events.filter(e => !e.isAllDay);

  // Calculate overlap columns for side-by-side stacking
  const overlapColumns = calculateOverlapColumns(timedEvents);

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

    domRefs.timeGrid.appendChild(row);
  }

  // Create events container (positioned over the grid)
  const eventsContainer = document.createElement('div');
  eventsContainer.style.position = 'absolute';
  eventsContainer.style.top = '0';
  eventsContainer.style.left = 'var(--hour-width)';
  eventsContainer.style.right = '0';
  eventsContainer.style.bottom = '0';
  eventsContainer.style.pointerEvents = 'none';

  // Add available slots FIRST (behind events) if scheduling mode is enabled
  if (schedulingMode?.enabled) {
    const availableSlots = calculateAvailableSlots(events, schedulingMode.durationMinutes, startHour, endHour);

    for (const slot of availableSlots) {
      const slotElement = createTimeGridSlotElement(slot, onSlotSelect);
      const position = calculateSlotPosition(slot, startHour, endHour);

      slotElement.style.position = 'absolute';
      slotElement.style.top = position.top;
      slotElement.style.height = position.height;
      slotElement.style.left = '0';
      slotElement.style.right = '0';
      slotElement.style.pointerEvents = 'auto';
      slotElement.style.zIndex = '0';

      eventsContainer.appendChild(slotElement);
    }
  }

  // Position and add events AFTER slots (on top)
  // Apply overlap positioning for side-by-side stacking
  const PADDING = 4; // px padding between events and edges
  const GAP = 2; // px gap between overlapping events

  for (const event of timedEvents) {
    const isFocused = event.id === focusEventId;
    const element = createEventElement(event, isFocused, appInstance, false, onEventClick);
    const position = calculateEventPosition(event, startHour, endHour);
    const overlapPos = overlapColumns.get(event.id);

    element.style.top = position.top;
    element.style.height = position.height;
    element.style.pointerEvents = 'auto';

    // Apply horizontal positioning for overlapping events
    if (overlapPos && overlapPos.totalColumns > 1) {
      const totalColumns = overlapPos.totalColumns;
      const columnIndex = overlapPos.columnIndex;
      const columnWidth = (100 - (GAP * (totalColumns - 1))) / totalColumns;
      const leftPercent = columnIndex * (columnWidth + GAP);

      element.style.left = `calc(${leftPercent}% + ${PADDING}px)`;
      element.style.width = `calc(${columnWidth}% - ${PADDING * 2}px)`;
      element.style.right = 'auto';
    } else {
      element.style.left = `${PADDING}px`;
      element.style.right = `${PADDING}px`;
    }

    element.style.zIndex = String(1 + (overlapPos?.columnIndex || 0));

    eventsContainer.appendChild(element);
  }

  // Make time grid position relative for absolute positioning of events
  domRefs.timeGrid.style.position = 'relative';
  domRefs.timeGrid.appendChild(eventsContainer);

  // Add current time indicator if viewing today
  if (isToday(context.date)) {
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;

    // Only show if current time is within visible time range
    if (currentHour >= startHour && currentHour <= endHour) {
      const ROW_HEIGHT = 48;
      const topPosition = (currentHour - startHour) * ROW_HEIGHT;

      const timeLine = document.createElement('div');
      timeLine.className = 'current-time-line';
      timeLine.style.top = `${topPosition}px`;
      eventsContainer.appendChild(timeLine);
    }
  }
}

/**
 * Main render function for single-day view
 */
export function renderDayView(
  context: DayContext,
  appInstance: App | null,
  domRefs: DOMRefs,
  toggleExpanded: () => void,
  stateRefs: { isExpanded: { value: boolean }; calendarFilters?: CalendarFilter[]; hiddenCalendarIds?: string[] },
  schedulingMode?: SchedulingMode,
  onSlotSelect?: (slot: AvailableSlot) => void,
  onFilterChange?: () => void,
  onEventClick?: (event: DayViewEvent) => void
): void {
  // Show day view, hide multi-day view
  showDayView(domRefs);

  // Update header
  domRefs.dateHeading.classList.remove('loading-shimmer');
  domRefs.dateHeading.textContent = formatDateHeading(context.date);

  // Show and set up "Open in Calendar" button with click handler (sandboxed iframe)
  domRefs.dayLink.style.display = '';
  domRefs.dayLink.href = '#';
  domRefs.dayLink.onclick = (e) => {
    e.preventDefault();
    openLink(context.dayLink, appInstance);
  };

  // Compute calendar filters for legend (restore hidden state from persistence)
  const filters = computeCalendarFilters(context.events, stateRefs.hiddenCalendarIds);
  stateRefs.calendarFilters = filters;

  // Create and add calendar legend if we have multiple calendars
  if (domRefs.calendarLegendContainer) {
    while (domRefs.calendarLegendContainer.firstChild) {
      domRefs.calendarLegendContainer.removeChild(domRefs.calendarLegendContainer.firstChild);
    }

    if (filters.length > 1) {
      const legend = createCalendarLegend(filters, () => {
        // Re-render events when a calendar is toggled
        const visibleEvents = filterVisibleEvents(context.events, filters);
        renderAllDayEvents(visibleEvents, context.focusEventId, appInstance, domRefs, onEventClick);
        renderTimeGrid(context, appInstance, domRefs, visibleEvents, schedulingMode, onSlotSelect, onEventClick);
        onFilterChange?.();
      });
      domRefs.calendarLegendContainer.appendChild(legend);
    }
  }

  // Apply persisted filter visibility on initial render
  const initialEvents = filterVisibleEvents(context.events, filters);

  // Render all-day events
  renderAllDayEvents(initialEvents, context.focusEventId, appInstance, domRefs, onEventClick);

  // Render time grid with optional scheduling mode
  renderTimeGrid(context, appInstance, domRefs, initialEvents, schedulingMode, onSlotSelect, onEventClick);

  // Show expand toggle and set up handler
  domRefs.expandToggle.style.display = '';
  domRefs.expandToggle.onclick = toggleExpanded;

  // Apply persisted expand state, or default to compact
  if (stateRefs.isExpanded.value) {
    domRefs.timeGrid.classList.remove('compact');
    domRefs.expandToggle.classList.add('expanded');
    domRefs.toggleText.textContent = 'Show less';
  } else {
    stateRefs.isExpanded.value = false;
    domRefs.timeGrid.classList.add('compact');
    domRefs.expandToggle.classList.remove('expanded');
    domRefs.toggleText.textContent = 'Show more';
  }

  // Scroll focused event into view (after a short delay for render)
  setTimeout(() => {
    const focusedInGrid = domRefs.timeGrid.querySelector('.focused') as HTMLElement | null;
    const focusedInAllDay = domRefs.allDayEvents.querySelector('.focused') as HTMLElement | null;
    const focusedElement = focusedInGrid || focusedInAllDay;

    if (!focusedElement) return;

    // In compact mode, scroll the time grid internally to center the focused event
    if (focusedInGrid && !stateRefs.isExpanded.value) {
      const gridRect = domRefs.timeGrid.getBoundingClientRect();
      const focusedRect = focusedInGrid.getBoundingClientRect();
      const scrollOffset = focusedRect.top - gridRect.top + domRefs.timeGrid.scrollTop;
      const gridVisibleHeight = gridRect.height;
      domRefs.timeGrid.scrollTop = Math.max(0, scrollOffset - gridVisibleHeight / 2 + focusedRect.height / 2);
    }

    focusedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

/**
 * Render multi-day view
 */
export function renderMultiDayView(
  context: MultiDayContext,
  appInstance: App | null,
  domRefs: DOMRefs,
  toggleDayExpanded: (dateStr: string) => void,
  stateRefs: { expandedDays: Set<string>; hostLocale?: string },
  schedulingMode?: SchedulingMode,
  onSlotSelect?: (slot: AvailableSlot) => void,
  onEventClick?: (event: DayViewEvent) => void
): void {
  // Only clear expanded days if no persisted state was loaded
  // (persisted state is pre-loaded into stateRefs before this call)
  if (stateRefs.expandedDays.size === 0) {
    stateRefs.expandedDays.clear();
  }

  // Hide day view, show multi-day view
  domRefs.dayViewContainer.style.display = 'none';
  domRefs.multiDayViewContainer.style.display = '';

  // Update header
  domRefs.multiDayHeading.textContent = context.query ? 'Search Results' : 'Events';

  // Update subheading
  domRefs.multiDaySubheading.textContent = formatTimeRangeSubheading(context);

  // Set up calendar link
  domRefs.multiDayLink.href = '#';
  domRefs.multiDayLink.onclick = (e) => {
    e.preventDefault();
    openLink(context.calendarLink, appInstance);
  };

  // Clear existing content
  while (domRefs.multiDayEventsList.firstChild) {
    domRefs.multiDayEventsList.removeChild(domRefs.multiDayEventsList.firstChild);
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
      const startStr = startDate.toLocaleDateString(stateRefs.hostLocale || 'en-US', formatOptions);
      const endStr = endDate.toLocaleDateString(stateRefs.hostLocale || 'en-US', formatOptions);
      emptyState.textContent = `No events from ${startStr} to ${endStr}`;
    } else {
      emptyState.textContent = 'No events found';
    }
    domRefs.multiDayEventsList.appendChild(emptyState);
  } else {
    for (const date of context.dates) {
      const events = context.eventsByDate[date] || [];
      if (events.length > 0) {
        // Calculate available slots for this day if scheduling mode is enabled
        const availableSlots = schedulingMode?.enabled
          ? calculateAvailableSlots(events, schedulingMode.durationMinutes)
          : undefined;
        const isExpanded = stateRefs.expandedDays.has(date);
        const dateGroup = createDateGroup(date, events, appInstance, toggleDayExpanded, context.focusEventId, availableSlots, onSlotSelect, isExpanded, onEventClick);
        domRefs.multiDayEventsList.appendChild(dateGroup);
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
