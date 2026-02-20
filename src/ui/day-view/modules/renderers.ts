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
    const availableSlots = calculateAvailableSlots(
      events,
      schedulingMode.durationMinutes,
      startHour,
      endHour,
      context.timezone
    );

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
    const position = calculateEventPosition(event, startHour, endHour, context.timezone);
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
  if (isToday(context.date, context.timezone)) {
    const now = new Date();
    let currentHour = now.getHours() + now.getMinutes() / 60;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: context.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(now);
      const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
      const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
      currentHour = hour + minute / 60;
    } catch {
      // Fall back to local time.
    }

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
 * Animate scrollTop from current position to target using ease-out cubic.
 */
function smoothScrollTop(element: HTMLElement, target: number, duration = 250): void {
  const start = element.scrollTop;
  const distance = target - start;
  if (Math.abs(distance) < 1) return;

  const t0 = performance.now();
  function step(now: number): void {
    const p = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    element.scrollTop = start + distance * eased;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/** Compact viewport height (must match .time-grid.compact max-height in CSS). */
const COMPACT_HEIGHT = 200;

/**
 * Compute the ideal scroll target and count of timed events hidden below the
 * fold for compact mode. Computed from event data (not DOM) so it works
 * reliably on first paint.
 *
 * When a focusEventId is provided (create/update), centers on that event.
 * Otherwise scrolls to the first visible timed event.
 */
function computeCompactScrollInfo(
  context: DayContext,
  visibleEvents: DayViewEvent[]
): { scrollTarget: number; hiddenCount: number } {
  const timedEvents = visibleEvents.filter(e => !e.isAllDay);

  if (timedEvents.length === 0) {
    // No timed events — try current time if today, otherwise top
    if (isToday(context.date, context.timezone)) {
      const ROW_HEIGHT = 48;
      let currentHour: number;
      try {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: context.timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).formatToParts(now);
        const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
        const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
        currentHour = (hour === 24 ? 0 : hour) + minute / 60;
      } catch {
        const now = new Date();
        currentHour = now.getHours() + now.getMinutes() / 60;
      }
      const scrollPos = (currentHour - context.timeRange.startHour) * ROW_HEIGHT;
      return { scrollTarget: Math.max(0, scrollPos - 24), hiddenCount: 0 };
    }
    return { scrollTarget: 0, hiddenCount: 0 };
  }

  // Compute positions from event data
  const { startHour, endHour } = context.timeRange;
  const positions = timedEvents.map(event => {
    const pos = calculateEventPosition(event, startHour, endHour, context.timezone);
    return { id: event.id, top: parseFloat(pos.top), height: parseFloat(pos.height) };
  });

  // If a focused event exists in timed events, center on it; otherwise first event
  let anchorTop: number;
  let anchorHeight = 0;
  const focusPos = context.focusEventId
    ? positions.find(p => p.id === context.focusEventId)
    : undefined;

  if (focusPos) {
    anchorTop = focusPos.top;
    anchorHeight = focusPos.height;
  } else {
    anchorTop = Math.min(...positions.map(p => p.top));
  }

  // Center the anchor in the viewport when focusing; top-align otherwise
  const scrollTarget = focusPos
    ? Math.max(0, anchorTop - (COMPACT_HEIGHT - anchorHeight) / 2)
    : Math.max(0, anchorTop - 8);

  // Count timed events whose top edge is fully below the compact viewport
  const viewBottom = scrollTarget + COMPACT_HEIGHT;
  let hiddenCount = 0;
  for (const pos of positions) {
    if (pos.top >= viewBottom) {
      hiddenCount++;
    }
  }

  return { scrollTarget, hiddenCount };
}

/**
 * Build the compact-mode toggle label, e.g. "Show more (3)" or "Show more".
 */
function compactToggleLabel(hiddenCount: number): string {
  return hiddenCount > 0 ? `Show more (${hiddenCount})` : 'Show more';
}

/**
 * Create a highlight filter chip element
 */
function createHighlightChip(
  matchCount: number,
  totalCount: number,
  label: string | undefined,
  onClear: () => void
): HTMLDivElement {
  const chip = document.createElement('div');
  chip.className = 'highlight-filter-chip';
  chip.setAttribute('data-highlight-chip', '');

  const labelEl = document.createElement('span');
  labelEl.className = 'highlight-chip-label';
  labelEl.textContent = label
    ? `${label} \u00b7 ${matchCount} of ${totalCount}`
    : `Showing ${matchCount} of ${totalCount} events`;
  chip.appendChild(labelEl);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'highlight-chip-close';
  closeBtn.setAttribute('aria-label', 'Clear filter');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', onClear);
  chip.appendChild(closeBtn);

  return chip;
}

/**
 * Main render function for single-day view
 */
export function renderDayView(
  context: DayContext,
  appInstance: App | null,
  domRefs: DOMRefs,
  toggleExpanded: () => void,
  stateRefs: { isExpanded: { value: boolean }; calendarFilters?: CalendarFilter[]; hiddenCalendarIds?: string[]; highlightedEventIds?: Set<string>; highlightLabel?: string },
  schedulingMode?: SchedulingMode,
  onSlotSelect?: (slot: AvailableSlot) => void,
  onFilterChange?: () => void,
  onEventClick?: (event: DayViewEvent) => void,
  onClearHighlight?: () => void
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
        const displayEvts = stateRefs.highlightedEventIds?.size
          ? visibleEvents.filter(e => stateRefs.highlightedEventIds!.has(e.id))
          : visibleEvents;
        // Update highlight chip counts
        const oldChip = domRefs.calendarLegendContainer?.querySelector('[data-highlight-chip]');
        if (oldChip) oldChip.remove();
        if (stateRefs.highlightedEventIds?.size && onClearHighlight && domRefs.calendarLegendContainer) {
          domRefs.calendarLegendContainer.appendChild(
            createHighlightChip(displayEvts.length, visibleEvents.length, stateRefs.highlightLabel, onClearHighlight)
          );
        }
        renderAllDayEvents(displayEvts, context.focusEventId, appInstance, domRefs, onEventClick);
        renderTimeGrid(context, appInstance, domRefs, displayEvts, schedulingMode, onSlotSelect, onEventClick);
        // Recompute scroll position and hidden-event count
        const info = computeCompactScrollInfo(context, displayEvts);
        domRefs.expandToggle.dataset.hiddenCount = String(info.hiddenCount);
        domRefs.expandToggle.dataset.scrollTarget = String(info.scrollTarget);
        if (!stateRefs.isExpanded.value) {
          domRefs.toggleText.textContent = compactToggleLabel(info.hiddenCount);
          smoothScrollTop(domRefs.timeGrid, info.scrollTarget);
        }
        onFilterChange?.();
      });
      domRefs.calendarLegendContainer.appendChild(legend);
    }
  }

  // Apply persisted filter visibility on initial render
  const initialEvents = filterVisibleEvents(context.events, filters);

  // Apply highlight filter (stacks with calendar filter)
  const totalEventCount = initialEvents.length;
  const displayEvents = stateRefs.highlightedEventIds?.size
    ? initialEvents.filter(e => stateRefs.highlightedEventIds!.has(e.id))
    : initialEvents;

  // Insert highlight filter chip
  const existingChip = domRefs.calendarLegendContainer?.querySelector('[data-highlight-chip]');
  if (existingChip) existingChip.remove();
  if (stateRefs.highlightedEventIds?.size && onClearHighlight && domRefs.calendarLegendContainer) {
    domRefs.calendarLegendContainer.appendChild(
      createHighlightChip(displayEvents.length, totalEventCount, stateRefs.highlightLabel, onClearHighlight)
    );
  }

  // Render all-day events
  renderAllDayEvents(displayEvents, context.focusEventId, appInstance, domRefs, onEventClick);

  // Render time grid with optional scheduling mode
  renderTimeGrid(context, appInstance, domRefs, displayEvents, schedulingMode, onSlotSelect, onEventClick);

  // Compute compact-mode scroll target and hidden-event count from event data
  const scrollInfo = computeCompactScrollInfo(context, displayEvents);

  // Show expand toggle and set up handler
  domRefs.expandToggle.style.display = '';
  domRefs.expandToggle.onclick = toggleExpanded;
  domRefs.expandToggle.dataset.hiddenCount = String(scrollInfo.hiddenCount);
  domRefs.expandToggle.dataset.scrollTarget = String(scrollInfo.scrollTarget);

  // Apply persisted expand state, or default to compact
  if (stateRefs.isExpanded.value) {
    domRefs.timeGrid.classList.remove('compact');
    domRefs.expandToggle.classList.add('expanded');
    domRefs.toggleText.textContent = 'Show less';
  } else {
    stateRefs.isExpanded.value = false;
    domRefs.timeGrid.classList.add('compact');
    domRefs.expandToggle.classList.remove('expanded');
    domRefs.toggleText.textContent = compactToggleLabel(scrollInfo.hiddenCount);

    // Set initial scroll position instantly (no animation on first paint).
    // computeCompactScrollInfo already centers on the focused event when present.
    void domRefs.timeGrid.offsetHeight; // force reflow so scrollTop sticks
    domRefs.timeGrid.scrollTop = scrollInfo.scrollTarget;
  }

  // For focused all-day events or expanded mode, scroll the element into view
  if (context.focusEventId) {
    setTimeout(() => {
      const focusedInAllDay = domRefs.allDayEvents.querySelector('.focused') as HTMLElement | null;
      if (focusedInAllDay) {
        focusedInAllDay.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (stateRefs.isExpanded.value) {
        // In expanded mode, scroll the focused timed event into the page
        const focusedInGrid = domRefs.timeGrid.querySelector('.focused') as HTMLElement | null;
        focusedInGrid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }
}

/**
 * Render multi-day view
 */
export function renderMultiDayView(
  context: MultiDayContext,
  appInstance: App | null,
  domRefs: DOMRefs,
  toggleDayExpanded: (dateStr: string) => void,
  stateRefs: { expandedDays: Set<string>; hostLocale?: string; highlightedEventIds?: Set<string>; highlightLabel?: string },
  schedulingMode?: SchedulingMode,
  onSlotSelect?: (slot: AvailableSlot) => void,
  onEventClick?: (event: DayViewEvent) => void,
  onClearHighlight?: () => void
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

  // Remove existing highlight chip
  domRefs.multiDaySubheading.parentElement?.querySelector('[data-highlight-chip]')?.remove();

  const hasHighlight = (stateRefs.highlightedEventIds?.size ?? 0) > 0;

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
    let highlightMatchCount = 0;

    for (const date of context.dates) {
      let events = context.eventsByDate[date] || [];
      if (hasHighlight) {
        events = events.filter(e => stateRefs.highlightedEventIds!.has(e.id));
        highlightMatchCount += events.length;
      }
      if (events.length > 0) {
        // Calculate available slots for this day if scheduling mode is enabled
        const availableSlots = schedulingMode?.enabled
          ? calculateAvailableSlots(events, schedulingMode.durationMinutes, 9, 17, context.timezone)
          : undefined;
        const isExpanded = stateRefs.expandedDays.has(date);
        const dateGroup = createDateGroup(
          date,
          events,
          appInstance,
          toggleDayExpanded,
          context.focusEventId,
          availableSlots,
          onSlotSelect,
          isExpanded,
          onEventClick,
          context.timezone
        );
        domRefs.multiDayEventsList.appendChild(dateGroup);
      }
    }

    // Insert highlight chip after subheading
    if (hasHighlight && onClearHighlight) {
      const chip = createHighlightChip(
        highlightMatchCount,
        context.totalEventCount,
        stateRefs.highlightLabel,
        onClearHighlight
      );
      domRefs.multiDaySubheading.after(chip);
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
