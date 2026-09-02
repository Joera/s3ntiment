# nillcc-backend/Dockerfile — ISOLATED build. No pnpm workspace, no repo-root
# context, no `pnpm --filter`. Only nillcc-backend/, shared/ and contracts/ are
# needed; the image builds every artifact (shared/dist, contracts/dist/constants.js,
# nillcc-backend/dist) in-image from source.
#
# In-image layout (/app):
#   /app/nillcc-backend   the backend package (deps: file:../shared, file:../contracts)
#   /app/shared           sibling source for @s3ntiment/shared  (file:../shared)
#   /app/contracts        sibling source for s3ntiment-contracts (file:../contracts)
#
# WHY THE ORDER MATTERS: the backend's committed pnpm-lock.yaml resolves the
# `file:` deps as PACKED snapshots at install time (pnpm packs the target dir,
# respecting its `files:` field). The packed snapshot therefore only contains
# dist if shared/dist and contracts/dist already exist WHEN the backend install
# runs. So we build the siblings FIRST, then install + build the backend — all in
# one RUN layer, so a shared/contracts source change re-runs the backend install
# (a cached backend install would otherwise keep a stale, dist-less snapshot).
#
# This Dockerfile does NOT contain a pnpm-workspace.yaml: `file:` deps resolve
# relative to /app/nillcc-backend (../shared, ../contracts) with no workspace.

FROM node:22-alpine

# pnpm pinned to the toolchain era of the committed lockfiles (matches the dev
# machine). corepack ships with the node image; prepare activates the pinned CLI.
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

WORKDIR /app

# --- shared deps (cached: re-runs only when shared/package.json or its lockfile
#     change; source is layered in below) ---
COPY shared/package.json shared/pnpm-lock.yaml ./shared/
RUN cd shared && pnpm install --frozen-lockfile --ignore-scripts

# --- one correctness layer: build siblings, THEN backend install + build ---
COPY shared/ ./shared/
COPY contracts/ ./contracts/
COPY nillcc-backend/ ./nillcc-backend/
RUN set -e; \
    echo ">> build shared/dist"; \
    cd /app/shared && pnpm run build; \
    echo ">> build contracts/dist/constants.js (via shared's tsc)"; \
    mkdir -p /app/contracts/node_modules/@types \
      && ln -s /app/shared/node_modules/@types/node /app/contracts/node_modules/@types/node; \
    cd /app/contracts && /app/shared/node_modules/.bin/tsc -p tsconfig.constants.json; \
    echo ">> install backend deps (file:../* snapshots now include dist)"; \
    cd /app/nillcc-backend && pnpm install --frozen-lockfile --ignore-scripts; \
    echo ">> build backend (tsc -> dist)"; \
    cd /app/nillcc-backend && pnpm run build

WORKDIR /app/nillcc-backend
ENV NODE_ENV=production
EXPOSE 8080

# Run from /app/nillcc-backend so the bare specifiers '@s3ntiment/shared/node'
# and 's3ntiment-contracts/constants' resolve via nillcc-backend/node_modules.
CMD ["node", "dist/main.js"]
