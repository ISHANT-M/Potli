FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json frontend/
RUN npm ci --prefix frontend
COPY frontend frontend
COPY shared shared
ARG VITE_APPWRITE_ENDPOINT
ARG VITE_APPWRITE_PROJECT_ID
RUN test -n "$VITE_APPWRITE_ENDPOINT" && test -n "$VITE_APPWRITE_PROJECT_ID" && \
    VITE_APPWRITE_ENDPOINT="$VITE_APPWRITE_ENDPOINT" VITE_APPWRITE_PROJECT_ID="$VITE_APPWRITE_PROJECT_ID" npm --prefix frontend run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package*.json backend/
COPY db/package*.json db/
RUN npm ci --prefix backend --omit=dev && npm ci --prefix db --omit=dev
COPY backend/src backend/src
COPY db db
COPY shared shared
COPY --from=frontend-build /app/frontend/dist frontend/dist
USER node
EXPOSE 4000
WORKDIR /app/backend
CMD ["node", "src/server.ts"]
