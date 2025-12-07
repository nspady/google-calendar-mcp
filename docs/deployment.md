# Deployment Guide

This guide covers deploying the Google Calendar MCP Server for remote access via HTTP transport.

## Transport Modes

### stdio Transport (Default)
- Local use only
- Direct communication with Claude Desktop
- No network exposure
- Automatic authentication handling

### HTTP Transport
- Remote deployment capable
- Server-Sent Events (SSE) for real-time communication
- Built-in security features
- Suitable for cloud deployment

## HTTP Server Features

- ✅ **CORS Support**: Basic cross-origin access support
- ✅ **Health Monitoring**: Basic health check endpoint
- ✅ **Graceful Shutdown**: Proper resource cleanup
- ✅ **Origin Validation**: DNS rebinding protection

## Local HTTP Deployment

### Basic HTTP Server

```bash
# Start on localhost only (default port 3000)
npm run start:http
```

### Public HTTP Server

```bash
# Listen on all interfaces (0.0.0.0)
npm run start:http:public
```

### Environment Variables

```bash
PORT=3000                    # Server port
HOST=localhost              # Bind address
TRANSPORT=http              # Transport mode
```

## Docker Deployment

### Using Docker Compose (Recommended)

```bash
# stdio mode  
docker compose up -d server

# HTTP mode
docker compose --profile http up -d
```

See [Docker Guide](docker.md) for complete setup instructions.

### Using Docker Run

```bash
# Create volume for token storage
docker volume create mcp-tokens

# stdio mode
docker run -i \
  -v ./gcp-oauth.keys.json:/usr/src/app/gcp-oauth.keys.json:ro \
  -v mcp-tokens:/home/nodejs/.config/google-calendar-mcp \
  -e TRANSPORT=stdio \
  --name calendar-mcp \
  google-calendar-mcp

# HTTP mode
docker run -d \
  -p 3000:3000 \
  -v ./gcp-oauth.keys.json:/usr/src/app/gcp-oauth.keys.json:ro \
  -v mcp-tokens:/home/nodejs/.config/google-calendar-mcp \
  -e TRANSPORT=http \
  -e HOST=0.0.0.0 \
  --name calendar-mcp \
  google-calendar-mcp

```

### Building Custom Image

Use the provided Dockerfile which includes proper user setup and token storage:

```bash
# Build image
docker build -t google-calendar-mcp .

# Run with authentication
docker run -it google-calendar-mcp npm run auth
```

## Cloud Deployment

### Google Cloud Run

```bash
# Build and push image
gcloud builds submit --tag gcr.io/PROJECT-ID/calendar-mcp

# Deploy
gcloud run deploy calendar-mcp \
  --image gcr.io/PROJECT-ID/calendar-mcp \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="TRANSPORT=http"
```

### AWS ECS

1. Push image to ECR
2. Create task definition with environment variables
3. Deploy service with ALB

### Heroku

```bash
# Create app
heroku create your-calendar-mcp

# Set buildpack
heroku buildpacks:set heroku/nodejs

# Configure
heroku config:set TRANSPORT=http
heroku config:set GOOGLE_OAUTH_CREDENTIALS=./gcp-oauth.keys.json

# Deploy
git push heroku main
```

## Security Configuration

### HTTPS/TLS

Always use HTTPS in production:

1. **Behind a Reverse Proxy** (Recommended)
   ```nginx
   server {
       listen 443 ssl;
       server_name calendar-mcp.example.com;
       
       ssl_certificate /path/to/cert.pem;
       ssl_certificate_key /path/to/key.pem;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection '';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

2. **Direct TLS** (Not built-in)
   For TLS support, use a reverse proxy like nginx or a cloud load balancer with SSL termination.


### Authentication Flow

1. Client connects to HTTP endpoint
2. Server redirects to Google OAuth
3. User authenticates with Google
4. Server stores tokens securely
5. Client receives session token
6. All requests use session token

## Monitoring

### Health Checks

```bash
# Health check
curl http://localhost:3000/health
```

## Production Checklist

**OAuth App Setup:**
- [ ] **Publish OAuth app to production in Google Cloud Console**
- [ ] **Set up proper redirect URIs for your domain**
- [ ] **Use production OAuth credentials (not test/development)**
- [ ] **Consider submitting for verification to remove user warnings**

**Infrastructure:**
- [ ] Use HTTPS/TLS encryption
- [ ] Configure reverse proxy for production
- [ ] Set up SSL termination
- [ ] Set up monitoring/alerting for authentication failures
- [ ] Configure log aggregation
- [ ] Implement backup strategy for token storage
- [ ] Test disaster recovery and re-authentication procedures
- [ ] Review security headers
- [ ] Enable graceful shutdown

**Note**: The 7-day token expiration is resolved by publishing your OAuth app to production in Google Cloud Console.

## Troubleshooting

### Connection Issues
- Check firewall rules
- Verify CORS configuration
- Test with curl first

### Authentication Failures
- Ensure credentials are accessible
- Check token permissions
- Verify redirect URIs

### Performance Problems
- Enable caching headers
- Use CDN for static assets
- Monitor memory usage