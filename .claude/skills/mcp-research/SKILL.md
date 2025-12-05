---
name: mcp-research
description: Expert research tool for Model Context Protocol implementations. PROACTIVELY use when reviewing MCP server code, planning new MCP tools/resources/prompts, investigating protocol compliance issues, or validating architecture. Specializes in protocol compliance (JSON-RPC 2.0), security patterns, transport layers, and production best practices. Current spec: 2025-06-18.
allowed-tools: Read, Grep, Glob, WebFetch, WebSearch
---

# MCP Implementation Research

## Quick Start

**What are you doing?**
- 📝 **Reviewing MCP server** → `references/implementation-checklist.md`
- 🚀 **Planning MCP feature** → `references/protocol-patterns.md`
- 🐛 **Protocol issue** → `references/common-pitfalls.md`
- ✅ **Architecture validation** → All references + latest spec

## Research Workflow

1. **Understand implementation** - What MCP capabilities? Which transport? What security requirements?
2. **Consult references** - Load relevant reference files progressively
3. **Check latest spec** - WebFetch `https://modelcontextprotocol.io/specification/2025-06-18`
4. **Search community** - WebSearch for "MCP [specific-issue] 2025"
5. **Validate compliance** - Protocol compliance, security, best practices
6. **Report findings** - Structured format (see examples/)

## Critical MCP Requirements

### Protocol Compliance (JSON-RPC 2.0)
- All messages MUST include `jsonrpc: "2.0"`
- Responses include `result` OR `error`, never both
- Initialization: `initialize` → response → `initialized` notification
- Use standard error codes (-32xxx)

### Security & Consent
- User consent MUST be obtained before data access
- Tool execution requires explicit approval
- No hardcoded credentials
- Input/output sanitization required

### Capability Advertisement
- Declare all capabilities in `initialize` response
- Types: `tools`, `resources`, `prompts`, `logging`, `experimental`
- Protocol version: `"2025-06-18"` (latest)

### Transport Layers

**stdio:**
- Newline-delimited JSON-RPC messages
- Use stderr for logging (not stdout)
- Flush after each message

**HTTP/SSE:**
- POST `/mcp` for JSON-RPC requests
- GET `/mcp/sse` for server-sent events
- CORS configured for browser clients

## Key Reference Files

**`implementation-checklist.md`** - Protocol compliance, capabilities, security, production readiness
**`protocol-patterns.md`** - Tool/resource/prompt patterns, best practices, code examples
**`common-pitfalls.md`** - Known issues, edge cases, gotchas

## Research Sources

**Official Spec:** `https://modelcontextprotocol.io/specification/2025-06-18`
**Best Practices:** `https://modelcontextprotocol.info/docs/best-practices/`
**Examples:** `https://github.com/modelcontextprotocol/servers`

## Search Patterns

```
# Protocol issues
WebSearch("MCP JSON-RPC [specific-error] 2025")

# Implementation patterns
WebSearch("MCP server [capability-type] best practices site:github.com")

# Security
WebSearch("MCP consent workflow implementation 2025")
```

## Output Format

**BE EXTREMELY CONCISE.** Senior engineers with limited time.

**MAX 400 words.** Focus on critical issues only:
- Protocol violations (file:line)
- Security gaps (specific CVE/exploit)
- 3 max actionable fixes

### Code Review Template
```
**Protocol:** [compliant/non-compliant + critical issue]
**Security:** [ok/issue + specific vulnerability]
**Critical Fixes:** [1-3 items max, file:line references]
```

### Feature Planning Template
```
**Approach:** [tool/resource/prompt]
**Requirements:** [1-2 critical constraints]
**Security:** [specific consent/privacy needs]
```

**DO NOT:**
- Write long explanations
- Create documentation files
- Provide code examples (unless critical fix)
- Explain basic MCP concepts

## Success Criteria

✅ Protocol compliance (JSON-RPC 2.0 + MCP spec)
✅ Security requirements met (consent + privacy)
✅ Best practices followed
✅ Production ready (monitoring + scaling)
