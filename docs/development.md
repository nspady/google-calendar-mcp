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

## Contributing

- Follow existing code patterns
- Add tests for new features  
- Use TypeScript strictly (avoid `any`)
- Run `npm run dev` for development tools

## Adding New Tools

1. Create handler in `src/handlers/core/NewToolHandler.ts`
2. Define schema in `src/tools/registry.ts` (add to `ToolSchemas` object)
3. Register in `ToolRegistry.tools` array in the same file
4. Add tests in `src/tests/`

See existing handlers and CLAUDE.md for patterns.
