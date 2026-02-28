FROM python:3.11-slim AS base

WORKDIR /app

# Install Poetry
RUN pip install --no-cache-dir poetry==1.8.3

# Copy dependency files first for layer caching
COPY pyproject.toml poetry.lock* ./

# Install runtime deps only (no dev tools in production)
RUN poetry config virtualenvs.create false \
    && poetry install --no-interaction --no-ansi --without dev

# Copy source
COPY cassandrina/ ./cassandrina/

CMD ["python", "-m", "cassandrina.main"]
