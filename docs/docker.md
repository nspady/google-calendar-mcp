# Docker Deployment Guide

Simple, production-ready Docker setup for the Google Calendar MCP Server.

## Quick Start

```bash
# 1. Place your OAuth credentials
cp /path/to/your/gcp-oauth.keys.json .

# 2. Configure environment (optional)
cp .env.example .env

# 3. Start the server
docker compose up
```

## Two Modes

### stdio Mode (Default)
**Perfect for Claude Desktop integration:**

```bash
# Start in stdio mode
docker compose up

# Use in Claude Desktop config:
{
  "mcpServers": {
    "google-calendar": {
      "command": "docker",
      "args": ["exec", "-i", "calendar-mcp", "npm", "start"]
    }
  }
}
```

### HTTP Mode
**For remote access and web integration:**

```bash
# Edit docker-compose.yml to uncomment these lines:
ports:
  - "${PORT:-3000}:3000"
environment:
  TRANSPORT: http

# Then start
docker compose up

# Test the endpoint
curl http://localhost:3000/health
```

## Authentication Setup

### Step 1: Get OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials (Desktop Application)
5. Download as `gcp-oauth.keys.json`

### Step 2: Authenticate

```bash
# One-time authentication
docker compose exec calendar-mcp npm run auth

# Tokens are automatically persisted in Docker volume
```

## Environment Configuration

Create a `.env` file for customization:

```bash
# Transport mode
TRANSPORT=stdio  # or 'http' for HTTP mode

# HTTP settings (when TRANSPORT=http)
PORT=3000
HOST=0.0.0.0
ALLOWED_ORIGINS=*

# Development
DEBUG=false
NODE_ENV=production

# OAuth credentials path
GOOGLE_OAUTH_CREDENTIALS=./gcp-oauth.keys.json
```

## Production Deployment

### OAuth App Setup (Important!)

For production use, **publish your OAuth app** to avoid 7-day token expiration:

1. **Google Cloud Console** → **OAuth consent screen**
2. Click **"PUBLISH APP"** or **"PUSH TO PRODUCTION"**
3. ✅ Tokens will now persist indefinitely

See [OAuth Verification Guide](oauth-verification.md) for detailed steps.

### Docker Production Setup

```bash
# For HTTP mode production
# 1. Edit docker-compose.yml to uncomment HTTP settings
# 2. Configure environment
echo "TRANSPORT=http" >> .env
echo "ALLOWED_ORIGINS=https://yourdomain.com" >> .env

# 3. Deploy with reverse proxy for HTTPS
docker compose up -d
```

### Production Checklist

- [ ] OAuth app published to production in Google Cloud Console
- [ ] HTTPS/TLS via reverse proxy (nginx, traefik, etc.)
- [ ] Appropriate CORS origins configured
- [ ] Monitoring and logging set up
- [ ] Backup strategy for token volume

## Common Commands

```bash
# Background mode
docker compose up -d

# View logs
docker compose logs -f

# Stop and remove
docker compose down

# Rebuild image
docker compose build

# Execute commands in container
docker compose exec calendar-mcp npm run auth

# Check token status
docker compose exec calendar-mcp ls -la /home/nodejs/.config/google-calendar-mcp/
```

## Troubleshooting

### Authentication Issues
```bash
# Check if credentials file exists
ls -la gcp-oauth.keys.json

# Check if mounted correctly in container
docker compose exec calendar-mcp ls -la /app/gcp-oauth.keys.json

# Re-authenticate
docker compose exec calendar-mcp npm run auth
```

### Network Issues (HTTP mode)
```bash
# Check container is running
docker compose ps

# Test health endpoint
curl http://localhost:3000/health

# Check logs
docker compose logs calendar-mcp
```

### Token Persistence
```bash
# Check token volume
docker volume inspect google-calendar-mcp_calendar-tokens

# Check tokens in container
docker compose exec calendar-mcp ls -la /home/nodejs/.config/google-calendar-mcp/
```

## Advanced Usage

### Custom Port
```bash
# Set custom port in .env
echo "PORT=8080" >> .env

# Update docker-compose.yml port mapping
ports:
  - "8080:8080"
```

### Development Mode
```bash
# Enable debug logging
echo "DEBUG=true" >> .env
docker compose up
```

### Health Monitoring
```bash
# Check container health
docker compose ps

# For HTTP mode, health endpoint returns:
curl http://localhost:3000/health
# {"status":"healthy","server":"google-calendar-mcp","version":"1.3.0"}
```

## Integration Examples

### Claude Desktop (stdio)
```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "docker",
      "args": ["exec", "-i", "calendar-mcp", "npm", "start"]
    }
  }
}
```

### HTTP Client (JavaScript)
```javascript
// Check server health
const response = await fetch('http://localhost:3000/health');
const status = await response.json();
console.log(status); // {"status":"healthy",...}
```

### Production with Traefik
```yaml
# docker-compose.yml additions for Traefik
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.calendar-mcp.rule=Host(`calendar-api.yourdomain.com`)"
  - "traefik.http.routers.calendar-mcp.tls.certresolver=letsencrypt"
```

That's it! This setup provides a simple, secure, and production-ready way to run the Google Calendar MCP Server in Docker.

For more details, see:
- [OAuth Verification Guide](oauth-verification.md) - Solving 7-day token expiration
- [Development Guide](development.md) - Local development setup
- [Deployment Guide](deployment.md) - Cloud deployment options