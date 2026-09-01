#!/usr/bin/env bash
#
# deploy.sh — ship the s3ntiment workspace to the deploy host and print the
# exact command to bring up the backend container.
#
# The Dockerfile (PR #33, repo-root-context) builds from the REPOSITORY ROOT:
#   - nillcc-backend/docker-compose.yaml sets build.context: .. and
#     dockerfile: nillcc-backend/Dockerfile
#   - the Dockerfile runs `pnpm install --frozen-lockfile` at the workspace
#     root and builds contracts/dist, shared/dist and nillcc-backend/dist
#     IN-IMAGE.
# So the host must receive the FULL workspace (repo root + every member:
# shared/, contracts/, nillcc-backend/, protocol/, frontend-organiser/,
# frontend-respondents/, website/) at /srv/s3ntiment/backend. Build artifacts
# (node_modules, dist, artifacts) are never shipped — the image regenerates
# them.
#
# .env is handled explicitly and NEVER bulk-shipped: the compose file's
# `env_file: .env` resolves relative to the compose dir (nillcc-backend/), so
# the host needs /srv/s3ntiment/backend/nillcc-backend/.env.
#
# Usage:  ./deploy.sh [--delete]
#   --delete / --prune   Pass --delete to rsync (remove stale files on the
#                        host). OFF by default; see NOTES below.
#
# This script SUPERSEDES the old scp-based deployers (which copied a flat tree
# of prebuilt artifacts to /srv/s3ntiment-backend):
#   - nillcc-backend/deploy.sh   (scp flat tree -> zomi-ts)
#   - nillcc-backend/deploy2.sh  (scp flat tree -> zomi)
#   - nillcc-backend/ideploy.sh  (scp flat tree -> local /srv/s3ntiment-backend)
# Those relied on locally-built dist/ being copied to the host; the new image
# builds everything in-image from the workspace root, so no prebuilt artifacts
# are shipped. Old scripts deliberately left in place for reference.

set -euo pipefail

HOST="zomi"
REMOTE_DIR="/srv/s3ntiment/backend"     # destination = repo root on the host
COMPOSE_REL="nillcc-backend"             # compose dir relative to REMOTE_DIR
ENV_REL="${COMPOSE_REL}/.env"            # host .env path relative to REMOTE_DIR

# Repo root = directory containing this script, so ./deploy.sh works from any cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

PRUNE=0

usage() {
  # Print just the header comment block (lines 2 up to the blank line before `set -euo`).
  sed -n '2,/^$/p' "$REPO_ROOT/deploy.sh" | sed '/^set -euo pipefail/,$d'
}

for arg in "$@"; do
  case "$arg" in
    --delete|--prune) PRUNE=1 ;;
    -h|--help)        usage; exit 0 ;;
    *)                echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

# --- prerequisites ---------------------------------------------------------
command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync is required but not installed." >&2; exit 1; }
command -v ssh   >/dev/null 2>&1 || { echo "ERROR: ssh is required but not installed." >&2;   exit 1; }

echo ">> Deploying workspace into ${REMOTE_DIR} on '${HOST}' from ${REPO_ROOT}"
echo ">> Checking ssh connectivity to ${HOST} ..."
ssh -o BatchMode=yes -o ConnectTimeout=10 "${HOST}" 'true'

# --- rsync excludes --------------------------------------------------------
# Mirrors the .dockerignore intent for what must NOT reach the host (the image
# rebuilds these in-image) plus local-only / sensitive paths. .env/.env.* is
# ALWAYS excluded from the bulk copy (handled explicitly afterwards).
declare -a EXCLUDES=(
  --exclude='.git/'
  --exclude='worktrees/'
  --exclude='.pnpm-store/'
  --exclude='.s3n-orchestrator/'
  --exclude='.pi/'
  --exclude='.pi-lens/'
  --exclude='**/node_modules/'
  --exclude='**/dist/'
  --exclude='**/artifacts/'
  --exclude='**/cache/'
  --exclude='**/output/'
  --exclude='**/.data/pool-keys/'
  --exclude='**/.env'
  --exclude='**/.env.*'
  --exclude='branding/'
  --exclude='brain/'
  --exclude='logs/'
  --exclude='cards/'
  --exclude='node/'
  --exclude='nillcc-backend/data/'
)

declare -a RSYNC_ARGS=(-a --partial --info=stats1)
if [[ "$PRUNE" -ne 1 ]]; then
  echo ">> rsync WITHOUT --delete (off by default; stale host files kept)"
else
  echo ">> rsync WITH --delete (prune stale files; excluded paths are protected from deletion)"
  RSYNC_ARGS+=(--delete)
fi

echo ">> Shipping full workspace ..."
# Trailing slashes on source and destination copy the workspace CONTENTS into
# ${REMOTE_DIR} (repo root lands directly in /srv/s3ntiment/backend).
rsync "${RSYNC_ARGS[@]}" "${EXCLUDES[@]}" "${REPO_ROOT}/" "${HOST}:${REMOTE_DIR}/"

# --- .env handling (explicit, never overwrite a populated host .env) -------
local_env="${REPO_ROOT}/${COMPOSE_REL}/.env"
host_env="${REMOTE_DIR}/${ENV_REL}"

if [[ -s "$local_env" ]]; then
  echo ">> Shipping local ${local_env} -> ${HOST}:${host_env}"
  rsync -a "$local_env" "${HOST}:${host_env}"
elif ssh -o BatchMode=yes "${HOST}" "[ -s '${host_env}' ]"; then
  echo ">> No local ${COMPOSE_REL}/.env found; host already has a populated .env at ${host_env}."
  echo "   Leaving the host .env untouched (NOT overwritten)."
else
  echo ">> No local ${COMPOSE_REL}/.env and no populated host .env — creating a placeholder on the host."
  ssh -o BatchMode=yes "${HOST}" \
    "mkdir -p '${REMOTE_DIR}/${COMPOSE_REL}' && cat > '${host_env}'" <<'PLACEHOLDER'
# .env for the s3ntiment backend (nillcc-backend). docker-compose.yaml's
# `env_file: .env` resolves relative to this file's directory, so it MUST live
# here (nillcc-backend/.env) — a repo-root .env is NOT read by compose.
# Fill in real values before running: docker compose up -d --build
NODE_ENV=production

# --- chain / RPC ---
BASE_RPC_URL=
ETH_NODE_URI_base=
VITE_NILCHAIN_URL=
VITE_NILAUTH_URL=
VITE_NIL_CHAINID=
VITE_L2=

# --- backend signer / builder ---
VITE_NIL_BUILDER_PRIVATE_KEY=
VITE_NIL_BUILDER_DID=
MNEMONIC=

# --- storage / pinning / indexing ---
VITE_NILDB_NODES=
VITE_KUBO_ENDPOINT=
VITE_ALCHEMY_KEY=
VITE_DRPC_KEY=
VITE_PINATA_JWT=
VITE_PINATA_GATEWAY=
VITE_PINATA_KEY=
VITE_PINATA_SECRET=

# --- Lit Protocol ---
VITE_LIT_NETWORK=
VITE_LIT_API_ACCOUNT_KEY=
VITE_LIT_API_DEV_ACCOUNT_KEY=
VITE_LIT_PAYMASTER_KEY=

# --- misc ---
VITE_ENTRYPOINT_ADDRESS_V07=
VITE_HUMAN_NETWORK_SIGNER_URL=
VITE_PIMLICO_KEY=
VITE_USE_SAFE=
PLACEHOLDER
  echo "!! WARNING: created an EMPTY placeholder at ${HOST}:${host_env}."
  echo "   Fill in the secrets there on the host BEFORE running 'docker compose up -d --build'."
fi

# If the developer keeps secrets in a repo-ROOT .env (as some prior setups
# did), point them at the file compose actually reads.
if [[ -s "${REPO_ROOT}/.env" ]]; then
  echo ">> Note: found a repo-root .env — the new compose reads nillcc-backend/.env, not the root one."
  echo "   If you want to reuse it:  cp ${REPO_ROOT}/.env ${REPO_ROOT}/${COMPOSE_REL}/.env && ./deploy.sh"
fi

# --- done: print the exact next command ------------------------------------
echo
echo "Deploy complete."
echo "On ${HOST}, now run:"
echo
echo "  cd ${REMOTE_DIR}/${COMPOSE_REL} && docker compose up -d --build"
echo
