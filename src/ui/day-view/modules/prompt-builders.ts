/**
 * Prompt builders for generating natural-language messages
 * sent to the model via sendMessage (RSVP actions, slot selection, etc.)
 */

export interface RsvpPromptOpts {
  action: 'accept' | 'tentative' | 'decline';
  summary: string;
  date: string;       // ISO date string (e.g. "2025-01-15")
  eventId: string;
  calendarId: string;
  accountId?: string;
  locale?: string;
}

export interface SlotSelectPromptOpts {
  startTime: string;   // formatted time string (e.g. "9 AM")
  endTime: string;     // formatted time string (e.g. "10 AM")
  date?: string;       // ISO date string (e.g. "2025-01-15")
  locale?: string;
}

const ACTION_VERBS: Record<RsvpPromptOpts['action'], string> = {
  accept: 'accept',
  tentative: 'mark as tentative',
  decline: 'decline'
};

function formatDateNatural(isoDate: string, locale?: string): string {
  const date = new Date(isoDate + 'T00:00:00');
  return date.toLocaleDateString(locale || 'en-US', {
    month: 'long',
    day: 'numeric'
  });
}

export function buildRsvpPrompt(opts: RsvpPromptOpts): string {
  const verb = ACTION_VERBS[opts.action];
  const dateFormatted = formatDateNatural(opts.date, opts.locale);

  let prompt = `Please ${verb} "${opts.summary}" on ${dateFormatted}.`;

  const metaParts = [`Event ID: ${opts.eventId}`, `calendar: ${opts.calendarId}`];
  if (opts.accountId) {
    metaParts.push(`account: ${opts.accountId}`);
  }
  prompt += `\n(${metaParts.join(', ')})`;
  prompt += `\nNote (optional): `;

  return prompt;
}

export function buildSlotSelectPrompt(opts: SlotSelectPromptOpts): string {
  if (opts.date) {
    const dateFormatted = formatDateNatural(opts.date, opts.locale);
    return `Schedule a new event on ${dateFormatted} from ${opts.startTime} to ${opts.endTime}`;
  }
  return `Schedule at ${opts.startTime} – ${opts.endTime}`;
}
