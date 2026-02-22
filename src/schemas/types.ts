// Type-safe response based on Google Calendar FreeBusy API
export interface FreeBusyResponse {
  kind: "calendar#freeBusy";
  timeMin: string;
  timeMax: string;
  groups?: {
    [key: string]: {
      errors?: { domain: string; reason: string }[];
      calendars?: string[];
    };
  };
  calendars: {
    [key: string]: {
      errors?: { domain: string; reason: string }[];
      busy: {
        start: string;
        end: string;
      }[];
    };
  };
}