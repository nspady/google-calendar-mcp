# Feature Roadmap

Long-term planning document for Google Calendar MCP improvements, informed by research across three user personas (busy professional, family coordinator, personal life planner), competitor analysis, and community feedback.

**Last updated:** 2026-02-05

---

## Guiding Principles

1. **Intelligence layer over raw data.** The Google Calendar API already exposes the data. The MCP's value is in reasoning on top of it — computing availability intersections, generating summaries, detecting cross-calendar conflicts. Do the deterministic math server-side so LLMs don't have to.
2. **Extended properties as the metadata backbone.** Google Calendar supports 300 key-value pairs per event. Establishing conventions (category, person, habit, etc.) unlocks tagging, filtering, and analytics without any new API scopes.
3. **Enhance existing tools before adding new ones.** Adding an `availableSlots` field to `check-availability` is better than creating a separate `find-available-time` tool. Less surface area, less for LLMs to choose between.
4. **All personas benefit from the same primitives.** "Find available time" serves the executive scheduling a meeting, the parent finding a family window, and the friend planning dinner. Build general tools, not persona-specific ones.

---

## Phase 1: Quick Wins

Low effort, immediate value, no new API endpoints needed.

### 1.1 Rename `get-freebusy` to `check-availability` and Add Slot Computation

**What:** Rename `get-freebusy` to `check-availability` and add an optional `slotDuration` parameter (in minutes). When `slotDuration` is provided, the response includes a computed `availableSlots` array — time windows where ALL queried calendars are simultaneously free, filtered to slots that fit the requested duration.

**Why rename:** "freebusy" is Google API jargon that doesn't match how users or LLMs think about the operation. When someone asks "when is everyone free?", an LLM choosing between 11+ tools is much more likely to reach for `check-availability` than `get-freebusy`. The name should match the intent.

**Why add slot computation:** Finding mutual availability is the #1 scheduling pain point across all three personas. The current tool returns raw busy blocks per calendar, forcing the LLM to compute the inverse, find intersections, and filter by duration. This is error-prone math — especially with many participants and timezone differences. A competitor MCP (`deciduus/calendar-mcp`) already offers "find mutual free slots" as a standalone tool. By adding this to the existing tool's response, we close the gap without adding tool sprawl.

**API feasibility:** No new API calls. The Google `freebusy.query` response already contains all the data. The slot computation is pure server-side logic: invert busy blocks to free blocks, intersect across calendars, filter by minimum duration.

**Scenarios:**
- Professional: "Find a 60-min slot for me, the CTO, and our London PM next week"
- Family: "When are both parents free for a 2-hour window on Saturday?"
- Personal: "Find a 90-min block I can use for deep work tomorrow"

### 1.2 Expose `eventType` Filter on `list-events` and `search-events`

**What:** Add an optional `eventType` parameter to `list-events` and `search-events` schemas, passing through to the Google API's `eventType` filter. Supported values: `default`, `birthday`, `focusTime`, `fromGmail`, `outOfOffice`, `workingLocation`.

**Why:** The `birthday` event type (added to the API September 2024) is entirely untapped. Users can't query "show me upcoming birthdays" without this filter. Similarly, filtering for `focusTime` or `outOfOffice` events enables analytics and briefing features downstream.

**API feasibility:** Direct passthrough to existing `events.list` parameter. Trivial.

### 1.3 Add `get-settings` Tool

**What:** New tool that reads calendar user settings via `settings.list` API. Returns timezone, locale, date/time format, week start day, default event length, and other preferences.

**Why:** Provides context that every other tool benefits from. The LLM currently has to infer or ask about timezone and preferences. Settings are also useful for a future briefing tool to format output correctly.

**API feasibility:** Direct `settings.list` call. 12 documented settings keys. Trivial implementation following the existing handler pattern.

---

## Phase 2: Intelligence Layer

Medium effort, high value. These build on Phase 1 primitives.

### 2.1 Calendar Analytics / Time Audit Tool

**What:** New `analyze-time` tool that fetches events for a date range and returns a structured breakdown: total hours in events, breakdown by calendar/color/category, meeting count, average duration, busiest days, free time analysis, and comparison against optional targets.

**Why:** Every persona needs this. Professionals track meeting load (the average knowledge worker spends 25+ hours/week in meetings). Families check activity balance across kids. Personal users audit life-area allocation. Third-party tools (Clockwise, Flowtrace) charge $4-8/user/month for this. The data is already available via `events.list` — the value is entirely in the computation and presentation.

**API feasibility:** Pure client-side analytics over existing `events.list` data. No new API endpoints.

### 2.2 Schedule Briefing Tool

**What:** New `get-briefing` tool that generates a structured daily or weekly summary. Groups events by time-of-day, flags back-to-back meetings, highlights cross-timezone considerations, aggregates meeting links, identifies conflicts and free windows, and provides at-a-glance density ratings per day.

**Why:** Everyone does this manually — the professional scanning their morning schedule, the parent doing "Sunday night planning," the personal user checking their day's intentions. A well-structured briefing replaces 10-15 minutes of manual calendar parsing.

**API feasibility:** Uses existing `events.list` across calendars with enriched formatting and analysis. Could also use `get-settings` (Phase 1.3) for timezone/format preferences.

### 2.3 Cross-Calendar Conflict Scanner

**What:** New `check-conflicts` tool that proactively scans for conflicts across multiple calendars within a time range. Returns overlapping events, near-miss events (configurable buffer), and events where all relevant parties are busy.

**Why:** The existing conflict detection only fires when creating or updating a single event. Families need proactive scanning ("do any kid activities overlap next week requiring two drivers?"). Professionals need it for delegation ("which of my meetings conflict with the team offsite?"). Builds directly on the existing `ConflictDetectionService` architecture.

**API feasibility:** Uses existing `events.list` across calendars. Extends the existing `ConflictAnalyzer` pattern to cross-calendar scenarios.

### 2.4 Focus Time Protection

**What:** Enhance the existing `create-event` flow (which already supports `eventType: 'focusTime'`) with a higher-level `protect-focus-time` tool that: scans for available windows, creates `focusTime` events with auto-decline settings, supports recurring patterns, and reports on how much focus time was protected vs. overridden.

**Why:** This is the core value proposition of Clockwise and Reclaim.ai ($4-8/user/month). The MCP already supports creating focus time events — the gap is the intelligence around optimal placement and ongoing management.

**API feasibility:** Combines existing `get-freebusy` + `create-event` with `focusTime` type. Note: `focusTime` auto-decline requires Google Workspace (not available on free Gmail).

---

## Phase 3: Calendar Management

Features for managing the calendar ecosystem itself, not just events.

### 3.1 Calendar Sharing / ACL Management

**What:** New `manage-calendar-sharing` tool supporting list, add, update, and remove operations on calendar access control lists.

**Why:** Critical for families setting up shared calendars and professionals delegating to EAs. Currently requires the Google Calendar web UI. The Composio MCP competitor already offers this.

**API feasibility:** Google Calendar API has complete ACL support (`acl.list`, `acl.insert`, `acl.update`, `acl.delete`). Well-documented, straightforward.

### 3.2 Create / Delete Calendars

**What:** New tools to create and delete secondary calendars via `calendars.insert` and `calendars.delete`.

**Why:** Setting up per-kid, per-project, or per-life-area calendars is the first step in organized calendar use. Currently requires the web UI. Competitors (Composio) offer this.

**API feasibility:** Direct API calls. `calendars.insert` takes a title and optional description/timezone. `calendars.delete` takes a calendar ID.

### 3.3 Out of Office / Working Location Workflow

**What:** Higher-level tools wrapping the existing `outOfOffice` and `workingLocation` event types. OOO: create multi-day ranges, preview impacted events, configure auto-decline messages. Working location: batch-set patterns for hybrid work (e.g., "home Mon/Fri, office Tue-Thu for the next month").

**API feasibility:** The MCP already supports both event types in `create-event`. These tools add workflow convenience — multi-day expansion, batch creation, impact preview.

---

## Phase 4: Extended Property Conventions & Lifestyle Features

Features that rely on establishing metadata conventions via Google Calendar's extended properties.

### 4.1 Establish Extended Property Conventions

**What:** Define and document standard `sharedExtendedProperty` keys for tagging events with metadata:
- `gcalmcp_category`: sports, school, medical, social, lessons, work, personal, wellness, creative
- `gcalmcp_person`: name of the family member or person the event is for
- `gcalmcp_habit`: true/false, marks habit/routine events
- `gcalmcp_transport`: true/false, flags events requiring logistics coordination
- `gcalmcp_prep_N` / `gcalmcp_prep_done_N`: event-linked preparation items

**Why:** This is the foundation for family search, habit tracking, time analytics by category, and prep lists. The conventions need to be established before building tools that consume them. Prefix keys with `gcalmcp_` to avoid collisions.

**API feasibility:** Extended properties support up to 300 key-value pairs per event (values up to 1024 chars each). Filtering by `sharedExtendedProperty` is already supported in `events.list`.

### 4.2 Enhanced Recurring Event Creation

**What:** Add friendlier parameters to `create-event` for recurring patterns: `seasonStart`/`seasonEnd` (auto-generates RRULE with UNTIL), `skipDates` (auto-generates EXDATE), and category/person tagging via extended properties.

**Why:** Families manage seasonal activities (soccer Sept-Nov, piano during school year). Personal users create habits. Currently both require hand-writing RRULE strings. Higher-level abstractions make recurring events accessible.

### 4.3 Habit & Routine Management

**What:** A `manage-habits` tool that creates recurring events with habit metadata, tracks streaks via extended property updates, and lists active habits by querying `privateExtendedProperty: habit=true`.

**Why:** Habit tracking via calendar is a widely practiced personal productivity pattern (Atomic Habits, Don't Break the Chain). The value-add over raw `create-event` is the streamlined workflow and streak tracking.

### 4.4 Event-Linked Prep Lists

**What:** Tools to add, list, and complete preparation items stored in event extended properties. E.g., "Pack soccer bag" linked to Thursday's practice.

**Why:** Families constantly associate action items with events. Google Calendar doesn't natively support event-linked to-dos (Tasks is a separate API), but extended properties provide a workable simulation within the existing API.

---

## Phase 5: Future Explorations

Lower priority or requiring further research.

- **Google Tasks integration** — Requested in GitHub issue #147. Separate API (`tasks.googleapis.com`) with its own OAuth scope. Would require adding the Tasks scope and a new set of handlers.
- **Calendar push notifications / watch** — `events.watch` enables real-time change monitoring via webhooks. Requires a publicly accessible callback URL, making it complex for local/stdio deployments.
- **Meeting cost estimation** — Calculate approximate cost of meetings based on attendee count and configurable hourly rates. Powerful for meeting culture pushback.
- **Recurring meeting audit** — Scan recurring meetings for hygiene: total monthly time cost, low-attendance patterns, missing agendas.
- **Quick availability text generation** — Generate a human-readable "here are my available slots" message formatted for pasting into email or chat.

---

## Open Issues to Address

- **#162** — Remote server OAuth flow is broken (EISDIR error). Users on headless servers can't complete the OAuth callback. Need a manual token provisioning path.
- **#142** — Server-level calendar filtering. Users exposing the MCP publicly need config-based include/exclude to prevent personal calendar access.

---

## Competitive Context

| Capability | Clockwise | Reclaim.ai | Motion | deciduus MCP | This MCP (Current) | This MCP (Roadmap) |
|---|---|---|---|---|---|---|
| Find available slots | Yes | Yes | Yes | Yes | Raw data only | Phase 1.1 |
| Calendar analytics | Yes | Limited | No | No | No | Phase 2.1 |
| Schedule briefing | No | No | Yes | No | No | Phase 2.2 |
| Focus time protection | Yes | Yes | No | No | Create only | Phase 2.4 |
| Cross-calendar conflicts | Partial | Partial | No | No | Create-time only | Phase 2.3 |
| Calendar management (ACL) | No | No | No | No | No | Phase 3.1 |
| Create/delete calendars | No | No | No | Yes | No | Phase 3.2 |
| OOO/working location | No | Yes | No | No | Create only | Phase 3.3 |
| Habit scheduling | No | Yes | No | No | No | Phase 4.3 |
| Birthday tracking | No | No | No | No | No | Phase 1.2 |
