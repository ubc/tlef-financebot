#!/bin/bash
# Bring up FinanceBot's backing services (MongoDB, Qdrant, mock SAML IdP) with
# `docker compose up`, but FIRST free any host ports a DIFFERENT project is
# holding — so start order never matters.
#
# SAFE BY DESIGN: it only `docker stop`s foreign containers (data preserved in
# their volumes; restore later with `docker start <name>`). It never removes a
# container or deletes a volume, and it never touches our own containers.
#
# Usage:  npm run services:up          (detached, default)
#         npm run services:up -- --attach   (foreground logs)

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}[services]${NC} $*"; }
warn() { echo -e "${YELLOW}[services]${NC} $*"; }
error() { echo -e "${RED}[services]${NC} $*"; }

if ! docker info >/dev/null 2>&1; then
  error "Docker daemon is not running. Start Docker Desktop and retry."
  exit 1
fi

# Ports this compose file publishes, and the name of OUR container on each
# (compose names them "<project>-<service>-N"; project = tlef-financebot).
# port : own-container-name : label
SERVICES=(
  "27017:tlef-financebot-mongodb-1:MongoDB"
  "6333:tlef-financebot-qdrant-1:Qdrant"
  "6122:tlef-financebot-saml-idp-1:SAML IdP"
)

free_port() {
  local port="$1" own="$2" label="$3" cid cname
  for cid in $(docker ps -q --filter "publish=${port}" 2>/dev/null); do
    cname="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')"
    if [ "$cname" = "$own" ]; then
      info "${label}: port ${port} already served by our own '${cname}'."
    else
      warn "${label}: port ${port} held by '${cname}' (another project) — stopping it."
      warn "  data preserved; restore later with:  docker start ${cname}"
      docker stop "$cid" >/dev/null 2>&1 || warn "  could not stop ${cname}"
    fi
  done
}

info "Checking for port conflicts before starting..."
for entry in "${SERVICES[@]}"; do
  IFS=':' read -r port own label <<<"$entry"
  free_port "$port" "$own" "$label"
done

# Default detached; pass --attach for foreground logs.
UP_FLAGS="-d"
[ "$1" = "--attach" ] && UP_FLAGS=""

info "Starting FinanceBot services (docker compose up ${UP_FLAGS})..."
# shellcheck disable=SC2086
docker compose -f "$ROOT/docker-compose.yml" up $UP_FLAGS

if [ "$UP_FLAGS" = "-d" ]; then
  echo ""
  info "Services up:"
  echo "  MongoDB   → mongodb://localhost:27017"
  echo "  Qdrant    → http://localhost:6333/dashboard"
  echo "  SAML IdP  → http://localhost:6122/simplesaml"
  echo "              Users: student1 / instructor1 / ta1 / admin1  (password = <user>pass)"
  echo ""
  info "Next:  npm run saml:fetch-cert   (first run)   then   npm run dev"
fi
