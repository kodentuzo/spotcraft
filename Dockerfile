# Spotcraft: one image for the agent, the user pool, the dashboard and Caddy (ADR 0025). Compose
# runs it four times, choosing the program with `working_dir` and `command` (or `entrypoint`):
#   agent      working_dir /app/agent      command ["src/index.ts"]
#   auth       working_dir /app/auth       command ["src/index.ts"]
#   dashboard  working_dir /app/dashboard  command ["build"]
#   caddy      entrypoint ["caddy"]        command ["run", "--config", "/etc/caddy/Caddyfile", ...]
# Only the agent's container gets the Docker socket. Per-service settings (ports, proxy headers,
# paths) are set in Compose, not here.
# Build from the repository root: docker build .
# Base images are pinned by digest; bump the version and digest together.

# The Docker CLI and Compose plugin (static binaries) from the official image, for the agent.
FROM docker:29.10.0-cli@sha256:34507eb5069d8be82c95dd3b6987d4250fd5fee49b82e2509b7d7a7030740d6d AS docker-cli

# Caddy with the replace-response module, which adds the analytics script to apps' HTML
# (ADR 0038). Cross-compiled on the native platform; the module is pinned to a commit.
FROM --platform=$BUILDPLATFORM caddy:2.11.9-builder@sha256:f9beaa5ddbe7df6f26ebbcf9cbf44e05a1917b9bba464f0c3229038d7e2e6e13 AS caddy
ARG TARGETOS TARGETARCH
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH CGO_ENABLED=0 xcaddy build v2.11.9 \
    --with github.com/caddyserver/replace-response@80962887e4c6 \
    --output /usr/bin/caddy

# The build output is plain JavaScript, so it is built once on the native platform.
FROM --platform=$BUILDPLATFORM node:26.13.1-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS build
RUN npm install --global pnpm@12.4.1
WORKDIR /repo
# Dependencies first, from the lockfile alone: this layer (and the store cache) is reused until
# the lockfile changes, so editing code or docs doesn't download everything again.
ENV PNPM_STORE_DIR=/pnpm/store
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm fetch --store-dir "$PNPM_STORE_DIR"
COPY . .
# The agent runs its TypeScript directly, with production node_modules; the CLI package (app
# database provisioning) ships as built JavaScript, since Node won't run TypeScript from
# node_modules. It is selected by folder: `spotcraft` is also the workspace root's name. The
# dashboard is bundled into build/ and needs no node_modules.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir "$PNPM_STORE_DIR" \
    --filter @spotcraft/agent... --filter @spotcraft/auth... --filter @spotcraft/dashboard... \
    --filter ./packages/cli \
  && pnpm --filter ./packages/cli build \
  && pnpm --filter @spotcraft/agent deploy --prod --store-dir "$PNPM_STORE_DIR" /out/agent \
  && pnpm --filter @spotcraft/auth deploy --prod --store-dir "$PNPM_STORE_DIR" /out/auth \
  && pnpm --filter @spotcraft/dashboard build \
  && mkdir -p /out/dashboard /probes \
  && cp -r apps/dashboard/package.json apps/dashboard/build /out/dashboard/

# Distroless: Node and nothing else (no shell, no package manager), far fewer CVEs than slim.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:1d736cf8b5716c07a245301f92717143215d248fd55771ee1936ef4b3302e531
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
WORKDIR /app
COPY --from=build /out ./
# The dashboard's probes volume starts from this directory, so uid 1000 can write the targets file.
COPY --from=build --chown=1000:1000 /probes /probes
ENV NODE_ENV=production
# uid 1000 owns /opt/spotcraft/apps and /opt/spotcraft/sites on the server; the agent reaches
# Docker through the socket's group (group_add in Compose).
USER 1000:1000
