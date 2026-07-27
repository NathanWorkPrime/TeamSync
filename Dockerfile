# ==========================================
# Stage 1: Build the Frontend React client
# ==========================================
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Package the Backend & Assets
# ==========================================
FROM node:24-alpine
WORKDIR /app

# Copy backend package and install production dependencies
COPY backend/package*.json ./backend/
RUN npm install --prefix backend --omit=dev

# Copy compiled frontend assets from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy backend source files
COPY backend/ ./backend/

# Expose backend port (standard port 5000)
EXPOSE 5000

ENV PORT=5000
ENV NODE_ENV=production

# Set working directory to backend to run server
WORKDIR /app/backend
CMD ["node", "server.js"]
