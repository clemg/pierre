# Production image for the diffshub app (apps/docs with NEXT_PUBLIC_SITE=diffshub)
#
# Dokploy: point the project at this Dockerfile with build context = repo root.
# A clean Docker checkout has no apps/docs/.next, so the Turbopack stale-worker
# trap (which bites incremental local rebuilds) cannot happen here
#
# Base: node 24 for Next.js internals + bun copied in for install/build/run,
# matching the monorepo's bun-only workflow
FROM node:24-bookworm-slim AS base
COPY --from=oven/bun:1.3 /usr/local/bin/bun /usr/local/bin/bun
ENV NODE_ENV=production
ENV NEXT_PUBLIC_SITE=diffshub
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- deps: install once against the full workspace (catalog needs the root) ----
FROM base AS build
# Copy the whole monorepo. Workspaces + catalog resolve from the repo root, and
# the Next build pulls in packages/{diffs,truncate,trees}
COPY . .
RUN bun install --frozen-lockfile

# Build the workspace dependencies explicitly (the safe equivalent of the
# `build:deps` wrapper, which uses a `>&2` redirect that is shell-fragile)
RUN cd packages/diffs && bun run build \
 && cd ../truncate && bun run build \
 && cd ../trees && bun run build

# Build the Next.js app for diffshub. build:next == `next build`
RUN cd apps/docs && NEXT_PUBLIC_SITE=diffshub bun run build:next

# ---- runtime ----
FROM base AS runtime
# Bring the built monorepo over wholesale. (No `output: 'standalone'` in the
# Next config, so we serve with `next start` from the full tree; slimming this
# to a standalone bundle is a later optimization)
COPY --from=build /app /app
EXPOSE 3000
WORKDIR /app/apps/docs
# next start; honor Dokploy's $PORT if provided, default 3000
CMD ["sh", "-c", "NEXT_PUBLIC_SITE=diffshub bun run start -- -p ${PORT:-3000} -H 0.0.0.0"]
