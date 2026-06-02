FROM node:24-bookworm-slim AS base
COPY --from=oven/bun:1.3 /usr/local/bin/bun /usr/local/bin/bun
ENV NODE_ENV=production
ENV NEXT_PUBLIC_SITE=diffshub
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
COPY . .
RUN bun install --frozen-lockfile
RUN cd packages/diffs && bun run build \
 && cd ../truncate && bun run build \
 && cd ../trees && bun run build
RUN cd apps/docs && NEXT_PUBLIC_SITE=diffshub bun run build:next

FROM base AS runtime
COPY --from=build /app /app
EXPOSE 3000
WORKDIR /app/apps/docs
CMD ["sh", "-c", "NEXT_PUBLIC_SITE=diffshub bun run start -- -p ${PORT:-3000} -H 0.0.0.0"]
