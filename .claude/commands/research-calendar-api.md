---
description: Research Google Calendar API for a specific feature or issue using gcal-api-research skill
argument-hint: <feature-name-or-issue-description>
allowed-tools: Read, Grep, Glob, WebFetch, WebSearch
---

Use the **gcal-api-research** skill to conduct thorough research on: $ARGUMENTS

## Research Focus Areas

Investigate the following aspects:

1. **Best API Approach** - Identify the correct Google Calendar API method(s) to use
2. **Edge Cases** - Uncover potential pitfalls and gotchas specific to this feature
3. **Community Issues** - Find real-world problems others have encountered
4. **Best Practices** - Validate the approach against Google's recommendations
5. **Implementation Complexity** - Assess the effort required and any API limitations

## Expected Output

Provide actionable research findings that include:

- ✅ Recommended API method and implementation approach
- ⚠️ Critical edge cases that must be handled
- 📋 Specific code patterns and parameter recommendations
- 🧪 Testing scenarios to validate the implementation
- 📚 References to official documentation and community resources

## Research Workflow

Follow the gcal-api-research skill's structured workflow:

1. Understand the feature requirements
2. Consult reference materials (research-checklist.md, api-patterns.md, edge-cases.md)
3. Fetch official Google Calendar API documentation
4. Search for community-reported issues (Stack Overflow, GitHub)
5. Validate implementation approach
6. Provide clear, actionable findings

Focus on recurring events, timezone handling, batch operations, and multi-calendar support where applicable.
