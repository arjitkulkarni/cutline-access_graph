# CUTLINE API (FastAPI). Build context: backend/  (Railway: root directory "backend")
#   docker build -t cutline-api backend
#   docker run --rm -p 8000:8000 --env-file backend/.env cutline-api
# Python 3.11 matches the interpreter the test suite and the FalkorDB Cloud runs were verified on.
FROM python:3.11-slim

# FORWARDED_ALLOW_IPS: trust X-Forwarded-* from the platform proxy (Railway); the container is never
# exposed directly.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FORWARDED_ALLOW_IPS=*
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY policies ./policies

RUN useradd --create-home --uid 10001 cutline
USER cutline

EXPOSE 8000
# Railway injects PORT. BACKEND_PORT is set to the port actually bound because runtime verification sends
# its real HTTP checks to http://127.0.0.1:$BACKEND_PORT inside this container. `exec` makes uvicorn PID 1,
# so SIGTERM triggers a graceful shutdown (in-flight requests finish, FalkorDB connections are closed).
CMD ["sh", "-c", "export BACKEND_PORT=\"${PORT:-${BACKEND_PORT:-8000}}\" && exec uvicorn app.main:app --host 0.0.0.0 --port \"$BACKEND_PORT\" --proxy-headers --timeout-graceful-shutdown 20 --no-server-header"]
