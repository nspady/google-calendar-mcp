FROM node:22-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Copy build scripts and source files needed for build
COPY scripts ./scripts
COPY src ./src
COPY tsconfig.json .

# Install dependencies (now includes esbuild) and build via postinstall
RUN npm ci --production --no-audit --no-fund --silent

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

# Expose port for HTTP mode (optional, not used in stdio mode)
EXPOSE 3000

# Default to stdio mode
ENTRYPOINT ["npm", "run", "start", "--silent"]