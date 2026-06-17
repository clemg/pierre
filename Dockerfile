# diffshub bench orchestrator: Bun server + headless Chromium.
# Lives at the repo root of the clemg/benchmark branch so a plain Dockerfile
# deployment (context = repo root) picks it up without extra configuration.
# The arms it benchmarks are separate diffshub deployments, configured at
# runtime through the ARMS env var ("label=https://url,label=https://url").

FROM oven/bun:debian

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    procps \
    ca-certificates \
    curl \
    git \
    git-lfs \
  && rm -rf /var/lib/apt/lists/* \
  && git lfs install --system

# Google's official Chrome (amd64 only) is PGO-optimized where distro
# chromium is not — worth double-digit percent on V8-heavy parsing. The
# runner falls back to chromium (kept installed) on other architectures.
RUN if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
    curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && rm -f /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/* ; \
  fi

# Next builds must run under real node (Turbopack builds break under bun's
# node shim: metadata routes are emitted without their app-paths-manifest)
ARG NODE_VERSION=22.22.3
RUN ARCH=$(dpkg --print-architecture) \
  && case "$ARCH" in amd64) NODE_ARCH=x64 ;; arm64) NODE_ARCH=arm64 ;; *) echo "unsupported arch $ARCH" && exit 1 ;; esac \
  && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" \
    | tar -xz -C /usr/local --strip-components=1 \
  && node --version

# moon drives each branch's build: the monorepo has no package.json build
# scripts (moon owns building, via per-package tsdown/codegen tasks), so the
# bench shells out to moon instead of guessing each package's recipe. With no
# .moon/toolchain.yml, moon runs task commands against the node/bun already on
# PATH (no proto needed). Pinned to the repo's .prototools moon version.
ARG MOON_VERSION=2.3.3
RUN curl -fsSL https://moonrepo.dev/install/moon.sh | bash -s -- "${MOON_VERSION}" \
  && cp /root/.moon/bin/moon /usr/local/bin/moon \
  && moon --version

WORKDIR /app
COPY benchmark/ ./

# CHROME_BIN is intentionally not set: the runner picks google-chrome-stable
# when present and falls back to chromium
ENV DATA_DIR=/data \
    BUN_INSTALL_CACHE_DIR=/data/bun-cache \
    PORT=3000

VOLUME /data
EXPOSE 3000

CMD ["bun", "server.ts"]
