FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Install Playwright browsers
RUN npx playwright install chromium --with-deps

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create required directories
RUN mkdir -p dataset/legitimate dataset/phishing \
    checkpoints logs metadata reports

# Environment defaults (override via docker run -e or docker-compose)
ENV WORKERS=4
ENV HEADLESS=true
ENV OUTPUT_DIR=/app/dataset
ENV CHECKPOINT_DIR=/app/checkpoints
ENV LOGS_DIR=/app/logs
ENV METADATA_DIR=/app/metadata
ENV REPORTS_DIR=/app/reports
ENV URL_DIR=/app/url

VOLUME ["/app/dataset", "/app/checkpoints", "/app/logs", "/app/metadata", "/app/reports"]

ENTRYPOINT ["node", "dist/scripts/collect.js"]
