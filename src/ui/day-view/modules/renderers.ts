/**
 * Rendering functions for day view and multi-day view
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { DayViewEvent, DayContext, MultiDayContext, AvailableSlot, SchedulingMode } from './types.js';
import { formatHour, formatDateHeading, formatTimeRangeSubheading, formatSlotTime } from './formatting.js';
import { openLink, calculateAvailableSlots } from './utilities.js';
import { calculateEventPosition } from './positioning.js';
import { createEventElement, createDateGroup } from './dom-builders.js';

/**
 * DOM References interface
 */
export interface DOMRefs {
  // Day view
  dayViewContainer: HTMLDivElement;
  dateHeading: HTMLHeadingElement;
  dayLink: HTMLAnchorElement;
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
  domRefs.allDaySection.style.display = 'none';
  while (domRefs.timeGrid.firstChild) {
    domRefs.timeGrid.removeChild(domRefs.timeGrid.firstChild);
  }
  domRefs.dayLink.style.display = 'none';
  domRefs.expandToggle.style.display = 'none';
}

/**
 * Show cancelled state when tool is cancelled
 */
export function showCancelledState(domRefs: DOMRefs, reason?: string): void {
  // Show day view container for cancelled message, hide multi-day
  showDayView(domRefs);
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
  domRefs: DOMRefs
): void {
  const allDayEvts = events.filter(e => e.isAllDay);

  if (allDayEvts.length === 0) {
    domRefs.allDaySection.style.display = 'none';
    return;
  }

  domRefs.allDaySection.style.display = 'flex';

  // Clear existing events
  while (domRefs.allDayEvents.firstChild) {
    domRefs.allDayEvents.removeChild(domRefs.allDayEvents.firstChild);
  }

  // Add events
  for (const event of allDayEvts) {
    const isFocused = event.id === focusEventId;
    const element = createEventElement(event, isFocused, appInstance, true);
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
  schedulingMode?: SchedulingMode,
  onSlotSelect?: (slot: AvailableSlot) => void
): void {
  const { events, focusEventId, timeRange } = context;
  const { startHour, endHour } = timeRange;

  // Clear existing content
  while (domRefs.timeGrid.firstChild) {
    domRefs.timeGrid.removeChild(domRefs.timeGrid.firstChild);
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

  // Add available slots if scheduling mode is enabled
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

      eventsContainer.appendChild(slotElement);
    }
  }

  // Make time grid position relative for absolute positioning of events
  domRefs.timeGrid.style.position = 'relative';
  domRefs.timeGrid.appendChild(eventsContainer);
}

/**
 * Main render function for single-day view
 */
export function renderDayView(
  context: DayContext,
  appInstance: App | null,
  domRefs: DOMRefs,
  toggleExpanded: () => void,
  stateRefs: { isExpanded: { value: boolean } },
  schedulingMode?: SchedulingMode,
  onSlotSelect?: (slot: AvailableSlot) => void
): void {
  // Show day view, hide multi-day view
  showDayView(domRefs);

  // Update header
  domRefs.dateHeading.textContent = formatDateHeading(context.date);

  // Show and set up "Open in Calendar" button with click handler (sandboxed iframe)
  domRefs.dayLink.style.display = '';
  domRefs.dayLink.href = '#';
  domRefs.dayLink.onclick = (e) => {
    e.preventDefault();
    openLink(context.dayLink, appInstance);
  };

  // Render all-day events
  renderAllDayEvents(context.events, context.focusEventId, appInstance, domRefs);

  // Render time grid with optional scheduling mode
  renderTimeGrid(context, appInstance, domRefs, schedulingMode, onSlotSelect);

  // Show expand toggle and set up handler
  domRefs.expandToggle.style.display = '';
  domRefs.expandToggle.onclick = toggleExpanded;

  // Reset to compact state on new data
  stateRefs.isExpanded.value = false;
  domRefs.timeGrid.classList.add('compact');
  domRefs.expandToggle.classList.remove('expanded');
  domRefs.toggleText.textContent = 'Show more';

  // Scroll focused event into view (after a short delay for render)
  setTimeout(() => {
    const focusedElement = document.querySelector('.focused');
    if (focusedElement) {
      focusedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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
  onSlotSelect?: (slot: AvailableSlot) => void
): void {
  // Reset expanded days state
  stateRefs.expandedDays.clear();

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
        const dateGroup = createDateGroup(date, events, appInstance, toggleDayExpanded, context.focusEventId, availableSlots, onSlotSelect);
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
