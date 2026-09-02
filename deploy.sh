#!/usr/bin/env bash
#
# deploy.sh — ship the ISOLATED nillcc-backend deploy to the deploy host.
#
# Ships ONLY the three packages the isolated image needs, plus the
# build-context support file and the secrets file:
#
#   nillcc-backend/   backend package (Dockerfile, docker-compose.yaml,
#                     package.json, pnpm-lock.yaml, src/ ...)
#   shared/           @s3ntiment/shared source   (backend dep: file:../shared)
#   contracts/        s3ntiment-contracts source (backend dep: file:../contracts)
#   .dockerignore     context ignore list (shipped to the host deploy root)
#   .env              handled explicitly — NEVER overwrites a populated host .env
#
# Destination: zomi:/srv/s3ntiment/backend, matching the compose build context
# (docker-compose.yaml sets build.context: .. and dockerfile: nillcc-backend/Dockerfile).
#
# The old repo-root / pnpm-workspace build is gone. The image builds
# shared/dist, contracts/dist/constants.js and nillcc-backend/dist IN-IMAGE from
# this isolated layout; no node_modules/dist/artifacts are shipped (rsync
# excludes them) and no other workspace members (frontend, protocol, ...) reach
# the host.
#
# This script supersedes the old scp/rsync full-workspace deployers
# (nillcc-backend/deploy.sh, deploy2.sh, ideploy.sh), which are left in place
# only for reference.
#
# Usage:  ./deploy.sh [--dry-run]
#   --dry-run / -n   Show exactly what would be shipped (rsync -n, no ssh
#                    side-effects, no host changes) and print the run command.
#
# HOST and REMOTE_DIR are overridable via env for testing, e.g.:
#   HOST=localhost REMOTE_DIR=/tmp/deploy-sim ./deploy.sh --dry-run

set -euo pipefail

: "${HOST:=zomi}"
: "${REMOTE_DIR:=/srv/s3ntiment/backend}"
COMPOSE_REL="nillcc-backend"

# Repo root = directory containing this script, so ./deploy.sh works from any cwd.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0

usage() {
  sed -n '2,/^$/p' "$REPO_ROOT/deploy.sh" | sed '/^set -euo pipefail/,$d'
}

for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    -h|--help)    usage; exit 0 ;;
    *)            echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

# --- prerequisites ---------------------------------------------------------
command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync is required but not installed." >&2; exit 1; }
command -v ssh   >/dev/null 2>&1 || { echo "ERROR: ssh is required but not installed." >&2;   exit 1; }

# --- helpers ---------------------------------------------------------------
# Run a command on the host (no-op body under --dry-run; connectivity is still
# checked so --dry-run validates the deploy is even possible).
host() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    return 0
  fi
  ssh -o BatchMode=yes "$@"
}

# rsync wrapper: real run, or -n dry-run listing exactly what would transfer.
rsync_run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    rsync -n -a --itemize-changes --out-format='%n' "$@"
  else
    rsync -a --partial --info=stats1 "$@"
  fi
}

echo ">> Deploying ISOLATED backend into ${REMOTE_DIR} on '${HOST}' from ${REPO_ROOT}"
[[ "$DRY_RUN" -eq 1 ]] && echo ">> DRY RUN — nothing will be transferred or changed on the host."
ssh -o BatchMode=yes -o ConnectTimeout=10 "${HOST}" 'true'

# Ensure the remote layout exists (skipped under --dry-run).
host "${HOST}" "mkdir -p '${REMOTE_DIR}'"

# --- rsync: ONLY the three packages + .dockerignore ------------------------
# NO --delete: the host is never pruned (stale files are simply ignored by the
# context's .dockerignore). node_modules/dist/artifacts/.env are always excluded
# and are regenerated in-image / injected explicitly.
declare -a EXCLUDES=(
  --exclude='.git/'
  --exclude='**/node_modules/'
  --exclude='**/dist/'
  --exclude='**/artifacts/'
  --exclude='**/cache/'
  --exclude='**/output/'
  --exclude='**/.env'
  --exclude='**/.env.*'
  --exclude='**/.data/pool-keys/'
)

for dir in nillcc-backend shared contracts; do
  echo ">> shipping ${dir}/ -> ${REMOTE_DIR}/${dir}/"
  rsync_run "${EXCLUDES[@]}" "${REPO_ROOT}/${dir}/" "${HOST}:${REMOTE_DIR}/${dir}/"
done

echo ">> shipping .dockerignore -> ${REMOTE_DIR}/.dockerignore"
rsync_run "${REPO_ROOT}/.dockerignore" "${HOST}:${REMOTE_DIR}/.dockerignore"

# --- .env handling (explicit; NEVER clobber a populated host .env) ---------
local_env="${REPO_ROOT}/${COMPOSE_REL}/.env"
host_env="${REMOTE_DIR}/${COMPOSE_REL}/.env"

if [[ -s "$local_env" ]]; then
  echo ">> shipping local ${local_env} -> ${HOST}:${host_env}"
  rsync_run "$local_env" "${HOST}:${host_env}"
elif host "${HOST}" "[ -s '${host_env}' ]"; then
  echo ">> no local ${COMPOSE_REL}/.env; host already has a populated .env at ${host_env} — NOT overwritten."
else
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo ">> (dry-run) would create an EMPTY placeholder at ${HOST}:${host_env} (no local .env found)."
  else
    echo ">> no local ${COMPOSE_REL}/.env and no populated host .env — creating a placeholder on the host."
    host "${HOST}" "mkdir -p '${REMOTE_DIR}/${COMPOSE_REL}' && cat > '${host_env}'" <<'PLACEHOLDER'
# .env for the s3ntiment backend. docker-compose.yaml's `env_file: .env` resolves
# relative to the compose file (nillcc-backend/), so this MUST live at
# /srv/s3ntiment/backend/nillcc-backend/.env. Fill in real values before running
# `docker compose up -d --build`.
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
fi

# --- done: print the exact next command ------------------------------------
echo
echo "Deploy complete."
echo "On ${HOST}, now run:"
echo
echo "  cd ${REMOTE_DIR}/${COMPOSE_REL} && docker compose up -d --build"
echo
