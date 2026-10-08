/**
 * Event labels (custom event colors) support.
 *
 * Labels are defined per calendar in Calendars.labelProperties.eventLabels and
 * assigned to events via Events.eventLabelId. The installed googleapis typings
 * predate the feature, so the extra fields are typed here.
 *
 * Writing eventLabelId requires the eventLabelVersion=1 query parameter, which
 * only insert/import/update/patch accept. With it set, Google ignores the
 * legacy colorId. Reads (get/list) return eventLabelId without any parameter.
 */
import { calendar_v3 } from 'googleapis';

export const EVENT_LABEL_VERSION = 1;

export type EventWithLabel = calendar_v3.Schema$Event & {
  eventLabelId?: string | null;
};

export interface GoogleEventLabel {
  id?: string | null;
  name?: string | null;
  backgroundColor?: string | null;
}

export type CalendarWithLabels = calendar_v3.Schema$Calendar & {
  labelProperties?: {
    eventLabels?: GoogleEventLabel[] | null;
  } | null;
};

/**
 * Query params for a write: eventLabelVersion=1 only when the body sets eventLabelId.
 * Sending the version without the field can clear an existing label and makes
 * Google ignore any colorId, so it is never sent unconditionally.
 */
export function eventLabelParams(eventLabelId: string | null | undefined): { eventLabelVersion?: number } {
  return eventLabelId !== undefined && eventLabelId !== null
    ? { eventLabelVersion: EVENT_LABEL_VERSION }
    : {};
}
