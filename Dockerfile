FROM node:22.23.3-bookworm-slim AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12.15-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    NESTWISE_ENV=production \
    NESTWISE_GEMINI_DIAGNOSTICS=0 \
    PORT=10000

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN python -m pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY data/public/ ./data/public/
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

RUN groupadd --system --gid 10001 nestwise \
    && useradd --system --uid 10001 --gid nestwise --create-home --shell /usr/sbin/nologin nestwise
USER 10001:10001

EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
