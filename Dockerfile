# Use Node.js 20 (Debian Bookworm)
FROM node:20

# Install Chromium and necessary fonts to support Puppeteer on Linux
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-thai-tlwg \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install npm dependencies
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium
RUN npm ci --only=production

# Copy application source
COPY . .

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser
# Set HOME environment variable needed for Chromium
ENV HOME=/home/appuser
RUN mkdir -p /home/appuser && chown -R appuser:appuser /home/appuser

# Create data directory for Named Volume and set ownership
RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

# Change ownership of app directory
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port 3001
EXPOSE 3001

# Default DB Path (can be overridden by Env Var)
ENV DB_FILE=/app/data/projects.db
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))" || exit 1

# Run the application
CMD ["npm", "start"]
