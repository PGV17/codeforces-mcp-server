# ─────────────────────────────────────────────────────────────────────────────
# Codeforces AI Analytics Server — Dockerfile
#
# Base image: node:20-bookworm-slim (Debian Bookworm slim with Node 20)
# Installs: Python 3, pip, TensorFlow, Node deps, compiles TypeScript
# Exposes: port 8080 (Google Cloud Run default)
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim

# ── 1. System dependencies (Python 3 + pip + build tools) ────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        build-essential \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ── 2. Set up a Python virtual-env to isolate TensorFlow from system Python ──
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# ── 3. Install Python dependencies ───────────────────────────────────────────
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# ── 4. Set working directory for the Node application ────────────────────────
WORKDIR /app

# ── 5. Install Node.js dependencies ──────────────────────────────────────────
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Also install devDependencies (needed for `tsc` compilation)
RUN npm install --include=dev

# ── 6. Copy source and compile TypeScript ────────────────────────────────────
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── 7. Copy the AI prediction script ─────────────────────────────────────────
COPY ai/ ./ai/

# ── 8. Runtime configuration ─────────────────────────────────────────────────
# Cloud Run injects PORT=8080 automatically; we honour it in Express.
ENV PORT=8080
ENV NODE_ENV=production

# Expose Cloud Run's expected port
EXPOSE 8080

# ── 9. Health check (Cloud Run also does its own probe via /health) ───────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# ── 10. Start the compiled Express server ────────────────────────────────────
CMD ["node", "dist/index.js"]
