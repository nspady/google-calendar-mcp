import { App, applyHostStyleVariables, applyHostFonts, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

// Import formatting functions
import { setHostContext, formatTime, formatSlotTime } from './modules/formatting.js';

// Import renderers
import {
  renderDayView,
  renderMultiDayView,
  renderSkeletonView,
  showLoadingState,
  showCancelledState,
  type DOMRefs
} from './modules/renderers.js';

// Import state management
import { toggleExpanded, toggleDayExpanded } from './modules/state-management.js';

// Import context extraction
import { extractDayContext, extractMultiDayContext, isCreateUpdateResponse } from './modules/context-extraction.js';

// Import types for context tracking
import type { DayContext, MultiDayContext, CalendarFilter, DayViewEvent, AvailableSlot } from './modules/types.js';

// DOM element references - Day view
const dayViewContainer = document.getElementById('day-view-container') as HTMLDivElement;
const dayViewHeader = document.getElementById('day-view-header') as HTMLDivElement;
const dateHeading = document.getElementById('date-heading') as HTMLHeadingElement;
const dayLink = document.getElementById('day-link') as HTMLAnchorElement;
const calendarLegendContainer = document.getElementById('calendar-legend-container') as HTMLDivElement;
const allDaySection = document.getElementById('all-day-section') as HTMLDivElement;
const allDayEvents = document.getElementById('all-day-events') as HTMLDivElement;
const timeGrid = document.getElementById('time-grid') as HTMLDivElement;
const expandToggle = document.getElementById('expand-toggle') as HTMLButtonElement;
const toggleText = document.getElementById('toggle-text') as HTMLSpanElement;
const dayFullscreenBtn = document.getElementById('day-fullscreen-btn') as HTMLButtonElement;
const dayRefreshBtn = document.getElementById('day-refresh-btn') as HTMLButtonElement;

// DOM element references - Multi-day view
const multiDayViewContainer = document.getElementById('multi-day-view-container') as HTMLDivElement;
const multiDayHeading = document.getElementById('multi-day-heading') as HTMLHeadingElement;
const multiDaySubheading = document.getElementById('multi-day-subheading') as HTMLDivElement;
const multiDayLink = document.getElementById('multi-day-link') as HTMLAnchorElement;
const multiDayEventsList = document.getElementById('multi-day-events-list') as HTMLDivElement;
const multiDayFullscreenBtn = document.getElementById('multi-day-fullscreen-btn') as HTMLButtonElement;
const multiDayRefreshBtn = document.getElementById('multi-day-refresh-btn') as HTMLButtonElement;

// DOM element references - Event detail overlay
const eventDetailOverlay = document.getElementById('event-detail-overlay') as HTMLDivElement;
const eventDetailCard = eventDetailOverlay.querySelector('.event-detail-card') as HTMLDivElement;
const eventDetailContent = document.getElementById('event-detail-content') as HTMLDivElement;

// Global app instance for opening links (sandboxed iframe requires app.openLink)
let appInstance: App | null = null;

// Track last click Y position for popup positioning (captured in click phase)
let lastClickY = window.innerHeight / 2;
document.addEventListener('click', (e) => { lastClickY = e.clientY; }, true);

// Skeleton rendering flag: render skeleton only once per tool call cycle
let skeletonRendered = false;

// State references
const stateRefs = {
  isExpanded: { value: false },
  expandedDays: new Set<string>(),
  hostLocale: undefined as string | undefined,
  viewKey: undefined as string | undefined,
  hiddenCalendarIds: undefined as string[] | undefined
};

// --- View state persistence via localStorage ---

const STORAGE_KEY = 'dayview-states';
const MAX_STORED_VIEWS = 20;

interface PersistedViewState {
  isExpanded: boolean;
  expandedDays: string[];
  hiddenCalendarIds?: string[];
  timestamp: number;
}

function deriveViewKey(context: { date?: string; dates?: string[]; query?: string }): string {
  if (context.date) return `day:${context.date}`;
  if (context.dates) return `multi:${context.dates.join(',')}:${context.query || ''}`;
  return '';
}

function loadViewState(viewKey: string): PersistedViewState | null {
  if (!viewKey) return null;
  try {
    const cache = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return cache[viewKey] || null;
  } catch {
    return null;
  }
}

function saveViewState(viewKey: string, state: { isExpanded: boolean; expandedDays: Set<string> }): void {
  if (!viewKey) return;
  // Extract hidden calendar IDs from current filters
  const hiddenIds = (stateRefs as { calendarFilters?: CalendarFilter[] }).calendarFilters
    ?.filter(f => !f.visible)
    .map(f => f.accountId ? `${f.accountId}:${f.calendarId}` : f.calendarId) || [];
  try {
    const cache: Record<string, PersistedViewState> = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    cache[viewKey] = {
      isExpanded: state.isExpanded,
      expandedDays: Array.from(state.expandedDays),
      hiddenCalendarIds: hiddenIds.length > 0 ? hiddenIds : undefined,
      timestamp: Date.now()
    };

    // Evict oldest entries if over limit
    const keys = Object.keys(cache);
    if (keys.length > MAX_STORED_VIEWS) {
      keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
      for (let i = 0; i < keys.length - MAX_STORED_VIEWS; i++) {
        delete cache[keys[i]];
      }
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be unavailable in sandboxed iframe
  }
}

// Callback fired after any state toggle — persists to localStorage and updates model context
function onStateChange(): void {
  if (stateRefs.viewKey) {
    saveViewState(stateRefs.viewKey, {
      isExpanded: stateRefs.isExpanded.value,
      expandedDays: stateRefs.expandedDays
    });
  }
  sendModelContextUpdate();
}

// --- Refresh via callServerTool ---

let refreshInProgress = false;

// --- Cross-calendar background fetch for create/update responses ---

let crossCalendarFetchInProgress = false;
let lastCrossCalendarArgs: { date: string; timeZone: string; focusEventId: string } | null = null;

async function fetchCrossCalendarDayEvents(
  date: string, timezone: string, focusEventId: string
): Promise<void> {
  if (!appInstance || crossCalendarFetchInProgress) return;

  crossCalendarFetchInProgress = true;
  lastCrossCalendarArgs = { date, timeZone: timezone, focusEventId };

  try {
    const result = await appInstance.callServerTool({
      name: 'ui-get-day-events',
      arguments: { date, timeZone: timezone, focusEventId }
    });

    if (result.isError) return;

    // Stale check: user may have triggered another tool
    if (currentDayContext?.date !== date) return;

    const dayContext = extractDayContext(result);
    if (dayContext) {
      currentDayContext = dayContext;
      renderDayView(
        dayContext,
        appInstance,
        domRefs,
        () => toggleExpanded(appInstance, domRefs, stateRefs, onStateChange),
        stateRefs,
        undefined,
        undefined,
        sendModelContextUpdate,
        showEventDetails
      );
      sendModelContextUpdate();
    }
  } catch {
    // Silent failure — single-calendar view is already displayed
  } finally {
    crossCalendarFetchInProgress = false;
  }
}

async function refreshEvents(): Promise<void> {
  if (!appInstance || refreshInProgress) return;

  // If the current view originated from a cross-calendar fetch, use ui-get-day-events for refresh
  if (lastCrossCalendarArgs) {
    refreshInProgress = true;
    showLoadingState(domRefs);
    try {
      const result = await appInstance.callServerTool({
        name: 'ui-get-day-events',
        arguments: lastCrossCalendarArgs
      });
      if (result.isError) {
        showCancelledState(domRefs, 'Refresh failed');
        return;
      }
      const dayContext = extractDayContext(result);
      if (dayContext) {
        currentDayContext = dayContext;
        currentMultiDayContext = null;
        renderDayView(
          dayContext,
          appInstance,
          domRefs,
          () => toggleExpanded(appInstance, domRefs, stateRefs, onStateChange),
          stateRefs,
          undefined,
          undefined,
          sendModelContextUpdate,
          showEventDetails
        );
        sendModelContextUpdate();
      }
    } catch {
      showCancelledState(domRefs, 'Refresh failed');
    } finally {
      refreshInProgress = false;
    }
    return;
  }

  if (!lastToolInputArgs || !lastToolName) return;

  refreshInProgress = true;
  showLoadingState(domRefs);

  try {
    const result = await appInstance.callServerTool({
      name: lastToolName,
      arguments: lastToolInputArgs
    });

    if (result.isError) {
      showCancelledState(domRefs, 'Refresh failed');
      return;
    }

    // Process the result through the same pipeline as ontoolresult
    const multiDayContext = extractMultiDayContext(result);
    if (multiDayContext) {
      currentDayContext = null;
      currentMultiDayContext = multiDayContext;
      renderMultiDayView(
        multiDayContext,
        appInstance,
        domRefs,
        (dateStr: string) => toggleDayExpanded(dateStr, appInstance, stateRefs.expandedDays, onStateChange),
        stateRefs,
        undefined, // schedulingMode
        handleSlotSelect,
        showEventDetails // onEventClick
      );
      sendModelContextUpdate();
      return;
    }

    const dayContext = extractDayContext(result);
    if (dayContext) {
      currentDayContext = dayContext;
      currentMultiDayContext = null;
      renderDayView(
        dayContext,
        appInstance,
        domRefs,
        () => toggleExpanded(appInstance, domRefs, stateRefs, onStateChange),
        stateRefs,
        undefined, // schedulingMode
        handleSlotSelect,
        onStateChange, // onFilterChange — persists hidden calendars and updates model context
        showEventDetails // onEventClick
      );
      sendModelContextUpdate();
    }
  } catch {
    showCancelledState(domRefs, 'Refresh failed');
  } finally {
    refreshInProgress = false;
  }
}

// --- Slot selection via sendMessage ---

function handleSlotSelect(slot: AvailableSlot): void {
  if (!appInstance) return;
  const caps = appInstance.getHostCapabilities?.();
  if (!caps?.message) return;

  const startStr = formatSlotTime(slot.startMinutes);
  const endStr = formatSlotTime(slot.endMinutes);
  appInstance.sendMessage({
    role: 'user',
    content: [{ type: 'text', text: `Schedule at ${startStr} – ${endStr}` }]
  }).catch(() => {});
}

// --- Display mode (fullscreen toggle) ---

let currentDisplayMode: 'inline' | 'fullscreen' = 'inline';

function updateFullscreenIcons(): void {
  const isFullscreen = currentDisplayMode === 'fullscreen';
  const ns = 'http://www.w3.org/2000/svg';

  for (const btn of [dayFullscreenBtn, multiDayFullscreenBtn]) {
    const svg = btn.querySelector('svg');
    if (!svg) continue;

    // Remove existing children
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    if (isFullscreen) {
      // Collapse icon: arrows pointing inward
      const pl1 = document.createElementNS(ns, 'polyline');
      pl1.setAttribute('points', '4 14 10 14 10 20');
      svg.appendChild(pl1);
      const pl2 = document.createElementNS(ns, 'polyline');
      pl2.setAttribute('points', '20 10 14 10 14 4');
      svg.appendChild(pl2);
      const l1 = document.createElementNS(ns, 'line');
      l1.setAttribute('x1', '10'); l1.setAttribute('y1', '14'); l1.setAttribute('x2', '3'); l1.setAttribute('y2', '21');
      svg.appendChild(l1);
      const l2 = document.createElementNS(ns, 'line');
      l2.setAttribute('x1', '14'); l2.setAttribute('y1', '10'); l2.setAttribute('x2', '21'); l2.setAttribute('y2', '3');
      svg.appendChild(l2);
    } else {
      // Expand icon: arrows pointing outward
      const pl1 = document.createElementNS(ns, 'polyline');
      pl1.setAttribute('points', '15 3 21 3 21 9');
      svg.appendChild(pl1);
      const pl2 = document.createElementNS(ns, 'polyline');
      pl2.setAttribute('points', '9 21 3 21 3 15');
      svg.appendChild(pl2);
      const l1 = document.createElementNS(ns, 'line');
      l1.setAttribute('x1', '21'); l1.setAttribute('y1', '3'); l1.setAttribute('x2', '14'); l1.setAttribute('y2', '10');
      svg.appendChild(l1);
      const l2 = document.createElementNS(ns, 'line');
      l2.setAttribute('x1', '3'); l2.setAttribute('y1', '21'); l2.setAttribute('x2', '10'); l2.setAttribute('y2', '14');
      svg.appendChild(l2);
    }
  }
}

function toggleDisplayMode(): void {
  if (!appInstance) return;
  const next = currentDisplayMode === 'inline' ? 'fullscreen' : 'inline';
  appInstance.requestDisplayMode({ mode: next }).then(() => {
    currentDisplayMode = next;
    updateFullscreenIcons();
  }).catch(() => {});
}

// --- Event detail overlay ---

function hideEventDetails(): void {
  eventDetailOverlay.style.display = 'none';
}

function sanitizeDescription(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('script, style, iframe, object, embed, form, input, textarea, select')) {
    el.remove();
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

function showEventDetails(event: DayViewEvent): void {
  // Clear previous content
  while (eventDetailContent.firstChild) {
    eventDetailContent.removeChild(eventDetailContent.firstChild);
  }

  // Build initial overlay with data we already have
  const header = document.createElement('div');
  header.className = 'event-detail-header';

  const colorBar = document.createElement('div');
  colorBar.className = 'event-detail-color-bar';
  if (event.backgroundColor) {
    colorBar.style.backgroundColor = event.backgroundColor;
  }
  header.appendChild(colorBar);

  const meta = document.createElement('div');
  meta.className = 'event-detail-meta';

  const title = document.createElement('div');
  title.className = 'event-detail-title';
  title.textContent = event.summary || '(No title)';
  meta.appendChild(title);

  // Time
  if (!event.isAllDay) {
    const timeRow = document.createElement('div');
    timeRow.className = 'event-detail-row';
    timeRow.textContent = `${formatTime(event.start)} – ${formatTime(event.end)}`;
    meta.appendChild(timeRow);
  } else {
    const allDayRow = document.createElement('div');
    allDayRow.className = 'event-detail-row';
    allDayRow.textContent = 'All day';
    meta.appendChild(allDayRow);
  }

  // Location
  if (event.location) {
    const locRow = document.createElement('div');
    locRow.className = 'event-detail-row';
    locRow.textContent = event.location;
    meta.appendChild(locRow);
  }

  // Calendar name
  if (event.calendarName) {
    const calRow = document.createElement('div');
    calRow.className = 'event-detail-row';
    calRow.textContent = event.calendarName;
    meta.appendChild(calRow);
  }

  header.appendChild(meta);
  eventDetailContent.appendChild(header);

  // Loading indicator for full details
  const loading = document.createElement('div');
  loading.className = 'event-detail-loading';
  loading.textContent = 'Loading details...';
  eventDetailContent.appendChild(loading);

  // Actions (Open in Calendar)
  const actions = document.createElement('div');
  actions.className = 'event-detail-actions';
  const openBtn = document.createElement('a');
  openBtn.className = 'open-calendar-btn';
  openBtn.textContent = 'Open in Calendar';
  openBtn.href = '#';
  openBtn.onclick = (e) => {
    e.preventDefault();
    if (appInstance) {
      appInstance.openLink({ url: event.htmlLink }).catch(() => {
        window.open(event.htmlLink, '_blank');
      });
    }
  };
  actions.appendChild(openBtn);
  eventDetailContent.appendChild(actions);

  // Position card near the clicked event
  const targetTop = Math.max(32, lastClickY - 80);
  const maxTop = Math.max(32, window.innerHeight - 300);
  eventDetailCard.style.top = `${Math.min(targetTop, maxTop)}px`;

  // Show the overlay
  eventDetailOverlay.style.display = '';

  // Fetch full event details in the background
  if (appInstance && event.calendarId && event.id) {
    appInstance.callServerTool({
      name: 'ui-get-event-details',
      arguments: {
        calendarId: event.calendarId,
        eventId: event.id,
        ...(event.accountId && { account: event.accountId })
      }
    }).then(result => {
      // Remove loading indicator
      loading.remove();

      if (result.isError) return;

      // Parse the response
      const textBlock = result.content?.find(
        (c: { type: string; text?: string }) => c.type === 'text' && c.text
      ) as { type: string; text: string } | undefined;
      if (!textBlock) return;

      try {
        const data = JSON.parse(textBlock.text);
        const fullEvent = data.event;
        if (!fullEvent) return;

        // Add description if available
        if (fullEvent.description) {
          const desc = document.createElement('div');
          desc.className = 'event-detail-description';
          // Render HTML from Google Calendar descriptions (sanitized to remove dangerous elements)
          desc.innerHTML = sanitizeDescription(fullEvent.description);
          // Make links work in sandboxed iframe
          for (const link of desc.querySelectorAll('a')) {
            const href = link.getAttribute('href');
            if (href) {
              link.addEventListener('click', (e) => {
                e.preventDefault();
                if (appInstance) {
                  appInstance.openLink({ url: href }).catch(() => {
                    window.open(href, '_blank');
                  });
                }
              });
            }
          }
          // Insert before actions
          eventDetailContent.insertBefore(desc, actions);
        }

        // Add conference link if available
        if (fullEvent.conferenceData?.entryPoints) {
          const videoEntry = fullEvent.conferenceData.entryPoints.find(
            (ep: { entryPointType: string; uri: string }) => ep.entryPointType === 'video'
          );
          if (videoEntry) {
            const confBtn = document.createElement('a');
            confBtn.className = 'event-detail-conference';
            confBtn.textContent = 'Join meeting';
            confBtn.href = '#';
            confBtn.onclick = (e) => {
              e.preventDefault();
              if (appInstance) {
                appInstance.openLink({ url: videoEntry.uri }).catch(() => {
                  window.open(videoEntry.uri, '_blank');
                });
              }
            };
            actions.insertBefore(confBtn, actions.firstChild);
          }
        }

        // Add attendees if available
        if (fullEvent.attendees && fullEvent.attendees.length > 0) {
          const attendeesSection = document.createElement('div');
          attendeesSection.className = 'event-detail-attendees';

          const label = document.createElement('div');
          label.className = 'event-detail-attendees-label';
          label.textContent = `Attendees (${fullEvent.attendees.length})`;
          attendeesSection.appendChild(label);

          for (const attendee of fullEvent.attendees.slice(0, 10)) {
            const item = document.createElement('div');
            item.className = 'event-detail-attendee';
            const name = attendee.displayName || attendee.email || 'Unknown';
            const statusText = attendee.responseStatus === 'accepted' ? 'accepted' :
                               attendee.responseStatus === 'declined' ? 'declined' :
                               attendee.responseStatus === 'tentative' ? 'tentative' : '';
            item.textContent = name;
            if (statusText) {
              const status = document.createElement('span');
              status.className = 'event-detail-attendee-status';
              status.textContent = ` (${statusText})`;
              item.appendChild(status);
            }
            attendeesSection.appendChild(item);
          }

          if (fullEvent.attendees.length > 10) {
            const more = document.createElement('div');
            more.className = 'event-detail-attendee';
            more.textContent = `+${fullEvent.attendees.length - 10} more`;
            more.style.color = 'var(--text-tertiary)';
            attendeesSection.appendChild(more);
          }

          // Insert before actions
          eventDetailContent.insertBefore(attendeesSection, actions);
        }

        // Add model action buttons (Edit, Delete, RSVP) if host supports sendMessage
        const caps = appInstance?.getHostCapabilities?.();
        if (caps?.message && appInstance) {
          const modelActions = document.createElement('div');
          modelActions.className = 'event-detail-model-actions';

          const dateStr = event.start.split('T')[0] || '';
          const timeStr = !event.isAllDay ? formatTime(event.start) : '';

          const editBtn = document.createElement('button');
          editBtn.className = 'event-action-btn';
          editBtn.textContent = 'Edit';
          editBtn.onclick = () => {
            hideEventDetails();
            appInstance!.sendMessage({
              role: 'user',
              content: [{ type: 'text', text: `Edit the event "${event.summary}"${timeStr ? ` at ${timeStr}` : ''} on ${dateStr}` }]
            }).catch(() => {});
          };
          modelActions.appendChild(editBtn);

          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'event-action-btn event-action-danger';
          deleteBtn.textContent = 'Delete';
          deleteBtn.onclick = () => {
            hideEventDetails();
            appInstance!.sendMessage({
              role: 'user',
              content: [{ type: 'text', text: `Delete the event "${event.summary}" on ${dateStr}` }]
            }).catch(() => {});
          };
          modelActions.appendChild(deleteBtn);

          // RSVP buttons if user has a response status
          const selfStatus = fullEvent.attendees?.find(
            (a: { self?: boolean }) => a.self
          )?.responseStatus as string | undefined;
          if (selfStatus) {
            const rsvpRow = document.createElement('div');
            rsvpRow.className = 'event-detail-rsvp-actions';

            for (const [label, status] of [['Accept', 'accepted'], ['Maybe', 'tentative'], ['Decline', 'declined']] as const) {
              const btn = document.createElement('button');
              btn.className = `event-action-btn event-action-rsvp${selfStatus === status ? ' active' : ''}`;
              btn.textContent = label;
              btn.onclick = () => {
                hideEventDetails();
                appInstance!.sendMessage({
                  role: 'user',
                  content: [{ type: 'text', text: `${label} the event "${event.summary}" on ${dateStr}` }]
                }).catch(() => {});
              };
              rsvpRow.appendChild(btn);
            }
            modelActions.appendChild(rsvpRow);
          }

          eventDetailContent.insertBefore(modelActions, actions);
        }
      } catch {
        // Failed to parse response - just keep showing basic info
      }
    }).catch(() => {
      loading.textContent = '';
    });
  } else {
    loading.remove();
  }
}

// Host context for locale/timezone formatting (stored here, used by imported modules)
let hostLocale: string | undefined;
let hostTimeZone: string | undefined;

// Current rendered context (for model context updates and refresh)
let currentDayContext: DayContext | null = null;
let currentMultiDayContext: MultiDayContext | null = null;

// Last query params for refresh (stored from tool input)
let lastToolInputArgs: Record<string, unknown> | null = null;
let lastToolName: string | null = null;

// --- Model context sync ---

let modelContextTimer: ReturnType<typeof setTimeout> | undefined;
const MODEL_CONTEXT_DEBOUNCE_MS = 150;

function sendModelContextUpdate(): void {
  if (!appInstance) return;

  clearTimeout(modelContextTimer);
  modelContextTimer = setTimeout(() => {
    if (!appInstance) return;

    const lines: string[] = [];

    if (currentDayContext) {
      lines.push(`View: single-day`);
      lines.push(`Date: ${currentDayContext.date}`);
      lines.push(`Events: ${currentDayContext.events.length}`);
      lines.push(`Expanded: ${stateRefs.isExpanded.value}`);
    } else if (currentMultiDayContext) {
      lines.push(`View: multi-day`);
      lines.push(`Dates: ${currentMultiDayContext.dates.length} days`);
      lines.push(`Events: ${currentMultiDayContext.totalEventCount}`);
      if (currentMultiDayContext.query) {
        lines.push(`Query: ${currentMultiDayContext.query}`);
      }
      if (stateRefs.expandedDays.size > 0) {
        lines.push(`Expanded days: ${Array.from(stateRefs.expandedDays).join(', ')}`);
      }
    }

    // Report hidden calendars
    const hiddenCalendars = (stateRefs as { calendarFilters?: CalendarFilter[] }).calendarFilters
      ?.filter(f => !f.visible)
      .map(f => f.displayName) || [];
    if (hiddenCalendars.length > 0) {
      lines.push(`Hidden calendars: ${hiddenCalendars.join(', ')}`);
    }

    if (lines.length === 0) return;

    // Build structured content alongside text
    const structured: Record<string, unknown> = {};
    if (currentDayContext) {
      structured.viewType = 'single-day';
      structured.date = currentDayContext.date;
      structured.timezone = currentDayContext.timezone;
      structured.eventCount = currentDayContext.events.length;
      structured.expanded = stateRefs.isExpanded.value;
      structured.events = currentDayContext.events.map(e => ({
        id: e.id, summary: e.summary, start: e.start, end: e.end,
        isAllDay: e.isAllDay, calendarId: e.calendarId
      }));
    } else if (currentMultiDayContext) {
      structured.viewType = 'multi-day';
      structured.dates = currentMultiDayContext.dates;
      structured.timezone = currentMultiDayContext.timezone;
      structured.totalEventCount = currentMultiDayContext.totalEventCount;
      if (currentMultiDayContext.query) structured.query = currentMultiDayContext.query;
      if (stateRefs.expandedDays.size > 0) {
        structured.expandedDays = Array.from(stateRefs.expandedDays);
      }
    }
    if (hiddenCalendars.length > 0) {
      structured.hiddenCalendars = hiddenCalendars;
    }

    appInstance.updateModelContext({
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: structured
    }).catch(() => {
      // Host may not support updateModelContext
    });
  }, MODEL_CONTEXT_DEBOUNCE_MS);
}

// Create DOM references object
const domRefs: DOMRefs = {
  // Day view
  dayViewContainer,
  dayViewHeader,
  dateHeading,
  dayLink,
  calendarLegendContainer,
  allDaySection,
  allDayEvents,
  timeGrid,
  expandToggle,
  toggleText,

  // Multi-day view
  multiDayViewContainer,
  multiDayHeading,
  multiDaySubheading,
  multiDayLink,
  multiDayEventsList
};

/**
 * Apply host styles and context if available
 */
function applyHostStyles(app: App): void {
  const context = app.getHostContext();
  if (!context) return;

  // Store locale and timezone for date/time formatting (in both local vars and formatting module)
  if (context.locale) {
    hostLocale = context.locale;
    stateRefs.hostLocale = context.locale;
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

  // Apply safe area insets from host (overrides CSS env() defaults)
  if (context.safeAreaInsets) {
    const root = document.documentElement;
    root.style.setProperty('--safe-area-top', `${context.safeAreaInsets.top}px`);
    root.style.setProperty('--safe-area-right', `${context.safeAreaInsets.right}px`);
    root.style.setProperty('--safe-area-bottom', `${context.safeAreaInsets.bottom}px`);
    root.style.setProperty('--safe-area-left', `${context.safeAreaInsets.left}px`);
  }
}

/**
 * Initialize the app
 */
async function init(): Promise<void> {
  const app = new App(
    { name: 'DayView', version: '1.0.0' },
    {
      availableDisplayModes: ['inline', 'fullscreen'],
      tools: {}
    }
  );

  // Store app instance globally for openLink calls
  appInstance = app;

  // Handle partial tool input - show skeleton preview with available hints
  app.ontoolinputpartial = (params) => {
    if (skeletonRendered) return;
    skeletonRendered = true;

    const args = params.arguments as Record<string, unknown> | undefined;
    const hints: { date?: string; timeZone?: string; query?: string } = {};

    if (args) {
      try {
        // Extract date from timeMin (e.g., "2025-01-15T00:00:00")
        const timeMin = args.timeMin as string | undefined;
        if (timeMin && timeMin.length >= 10) {
          hints.date = timeMin.split('T')[0];
        }
        if (typeof args.timeZone === 'string') {
          hints.timeZone = args.timeZone;
        }
        if (typeof args.query === 'string') {
          hints.query = args.query;
        }
      } catch {
        // Partial args may be malformed — use whatever we have
      }
    }

    renderSkeletonView(domRefs, hints);
  };

  // Handle tool input - show loading state while tool executes
  app.ontoolinput = (params) => {
    skeletonRendered = false;

    // Store tool input args for refresh functionality
    const args = params.arguments as Record<string, unknown> | undefined;
    if (args) {
      lastToolInputArgs = { ...args };
      // Infer tool name from arguments
      lastToolName = typeof args.query === 'string' ? 'search-events' : 'list-events';
    }

    showLoadingState(domRefs);
  };

  // Handle tool results
  app.ontoolresult = (params) => {
    // Check for multi-day context first (multi-day queries, search results)
    const multiDayContext = extractMultiDayContext(params);
    if (multiDayContext) {
      // Track current context for model updates
      currentDayContext = null;
      currentMultiDayContext = multiDayContext;

      // Derive view key and restore persisted state
      const viewKey = deriveViewKey({ dates: multiDayContext.dates, query: multiDayContext.query });
      stateRefs.viewKey = viewKey;
      const saved = loadViewState(viewKey);
      if (saved) {
        stateRefs.expandedDays = new Set(saved.expandedDays);
        stateRefs.hiddenCalendarIds = saved.hiddenCalendarIds;
      } else {
        stateRefs.hiddenCalendarIds = undefined;
      }

      renderMultiDayView(
        multiDayContext,
        appInstance,
        domRefs,
        (dateStr: string) => toggleDayExpanded(dateStr, appInstance, stateRefs.expandedDays, onStateChange),
        stateRefs,
        undefined, // schedulingMode
        handleSlotSelect,
        showEventDetails // onEventClick
      );
      multiDayRefreshBtn.style.display = lastToolInputArgs ? '' : 'none';
      sendModelContextUpdate();
      return;
    }

    // Check for single-day context (single-day queries)
    const dayContext = extractDayContext(params);
    if (dayContext) {
      // Track current context for model updates
      currentDayContext = dayContext;
      currentMultiDayContext = null;

      // Derive view key and restore persisted state
      const viewKey = deriveViewKey({ date: dayContext.date });
      stateRefs.viewKey = viewKey;
      const saved = loadViewState(viewKey);
      if (saved) {
        stateRefs.isExpanded.value = saved.isExpanded;
        stateRefs.hiddenCalendarIds = saved.hiddenCalendarIds;
      } else {
        stateRefs.hiddenCalendarIds = undefined;
      }

      renderDayView(
        dayContext,
        appInstance,
        domRefs,
        () => toggleExpanded(appInstance, domRefs, stateRefs, onStateChange),
        stateRefs,
        undefined, // schedulingMode
        handleSlotSelect,
        onStateChange, // onFilterChange — persists hidden calendars and updates model context
        showEventDetails // onEventClick
      );
      dayRefreshBtn.style.display = lastToolInputArgs ? '' : 'none';
      sendModelContextUpdate();

      // For create/update responses, trigger background cross-calendar fetch
      const createUpdateInfo = isCreateUpdateResponse(params);
      if (createUpdateInfo) {
        fetchCrossCalendarDayEvents(
          createUpdateInfo.date, createUpdateInfo.timezone, createUpdateInfo.focusEventId
        );
      } else {
        // Reset cross-calendar args when view comes from list-events/search-events
        lastCrossCalendarArgs = null;
      }
    }
  };

  // Handle tool cancellation
  app.ontoolcancelled = (params) => {
    showCancelledState(domRefs, params.reason);
  };

  // Handle host context changes (theme, locale, display mode, etc.)
  app.onhostcontextchanged = () => {
    applyHostStyles(app);
    // Update display mode from host if it changed
    const ctx = app.getHostContext();
    if (ctx?.displayMode && ctx.displayMode !== currentDisplayMode) {
      currentDisplayMode = ctx.displayMode as 'inline' | 'fullscreen';
      updateFullscreenIcons();
    }
  };

  // Handle graceful teardown
  app.onteardown = async () => {
    // Clean up any resources if needed
    appInstance = null;
    return {};
  };

  // --- App-exposed tools (oncalltool/onlisttools) ---

  function reRenderCurrentView(): void {
    if (currentDayContext) {
      renderDayView(
        currentDayContext,
        appInstance,
        domRefs,
        () => toggleExpanded(appInstance, domRefs, stateRefs, onStateChange),
        stateRefs,
        undefined,
        handleSlotSelect,
        onStateChange,
        showEventDetails
      );
    } else if (currentMultiDayContext) {
      renderMultiDayView(
        currentMultiDayContext,
        appInstance,
        domRefs,
        (dateStr: string) => toggleDayExpanded(dateStr, appInstance, stateRefs.expandedDays, onStateChange),
        stateRefs,
        undefined,
        handleSlotSelect,
        showEventDetails
      );
    }
    sendModelContextUpdate();
  }

  app.onlisttools = async () => ({
    tools: ['navigate-to-date', 'set-calendar-filter', 'set-display-mode']
  });

  app.oncalltool = async (params) => {
    const args = (params.arguments || {}) as Record<string, unknown>;

    switch (params.name) {
      case 'navigate-to-date': {
        const date = args.date as string | undefined;
        if (!date || !appInstance) {
          return { content: [{ type: 'text', text: 'Missing required parameter: date' }], isError: true };
        }
        const timeZone = (args.timeZone as string) || currentDayContext?.timezone || 'UTC';
        try {
          const result = await appInstance.callServerTool({
            name: 'ui-get-day-events',
            arguments: { date, timeZone, focusEventId: '' }
          });
          if (result.isError) {
            return { content: [{ type: 'text', text: 'Failed to fetch events' }], isError: true };
          }
          const dayContext = extractDayContext(result);
          if (dayContext) {
            currentDayContext = dayContext;
            currentMultiDayContext = null;
            lastCrossCalendarArgs = { date, timeZone, focusEventId: '' };
            const viewKey = deriveViewKey({ date });
            stateRefs.viewKey = viewKey;
            const saved = loadViewState(viewKey);
            if (saved) {
              stateRefs.isExpanded.value = saved.isExpanded;
              stateRefs.hiddenCalendarIds = saved.hiddenCalendarIds;
            } else {
              stateRefs.hiddenCalendarIds = undefined;
            }
            reRenderCurrentView();
            return { content: [{ type: 'text', text: `Navigated to ${date}` }] };
          }
          return { content: [{ type: 'text', text: 'No events found' }] };
        } catch {
          return { content: [{ type: 'text', text: 'Failed to navigate' }], isError: true };
        }
      }

      case 'set-calendar-filter': {
        const calendarName = args.calendarName as string | undefined;
        const visible = args.visible as boolean | undefined;
        if (calendarName === undefined || visible === undefined) {
          return { content: [{ type: 'text', text: 'Missing required parameters: calendarName, visible' }], isError: true };
        }
        const filters = (stateRefs as { calendarFilters?: CalendarFilter[] }).calendarFilters;
        if (!filters) {
          return { content: [{ type: 'text', text: 'No calendar filters available' }], isError: true };
        }
        const filter = filters.find(f => f.displayName.toLowerCase() === calendarName.toLowerCase());
        if (!filter) {
          const names = filters.map(f => f.displayName).join(', ');
          return { content: [{ type: 'text', text: `Calendar "${calendarName}" not found. Available: ${names}` }], isError: true };
        }
        filter.visible = visible;
        reRenderCurrentView();
        return { content: [{ type: 'text', text: `${visible ? 'Showing' : 'Hiding'} calendar "${filter.displayName}"` }] };
      }

      case 'set-display-mode': {
        const mode = args.mode as string | undefined;
        if (mode !== 'inline' && mode !== 'fullscreen') {
          return { content: [{ type: 'text', text: 'Invalid mode. Use "inline" or "fullscreen"' }], isError: true };
        }
        if (!appInstance) {
          return { content: [{ type: 'text', text: 'App not connected' }], isError: true };
        }
        try {
          await appInstance.requestDisplayMode({ mode });
          currentDisplayMode = mode;
          updateFullscreenIcons();
          return { content: [{ type: 'text', text: `Display mode set to ${mode}` }] };
        } catch {
          return { content: [{ type: 'text', text: `Failed to set display mode to ${mode}` }], isError: true };
        }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${params.name}` }], isError: true };
    }
  };

  try {
    await app.connect();
    applyHostStyles(app);

    // Wire up fullscreen toggle buttons (show only if host supports fullscreen)
    const hostContext = app.getHostContext();
    const supportsFullscreen = hostContext?.availableDisplayModes?.includes?.('fullscreen');
    if (supportsFullscreen) {
      dayFullscreenBtn.style.display = '';
      multiDayFullscreenBtn.style.display = '';
      dayFullscreenBtn.addEventListener('click', toggleDisplayMode);
      multiDayFullscreenBtn.addEventListener('click', toggleDisplayMode);
    }

    // Wire up refresh buttons
    const refreshHandler = () => { refreshEvents(); };
    dayRefreshBtn.addEventListener('click', refreshHandler);
    multiDayRefreshBtn.addEventListener('click', refreshHandler);

    // Wire up event detail overlay close handlers
    const backdrop = eventDetailOverlay.querySelector('.event-detail-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', hideEventDetails);
    }
    const closeBtn = eventDetailOverlay.querySelector('.event-detail-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hideEventDetails);
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && eventDetailOverlay.style.display !== 'none') {
        hideEventDetails();
      }
    });
  } catch (error) {
    console.error('Failed to connect to host:', error);
    domRefs.dateHeading.textContent = 'Failed to connect';
  }
}

// Start the app
init();
