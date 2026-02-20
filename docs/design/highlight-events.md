# Design: `highlight-events` App Tool

## Problem

When the model calls `list-events` over a large date range (e.g., "What weeks do I have travel this summer?"), the UI renders ALL 60+ returned events. The model's text response discusses only the relevant subset, but the UI shows everything — a mismatch.

We need a tool that lets the model tell the UI "show only these events."

## MCP Apps Architecture (Key Concepts)

### UI Instance Lifecycle

Each MCP tool call with `_meta.ui.resourceUri` creates a **separate, isolated UI instance** (sandboxed iframe). There is no mechanism for one tool's UI to receive results from another tool. The spec explicitly states: "The specification does not provide a direct mechanism for subsequent tool calls to update an existing UI instance."

This means: if `highlight-events` is registered as a server tool with `hasUI: true` and model visibility, calling it creates a **brand-new UI** that has no event data. This is the root cause of the "Loading..." bug.

### Two Types of Tools

1. **Server tools** — Registered via `registerAppTool()` / `server.registerTool()`. When the model calls one with `_meta.ui.resourceUri`, the host creates a new UI iframe and feeds it the tool's input/result via `ontoolinput` → `ontoolresult`.

2. **App-exposed tools** — Listed by the running UI via `onlisttools`, handled in `oncalltool`. When the model calls one, the host routes the call to the **existing UI instance** that listed it. No new iframe. The app handles it in-place and returns a result.

### Tool Visibility (`_meta.ui.visibility`)

Controls who can see/call a server-registered tool:
- `["model", "app"]` (default) — Model sees it in `tools/list` and can call it. App can call it via `callServerTool()`.
- `["model"]` — Model only. App can't call it.
- `["app"]` — App only. **Model does not see it** in `tools/list`. App can call it via `callServerTool()`.

### How App-Exposed Tools Get Schemas

When the host calls `onlisttools` and gets back `['highlight-events', ...]`, it looks up matching server-side tool definitions for schemas/descriptions. The server can register a tool with `visibility: ["app"]` purely to provide the schema, without making it model-callable as a server tool.

## Correct Architecture for `highlight-events`

`highlight-events` needs to be an **app-exposed tool**, not a model-callable server tool. This ensures the call is routed to the existing UI instance (the one showing events) rather than creating a new empty UI.

### Registration

**Server side** (`registry.ts`):
```typescript
{
  name: "highlight-events",
  description: "...",
  schema: ToolSchemas['highlight-events'],
  handler: HighlightEventsHandler,  // Required by registry, but never called by model
  hasUI: true,
  uiVisibility: ['app']  // <-- CRITICAL: hides from model's server tool list
}
```

This registers the tool with the server for schema discovery, but `visibility: ["app"]` prevents the model from calling it as a server tool (which would create a new UI).

**App side** (`day-view.ts`):
```typescript
app.onlisttools = async () => ({
  tools: ['navigate-to-date', 'set-calendar-filter', 'set-display-mode', 'highlight-events']
});

app.oncalltool = async (params) => {
  switch (params.name) {
    case 'highlight-events': {
      const eventIds = args.eventIds as string[];
      const label = args.label as string | undefined;
      // Filter events in-place, re-render, return match count
      ...
    }
  }
};
```

The host sees `highlight-events` from `onlisttools`, matches it to the server schema, and presents it to the model. When the model calls it, the host routes to the existing UI's `oncalltool`.

### Call Flow

```
1. Model calls list-events → server handler → UI instance created → events rendered
2. Model calls highlight-events → host routes to EXISTING UI's oncalltool
3. oncalltool handler: set filter state → re-render with subset → return "Highlighting N events"
4. No new UI created. Same iframe, same event data, filtered in-place.
```

### What to Remove

The previous (broken) implementation tried to work around the separate-UI-instance problem:
- `tryParseHighlightResult()` — parsed highlight results from `ontoolresult` (wrong: app-exposed tools don't go through `ontoolresult`)
- `ontoolresult` highlight detection — not needed when `oncalltool` handles it
- `storeContextForBridge()` / `loadContextFromBridge()` — localStorage bridge between UI instances (unnecessary when using the same instance)
- Skeleton/loading detection workarounds for highlight-events in `ontoolinputpartial`/`ontoolinput`

## Existing Pattern (Reference)

The codebase already has three app-exposed tools that follow this exact pattern:
- `navigate-to-date` — re-fetches events for a different date, renders in-place
- `set-calendar-filter` — toggles calendar visibility, re-renders in-place
- `set-display-mode` — switches inline/fullscreen mode

These are listed in `onlisttools`, handled in `oncalltool`, and have NO server-side registration at all (they don't even need schema lookup since the host can pass args without validation).

`highlight-events` follows the same pattern but additionally has a server-side registration with `uiVisibility: ['app']` to provide the schema to the host. The `HighlightEventsHandler` exists because the registry requires a handler class, but it's never invoked by the model.

## Changes Required

### `src/tools/registry.ts`
- Add `uiVisibility: ['app']` to `highlight-events` entry (already done)

### `src/ui/day-view/day-view.ts`
1. Add `'highlight-events'` to `onlisttools` tools array
2. Add `highlight-events` case to `oncalltool` switch (set filter, re-render, return count)
3. Remove `tryParseHighlightResult()` function
4. Remove highlight detection from `ontoolresult`
5. Remove `storeContextForBridge()` / `loadContextFromBridge()` functions
6. Remove `CONTEXT_BRIDGE_KEY` constant
7. Remove localStorage bridge check in `ontoolinputpartial`
8. Keep: `clearHighlight()`, `clearHighlightRef`, highlight state in `stateRefs`, `sendModelContextUpdate` highlight reporting

### `src/ui/day-view/modules/renderers.ts`
- No changes needed (highlight filtering and chip rendering are correct)

### `src/ui/day-view/styles.css`
- No changes needed (highlight chip styles are correct)

### `src/handlers/core/HighlightEventsHandler.ts`
- Keep as-is (required by registry, acts as fallback if app ever calls via `callServerTool`)
