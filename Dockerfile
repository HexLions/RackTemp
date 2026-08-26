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

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
