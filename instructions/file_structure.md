# Project Directory Structure

```
.
├── bun.lockb
├── Dockerfile
├── docs
│   └── architecture.md
├── gcp-oauth.keys.example.json
├── gcp-oauth.keys.json
├── instructions
│   └── file_structure.md
├── LICENSE
├── package-lock.json
├── package.json
├── README.md
├── scripts
│   └── build.js
├── src
│   ├── auth
│   │   ├── client.ts
│   │   ├── server.ts
│   │   ├── tokenManager.ts
│   │   └── utils.ts
│   ├── auth-server.ts
│   ├── handlers
│   │   ├── callTool.ts
│   │   ├── core
│   │   │   ├── BaseToolHandler.ts
│   │   │   ├── CreateEventHandler.ts
│   │   │   ├── DeleteEventHandler.ts
│   │   │   ├── FreeBusyEventHandler.ts
│   │   │   ├── ListCalendarsHandler.ts
│   │   │   ├── ListColorsHandler.ts
│   │   │   ├── ListEventsHandler.ts
│   │   │   ├── SearchEventsHandler.ts
│   │   │   └── UpdateEventHandler.ts
│   │   ├── listTools.ts
│   │   └── utils.ts
│   ├── index.test.ts
│   ├── index.ts
│   └── schemas
│       ├── types.ts
│       └── validators.ts
├── streaming_todo.md
├── test-server.js
├── tsconfig.json
├── update_tree.sh
└── vitest.config.ts

9 directories, 37 files
```
