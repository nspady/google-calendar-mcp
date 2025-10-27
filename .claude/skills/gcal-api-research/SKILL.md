---
name: gcal-api-research
description: Expert research tool for Google Calendar API implementations. PROACTIVELY use when (1) reviewing PRs adding calendar features, (2) planning new event/attendee/recurring event functionality, (3) investigating calendar API issues, (4) validating timezone handling or batch operations. Specializes in recurring events, timezone conversions, multi-calendar support, and edge case identification.
allowed-tools: Read, Grep, Glob, WebFetch, WebSearch
---

# Google Calendar API Research

## Quick Start

**What are you doing?**
- 📝 **Reviewing a PR** → Read `references/research-checklist.md` first
- 🚀 **Planning a feature** → Start with Step 1 below, then consult relevant references
- 🐛 **Investigating an issue** → Check `references/edge-cases.md` for known pitfalls
- ✅ **Validating an approach** → Read `references/api-patterns.md` for best practices

Then follow the detailed workflow below.

## Overview

This skill provides a structured approach to researching Google Calendar API implementations, identifying best practices, and uncovering potential edge cases. Use this skill to ensure implementations leverage Google Calendar APIs appropriately with good defaults while supporting complex use cases.

## When to Use This Skill

Use this skill when:

- **Reviewing PRs** that add new Google Calendar functionality (e.g., "feat: add respond-to-event tool")
- **Planning new features** before implementation begins
- **Investigating issues** with existing Google Calendar integrations
- **Validating implementation approaches** against Google Calendar API best practices
- **Researching edge cases** for specific calendar operations

This skill is particularly valuable for features involving:
- Recurring event handling
- Timezone conversions
- Batch operations across multiple calendars
- Event conflict detection
- Attendee management
- Conference data integration

## Research Workflow

### Step 1: Understand the Feature

First, identify what the implementation does or plans to do:

1. **For PR Reviews**: Read the PR description and examine the code changes
2. **For Feature Planning**: Clarify the requirements and desired functionality
3. **For Issues**: Understand the reported problem and expected behavior

**Key Questions:**
- What Google Calendar API operations are involved?
- What user scenarios does this support?
- What are the critical requirements (performance, reliability, edge cases)?

### Step 2: Consult Reference Materials

Load relevant reference files based on the feature area. The skill includes three comprehensive references:

**`references/research-checklist.md`**
- Use for structured PR review workflow
- Covers API method selection, recurring events, timezones, batch operations, multi-calendar support, error handling, response structure, and testing
- Provides specific "Questions to Ask" for each area
- Includes "Research Steps" for finding additional information

**`references/api-patterns.md`**
- Use for understanding common implementation patterns
- Covers event querying, modification patterns, field masks, batch requests, conflict detection, pagination, timezone handling, error handling, and performance optimization
- Provides code examples and "when to use" guidance
- Documents authentication and authorization patterns

**`references/edge-cases.md`**
- Use for identifying potential pitfalls and gotchas
- Comprehensive catalog of recurring event edge cases, all-day event issues, attendee edge cases, conference data pitfalls, permission issues, batch request complications, and more
- Real-world scenarios and common mistakes
- Includes "Best Practice" recommendations for each edge case

**How to Use References:**

```
# Read the most relevant reference first
Read references/research-checklist.md

# Then read specific sections of other references as needed
Read references/api-patterns.md (focus on relevant sections)
Read references/edge-cases.md (scan for applicable edge cases)
```

Avoid loading all references into context at once. Load them progressively as needed based on the specific feature area.

### Step 3: Research Official Documentation

Use WebFetch to access Google's official Calendar API documentation:

**Primary Sources:**
- **API Reference**: `https://developers.google.com/calendar/api/v3/reference`
- **Guides**: `https://developers.google.com/calendar/api/guides/overview`
- **Best Practices**: Search for specific topics like "google calendar api recurring events"

**Research Pattern:**
```
# Fetch official documentation for specific feature
WebFetch(
  url: "https://developers.google.com/calendar/api/v3/reference/events/insert",
  prompt: "What are the parameters and best practices for creating calendar events? Focus on required fields, optional parameters, and any notes about recurring events or timezones."
)
```

**Focus Areas:**
- Required vs optional parameters
- Field formats and validation rules
- Return types and error codes
- Usage quotas and rate limits
- Deprecation notices

### Step 4: Search for Community Issues

Use WebSearch to find real-world issues others have encountered:

**Search Patterns:**

1. **Stack Overflow Issues:**
```
WebSearch(
  query: "google calendar api recurring event instances site:stackoverflow.com"
)
```

2. **GitHub Issues:**
```
WebSearch(
  query: "google calendar api timezone handling issues site:github.com"
)
```

3. **General Problem Reports:**
```
WebSearch(
  query: "google calendar api [specific operation] problems edge cases"
)
```

**Look For:**
- Common error messages and their solutions
- Unexpected behaviors reported by developers
- Workarounds for API limitations
- Performance issues and optimization strategies

**Example Searches:**
- "google calendar api batch request partial failure"
- "google calendar api recurring event exception orphaned"
- "google calendar api all-day event timezone conversion"
- "google calendar api attendee response status not updating"

### Step 5: Validate Implementation

Synthesize findings to validate the implementation:

**For PR Reviews:**
1. **API Method Selection**: Is the correct API method being used? (See research-checklist.md → API Method Selection)
2. **Edge Cases**: Are known edge cases handled? (See edge-cases.md for relevant category)
3. **Best Practices**: Does implementation follow recommended patterns? (See api-patterns.md for relevant pattern)
4. **Error Handling**: Are errors handled appropriately?
5. **Testing**: Can the feature be tested reliably?

**For Feature Planning:**
1. **Feasibility**: Does the Google Calendar API support the desired functionality?
2. **Approach**: What's the best API method/pattern for this use case?
3. **Complexity**: What edge cases need to be considered?
4. **Defaults**: What are good defaults that still allow advanced usage?

**For Issue Investigation:**
1. **Known Issue**: Is this a documented edge case? (Check edge-cases.md)
2. **API Behavior**: Is the API behaving as documented? (Check official docs)
3. **Pattern Problem**: Is there a better implementation pattern? (Check api-patterns.md)
4. **Community Solutions**: Have others solved this? (Check WebSearch results)

### Step 6: Provide Actionable Findings

**BE EXTREMELY CONCISE.** Senior engineers with limited time.

**MAX 500 words.** Focus on critical issues only.

**For PR Reviews:**
```
**Approach:** [correct API method? yes/no]
**Critical Edge Cases:** [3-5 max, file:line refs]
**Fixes:** [specific changes needed, file:line]
**Tests:** [3-5 specific test cases needed]
```

**For Feature Planning:**
```
**API Method:** [which method + why]
**Critical Edges:** [3-5 pitfalls to handle]
**Complexity:** [low/med/high + 1 reason]
```

**DO NOT:**
- Write long explanations
- Create documentation files
- Explain Google Calendar basics
- Provide code examples (unless critical fix)
- List obvious edge cases

## Critical Focus Areas

### Recurring Events
Recurring events are the most complex aspect of Google Calendar API. Always check:

- **Instance ID format**: Must be `{recurringEventId}_{instanceTime}` with time in UTC
- **Modification scope**: thisEventOnly, thisAndFollowing, all
- **Exceptions**: Instances with `recurringEventId` field have limitations
- **Timezone changes**: Can cause unexpected shifts in recurring patterns

**Primary Reference:** `edge-cases.md` → "Recurring Events Edge Cases"

### Timezone Handling
Timezone issues are common and subtle. Always verify:

- **Explicit specification**: Are timezones specified explicitly rather than relying on defaults?
- **All-day vs timed**: All-day events use `date`, timed events use `dateTime` + `timeZone`
- **Conversions**: Is conversion between all-day and timed events handled correctly?
- **Calendar timezone**: Is calendar's default timezone being retrieved when needed?

**Primary Reference:** `api-patterns.md` → "Timezone Handling Patterns" and `edge-cases.md` → "All-Day Event Edge Cases"

### Batch Operations
Batch operations improve performance but have special handling requirements. Check:

- **Batch size limits**: Max 50 requests per batch
- **Partial failures**: Each request can succeed/fail independently
- **Error handling**: Must check status of each response individually
- **When to batch**: Independent operations benefit from batching

**Primary Reference:** `api-patterns.md` → "Batch Request Patterns" and `edge-cases.md` → "Batch Request Edge Cases"

### Multi-Calendar Support
Operations across multiple calendars require special consideration:

- **Calendar access**: Different calendars may have different permissions
- **Aggregation**: Results from multiple calendars need proper merging
- **Performance**: Consider using batch requests or freebusy queries
- **Calendar discovery**: calendarList.list() vs direct calendar access

**Primary Reference:** `research-checklist.md` → "Multi-Calendar Operations" and `edge-cases.md` → "Multi-Calendar Edge Cases"

## Research Tips

### Effective Web Searches

**Be Specific:**
- ❌ "google calendar api issues"
- ✅ "google calendar api recurring event instance ID format"

**Use Site Filters:**
- `site:stackoverflow.com` - For Q&A and troubleshooting
- `site:github.com` - For library-specific issues and code examples
- `site:developers.google.com` - For official documentation only

**Search for Errors:**
- Include error codes: "google calendar api 409 conflict"
- Include error messages: "google calendar api 'invalid event id'"

**Find Recent Issues:**
- Add year to query: "google calendar api batch requests 2024"
- Look for "updated" or "resolved" discussions

### Effective Documentation Review

**Read Between the Lines:**
- "Optional" parameters may be required for specific use cases
- Check "Notes" sections for important limitations
- Look for "Deprecated" or "Not recommended" warnings

**Cross-Reference:**
- Event creation docs often reference timezone docs
- Recurring event docs reference instance modification
- Check related API methods for alternative approaches

**Check Examples:**
- Official examples show recommended patterns
- Note what parameters examples include/exclude
- Compare examples across different operations

## Common Research Scenarios

### Scenario: New Event Creation Feature

1. Read `research-checklist.md` → "API Method Selection"
2. Read `api-patterns.md` → "Event Modification Patterns" → "Creating Events with Good Defaults"
3. WebFetch official events.insert documentation
4. Read `edge-cases.md` → "All-Day Event Edge Cases" (if supporting all-day events)
5. WebSearch "google calendar api event creation best practices"
6. Check `api-patterns.md` → "Timezone Handling Patterns"

### Scenario: Recurring Event Modification

1. Read `edge-cases.md` → "Recurring Events Edge Cases" (entire section)
2. Read `api-patterns.md` → "Event Modification Patterns" → "Modifying Recurring Event Instances"
3. Read `research-checklist.md` → "Recurring Events"
4. WebFetch official recurring events documentation
5. WebSearch "google calendar api recurring event instances problems site:stackoverflow.com"
6. WebSearch "google calendar api thisAndFollowing edge cases"

### Scenario: Batch Operation Implementation

1. Read `api-patterns.md` → "Batch Request Patterns"
2. Read `edge-cases.md` → "Batch Request Edge Cases"
3. Read `research-checklist.md` → "Batch Operations"
4. WebFetch official batch request documentation
5. WebSearch "google calendar api batch request partial failure handling"
6. Check `api-patterns.md` → "Performance Optimization Patterns"

### Scenario: Multi-Calendar Conflict Detection

1. Read `research-checklist.md` → "Multi-Calendar Operations"
2. Read `api-patterns.md` → "Conflict Detection Patterns"
3. Read `api-patterns.md` → "Batch Request Patterns" (for querying multiple calendars)
4. Read `edge-cases.md` → "Multi-Calendar Edge Cases"
5. WebSearch "google calendar api freebusy multiple calendars"
6. Consider `api-patterns.md` → "Free/Busy Queries" vs full event listing

## Success Criteria

A thorough research process should answer:

✅ **Appropriateness**: Is this the right API method/approach for the use case?

✅ **Edge Cases**: What edge cases exist and how are they handled?

✅ **Best Practices**: Does the implementation follow Google's recommendations?

✅ **Community Validation**: Have others encountered issues with this approach?

✅ **Testing**: Can the implementation be tested reliably?

✅ **Performance**: Is the approach efficient for the expected scale?

✅ **Error Handling**: Are errors handled with clear, actionable messages?

✅ **Defaults**: Do the default parameters work well while supporting advanced cases?
