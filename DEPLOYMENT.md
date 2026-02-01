# Railway Deployment Guide

This guide covers deploying the Google Calendar MCP Server to Railway for personal remote access.

## Prerequisites

1. [Railway account](https://railway.app/) (free trial or Hobby plan)
2. Google Cloud OAuth credentials (`gcp-oauth.keys.json`)
3. Domain or subdomain for deployment (or use Railway's provided domain)

## Step 1: Prepare Environment Variables

### Generate Bearer Token

```bash
# Generate a secure random token
openssl rand -base64 32
```

Save this token - you'll need it for both Railway configuration and Claude Desktop configuration.

### Base64 Encode OAuth Credentials

```bash
# Encode your OAuth credentials file
base64 -i gcp-oauth.keys.json

# Or on Linux:
base64 -w 0 gcp-oauth.keys.json
```

Copy the output - this will be your `GOOGLE_OAUTH_CREDENTIALS` environment variable.

## Step 2: Configure Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** > **Credentials**
3. Edit your OAuth 2.0 Client ID
4. Add to **Authorized redirect URIs**:
   - `https://your-domain.com/oauth2callback` (replace with your domain)
   - Or use Railway's domain: `https://your-app.railway.app/oauth2callback`
5. Add to **Authorized JavaScript origins**:
   - `https://your-domain.com`
   - Or use Railway's domain: `https://your-app.railway.app`
6. Click **Save**

## Step 3: Deploy to Railway

### Option A: Deploy from GitHub (Recommended)

1. Push this branch to GitHub:
   ```bash
   git add .
   git commit -m "feat: add Railway deployment configuration"
   git push origin feature/railway-deployment
   ```

2. Go to [Railway Dashboard](https://railway.app/dashboard)
3. Click **New Project** → **Deploy from GitHub repo**
4. Select your repository and branch `feature/railway-deployment`
5. Railway will detect the `Dockerfile` and `railway.toml` automatically

### Option B: Deploy with Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Deploy
railway up
```

## Step 4: Configure Environment Variables

In Railway Dashboard, go to your project → **Variables** and add:

```env
MCP_BEARER_TOKEN=<your-generated-token>
ALLOWED_ORIGIN=https://your-domain.com
OAUTH_REDIRECT_BASE_URL=https://your-domain.com
GOOGLE_OAUTH_CREDENTIALS=<base64-encoded-credentials>
```

**Note**: Railway automatically sets `PORT` and provides the domain. You don't need to set `HOST`.

## Step 5: Configure Custom Domain (Optional)

1. In Railway Dashboard, go to **Settings** → **Domains**
2. Click **Add Custom Domain**
3. Enter your domain (e.g., `cal.example.com`)
4. Add the CNAME record to your DNS:
   - **Name**: `cal` (or your subdomain)
   - **Value**: Railway provides this (e.g., `your-app.up.railway.app`)
5. Wait for DNS propagation (usually 5-30 minutes)
6. Update `ALLOWED_ORIGIN` and `OAUTH_REDIRECT_BASE_URL` to use your custom domain

## Step 6: Authenticate Your Google Account

1. Open your deployed URL in a browser: `https://your-domain.com/accounts`
2. Click "Add Account"
3. Follow the OAuth flow to authenticate with Google
4. Your tokens will be stored securely in the container's filesystem

**Note**: For personal use, the filesystem storage works fine. For multi-user, you'll need to add a PostgreSQL database (see Phase 2 in main plan).

## Step 7: Configure Claude Desktop

Edit your Claude Desktop MCP configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "google-calendar-remote": {
      "url": "https://your-domain.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_BEARER_TOKEN_HERE"
      }
    }
  }
}
```

Replace:
- `your-domain.com` with your actual domain
- `YOUR_BEARER_TOKEN_HERE` with the token you generated in Step 1

## Step 8: Verify Deployment

1. **Health Check**: Visit `https://your-domain.com/health`
   - Should return: `{"status":"healthy","server":"google-calendar-mcp","timestamp":"..."}`

2. **Test OAuth**: Visit `https://your-domain.com/accounts`
   - Should load the account management UI

3. **Test MCP from Claude Desktop**:
   - Restart Claude Desktop
   - Open a new conversation
   - Try: "List my calendars" or "What's on my calendar today?"
   - Claude should connect to your remote MCP server

## Troubleshooting

### Deployment Fails

- Check Railway build logs for errors
- Verify all environment variables are set correctly
- Ensure `gcp-oauth.keys.json` is valid and base64 encoded properly

### OAuth Redirect Fails

- Verify Google Cloud Console has correct redirect URIs
- Check that `OAUTH_REDIRECT_BASE_URL` matches your actual domain
- Wait for DNS propagation if using custom domain

### Bearer Token Authentication Fails

- Verify `MCP_BEARER_TOKEN` is set in Railway
- Check that Claude Desktop config has correct token in `Authorization` header
- Ensure no trailing spaces in token

### MCP Connection Fails

- Verify health endpoint returns 200 OK
- Check Railway logs for errors
- Ensure firewall/network allows HTTPS connections
- Verify CORS is configured correctly (`ALLOWED_ORIGIN`)

## Monitoring

Railway provides:
- **Logs**: Real-time application logs
- **Metrics**: CPU, memory, network usage
- **Deployments**: History of all deployments with rollback capability

Access these in the Railway Dashboard for your project.

## Cost Estimate

**Railway Hobby Plan**: $5/month minimum
- Includes $5 usage credit monthly
- Usage-based billing:
  - CPU: ~$0.000008/vCPU-second
  - RAM: ~$0.000004/GB-second
  - Egress: $0.05/GB

**Expected monthly cost for personal use**: $5-10/month

## Next Steps

- Monitor usage in Railway Dashboard
- Set up usage alerts
- Add multiple Google accounts if needed (via `/accounts` UI)
- When ready for multi-user, follow Phase 2 plan to add PostgreSQL

## Security Notes

- Bearer token provides authentication for MCP access
- Google OAuth handles calendar authorization
- HTTPS ensures encrypted communication
- CORS restricts access to your domain
- Never commit `.env` files or credentials to Git
- Rotate bearer token periodically for security
