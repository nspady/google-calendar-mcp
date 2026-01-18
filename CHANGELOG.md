# Changelog

## [2.4.1](https://github.com/nspady/google-calendar-mcp/compare/v2.4.0...v2.4.1) (2026-01-18)


### Bug Fixes

* add gaxios as direct dependency ([00a0755](https://github.com/nspady/google-calendar-mcp/commit/00a0755fd29cf4070a4534917d36c2860da695fa))

## [2.4.0](https://github.com/nspady/google-calendar-mcp/compare/v2.3.1...v2.4.0) (2026-01-18)


### Features

* add dayOfWeek to get-current-time response ([#159](https://github.com/nspady/google-calendar-mcp/issues/159)) ([cf588b8](https://github.com/nspady/google-calendar-mcp/commit/cf588b8f77cf3754a84e2d2d98e5d1c7999c15a6))
* add startDayOfWeek and endDayOfWeek to StructuredEvent ([#157](https://github.com/nspady/google-calendar-mcp/issues/157)) ([49342fc](https://github.com/nspady/google-calendar-mcp/commit/49342fccc5f01423b942d7af0663fa39e2f9fa3e))
* add tool description token analysis for PRs ([ee56e8c](https://github.com/nspady/google-calendar-mcp/commit/ee56e8cbcc198f1de70fc2a0782ddbfab06af916))

## [2.3.1](https://github.com/nspady/google-calendar-mcp/compare/v2.3.0...v2.3.1) (2026-01-07)


### Features

* consolidate event types into create-event tool ([#151](https://github.com/nspady/google-calendar-mcp/issues/151)) ([7bbacf8](https://github.com/nspady/google-calendar-mcp/commit/7bbacf8f7dd4a5a9e3a4f0f6c38917401c49d0af))

## [2.3.0](https://github.com/nspady/google-calendar-mcp/compare/v2.2.0...v2.3.0) (2026-01-06)


### Features

* Add Focus Time, Out of Office, and Working Location event types ([#144](https://github.com/nspady/google-calendar-mcp/issues/144)) ([ee5f870](https://github.com/nspady/google-calendar-mcp/commit/ee5f870830d0c9f10b01d3624ebd2c24764bf928))
* add tool filtering via --enable-tools flag ([#149](https://github.com/nspady/google-calendar-mcp/issues/149)) ([7cdba06](https://github.com/nspady/google-calendar-mcp/commit/7cdba06a0339d37d6f3616d7a984039ffadc8e88))


### Bug Fixes

* **update-event:** preserve attendee responseStatus when updating attendees ([#148](https://github.com/nspady/google-calendar-mcp/issues/148)) ([48d5f3f](https://github.com/nspady/google-calendar-mcp/commit/48d5f3f28b563cc8b83d2a64a9ecb6fa59111761))

## [2.2.0](https://github.com/nspady/google-calendar-mcp/compare/v2.1.0...v2.2.0) (2025-12-07)


### Features

* add manage-accounts tool for in-chat account management ([#139](https://github.com/nspady/google-calendar-mcp/issues/139)) ([9d938b0](https://github.com/nspady/google-calendar-mcp/commit/9d938b0856ad0e4c74a60bd50de22a367ced8630))
* support account-id in auth CLI command ([#137](https://github.com/nspady/google-calendar-mcp/issues/137)) ([cbdf2db](https://github.com/nspady/google-calendar-mcp/commit/cbdf2dbd13e8ad758b54281ba6248d0c0bf26165))

## [2.1.0](https://github.com/nspady/google-calendar-mcp/compare/v2.0.7...v2.1.0) (2025-12-06)


### Features

* Multi-account support with smart calendar routing and security hardening ([#132](https://github.com/nspady/google-calendar-mcp/issues/132)) ([11fff7f](https://github.com/nspady/google-calendar-mcp/commit/11fff7f9206150f612c75fafca82c75dbff8268a))
* respond-to-event tool with multi-account support ([#136](https://github.com/nspady/google-calendar-mcp/issues/136)) ([7ccfae4](https://github.com/nspady/google-calendar-mcp/commit/7ccfae44be387d8f484a731a7ecd622490a424e2))


### Bug Fixes

* handle "primary" calendar alias for single-account mode ([b3949d2](https://github.com/nspady/google-calendar-mcp/commit/b3949d2b0a1402f210332d61d53d35afc0168c1f))
* prevent origin bypass via subdomain in HTTP transport ([f8cacd6](https://github.com/nspady/google-calendar-mcp/commit/f8cacd68d5509eb1872e6ebcf23723e672934ef4))

## [Unreleased]

### Added
- **Multi-account support**: Connect and manage multiple Google accounts simultaneously
  - Query events across all accounts with automatic result merging
  - Permission-based account auto-selection for write operations
  - Case-insensitive account nicknames and calendar name resolution
- **`manage-accounts` tool**: Add, list, and remove Google accounts directly from chat - no terminal or browser needed
- **Account management UI**: Web-based interface at `/accounts` endpoint (HTTP mode)
- **CalendarRegistry service**: Centralized calendar discovery with caching and deduplication

### Changed
- All tools now accept optional `account` parameter for explicit account selection
- Read operations (list-events, list-calendars, get-freebusy) query all accounts when `account` is omitted
- Write operations auto-select account with appropriate calendar permissions
- Token storage format now supports multiple accounts (automatic migration from single-account format)

### Fixed
- Race conditions in token refresh and cache operations
- HTTP transport security hardening (origin validation, input sanitization)

### Backwards Compatibility
- Fully backwards compatible: existing single-account setups work unchanged
- Automatic token migration on first load (no manual intervention required)
- All new parameters are optional with sensible defaults

## [2.0.7](https://github.com/nspady/google-calendar-mcp/compare/v2.0.6...v2.0.7) (2025-11-05)


### Bug Fixes

* add reminders and recurrence to default event fields ([#128](https://github.com/nspady/google-calendar-mcp/issues/128)) ([#130](https://github.com/nspady/google-calendar-mcp/issues/130)) ([5b32b9b](https://github.com/nspady/google-calendar-mcp/commit/5b32b9b6f30866c9382bbbea578c457a06ac6d3f))
* return currentTime in requested timezone, not UTC ([#127](https://github.com/nspady/google-calendar-mcp/issues/127)) ([63f7aed](https://github.com/nspady/google-calendar-mcp/commit/63f7aed9f7725c90de858e1b75fa9a59d6f3c77f))

## [2.0.6](https://github.com/nspady/google-calendar-mcp/compare/v2.0.5...v2.0.6) (2025-10-22)


### Bug Fixes

* support converting between timed and all-day events in update-event ([#119](https://github.com/nspady/google-calendar-mcp/issues/119)) ([407e4c8](https://github.com/nspady/google-calendar-mcp/commit/407e4c89753932e13f9ccd55800999b4b12288be))

## [2.0.5](https://github.com/nspady/google-calendar-mcp/compare/v2.0.4...v2.0.5) (2025-10-19)


### Bug Fixes

* **list-events:** support native arrays for Python MCP clients ([#95](https://github.com/nspady/google-calendar-mcp/issues/95)) ([#116](https://github.com/nspady/google-calendar-mcp/issues/116)) ([0e91c23](https://github.com/nspady/google-calendar-mcp/commit/0e91c23c9ae9db0c0ff863cd9019f6212544f62a))

## [2.0.4](https://github.com/nspady/google-calendar-mcp/compare/v2.0.3...v2.0.4) (2025-10-15)


### Bug Fixes

* resolve macOS installation error and improve publish workflow ([ec13f39](https://github.com/nspady/google-calendar-mcp/commit/ec13f397652a864cccd003f05ddd03d4e046316f)), closes [#113](https://github.com/nspady/google-calendar-mcp/issues/113)

## [2.0.3](https://github.com/nspady/google-calendar-mcp/compare/v2.0.2...v2.0.3) (2025-10-15)


### Bug Fixes

* move esbuild to devDependencies and fix publish workflow ([3900358](https://github.com/nspady/google-calendar-mcp/commit/39003589278dbab95c85f27af012293405f34f74)), closes [#113](https://github.com/nspady/google-calendar-mcp/issues/113)

## [2.0.2](https://github.com/nspady/google-calendar-mcp/compare/v2.0.1...v2.0.2) (2025-10-14)


### Bug Fixes

* **auth:** improve port availability error message ([9205fd7](https://github.com/nspady/google-calendar-mcp/commit/9205fd75445702d9e49520e4183c96a93078ea46)), closes [#110](https://github.com/nspady/google-calendar-mcp/issues/110)

## [2.0.1](https://github.com/nspady/google-calendar-mcp/compare/v2.0.0...v2.0.1) (2025-10-13)


### Bug Fixes

* auto-resolve calendar names and summaryOverride to IDs (closes [#104](https://github.com/nspady/google-calendar-mcp/issues/104)) ([#105](https://github.com/nspady/google-calendar-mcp/issues/105)) ([d10225c](https://github.com/nspady/google-calendar-mcp/commit/d10225ca767a0641fef118cf3d56869bf66e2421))
* Resolve rollup optional dependency issue in CI ([#102](https://github.com/nspady/google-calendar-mcp/issues/102)) ([0bc39bd](https://github.com/nspady/google-calendar-mcp/commit/0bc39bd54fdb57828b033153974e1a93e2b38737))
* Support single-quoted JSON arrays in list-events calendarId ([d2af7cf](https://github.com/nspady/google-calendar-mcp/commit/d2af7cf99e3d090bceb388cbf10f7f9649100e3c))
* update publish workflow to use release-please ([47addc9](https://github.com/nspady/google-calendar-mcp/commit/47addc95cc04e552017afd7523638795bf9f9090))

## [2.0.2](https://github.com/nspady/google-calendar-mcp/compare/v2.0.1...v2.0.2) (2025-10-13)

### Bug Fixes

* auto-resolve calendar names and summaryOverride to IDs (closes [#104](https://github.com/nspady/google-calendar-mcp/issues/104)) ([#105](https://github.com/nspady/google-calendar-mcp/issues/105)) ([d10225c](https://github.com/nspady/google-calendar-mcp/commit/d10225ca767a0641fef118cf3d56869bf66e2421))
* update publish workflow to use release-please ([47addc9](https://github.com/nspady/google-calendar-mcp/commit/47addc95cc04e552017afd7523638795bf9f9090))

## [2.0.1](https://github.com/nspady/google-calendar-mcp/compare/v2.0.0...v2.0.1) (2025-10-11)

### Bug Fixes

* Resolve rollup optional dependency issue in CI ([#102](https://github.com/nspady/google-calendar-mcp/issues/102)) ([0bc39bd](https://github.com/nspady/google-calendar-mcp/commit/0bc39bd54fdb57828b033153974e1a93e2b38737))
* Support single-quoted JSON arrays in list-events calendarId ([d2af7cf](https://github.com/nspady/google-calendar-mcp/commit/d2af7cf99e3d090bceb388cbf10f7f9649100e3c))
