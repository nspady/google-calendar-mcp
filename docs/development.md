# Development Guide

## Setup

```bash
git clone https://github.com/nspady/google-calendar-mcp.git
cd google-calendar-mcp
npm install
npm run build
npm run auth                # Authenticate main account
npm run dev auth:test       # Authenticate test account (used for integration tests) 
```

## Development

```bash
npm run dev         # Interactive development menu
npm run build       # Build project
npm run lint        # Type-check with TypeScript (no emit)
npm test            # Run tests
```

## Testing with Different Authentication Methods

The server supports both OAuth and gcloud (Application Default Credentials) authentication methods. Here's how to test with each:

### Testing with OAuth (Default)
```bash
# Authenticate with OAuth
npm run auth

# Run tests (will use OAuth)
npm test

# Or force OAuth method
GOOGLE_AUTH_METHOD=oauth npm test
```

### Testing with gcloud ADC
```bash
# Authenticate with gcloud
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/calendar.events

# Run tests (will auto-detect and use ADC)
npm test

# Or force gcloud method
GOOGLE_AUTH_METHOD=gcloud npm test
```

### Auto-Detection Testing
```bash
# Test auto-detection (prefers gcloud, falls back to OAuth)
unset GOOGLE_AUTH_METHOD
npm test
```

**Note:** The server will automatically choose the best available authentication method:
1. If `GOOGLE_AUTH_METHOD` is set, it will use that method (error if unavailable)
2. If unset, it will prefer gcloud ADC if available, otherwise fall back to OAuth
3. All authentication methods use the same OAuth2Client interface internally

## Contributing

- Follow existing code patterns
- Add tests for new features  
- Use TypeScript strictly (avoid `any`)
- Run `npm run dev` for development tools

## Adding New Tools

1. Create handler in `src/handlers/core/NewToolHandler.ts`
2. Define schema in `src/schemas/`  
3. Add tests in `src/tests/`
4. Auto-discovered by registry system

See existing handlers for patterns.
