# --- frontend build ---
FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- backend build ---
FROM node:24-alpine AS backend-build
WORKDIR /app/backend
RUN apk add --no-cache openssl
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
COPY --from=frontend-build /app/backend/public ./public
RUN npx prisma generate && npm run build

# --- runtime ---
FROM node:24-alpine AS runtime
ARG GIT_SHA=dev
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
RUN apk add --no-cache openssl

WORKDIR /app/backend
COPY --from=backend-build /app/backend/package*.json ./
COPY --from=backend-build /app/backend/node_modules ./node_modules
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/public ./public
COPY --from=backend-build /app/backend/prisma ./prisma
RUN mkdir -p /app/backend/data && chown -R node:node /app/backend
USER node

VOLUME ["/app/backend/data"]
EXPOSE 7431

# node node_modules/prisma/build/index.js directly, not "npx prisma": npx
# invokes the npm CLI to resolve the binary, and npm bundles its own
# vulnerable-at-rest transitive deps (tar/ip-address/brace-expansion —
# flagged by the Trivy scan in docker-publish.yml) that then sit inside
# the shipped image and get loaded at every container start for no
# reason — the local prisma binary is already right here, no resolution
# needed. Same invocation style linux/racktemp.service already uses.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js db push --skip-generate && node dist/index.js"]
