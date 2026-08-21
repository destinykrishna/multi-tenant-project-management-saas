# ==============================================================================
# Stage 1: Dependencies
# ==============================================================================
FROM node:22-alpine AS dependencies

WORKDIR /app

# Install native dependencies required by Prisma and build tools
RUN apk add --no-cache openssl libc6-compat

# Copy package manifests and Prisma schema for accurate dependency installation
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies needed for build & Prisma codegen)
RUN npm ci

# ==============================================================================
# Stage 2: Builder
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# Copy installed node_modules from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma/
COPY src ./src/

# Generate Prisma Client SDK
RUN npx prisma generate

# Build TypeScript to JavaScript in /app/dist
RUN npm run build

# Remove development dependencies, retaining only production modules
RUN npm prune --omit=dev

# ==============================================================================
# Stage 3: Production Runner
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Install runtime utilities (dumb-init for PID 1 signal forwarding, openssl for Prisma)
RUN apk add --no-cache openssl dumb-init

# Set production environment flags
ENV NODE_ENV=production
ENV PORT=5000

# Set non-root user permissions
RUN chown -R node:node /app

# Copy production artifacts from builder
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/prisma ./prisma

# Switch to standard non-root node user
USER node

# Expose API port
EXPOSE 5000

# Use dumb-init as the entrypoint for proper graceful termination signals
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Default command starts the HTTP API server
# Overridable to run workers: ["node", "dist/jobs/workers/index.js", "--run-workers"]
CMD ["node", "dist/server.js"]
