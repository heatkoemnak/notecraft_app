# Stage 1: Build Vite frontend bundle
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --legacy-peer-deps --no-audit --no-fund --fetch-retries=5 || npm install --legacy-peer-deps --no-audit --no-fund --fetch-retries=5; \
    else \
      npm install --legacy-peer-deps --no-audit --no-fund --fetch-retries=5; \
    fi

COPY . .
RUN npm run build

# Stage 2: Run full-stack Express + PostgreSQL server
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund --fetch-retries=5 || npm install --omit=dev --legacy-peer-deps --no-audit --no-fund --fetch-retries=5; \
    else \
      npm install --omit=dev --legacy-peer-deps --no-audit --no-fund --fetch-retries=5; \
    fi

COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY server ./server
COPY src/data ./src/data
COPY src/types ./src/types

EXPOSE 3000

CMD ["npm", "start"]
