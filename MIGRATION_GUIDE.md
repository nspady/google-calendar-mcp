# Migration Guide: v1.x to v2.0

## Breaking Changes

Version 2.0 introduces **structured JSON responses** for all MCP tools, replacing the previous natural language text format. This change provides:

- ✅ **Predictable parsing** - Direct JSON to object mapping
- ✅ **Type safety** - Use TypeScript/Pydantic models
- ✅ **Reduced tokens** - No verbose text descriptions  
- ✅ **Better DX** - No regex/string parsing needed
- ✅ **Machine-readable** - Perfect for AI agents and automation

## Response Format Changes

### Before (v1.x) - Natural Language Text

```json
{
  "content": [{
    "type": "text",
    "text": "Found 2 event(s) matching your search:\n\n1. Event: Team Meeting\nEvent ID: abc123\nStart: Mon, Dec 4, 2024, 10:00 AM PST\nEnd: Mon, Dec 4, 2024, 11:00 AM PST\n..."
  }]
}
```

### After (v2.0) - Structured JSON

```json
{
  "content": [{
    "type": "text", 
    "text": "{
      \"events\": [
        {
          \"id\": \"abc123\",
          \"summary\": \"Team Meeting\",
          \"start\": {
            \"dateTime\": \"2024-12-04T10:00:00-08:00\",
            \"timeZone\": \"America/Los_Angeles\"
          },
          \"end\": {
            \"dateTime\": \"2024-12-04T11:00:00-08:00\",
            \"timeZone\": \"America/Los_Angeles\"
          },
          \"htmlLink\": \"https://calendar.google.com/...\",
          ...
        }
      ],
      \"totalCount\": 2,
      \"query\": \"team meeting\",
      \"calendarId\": \"primary\"
    }"
  }]
}
```

## Tool-Specific Changes

### list-events / search-events

**Response Structure:**
```typescript
{
  events: StructuredEvent[];
  totalCount: number;
  query?: string;           // search-events only
  calendarId?: string;       // search-events only
  calendars?: string[];      // list-events multi-calendar only
  timeRange?: {
    start: string;
    end: string;
  };
}
```

### get-event

**Response Structure:**
```typescript
{
  event: StructuredEvent;
}
```

### create-event / update-event

**Response Structure:**
```typescript
{
  event: StructuredEvent;
  conflicts?: ConflictInfo[];
  duplicates?: DuplicateInfo[];
  warnings?: string[];
}
```

### delete-event

**Response Structure:**
```typescript
{
  success: boolean;
  eventId: string;
  calendarId: string;
  message?: string;
}
```

### list-calendars

**Response Structure:**
```typescript
{
  calendars: CalendarInfo[];
  totalCount: number;
}
```

### get-freebusy

**Response Structure:**
```typescript
{
  timeMin: string;
  timeMax: string;
  calendars: {
    [calendarId: string]: {
      busy: Array<{ start: string; end: string }>;
      errors?: Array<{ domain?: string; reason?: string }>;
    }
  }
}
```

### list-colors

**Response Structure:**
```typescript
{
  event: Record<string, { background: string; foreground: string }>;
  calendar: Record<string, { background: string; foreground: string }>;
}
```

### get-current-time

**Response Structure:**
```typescript
{
  currentTime: string;
  timezone: string;
  offset: string;
  isDST?: boolean;
}
```

## Migration Steps

### 1. Update Response Parsing

Replace text parsing with JSON parsing:

**Before:**
```javascript
// Parse natural language response
const response = await mcp.callTool('search-events', { ... });
const text = response.content[0].text;
const events = parseEventsFromText(text); // Custom parsing logic
```

**After:**
```javascript
// Parse structured JSON response
const response = await mcp.callTool('search-events', { ... });
const data = JSON.parse(response.content[0].text);
const events = data.events; // Direct access
```

### 2. Update Error Handling

Errors now throw exceptions instead of returning error text:

**Before:**
```javascript
const response = await mcp.callTool('get-event', { ... });
if (response.content[0].text.includes('not found')) {
  // Handle error
}
```

**After:**
```javascript
try {
  const response = await mcp.callTool('get-event', { ... });
  const data = JSON.parse(response.content[0].text);
  // Process data
} catch (error) {
  // Handle error - event not found
}
```

### 3. Type Safety (TypeScript)

Import and use the provided types:

```typescript
import type { 
  SearchEventsResponse,
  ListEventsResponse,
  StructuredEvent 
} from 'google-calendar-mcp/types';

const response = await mcp.callTool('search-events', { ... });
const data: SearchEventsResponse = JSON.parse(response.content[0].text);

// TypeScript now provides full intellisense
data.events.forEach(event => {
  console.log(event.summary, event.start.dateTime);
});
```

### 4. Handle Duplicate Detection

Duplicate detection now returns structured data:

**Before:**
```javascript
// Parse warning text for duplicates
if (response.content[0].text.includes('DUPLICATE EVENT DETECTED')) {
  // Extract similarity percentage from text
}
```

**After:**
```javascript
const data = JSON.parse(response.content[0].text);
if (data.duplicates && data.duplicates.length > 0) {
  const duplicate = data.duplicates[0];
  console.log(`${duplicate.event.similarity * 100}% similar`);
}
```

## Example Implementations

### Python with Pydantic

```python
from pydantic import BaseModel
from typing import List, Optional
import json

class DateTime(BaseModel):
    dateTime: Optional[str]
    date: Optional[str]
    timeZone: Optional[str]

class StructuredEvent(BaseModel):
    id: str
    summary: Optional[str]
    start: DateTime
    end: DateTime
    htmlLink: Optional[str]
    # ... other fields

class SearchEventsResponse(BaseModel):
    events: List[StructuredEvent]
    totalCount: int
    query: str
    calendarId: str

# Usage
response = await mcp.call_tool('search-events', {...})
data = SearchEventsResponse.parse_raw(response.content[0].text)

for event in data.events:
    print(f"{event.summary} at {event.start.dateTime}")
```

### JavaScript/Node.js

```javascript
// Using zod for validation (optional)
import { z } from 'zod';

const StructuredEventSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional()
  }),
  // ... other fields
});

const SearchEventsResponseSchema = z.object({
  events: z.array(StructuredEventSchema),
  totalCount: z.number(),
  query: z.string(),
  calendarId: z.string()
});

// Usage
const response = await mcp.callTool('search-events', {...});
const data = SearchEventsResponseSchema.parse(
  JSON.parse(response.content[0].text)
);
```

## Rollback Plan

If you need to stay on v1.x:

```bash
npm install google-calendar-mcp@^1.0.0
```

## Support

For issues or questions about the migration:
- Open an issue: https://github.com/your-repo/issues
- Check existing issues for solutions
- Review the test suite for usage examples

## Timeline

- **v2.0.0 Release**: Structured JSON responses (breaking change)
- **v1.x Support**: Security fixes only, no new features
- **Deprecation**: v1.x will be deprecated 6 months after v2.0 release