# OAuth scope profiles

`GOOGLE_CALENDAR_MCP_SCOPE_PROFILE` chooses the event scope used by both OAuth
transports and service-account clients:

- `standard` (default): `calendar.events`
- `owned`: `calendar.events.owned`, for events on calendars owned by the account
- `readonly`: `calendar.events.readonly`

All profiles also request `calendar.calendarlist.readonly`,
`calendar.calendars.readonly`, and `calendar.events.freebusy` to support calendar
discovery, metadata/timezones, and availability. No profile requests full
`calendar` access, calendar deletion/creation, or sharing administration.

The owned profile cannot read events on calendars merely shared with the account.
Metadata and free/busy access are still broader.
Google event-write scopes include event deletion; an OAuth scope cannot provide
"create/update but never delete". Exclude `delete-event` through tool filtering,
but do not mistake that for a restriction on the token itself.

Configure the same profile in the server and the standalone auth command.
Changing settings does not revoke an existing token's granted permissions.
Revoke the old grant in Google Account settings and authenticate again when
narrowing the profile.
