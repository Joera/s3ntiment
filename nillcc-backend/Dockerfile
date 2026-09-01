# Build the nillcc-backend Docker image from the REPOSITORY ROOT context.
#
# The backend depends on sibling workspace packages via `file:` deps:
#   - "s3ntiment-contracts": "file:../contracts"  (runtime import 's3ntiment-contracts/constants')
#   - "@s3ntiment/shared":    "file:../shared"
# Those bare specifiers only resolve at runtime when the compiled bundle runs from
# INSIDE the workspace dir (nillcc-backend/node_modules/s3ntiment-contracts ->
# ../../contracts). The contracts package ships a GITIGNORED dist/constants.js that
# this image MUST produce itself (pnpm --filter s3ntiment-contracts build:constants),
# because it is never committed nor scp'd to the host.
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
# NOTE: because install ran with --ignore-scripts, the scoped dep @s3ntiment/shared
# is hardlinked into the pnpm virtual store WITHOUT dist/. The backend resolves
# @s3ntiment/shared (tsc AND node) through that virtual-store copy (its
# node_modules/@s3ntiment/shared is a symlink into node_modules/.pnpm/...), so we
# build shared and copy the freshly built dist into the resolved copy.
RUN pnpm --filter s3ntiment-contracts build:constants \
    && pnpm --filter @s3ntiment/shared build \
    && RESOLVED_SHARED="$(readlink -f /app/nillcc-backend/node_modules/@s3ntiment/shared)" \
    && mkdir -p "$RESOLVED_SHARED/dist" \
    && cp -rL /app/shared/dist/. "$RESOLVED_SHARED/dist/" \
    && pnpm --filter @s3ntiment/nillcc-backend build

WORKDIR /app/nillcc-backend
ENV NODE_ENV=production
EXPOSE 8080

# Run from /app/nillcc-backend so the bare specifier 's3ntiment-contracts/constants'
# resolves via nillcc-backend/node_modules -> ../../contracts -> dist/constants.js.
CMD ["node", "dist/main.js"]
