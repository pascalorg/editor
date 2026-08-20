FROM ghcr.io/astral-sh/uv:0.9.21-python3.12-bookworm-slim@sha256:c79e0c910458f04e0e21902617e938d4b141e46c346f1a929834e0b1eac6df90 AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH=/app/.venv/bin:$PATH

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project


FROM ghcr.io/astral-sh/uv:0.9.21-python3.12-bookworm-slim@sha256:c79e0c910458f04e0e21902617e938d4b141e46c346f1a929834e0b1eac6df90 AS runtime

ENV HOME=/tmp \
    PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    MINI_ARTICRAFT_MAX_TURNS=120 \
    ARTICRAFT_JOBS_DIR=/data/jobs \
    ARTICRAFT_RUNS_DIR=/data/runs \
    PORT=8000

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=65532:65532 /app/.venv /app/.venv
COPY --chown=65532:65532 articraft_worker ./articraft_worker
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN python -c "import mini_articraft; from pxr import Usd; import articraft_worker.app"

RUN mkdir -p /data/jobs /data/runs \
    && chown 65532:65532 /data /data/jobs /data/runs \
    && chmod 0755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"PORT\", \"8000\")}/health', timeout=2).read()"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn articraft_worker.app:create_app --factory --host 0.0.0.0 --port ${PORT:-8000}"]
