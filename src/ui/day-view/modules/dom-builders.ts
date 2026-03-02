/**
 * DOM builder functions for creating event elements
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { DayViewEvent, CalendarFilter } from './types.js';
import {
  formatTime
} from './formatting.js';
import {
  getEventColorClass,
  openLink
} from './utilities.js';

/**
 * Create small inline SVG icons for event metadata (conference, attendees, recurring, event type, RSVP)
 */
function createEventIcons(event: DayViewEvent): HTMLSpanElement | null {
  const hasIcons = event.hasConferenceLink || (event.attendeeCount && event.attendeeCount > 1) ||
    event.isRecurring || event.eventType || event.selfResponseStatus === 'needsAction';
  if (!hasIcons) return null;

  const container = document.createElement('span');
  container.className = 'event-icons';

  const makeSvg = (path: string, title: string): SVGSVGElement => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.classList.add('event-icon');
    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleEl.textContent = title;
    svg.appendChild(titleEl);
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', path);
    svg.appendChild(pathEl);
    return svg;
  };

  if (event.hasConferenceLink) {
    container.appendChild(makeSvg(
      'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
      'Video meeting'
    ));
  }

  if (event.attendeeCount && event.attendeeCount > 1) {
    container.appendChild(makeSvg(
      'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
      `${event.attendeeCount} attendees`
    ));
  }

  if (event.isRecurring) {
    container.appendChild(makeSvg(
      'M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3',
      'Recurring event'
    ));
  }

  if (event.eventType) {
    const label = document.createElement('span');
    label.className = 'event-type-label';
    label.textContent = event.eventType === 'focusTime' ? 'Focus' :
      event.eventType === 'outOfOffice' ? 'OOO' :
      event.eventType === 'workingLocation' ? 'WFH' : event.eventType;
    container.appendChild(label);
  }

  if (event.selfResponseStatus === 'needsAction') {
    const badge = document.createElement('span');
    badge.className = 'event-badge-needs-response';
    badge.textContent = 'RSVP';
    container.appendChild(badge);
  }

  return container;
}

/**
 * Create an event element (safe DOM methods, no innerHTML)
 * Uses click handlers with app.openLink() for sandboxed iframe compatibility
 */
export function createEventElement(
  event: DayViewEvent,
  isFocused: boolean,
  appInstance: App | null,
  isAllDay: boolean = false,
  onEventClick?: (event: DayViewEvent) => void
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
  tooltipParts.push(onEventClick ? 'Click for details' : 'Click to open in Google Calendar');
  element.title = tooltipParts.join('\n');

  // Handle click: show detail overlay if callback provided, otherwise open in calendar
  const handleClick = () => {
    if (onEventClick) {
      onEventClick(event);
    } else {
      openLink(event.htmlLink, appInstance);
    }
  };
  element.addEventListener('click', handleClick);
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  });

  // Use backgroundColor directly if available, otherwise fall back to colorId class
  const colorClass = event.backgroundColor ? '' : getEventColorClass(event.colorId);

  // Check if event has ended (for past event styling)
  const now = new Date();
  const eventEnd = new Date(event.end);
  const isPast = eventEnd < now;

  if (isAllDay) {
    element.className = `all-day-event ${colorClass} ${isFocused ? 'focused' : ''} ${isPast ? 'event-past' : ''}`.trim();
    if (event.backgroundColor) {
      element.style.backgroundColor = event.backgroundColor;
    }
    const allDayText = document.createElement('span');
    allDayText.textContent = event.summary;
    element.appendChild(allDayText);

    // Add metadata icons for all-day events
    const allDayIcons = createEventIcons(event);
    if (allDayIcons) element.appendChild(allDayIcons);
  } else {
    element.className = `event-block ${colorClass} ${isFocused ? 'focused' : ''} ${isPast ? 'event-past' : ''}`.trim();
    if (event.backgroundColor) {
      element.style.backgroundColor = event.backgroundColor;
    }

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

    // Add metadata icons
    const icons = createEventIcons(event);
    if (icons) contentDiv.appendChild(icons);

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
 * Create the calendar legend for the day view header
 * Shows all calendars with color dots, names, event counts, and toggle visibility
 */
export function createCalendarLegend(
  filters: CalendarFilter[],
  onToggle: (filter: CalendarFilter) => void
): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'calendar-legend';

  for (const filter of filters) {
    const item = document.createElement('button');
    item.className = `calendar-legend-item${filter.visible ? '' : ' hidden'}`;
    item.setAttribute('role', 'checkbox');
    item.setAttribute('aria-checked', filter.visible ? 'true' : 'false');
    item.title = filter.visible
      ? `Click to hide ${filter.displayName} events`
      : `Click to show ${filter.displayName} events`;

    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.backgroundColor = filter.backgroundColor;
    item.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = filter.displayName;
    item.appendChild(name);

    const count = document.createElement('span');
    count.className = 'legend-count';
    count.textContent = `(${filter.eventCount})`;
    item.appendChild(count);

    item.addEventListener('click', () => {
      filter.visible = !filter.visible;
      item.classList.toggle('hidden', !filter.visible);
      item.setAttribute('aria-checked', filter.visible ? 'true' : 'false');
      item.title = filter.visible
        ? `Click to hide ${filter.displayName} events`
        : `Click to show ${filter.displayName} events`;
      onToggle(filter);
    });

    container.appendChild(item);
  }

  return container;
}
