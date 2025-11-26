# MCP Protocol Patterns

Essential implementation patterns for MCP servers.

## Tool Pattern

**tools/list** - Declare available tools with JSON schema
**tools/call** - Execute tool, return content array

```typescript
// Result format
{
  "content": [{ "type": "text", "text": JSON.stringify(data) }],
  "isError": false  // true for domain errors
}
```

**Best Practices:**
- Validate inputs against schema
- Return structured data as JSON string
- Use `isError: true` for domain errors (not JSON-RPC errors)

## Resource Pattern

**resources/list** - Declare resources/templates
**resources/read** - Return resource content by URI

```typescript
// URI schemes: custom (myapp://), file (file://), http (https://)
// Templates: "myapp://events/{date}"
```

**Best Practices:**
- Custom URI schemes for domain resources
- Templates for dynamic resources
- Chunk large resources (>1MB)

## Prompt Pattern

**prompts/list** - Declare prompts with arguments
**prompts/get** - Return formatted messages

```typescript
// Message format
{
  "messages": [{
    "role": "user" | "assistant",
    "content": { "type": "text", "text": "..." }
  }]
}
```

## Error Handling

**JSON-RPC Codes:**
- `-32700` Parse error
- `-32600` Invalid request
- `-32601` Method not found
- `-32602` Invalid params
- `-32603` Internal error

**Custom Codes:** Positive integers for domain errors

```typescript
// Include actionable context
{
  "error": {
    "code": -32602,
    "message": "Invalid calendar ID",
    "data": {
      "parameter": "calendarId",
      "expected": "Valid ID or 'primary'"
    }
  }
}
```

## Transport

### stdio
- Newline-delimited JSON-RPC
- stderr for logging
- Flush after each message

### HTTP/SSE
- POST `/mcp` - JSON-RPC requests
- GET `/mcp/sse` - Server-sent events
- GET `/health` - Health check

## Security

**Consent:** Check before tool execution/data access
**Validation:** Validate all inputs, sanitize all outputs
**Credentials:** Environment vars, never hardcoded

## Performance

**Caching:** In-memory with TTL for frequent data
**Pooling:** Reuse connections/clients
**Async:** Long operations return task IDs
**Timeouts:** Set on all external calls

## Monitoring

**Logging:** JSON structured to stderr
**Metrics:** Request count, duration (P95/P99), errors
**Health:** Overall status + component status

```typescript
// Health response
{
  "status": "healthy" | "degraded" | "unhealthy",
  "components": {
    "database": "healthy",
    "cache": "degraded"
  }
}
```

## Key Requirements

✅ JSON-RPC 2.0 format (jsonrpc, method, params, id)
✅ Accurate capability advertisement
✅ User consent workflows
✅ Input validation + output sanitization
✅ Appropriate error codes
✅ Structured logging
✅ Health checks
✅ Stateless design (for scaling)
