# Build the nillcc-backend Docker image from the REPOSITORY ROOT context.
#
# The backend depends on sibling workspace packages via the pnpm workspace
# protocol (workspace:*):
#   - "s3ntiment-contracts": "workspace:../contracts"  (runtime import 's3ntiment-contracts/constants')
#   - "@s3ntiment/shared":    "workspace:*"
# pnpm installs these as true workspace symlinks (node_modules/@s3ntiment/shared
# -> ../../shared, node_modules/s3ntiment-contracts -> ../../contracts), so the
# backend tsc AND node resolve them against the SOURCE tree exactly like the dev
# machine. The contracts package ships a GITIGNORED dist/constants.js that this
# image MUST produce itself (pnpm --filter s3ntiment-contracts build:constants),
# and shared ships a gitignored dist/ that is produced by pnpm --filter @s3ntiment/shared build.
#
# Build (from repo root context):
#   docker build -t s3ntiment-nillcc-backend -f nillcc-backend/Dockerfile .
# or: cd nillcc-backend && docker compose up --build   (compose sets context: ..)

FROM node:22-alpine

# node:20-alpine (the old base) can no longer run current pnpm (needs Node >= 22,
# throws ERR_UNKNOWN_BUILTIN_MODULE node:sqlite). Pin pnpm to the local lockfile-era tsc toolchain.
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

WORKDIR /app

# Workspace manifests + lockfile first (better layer caching).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# Packages the backend build/runtime needs. The remaining workspace members are
# also copied so `pnpm install` at the workspace root succeeds; only the backend-
# relevant artifacts are built below.
COPY shared ./shared
COPY contracts ./contracts
COPY nillcc-backend ./nillcc-backend
COPY protocol ./protocol
COPY frontend-organiser ./frontend-organiser
COPY frontend-respondents ./frontend-respondents
COPY website ./website

# Install the whole workspace WITHOUT lifecycle scripts so the image build does not
# run hardhat compile / set-defaults / frontend builds. Backend artifacts are
# produced explicitly in the next step.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Produce, from source inside the image, the artifacts the backend consumes at
# runtime: contracts/dist/constants.js (gitignored, never shipped), shared/dist,
# and nillcc-backend/dist/main.js.
#
# Because install ran with --ignore-scripts, no lifecycle builds happen here.
# With workspace:* the backend sees @s3ntiment/shared and s3ntiment-contracts as
# symlinks into the source tree, so building shared/dist and contracts/dist in
# place makes them visible to the backend tsc AND node automatically (no need to
# manually copy dist into a pnpm virtual-store copy).
RUN pnpm --filter s3ntiment-contracts build:constants \
    && pnpm --filter @s3ntiment/shared build \
    && pnpm --filter @s3ntiment/nillcc-backend build

WORKDIR /app/nillcc-backend
ENV NODE_ENV=production
EXPOSE 8080

# Run from /app/nillcc-backend so the bare specifier 's3ntiment-contracts/constants'
# resolves via nillcc-backend/node_modules -> ../../contracts -> dist/constants.js.
CMD ["node", "dist/main.js"]
