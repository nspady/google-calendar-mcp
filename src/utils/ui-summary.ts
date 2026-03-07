import { StructuredEvent, ConflictInfo, DuplicateInfo } from '../types/structured-responses.js';

/**
 * Formats a StructuredEvent's time for compact display.
 * Returns e.g. "9:00 AM-10:00 AM" or "all-day"
 */
function formatEventTime(event: StructuredEvent): string {
  if (event.start.date) return 'all-day';

  const startDt = event.start.dateTime;
  const endDt = event.end.dateTime;
  if (!startDt) return '';

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const start = formatTime(startDt);
  if (!endDt) return start;
  return `${start}-${formatTime(endDt)}`;
}

/**
 * Formats a single event as a compact line for LLM consumption.
 */
function formatEventLine(event: StructuredEvent): string {
  const title = event.summary || '(no title)';
  const time = formatEventTime(event);
  const calendar = event.calendarName ? ` [${event.calendarName}]` : '';
  return `- ${time}: ${title}${calendar}`;
}

/**
 * Generates a compact LLM summary for list-events responses.
 */
function summarizeListEvents(data: any): string {
  const events: StructuredEvent[] = data.events || [];
  const count = data.totalCount ?? events.length;
  const lines: string[] = [];

  lines.push(`${count} event${count !== 1 ? 's' : ''} found.`);

  if (data.warnings?.length) {
    lines.push(`Warnings: ${data.warnings.join('; ')}`);
  }

  for (const event of events) {
    lines.push(formatEventLine(event));
  }

  if (data.dayContext) {
    lines.push('Calendar UI displayed with full details.');
  }

  return lines.join('\n');
}

/**
 * Generates a compact LLM summary for search-events responses.
 */
function summarizeSearchEvents(data: any): string {
  const events: StructuredEvent[] = data.events || [];
  const count = data.totalCount ?? events.length;
  const lines: string[] = [];

  lines.push(`${count} result${count !== 1 ? 's' : ''} for "${data.query}".`);

  if (data.warnings?.length) {
    lines.push(`Warnings: ${data.warnings.join('; ')}`);
  }

  for (const event of events) {
    lines.push(formatEventLine(event));
  }

  return lines.join('\n');
}

/**
 * Formats conflict/duplicate warnings as compact text.
 */
function formatConflictWarnings(conflicts?: ConflictInfo[], duplicates?: DuplicateInfo[]): string[] {
  const lines: string[] = [];
  if (conflicts?.length) {
    lines.push(`${conflicts.length} conflict${conflicts.length !== 1 ? 's' : ''}: ${conflicts.map(c => c.event.title).join(', ')}`);
  }
  if (duplicates?.length) {
    lines.push(`${duplicates.length} potential duplicate${duplicates.length !== 1 ? 's' : ''}: ${duplicates.map(d => d.event.title).join(', ')}`);
  }
  return lines;
}

/**
 * Generates a compact LLM summary for create-event responses.
 */
function summarizeCreateEvent(data: any): string {
  const event: StructuredEvent = data.event;
  const lines: string[] = [];

  const title = event.summary || '(no title)';
  const time = formatEventTime(event);
  lines.push(`Created: ${title} (${time}).`);

  lines.push(...formatConflictWarnings(data.conflicts, data.duplicates));

  if (data.dayContext) {
    lines.push('Calendar UI displayed.');
  }

  return lines.join('\n');
}

/**
 * Generates a compact LLM summary for update-event responses.
 */
function summarizeUpdateEvent(data: any): string {
  const event: StructuredEvent = data.event;
  const lines: string[] = [];

  const title = event.summary || '(no title)';
  const time = formatEventTime(event);
  lines.push(`Updated: ${title} (${time}).`);

  lines.push(...formatConflictWarnings(data.conflicts));

  if (data.dayContext) {
    lines.push('Calendar UI displayed.');
  }

  return lines.join('\n');
}

/**
 * Generates a compact LLM summary for ui-get-day-events responses.
 */
function summarizeDayEvents(data: any): string {
  const ctx = data.dayContext;
  if (!ctx) return 'Day view displayed.';

  const eventCount = ctx.events?.length ?? 0;
  return `Day view for ${ctx.date}: ${eventCount} event${eventCount !== 1 ? 's' : ''}. Calendar UI displayed.`;
}

/**
 * Generates a compact LLM summary for get-event / ui-get-event-details responses.
 */
function summarizeGetEvent(data: any): string {
  const event: StructuredEvent = data.event;
  const title = event.summary || '(no title)';
  const time = formatEventTime(event);
  const parts = [`${title} (${time})`];

  if (event.location) parts.push(`at ${event.location}`);
  if (event.attendees?.length) parts.push(`with ${event.attendees.length} attendee${event.attendees.length !== 1 ? 's' : ''}`);
  if (event.hangoutLink || event.conferenceData) parts.push('has video call');

  return parts.join(', ') + '. Calendar UI displayed.';
}

/**
 * Generates a compact text summary for an LLM, given a tool name and its response data.
 * Returns undefined if no summary can be generated for the tool.
 */
export function generateToolSummary(toolName: string, data: any): string | undefined {
  switch (toolName) {
    case 'list-events':
      return summarizeListEvents(data);
    case 'search-events':
      return summarizeSearchEvents(data);
    case 'create-event':
      return summarizeCreateEvent(data);
    case 'update-event':
      return summarizeUpdateEvent(data);
    case 'ui-get-day-events':
      return summarizeDayEvents(data);
    case 'ui-get-event-details':
    case 'get-event':
      return summarizeGetEvent(data);
    default:
      return undefined;
  }
}
