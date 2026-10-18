# CUTLINE API (FastAPI). Build context: backend/  (Railway: root directory "backend")
#   docker build -t cutline-api backend
#   docker run --rm -p 8000:8000 --env-file backend/.env cutline-api
# Python 3.11 matches the interpreter the test suite and the FalkorDB Cloud runs were verified on.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY policies ./policies

RUN useradd --create-home --uid 10001 cutline
USER cutline

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${BACKEND_PORT:-8000}"]
