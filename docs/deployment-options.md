# MCP Server Deployment Guide

This guide compares deployment options for your Google Calendar MCP Server, with special focus on Vercel's new MCP features and other leading platforms in 2025.

## Quick Comparison Table

| Platform | Setup Time | Cost | Best For | MCP Native Support | Global Edge | Pros | Cons |
|----------|-----------|------|----------|-------------------|-------------|------|------|
| **Vercel** | 5-10 min | Free tier, then $20/mo | Next.js apps, serverless | ✅ Native (`mcp-handler`) | ✅ Yes | Fastest setup, automatic SSL, preview deployments | Requires Next.js wrapper, function timeout limits |
| **Cloudflare Workers** | 10-15 min | Free tier, then $5/mo | Edge computing, global latency | ✅ Native support | ✅ Yes | Lowest cost, unlimited requests, global edge | Learning curve, different runtime (no Node.js) |
| **Railway** | 5-10 min | $5/mo + usage | Docker apps, databases | ✅ Official MCP server | ❌ Limited regions | Simple deployment, great DX, auto SSL | No free tier, limited regions |
| **Google Cloud Run** | 15-20 min | Pay per use (~$0-20/mo) | Containerized apps | ✅ Official docs & tools | ✅ Regional deployment | Auto-scaling, pay per use, GCP integration | More complex setup, cold starts |
| **Render** | 10-15 min | Free tier, then $7/mo | Web services, databases | ✅ Official MCP server | ❌ Fixed regions | Easy setup, free tier, managed DBs | Limited regions (5), slow free tier |
| **Fly.io** | 15-20 min | $5-10/mo usage-based | Global apps, low latency | ⚠️ Community support | ✅ 20+ regions | True global deployment, low latency | Steeper learning curve, manual config |
| **DigitalOcean** | 10-15 min | $5/mo + usage | Simple web apps | ✅ Official MCP server | ❌ Limited regions | Simple, predictable pricing, good docs | Basic features, manual scaling |
| **AWS Lambda** | 20-30 min | Pay per request (~$0-10/mo) | Serverless, AWS ecosystem | ✅ Official AWS MCP tools | ✅ Regional | Deep AWS integration, generous free tier | Complex setup, cold starts, learning curve |

## Recommended by Use Case

### 🏆 Best Overall: Railway
**Why:** Simplest deployment with excellent developer experience, official MCP support, and no framework constraints.

**Perfect for:**
- Quick production deployment
- Teams familiar with Docker
- Projects needing databases alongside MCP server

### 🚀 Most Modern: Vercel (with Next.js wrapper)
**Why:** Native MCP adapter, instant deployments, automatic SSL, preview environments, and optimized performance.

**Perfect for:**
- Next.js applications
- Teams already on Vercel
- Projects needing serverless architecture

### 💰 Most Cost-Effective: Cloudflare Workers
**Why:** Free tier includes 100k requests/day, unlimited requests on paid plan ($5/mo), global edge deployment.

**Perfect for:**
- High-traffic applications
- Global user base
- Budget-conscious projects

### 🌍 Best Global Performance: Fly.io
**Why:** Deploy to 20+ regions, low latency worldwide, usage-based pricing, true edge computing.

**Perfect for:**
- International users
- Latency-sensitive applications
- Apps requiring regional presence

---

## Detailed Platform Guides

## 1. Vercel (Native MCP Support) ⭐ NEW

Vercel launched native MCP support in 2025 with the `mcp-handler` package, making it one of the easiest platforms for MCP deployment.

### Architecture

Your standalone Node.js server needs to be wrapped in a Next.js API route to deploy on Vercel:

```
Your MCP Server → Vercel mcp-handler → Next.js API Route → Vercel Functions
```

### Prerequisites

- Vercel account (free tier available)
- Next.js 14+ project
- Node.js 18+

### Setup Steps

#### Option A: Start from Template (Easiest)

```bash
# Clone Vercel's MCP template
npx create-next-app my-calendar-mcp --example https://github.com/vercel/mcp-handler/tree/main/examples/nextjs

cd my-calendar-mcp
```

#### Option B: Add to Existing Next.js Project

```bash
# Install dependencies
npm install mcp-handler @modelcontextprotocol/sdk zod

# Create API route
mkdir -p app/mcp
```

Create `app/mcp/route.ts`:

```typescript
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

// Import your existing MCP tools
import { ToolRegistry } from '@/lib/mcp/tools/registry';
import { initializeOAuth2Client } from '@/lib/mcp/auth/client';

const handler = createMcpHandler(
  async (server) => {
    // Initialize OAuth2 client
    const oauth2Client = await initializeOAuth2Client();

    // Register all your tools from the registry
    const registry = new ToolRegistry(oauth2Client);
    const tools = registry.getAllTools();

    for (const tool of tools) {
      server.tool(
        tool.name,
        tool.description,
        tool.inputSchema,
        async (args) => {
          const result = await tool.handler.runTool(args, oauth2Client);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        }
      );
    }
  },
  {
    // Optional: Add OAuth configuration
    // See: https://github.com/vercel/mcp-handler#authorization
  },
  {
    basePath: '/mcp',
  }
);

// Export for Next.js API routes
export { handler as GET, handler as POST, handler as DELETE };
```

#### Adapt Your Server Code

Since Vercel uses `mcp-handler`, you'll need to adapt your existing handler structure:

**Current structure:** `src/handlers/core/ListEventsHandler.ts`

**Vercel adaptation:** Create `lib/mcp/adapters/vercel-tools.ts`:

```typescript
import { z } from 'zod';
import { ListEventsHandler } from '@/src/handlers/core/ListEventsHandler';
import { CreateEventHandler } from '@/src/handlers/core/CreateEventHandler';
// Import other handlers...

export function registerMcpTools(server: any, oauth2Client: any) {
  // List Events
  server.tool(
    'list-events',
    'List calendar events with date range filtering',
    {
      calendarId: z.string().or(z.array(z.string())),
      timeMin: z.string().optional(),
      timeMax: z.string().optional(),
      maxResults: z.number().int().positive().max(2500).optional(),
    },
    async (args: any) => {
      const handler = new ListEventsHandler();
      const result = await handler.runTool(args, oauth2Client);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );

  // Create Event
  server.tool(
    'create-event',
    'Create a new calendar event',
    {
      calendarId: z.string(),
      summary: z.string(),
      start: z.string(),
      end: z.string(),
      description: z.string().optional(),
      // ... other fields
    },
    async (args: any) => {
      const handler = new CreateEventHandler();
      const result = await handler.runTool(args, oauth2Client);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }
  );

  // Add all other tools...
}
```

#### Configure Environment Variables

Create `.env.local`:

```bash
# Google OAuth credentials (as JSON string)
GOOGLE_OAUTH_CREDENTIALS='{"web":{"client_id":"...","client_secret":"..."}}'

# Or use file path (requires custom setup)
GOOGLE_OAUTH_CREDENTIALS_PATH=/path/to/gcp-oauth.keys.json

# Token storage (use Vercel KV or Postgres)
TOKEN_STORAGE=vercel-kv  # or 'postgres' or 'dynamodb'

# For SSE support (optional, requires Redis)
REDIS_URL=redis://default:password@redis.vercel.com:6379
```

#### Enable Fluid Compute (Recommended)

Vercel's Fluid Compute dramatically improves MCP server performance:

1. Go to your project settings on Vercel
2. Enable "Fluid Compute" under Functions
3. Adjust `maxDuration` to 800 (Pro/Enterprise accounts)

Benefits: 90% cost reduction, 50% CPU usage reduction, server reuse for faster responses.

#### Deploy

```bash
# Deploy to Vercel
vercel deploy

# Or push to GitHub (with Vercel integration)
git push origin main
```

### Access Your MCP Server

```
https://your-project.vercel.app/mcp
```

### Configuration for AI Clients

**ChatGPT:**
```json
{
  "type": "mcp",
  "server_label": "google-calendar",
  "server_url": "https://your-project.vercel.app/mcp",
  "require_approval": "never"
}
```

**Claude Desktop** (requires mcp-client):
```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "mcp-client",
      "args": ["https://your-project.vercel.app/mcp"]
    }
  }
}
```

### Limitations

- **Framework Lock-in:** Requires Next.js (or Nuxt/Svelte with adapters)
- **Function Timeouts:** 10s (Hobby), 15s (Pro), 900s (Enterprise)
- **No Long-Running Processes:** Serverless only
- **Cold Starts:** 100-500ms (mitigated by Fluid Compute)

### Cost Estimate

- **Hobby (Free):** 100GB-hours/month execution, 100GB bandwidth
- **Pro ($20/mo):** 1000GB-hours, 1TB bandwidth, Fluid Compute
- **Typical MCP Usage:** $0-5/mo on Hobby, $20-30/mo on Pro

### Resources

- [Vercel MCP Handler GitHub](https://github.com/vercel/mcp-handler)
- [Vercel MCP Documentation](https://vercel.com/docs/mcp)
- [Next.js MCP Template](https://vercel.com/templates/next.js/model-context-protocol-mcp-with-next-js)

---

## 2. Railway 🏆 RECOMMENDED

Railway offers the simplest deployment experience with native MCP support and no framework constraints.

### Why Railway?

- **Zero config:** Auto-detects Node.js/Docker
- **Official MCP server:** `@railway/mcp-server` for infrastructure management
- **Simple pricing:** $5/mo + usage (no free tier anymore)
- **Great DX:** GitHub integration, automatic SSL, instant rollbacks

### Setup Steps

#### Option A: Deploy from GitHub (Recommended)

```bash
# 1. Install Railway CLI
npm i -g @railway/cli

# 2. Login
railway login

# 3. Initialize in your project
cd google-calendar-mcp
railway init

# 4. Create railway.json for configuration
cat > railway.json << 'EOF'
{
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "node build/index.js --transport http --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE"
  }
}
EOF

# 5. Deploy
railway up

# 6. Add environment variables
railway variables set GOOGLE_OAUTH_CREDENTIALS="$(cat gcp-oauth.keys.json)"

# 7. Generate domain
railway domain
```

#### Option B: Deploy from Docker

```bash
# Railway auto-detects Dockerfile
railway up

# Add environment variables
railway variables set GOOGLE_OAUTH_CREDENTIALS="$(cat gcp-oauth.keys.json)"

# Generate domain
railway domain
```

### Authentication Setup

```bash
# SSH into your Railway service for one-time auth
railway run npm run auth

# Or use Railway's console
# Settings → Service → Console → Run: npm run auth
```

### Token Storage

Railway provides persistent volumes:

```bash
# Add volume in Railway dashboard
# Settings → Volumes → New Volume
# Mount path: /home/nodejs/.config/google-calendar-mcp
```

Or use Railway's Postgres for token storage (see Multi-User section).

### Access Your Server

```
https://your-project.up.railway.app
```

### Cost Estimate

- **Starter:** $5/mo base + usage
- **Typical Usage:** $8-15/mo (small MCP server)
- **No free tier** (as of 2025)

### Pros & Cons

**Pros:**
- Easiest Docker deployment
- No framework constraints
- Automatic SSL and domains
- GitHub integration
- One-click databases (Postgres, Redis, etc.)
- Preview environments

**Cons:**
- No free tier
- Limited to US/EU regions
- No global edge deployment

### Resources

- [Railway MCP Server](https://github.com/railwayapp/railway-mcp-server)
- [Railway Node.js Deployment](https://railway.app/deploy/nodejs)
- [Railway Documentation](https://docs.railway.app/)

---

## 3. Cloudflare Workers (Global Edge)

Cloudflare Workers provides the most cost-effective solution with global edge deployment.

### Why Cloudflare?

- **Ultra-low cost:** Free 100k requests/day, $5/mo unlimited
- **Global edge:** Deploy to 300+ data centers worldwide
- **Zero cold starts:** Workers are always warm
- **Streamable HTTP:** Native support for latest MCP protocol

### Prerequisites

- Cloudflare account
- Wrangler CLI
- Adaptation to Workers runtime (no Node.js fs, http modules)

### Setup Steps

```bash
# 1. Install Wrangler CLI
npm install -g wrangler

# 2. Login to Cloudflare
wrangler login

# 3. Create Worker project
wrangler init google-calendar-mcp-worker

# 4. Install dependencies
npm install @modelcontextprotocol/sdk
npm install @google-cloud/local-auth googleapis
```

Create `src/index.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Initialize MCP server
    const server = new McpServer({
      name: 'google-calendar-mcp',
      version: '2.0.0',
    });

    // Register your tools
    // Note: Adapt handlers for Workers runtime (no fs, use env vars/KV)
    registerTools(server, env);

    // Create transport
    const transport = new StreamableHTTPServerTransport();
    await server.connect(transport);

    // Handle request
    return await transport.handleRequest(request);
  },
};

function registerTools(server: McpServer, env: Env) {
  // Register your MCP tools here
  // Access OAuth credentials from env.GOOGLE_OAUTH_CREDENTIALS
  // Store tokens in Workers KV: env.CALENDAR_TOKENS
}
```

Configure `wrangler.toml`:

```toml
name = "google-calendar-mcp"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[vars]
GOOGLE_OAUTH_CREDENTIALS = ""  # Set via `wrangler secret put`

[[kv_namespaces]]
binding = "CALENDAR_TOKENS"
id = "your-kv-namespace-id"

[observability]
enabled = true
```

Deploy:

```bash
# Set secrets
echo "{your oauth json}" | wrangler secret put GOOGLE_OAUTH_CREDENTIALS

# Deploy
wrangler deploy

# Get URL
wrangler deployments list
```

### Challenges & Adaptations

**Runtime Differences:**
- ❌ No Node.js `fs` module → Use Workers KV for token storage
- ❌ No `http` module → Use Fetch API
- ❌ Limited dependencies → Some npm packages won't work
- ✅ Use Workers-compatible libraries

**Required Adaptations:**
1. **Token Storage:** Replace file-based storage with Workers KV
2. **OAuth Flow:** Use OAuth redirect to Workers URL
3. **Dependencies:** Ensure all packages are Workers-compatible

### Cost Estimate

- **Free:** 100,000 requests/day
- **Paid ($5/mo):** Unlimited requests, Workers KV included
- **Typical Usage:** $0-5/mo (most apps stay on free tier)

### Pros & Cons

**Pros:**
- Lowest cost of all options
- Global edge deployment (300+ locations)
- Zero cold starts
- Unlimited requests on paid plan
- Excellent performance

**Cons:**
- Requires code adaptation (no Node.js runtime)
- Learning curve for Workers API
- Limited to Workers-compatible packages
- More complex setup

### Resources

- [Cloudflare Workers MCP Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [Cloudflare Blog: MCP Servers](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
- [Workers Documentation](https://developers.cloudflare.com/workers/)

---

## 4. Google Cloud Run

Google Cloud Run offers auto-scaling containerized deployment with pay-per-use pricing.

### Why Cloud Run?

- **Pay per use:** Only pay when requests are running ($0.0000167/vCPU-second)
- **Auto-scaling:** Scales to zero, up to thousands
- **Container-based:** Use your existing Dockerfile
- **Official MCP support:** Google-provided tools and documentation

### Setup Steps

```bash
# 1. Install Google Cloud CLI
# https://cloud.google.com/sdk/docs/install

# 2. Initialize gcloud
gcloud init

# 3. Configure project
gcloud config set project YOUR_PROJECT_ID

# 4. Build and push container
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/google-calendar-mcp

# 5. Deploy to Cloud Run
gcloud run deploy google-calendar-mcp \
  --image gcr.io/YOUR_PROJECT_ID/google-calendar-mcp \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_OAUTH_CREDENTIALS=$(cat gcp-oauth.keys.json)" \
  --port 3000 \
  --min-instances 0 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1

# 6. Get URL
gcloud run services describe google-calendar-mcp --region us-central1 --format 'value(status.url)'
```

### With `cloudbuild.yaml` (CI/CD)

Create `cloudbuild.yaml`:

```yaml
steps:
  # Build the container image
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/google-calendar-mcp', '.']

  # Push to Container Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'gcr.io/$PROJECT_ID/google-calendar-mcp']

  # Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: gcloud
    args:
      - 'run'
      - 'deploy'
      - 'google-calendar-mcp'
      - '--image=gcr.io/$PROJECT_ID/google-calendar-mcp'
      - '--region=us-central1'
      - '--platform=managed'
      - '--allow-unauthenticated'

images:
  - 'gcr.io/$PROJECT_ID/google-calendar-mcp'
```

Deploy via Cloud Build:

```bash
gcloud builds submit --config cloudbuild.yaml
```

### Authentication with Cloud Run

**Option 1: Environment Variable**

```bash
gcloud run services update google-calendar-mcp \
  --set-env-vars "GOOGLE_OAUTH_CREDENTIALS=$(cat gcp-oauth.keys.json)"
```

**Option 2: Secret Manager (Recommended)**

```bash
# Store credentials in Secret Manager
gcloud secrets create google-oauth-credentials \
  --data-file=gcp-oauth.keys.json

# Grant access to Cloud Run service account
gcloud secrets add-iam-policy-binding google-oauth-credentials \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@YOUR_PROJECT.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Update Cloud Run service
gcloud run services update google-calendar-mcp \
  --update-secrets=GOOGLE_OAUTH_CREDENTIALS=google-oauth-credentials:latest
```

### Token Storage

Use Google Cloud Storage or Firestore for persistent token storage:

```typescript
// Adapt tokenManager.ts to use Cloud Storage
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucket = storage.bucket('your-bucket-name');
const file = bucket.file('tokens/calendar-tokens.json');

// Save tokens
await file.save(JSON.stringify(tokens));

// Load tokens
const [contents] = await file.download();
const tokens = JSON.parse(contents.toString());
```

### Cost Estimate

**Free Tier (per month):**
- 2 million requests
- 360,000 vCPU-seconds
- 180,000 GiB-seconds memory

**Typical MCP Usage:**
- Small: $0-2/mo (stays in free tier)
- Medium: $5-15/mo
- High: $20-50/mo

**Cost Breakdown:**
- $0.0000167 per vCPU-second
- $0.0000017 per GiB-second
- $0.40 per million requests

### Pros & Cons

**Pros:**
- True pay-per-use pricing
- Auto-scales to zero (no cost when idle)
- Strong security with IAM
- Integrates with GCP ecosystem
- Official MCP documentation

**Cons:**
- Cold starts (100-500ms)
- More complex setup than Railway/Render
- Requires GCP knowledge
- Can be expensive at high scale

### Resources

- [Cloud Run MCP Guide](https://cloud.google.com/run/docs/host-mcp-servers)
- [Cloud Run Tutorial](https://cloud.google.com/run/docs/tutorials/deploy-remote-mcp-server)
- [Cloud Run Pricing](https://cloud.google.com/run/pricing)

---

## 5. Render

Render provides a simple deployment experience with a free tier and managed services.

### Why Render?

- **Free tier available:** Great for testing
- **Simple deployment:** Git push to deploy
- **Managed databases:** Postgres, Redis included
- **Official MCP server:** Use Render's infrastructure via AI
- **Auto-SSL:** Automatic HTTPS

### Setup Steps

#### Option 1: Docker Deployment

```bash
# 1. Create account at render.com

# 2. Connect your GitHub repository

# 3. Create new Web Service:
#    - Build Command: (leave empty, uses Dockerfile)
#    - Start Command: (leave empty, uses Dockerfile CMD)
#    - Plan: Free or Starter ($7/mo)

# 4. Add environment variables in Render dashboard:
#    - GOOGLE_OAUTH_CREDENTIALS: (paste JSON)

# 5. Deploy automatically on git push
```

#### Option 2: Native Deployment

Create `render.yaml`:

```yaml
services:
  - type: web
    name: google-calendar-mcp
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: node build/index.js --transport http --host 0.0.0.0 --port $PORT
    envVars:
      - key: NODE_ENV
        value: production
      - key: GOOGLE_OAUTH_CREDENTIALS
        sync: false  # Set in Render dashboard
    healthCheckPath: /health
```

Deploy:

```bash
# Push to GitHub, Render auto-deploys
git push origin main
```

### Token Storage

Use Render's persistent disk:

```yaml
services:
  - type: web
    # ... other config
    disk:
      name: calendar-tokens
      mountPath: /home/nodejs/.config/google-calendar-mcp
      sizeGB: 1
```

### Access Your Server

```
https://your-service.onrender.com
```

### Cost Estimate

- **Free Tier:** 750 hours/month, spins down after inactivity
- **Starter ($7/mo):** Always on, better performance
- **Standard ($25/mo):** More resources, zero-downtime deploys

**Free tier limitations:**
- 15-30 second spin-up time after inactivity
- Limited to 512MB RAM
- Shared CPU

### Pros & Cons

**Pros:**
- Free tier available
- Simple setup (Git → Deploy)
- Auto-SSL
- Built-in databases
- Official MCP server for Render management
- Good documentation

**Cons:**
- Free tier spins down (slow cold starts)
- Limited to 5 regions
- Slow compared to edge platforms
- More expensive than Railway for always-on

### Resources

- [Render MCP Server](https://render.com/docs/mcp-server)
- [Render Node.js Deploy Guide](https://render.com/docs/deploy-node)
- [Render Documentation](https://render.com/docs)

---

## 6. Fly.io (Global Deployment)

Fly.io excels at global deployment with low latency and usage-based pricing.

### Why Fly.io?

- **True global deployment:** 20+ regions, run close to users
- **Low latency:** Global Anycast routing
- **Usage-based pricing:** Pay per second of CPU/memory
- **Docker-native:** Uses your existing Dockerfile

### Setup Steps

```bash
# 1. Install flyctl
curl -L https://fly.io/install.sh | sh

# 2. Login
flyctl auth login

# 3. Launch app (interactive)
flyctl launch

# Follow prompts:
# - App name: google-calendar-mcp
# - Region: Choose primary (e.g., iad - Washington DC)
# - PostgreSQL/Redis: No (unless needed for tokens)

# 4. Configure fly.toml
```

Edit `fly.toml`:

```toml
app = "google-calendar-mcp"
primary_region = "iad"

[build]

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[http_service.checks]]
  grace_period = "30s"
  interval = "15s"
  method = "get"
  path = "/health"
  timeout = "5s"

[env]
  NODE_ENV = "production"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

Deploy:

```bash
# Set secrets
flyctl secrets set GOOGLE_OAUTH_CREDENTIALS="$(cat gcp-oauth.keys.json)"

# Deploy
flyctl deploy

# Scale to multiple regions (optional)
flyctl scale count 3 --region iad,lhr,syd

# Get URL
flyctl info
```

### Token Storage

**Option 1: Persistent Volumes**

```bash
# Create volume
flyctl volumes create calendar_tokens --size 1

# Update fly.toml
```

Add to `fly.toml`:

```toml
[[mounts]]
  source = "calendar_tokens"
  destination = "/home/nodejs/.config/google-calendar-mcp"
```

**Option 2: Fly Postgres**

```bash
flyctl postgres create
flyctl postgres attach --app google-calendar-mcp
```

### Multi-Region Deployment

```bash
# Deploy to multiple regions for low latency worldwide
flyctl scale count 3 --region iad,lhr,syd

# Or add regions one by one
flyctl regions add lhr syd nrt fra
```

### Cost Estimate

- **Free tier:** 3 shared-cpu VMs, 3GB persistent volumes
- **Typical Usage:**
  - Small (1 region): $5-10/mo
  - Multi-region (3 regions): $15-25/mo
  - High traffic: $30-50/mo

**Pricing:**
- $0.0000008/sec for shared-cpu-1x (256MB RAM)
- $0.15/GB/month for volumes
- Free bandwidth (first 100GB/mo)

### Pros & Cons

**Pros:**
- True global deployment (20+ regions)
- Low latency worldwide
- Pay-per-second pricing
- Auto-stop/start (save costs)
- Static IPs included
- Great for Elixir/Phoenix (bonus)

**Cons:**
- Steeper learning curve
- More manual configuration
- No managed Redis/MongoDB
- Cold starts when auto-stopped
- Requires comfort with containers

### Resources

- [Fly.io Documentation](https://fly.io/docs/)
- [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- [Fly Launch Guide](https://fly.io/docs/hands-on/launch-app/)

---

## 7. DigitalOcean App Platform

DigitalOcean App Platform offers simple deployment with predictable pricing.

### Why DigitalOcean?

- **Predictable pricing:** Flat $5/mo, no surprises
- **Simple setup:** GitHub → Deploy
- **Official MCP server:** Manage DigitalOcean via AI
- **Managed databases:** Add Postgres/Redis easily

### Setup Steps

```bash
# Option 1: Via Web UI
# 1. Connect GitHub repository at digitalocean.com/apps
# 2. Select repository and branch
# 3. Configure build settings
# 4. Set environment variables
# 5. Deploy

# Option 2: Via doctl CLI
doctl apps create --spec .do/app.yaml
```

Create `.do/app.yaml`:

```yaml
name: google-calendar-mcp
region: nyc
services:
  - name: web
    github:
      repo: your-username/google-calendar-mcp
      branch: main
      deploy_on_push: true
    build_command: npm run build
    run_command: node build/index.js --transport http --host 0.0.0.0 --port 8080
    http_port: 8080
    instance_count: 1
    instance_size_slug: basic-xxs
    envs:
      - key: NODE_ENV
        value: production
      - key: GOOGLE_OAUTH_CREDENTIALS
        value: ${GOOGLE_OAUTH_CREDENTIALS}  # Set via doctl or UI
    health_check:
      http_path: /health
```

Deploy:

```bash
# Create app
doctl apps create --spec .do/app.yaml

# Update environment variables
doctl apps update YOUR_APP_ID --spec .do/app.yaml

# View logs
doctl apps logs YOUR_APP_ID
```

### Cost Estimate

- **Basic ($5/mo):** 512MB RAM, 1 vCPU
- **Professional ($12/mo):** 1GB RAM, more resources
- **Typical Usage:** $5-12/mo

### Pros & Cons

**Pros:**
- Simple, predictable pricing
- Easy GitHub integration
- Good documentation
- Official MCP server
- Managed databases available

**Cons:**
- Limited regions (8 available)
- No edge deployment
- Manual scaling
- Basic features compared to others

### Resources

- [DigitalOcean MCP Server](https://docs.digitalocean.com/products/app-platform/how-to/use-mcp/)
- [App Platform Docs](https://docs.digitalocean.com/products/app-platform/)
- [App Platform Pricing](https://www.digitalocean.com/pricing/app-platform)

---

## 8. AWS Lambda (Serverless)

AWS Lambda offers deep AWS integration with generous free tier and pay-per-request pricing.

### Why AWS Lambda?

- **Generous free tier:** 1 million requests/month free forever
- **Deep AWS integration:** EventBridge, DynamoDB, S3, etc.
- **Pay per request:** Only pay when invoked
- **Official MCP support:** AWS Serverless MCP tools

### Prerequisites

- AWS account
- AWS CLI configured
- Serverless Framework or SAM CLI

### Setup with Serverless Framework

Install:

```bash
npm install -g serverless
```

Create `serverless.yml`:

```yaml
service: google-calendar-mcp

provider:
  name: aws
  runtime: nodejs18.x
  stage: ${opt:stage, 'prod'}
  region: us-east-1
  memorySize: 512
  timeout: 30
  environment:
    NODE_ENV: production
    GOOGLE_OAUTH_CREDENTIALS: ${ssm:/google-calendar-mcp/oauth-credentials~true}
  iam:
    role:
      statements:
        - Effect: Allow
          Action:
            - dynamodb:PutItem
            - dynamodb:GetItem
            - dynamodb:UpdateItem
          Resource:
            - !GetAtt TokensTable.Arn

functions:
  mcp:
    handler: build/lambda.handler
    events:
      - httpApi:
          path: /{proxy+}
          method: ANY

resources:
  Resources:
    TokensTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: ${self:service}-tokens-${self:provider.stage}
        AttributeDefinitions:
          - AttributeName: userId
            AttributeType: S
        KeySchema:
          - AttributeName: userId
            KeyType: HASH
        BillingMode: PAY_PER_REQUEST
```

Create Lambda handler `src/lambda.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDB } from '@aws-sdk/client-dynamodb';

// Initialize MCP server (outside handler for reuse)
let server: McpServer | null = null;
let transport: StreamableHTTPServerTransport | null = null;

async function initializeServer() {
  if (!server) {
    server = new McpServer({
      name: 'google-calendar-mcp',
      version: '2.0.0',
    });

    // Register tools
    // Adapt your handlers to use DynamoDB for token storage

    transport = new StreamableHTTPServerTransport();
    await server.connect(transport);
  }
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  await initializeServer();

  // Convert API Gateway event to standard HTTP request
  const request = new Request(
    `https://${event.requestContext.domainName}${event.rawPath}`,
    {
      method: event.requestContext.http.method,
      headers: event.headers as HeadersInit,
      body: event.body || undefined,
    }
  );

  // Handle with MCP transport
  const response = await transport!.handleRequest(request);

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
}
```

Deploy:

```bash
# Store OAuth credentials in Parameter Store
aws ssm put-parameter \
  --name /google-calendar-mcp/oauth-credentials \
  --value "$(cat gcp-oauth.keys.json)" \
  --type SecureString

# Deploy
serverless deploy

# Get endpoint URL
serverless info
```

### Token Storage with DynamoDB

Adapt `src/auth/tokenManager.ts`:

```typescript
import { DynamoDBClient, PutItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({});
const tableName = process.env.TOKENS_TABLE || 'google-calendar-mcp-tokens-prod';

export async function saveTokens(userId: string, tokens: any) {
  await dynamodb.send(new PutItemCommand({
    TableName: tableName,
    Item: {
      userId: { S: userId },
      tokens: { S: JSON.stringify(tokens) },
      updatedAt: { N: Date.now().toString() },
    },
  }));
}

export async function loadTokens(userId: string) {
  const result = await dynamodb.send(new GetItemCommand({
    TableName: tableName,
    Key: { userId: { S: userId } },
  }));

  if (result.Item?.tokens?.S) {
    return JSON.parse(result.Item.tokens.S);
  }
  return null;
}
```

### Cost Estimate

**Free Tier (monthly):**
- 1 million requests
- 400,000 GB-seconds compute time

**Typical Usage:**
- Small: $0 (stays in free tier)
- Medium: $5-10/mo
- Large: $20-50/mo

**Pricing:**
- $0.20 per 1M requests
- $0.0000166667 per GB-second

### Pros & Cons

**Pros:**
- Generous free tier (1M requests/mo)
- True pay-per-request
- Deep AWS integration
- Scales automatically
- Official AWS MCP tools

**Cons:**
- Complex setup
- Cold starts (100-500ms)
- Requires AWS knowledge
- DynamoDB/S3 needed for state
- VPC config for private resources

### Resources

- [AWS Serverless MCP](https://aws.amazon.com/blogs/compute/introducing-aws-serverless-mcp-server-ai-powered-development-for-modern-applications/)
- [AWS Lambda Docs](https://docs.aws.amazon.com/lambda/)
- [Serverless Framework](https://www.serverless.com/)

---

## Additional Considerations

### Multi-User Support

Your current server uses single OAuth tokens. For multi-user:

**Option 1: User-specific tokens in database**

```typescript
// Store tokens per user
interface UserTokens {
  userId: string;
  tokens: OAuth2Tokens;
  createdAt: Date;
  updatedAt: Date;
}

// Adapt handlers to accept userId
async function getUserCalendar(userId: string) {
  const tokens = await loadUserTokens(userId);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}
```

**Option 2: OAuth per-request**

Implement OAuth Authorization Code flow where users authenticate via your MCP server.

**Databases for Token Storage:**
- **Railway/Render:** Postgres ($10-15/mo)
- **Vercel:** Vercel KV (Redis) ($0.20/100K reads)
- **Cloudflare:** Workers KV (free 100K reads/day)
- **AWS:** DynamoDB (free 25GB)
- **GCP:** Firestore (free 1GB)

### Security Checklist

- [ ] **API Authentication:** Add API key or OAuth to MCP endpoint
- [ ] **Rate Limiting:** Implement rate limits (express-rate-limit, Cloudflare)
- [ ] **Token Encryption:** Encrypt tokens at rest
- [ ] **HTTPS Only:** Enforce HTTPS (all platforms provide free SSL)
- [ ] **CORS Policy:** Restrict origins if not public
- [ ] **Environment Variables:** Never commit credentials
- [ ] **Secrets Management:** Use platform secret stores
- [ ] **Audit Logging:** Log access and tool usage
- [ ] **Production OAuth:** Move out of test mode (no expiry)

### Monitoring & Observability

**Recommended Tools:**
- **Sentry:** Error tracking (free tier available)
- **Datadog:** APM and logging ($15/host/mo)
- **LogTail:** Log aggregation (free tier)
- **Uptime Robot:** Health checks (free for 50 monitors)

**Platform-native:**
- **Vercel:** Built-in analytics and logging
- **Railway:** Integrated logs and metrics
- **Cloudflare:** Workers Analytics
- **Google Cloud:** Cloud Logging & Monitoring
- **AWS:** CloudWatch

### Performance Optimization

1. **Enable Caching:** Cache calendar list, event queries
2. **Connection Pooling:** Reuse OAuth clients
3. **Lazy Loading:** Initialize services on-demand
4. **Batch Requests:** Combine multiple calendar queries
5. **CDN:** Use platform CDN for static assets

---

## Migration Guide: From stdio to HTTP

Your current server supports both stdio and HTTP. To migrate:

### 1. Update Environment Variables

```bash
# .env or platform environment
TRANSPORT=http
HOST=0.0.0.0
PORT=3000
```

### 2. Test Locally

```bash
npm run build
npm run start:http

# Test health endpoint
curl http://localhost:3000/health

# Test MCP protocol
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### 3. Deploy to Platform

Follow platform-specific guide above.

### 4. Update AI Clients

**OpenAI Responses API:**
```python
response = client.responses.create(
    model="gpt-4.1",
    tools=[{
        "type": "mcp",
        "server_url": "https://your-deployed-server.com",
    }],
    input="List my calendars"
)
```

**ChatGPT Developer Mode:**
- Settings → Connectors → Add Custom Connector
- Enter: `https://your-deployed-server.com`

---

## Summary & Decision Matrix

### Choose **Vercel** if:
- ✅ You're already using Next.js
- ✅ You want fastest time-to-deploy
- ✅ You need preview deployments
- ✅ Budget: $20-30/mo is acceptable

### Choose **Railway** if:
- ✅ You want simplest Docker deployment
- ✅ You need databases alongside MCP
- ✅ You prefer GitHub integration
- ✅ Budget: $8-15/mo

### Choose **Cloudflare Workers** if:
- ✅ You want global edge deployment
- ✅ Cost is priority ($5/mo unlimited)
- ✅ You're comfortable adapting code
- ✅ You want zero cold starts

### Choose **Google Cloud Run** if:
- ✅ You want true pay-per-use
- ✅ You're in GCP ecosystem
- ✅ You need auto-scaling to zero
- ✅ Budget: $0-20/mo depending on traffic

### Choose **Render** if:
- ✅ You want a free tier for testing
- ✅ You need simple Git → Deploy
- ✅ You're okay with cold starts on free tier
- ✅ Budget: $0 (testing) or $7/mo (production)

### Choose **Fly.io** if:
- ✅ You need global multi-region deployment
- ✅ Low latency worldwide is critical
- ✅ You're comfortable with containers
- ✅ Budget: $15-25/mo for multi-region

### Choose **DigitalOcean** if:
- ✅ You want predictable $5/mo pricing
- ✅ Simple is better than powerful
- ✅ You're familiar with DigitalOcean
- ✅ Budget: $5-12/mo

### Choose **AWS Lambda** if:
- ✅ You're in AWS ecosystem
- ✅ You want pay-per-request
- ✅ You're comfortable with serverless
- ✅ Budget: $0-10/mo (with free tier)

---

## Getting Help

- **Issues:** [GitHub Issues](https://github.com/nspady/google-calendar-mcp/issues)
- **OpenAI Integration:** See [openai-integration.md](openai-integration.md)
- **Docker Deployment:** See [docker.md](docker.md)
- **Authentication:** See [authentication.md](authentication.md)

---

**Last Updated:** October 2025
**MCP Version:** 2025-06-18
**Server Version:** 2.0.0
