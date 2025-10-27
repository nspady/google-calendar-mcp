# MCP Implementation Review Checklist

Quick validation checklist for MCP server implementations.

## Protocol Compliance

### JSON-RPC 2.0
- [ ] All messages include `jsonrpc: "2.0"`
- [ ] Requests have `method`, `params`, `id`
- [ ] Responses have `result` XOR `error` (never both)
- [ ] Error codes: `-32xxx` (JSON-RPC) or custom positive integers
- [ ] Init sequence: `initialize` → response → `initialized` notification

### Capabilities
- [ ] `initialize` response declares all implemented capabilities
- [ ] Protocol version set (e.g., `"2025-06-18"`)
- [ ] Capabilities match actual implementation
- [ ] Types: `tools`, `resources`, `prompts`, `logging`, `experimental`

## Features

### Tools (`tools/list`, `tools/call`)
- [ ] Tool schemas define clear input parameters
- [ ] Results return MCP content types (text/image/resource)
- [ ] Input validation rejects invalid params
- [ ] User consent obtained before execution
- [ ] Errors use MCP error codes

### Resources (`resources/list`, `resources/read`)
- [ ] URIs use valid schemes (custom/file/http)
- [ ] Templates support parameter substitution
- [ ] Large resources paginated/chunked
- [ ] Access control enforced

### Prompts (`prompts/list`, `prompts/get`)
- [ ] Arguments clearly defined
- [ ] Messages properly formatted (role + content)
- [ ] Dynamic prompts tested with arguments
- [ ] Content safe for LLM consumption

## Transport

### stdio
- [ ] Newline-delimited JSON-RPC
- [ ] stderr only for logging (not responses)
- [ ] Output flushed after each message
- [ ] Handles EOF/close gracefully

### HTTP/SSE
- [ ] POST endpoint for requests
- [ ] SSE stream for server-initiated messages
- [ ] CORS configured appropriately
- [ ] Timeouts set for long operations

## Security

- [ ] User consent for data access
- [ ] Tool execution gated behind approval
- [ ] No hardcoded credentials
- [ ] Input validation/sanitization
- [ ] Output sanitization (no data leaks)
- [ ] Rate limiting for expensive ops
- [ ] Audit logging for sensitive actions

## Error Handling

**Standard Codes:**
- `-32700` Parse error
- `-32600` Invalid request
- `-32601` Method not found
- `-32602` Invalid params
- `-32603` Internal error

**Requirements:**
- [ ] Actionable error messages
- [ ] Error context for debugging
- [ ] Graceful handling of external API failures
- [ ] Appropriate logging

## Production

### Performance
- [ ] Async/non-blocking expensive ops
- [ ] Caching for frequently accessed data
- [ ] Connection pooling for external services
- [ ] Stateless (horizontal scaling possible)
- [ ] Timeouts on all external calls

**Targets:**
- Throughput: >1000 req/sec/instance
- Latency P95: <100ms (simple ops)
- Latency P99: <500ms (complex ops)
- Error rate: <0.1%

### Monitoring
- [ ] Structured logging (JSON format)
- [ ] Health check endpoint
- [ ] Metrics collection (request count, latency, errors)
- [ ] Deployment automation
- [ ] Rollback strategy

**Health Check Must Include:**
- Overall status (healthy/degraded/unhealthy)
- Component status (DB, cache, external APIs)
- Resource usage (memory, CPU, connections)

## Testing

- [ ] Protocol compliance tests (JSON-RPC)
- [ ] All capabilities tested (tools/resources/prompts)
- [ ] Error handling coverage
- [ ] Integration tests with real MCP client
- [ ] Load testing performed
- [ ] Security tests (consent, validation)

## Pre-Release Checklist

- [ ] JSON-RPC 2.0 validated
- [ ] Capabilities advertised correctly
- [ ] Security/consent implemented
- [ ] Error handling tested
- [ ] Performance targets met
- [ ] Monitoring configured
- [ ] Health checks working
- [ ] Client integration tested
- [ ] Documentation complete
