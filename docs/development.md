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
npm test            # Run tests
```

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