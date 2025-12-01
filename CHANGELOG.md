# Changelog

## [Unreleased]

### Added
- **Multi-account support**: Connect and manage multiple Google accounts simultaneously
  - Query events across all accounts with automatic result merging
  - Permission-based account auto-selection for write operations
  - Case-insensitive account IDs and calendar name resolution
  - New `find-calendar-conflicts` tool for cross-account conflict detection
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
