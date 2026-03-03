# Google Calendar MCP Server - Optimized Dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

# Set working directory
WORKDIR /app

# Copy package files for dependency caching
COPY package*.json ./

# Copy build scripts and source files needed for build
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json .
COPY vite.config.ui.ts .

# Install all dependencies (including dev dependencies for build)
RUN npm ci --no-audit --no-fund --silent

# Build the project
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production --silent

# Create config directory and set permissions
RUN mkdir -p /home/nodejs/.config/google-calendar-mcp && \
    chown -R nodejs:nodejs /home/nodejs/.config && \
    chown -R nodejs:nodejs /app

# Install su-exec for dropping privileges after fixing volume permissions
RUN apk add --no-cache su-exec

# Copy entrypoint script (runs as root to fix volume permissions, then drops to nodejs)
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port for HTTP mode (optional)
EXPOSE 3000

# Entrypoint fixes volume mount permissions then drops to nodejs user
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "build/index.js", "--transport", "http", "--host", "0.0.0.0"]