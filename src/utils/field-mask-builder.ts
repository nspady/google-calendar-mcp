/**
 * Field mask builder for Google Calendar API partial response
 */

// Allowed fields that can be requested from Google Calendar API
export const ALLOWED_EVENT_FIELDS = [
  'id',
  'summary',
  'description',
  'start',
  'end',
  'location',
  'attendees',
  'colorId',
  'transparency',
  'extendedProperties',
  'reminders',
  'conferenceData',
  'attachments',
  'status',
  'htmlLink',
  'created',
  'updated',
  'creator',
  'organizer',
  'recurrence',
  'recurringEventId',
  'originalStartTime',
  'visibility',
  'iCalUID',
  'sequence',
  'hangoutLink',
  'anyoneCanAddSelf',
  'guestsCanInviteOthers',
  'guestsCanModify',
  'guestsCanSeeOtherGuests',
  'privateCopy',
  'locked',
  'source',
  'eventType'
] as const;

export type AllowedEventField = typeof ALLOWED_EVENT_FIELDS[number];

// Default fields always included
export const DEFAULT_EVENT_FIELDS: AllowedEventField[] = [
  'id',
  'summary',
  'start',
  'end',
  'status',
  'htmlLink',
  'location',
  'attendees',
  'reminders',
  'recurrence'
];

/**
 * Validates that requested fields are allowed
 */
export function validateFields(fields: string[]): AllowedEventField[] {
  const validFields: AllowedEventField[] = [];
  const invalidFields: string[] = [];
  
  for (const field of fields) {
    if (ALLOWED_EVENT_FIELDS.includes(field as AllowedEventField)) {
      validFields.push(field as AllowedEventField);
    } else {
      invalidFields.push(field);
    }
  }
  
  if (invalidFields.length > 0) {
    throw new Error(`Invalid fields requested: ${invalidFields.join(', ')}. Allowed fields: ${ALLOWED_EVENT_FIELDS.join(', ')}`);
  }
  
  return validFields;
}

/**
 * Builds a Google Calendar API field mask for partial response
 * @param requestedFields Optional array of additional fields to include
 * @param includeDefaults Whether to include default fields (default: true)
 * @returns Field mask string for Google Calendar API
 */
export function buildEventFieldMask(
  requestedFields?: string[], 
  includeDefaults: boolean = true
): string | undefined {
  // If no custom fields requested and we should include defaults, return undefined
  // to let Google API return its default field set
  if (!requestedFields || requestedFields.length === 0) {
    return undefined;
  }
  
  // Validate requested fields
  const validFields = validateFields(requestedFields);
  
  // Combine with defaults if needed
  const allFields = includeDefaults 
    ? [...new Set([...DEFAULT_EVENT_FIELDS, ...validFields])]
    : validFields;
  
  // Build the field mask for events.list
  // Format: items(field1,field2,field3)
  return `items(${allFields.join(',')})`;
}

/**
 * Builds a field mask for a single event (events.get)
 */
export function buildSingleEventFieldMask(
  requestedFields?: string[],
  includeDefaults: boolean = true
): string | undefined {
  // If no custom fields requested, return undefined for default response
  if (!requestedFields || requestedFields.length === 0) {
    return undefined;
  }
  
  // Validate requested fields
  const validFields = validateFields(requestedFields);
  
  // Combine with defaults if needed
  const allFields = includeDefaults 
    ? [...new Set([...DEFAULT_EVENT_FIELDS, ...validFields])]
    : validFields;
  
  // For single event, just return comma-separated fields
  return allFields.join(',');
}

/**
 * Builds the full field mask parameter for list operations
 * Includes nextPageToken, nextSyncToken, etc.
 */
export function buildListFieldMask(
  requestedFields?: string[],
  includeDefaults: boolean = true
): string | undefined {
  // If no custom fields requested, return undefined for default response
  if (!requestedFields || requestedFields.length === 0) {
    return undefined;
  }
  
  const eventFieldMask = buildEventFieldMask(requestedFields, includeDefaults);
  if (!eventFieldMask) {
    return undefined;
  }
  
  // Include pagination tokens and other list metadata
  return `${eventFieldMask},nextPageToken,nextSyncToken,kind,etag,summary,updated,timeZone,accessRole,defaultReminders`;
}