---
description: Comprehensive PR review for MCP protocol, Google Calendar API, and testing best practices
argument-hint: <pr-number-or-branch>
---

Review PR $ARGUMENTS for compliance with:

## 1. MCP Protocol Compliance (mcp-research skill)

Check:
- JSON-RPC 2.0 format correctness
- Capability advertisement accuracy
- Security/consent workflows
- Error handling patterns
- Transport layer compliance
- Production readiness

## 2. Google Calendar API Best Practices (gcal-api-research skill)

Validate:
- Correct API method usage
- Edge cases handling (recurring events, timezones, all-day events, attendees)
- Error handling for Calendar API failures
- Structured response formats
- Field mask optimization

## 3. Test Coverage (calendar-test-engineer agent)

Verify:
- >90% code coverage achieved
- Unit tests for all edge cases identified in research
- Integration tests for critical scenarios
- Error path testing
- Mock configurations realistic

## Output Format

**CRITICAL: BE EXTREMELY CONCISE. MAX 300 WORDS TOTAL.**

Audience: Senior engineers with limited time.

**DO NOT:**
- Create analysis files or documentation
- Write verbose explanations
- Provide code examples unless critical
- List obvious issues

**DO:**
- Provide file:line references
- Focus on blocking issues only
- Give specific, actionable fixes

**MCP Compliance:** ✅/⚠️/❌ [one-line summary]
**Calendar API:** ✅/⚠️/❌ [one-line summary]
**Test Coverage:** ✅/⚠️/❌ [coverage % + critical gaps]

**Critical Issues:** [numbered list, max 3, with file:line]
**Recommendations:** [numbered list, max 3, specific fixes]

**Approval Status:** APPROVE / REQUEST CHANGES / BLOCK
