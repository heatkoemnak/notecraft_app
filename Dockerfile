# Stage 1: Build Vite frontend bundle
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

COPY . .
RUN npm run build

# Stage 2: Run full-stack Express + PostgreSQL server
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi

COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY server ./server
COPY src/data ./src/data
COPY src/types ./src/types

EXPOSE 3000

CMD ["npm", "start"]
