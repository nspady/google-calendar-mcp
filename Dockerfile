# Google Calendar MCP Server - Optimized Dockerfile
# syntax=docker/dockerfile:1

FROM node:18-alpine

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

# Switch to non-root user
USER nodejs

# Expose port for HTTP mode (optional)
EXPOSE 3000

# Default command - start in HTTP mode on all interfaces for Railway/cloud deployment
CMD ["node", "build/index.js", "--transport", "http", "--host", "0.0.0.0"]