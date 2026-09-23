## Summary

<!-- What does this change and why? Link related issues. -->

## Checklist

- [ ] `npm run lint` and `npm test` pass locally
- [ ] Unit tests added or updated for new behavior
- [ ] README.md / `docs/` updated for user-visible changes (new env vars, changed behavior)
- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`...)

### If this adds a tool (see [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-tool))

- [ ] Handler in `src/handlers/core/` extending `BaseToolHandler`
- [ ] Zod schema added to `ToolSchemas` in `src/tools/registry.ts`
- [ ] Entry added to `ToolRegistry.tools` (title, description, annotations, schema, handler)
- [ ] Unit test in `src/tests/unit/handlers/`
- [ ] Row added to the README "Available Tools" table
- [ ] Name added to the README "Available tool names" list (ENABLED_TOOLS)
- [ ] Tool listed in `docs/architecture.md`
