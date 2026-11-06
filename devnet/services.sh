#!/usr/bin/env bash
# Adapted from Midnight BallotLab by IBKR-BouncyBot (PolyForm Noncommercial).
# Starts an isolated ReviewLab node, indexer and prover. No wallet or transaction.
# Run with bash, never with shell tracing: local infrastructure secrets stay in env.
set -euo pipefail
set +x
readonly label='org.midnight-reviewlab.devnet'
readonly network='midnight-reviewlab-devnet-isolated'
readonly node='midnight-reviewlab-devnet-node'
readonly indexer='midnight-reviewlab-devnet-indexer'
readonly node_image='midnightntwrk/midnight-node:1.0.400'
readonly indexer_image='midnightntwrk/indexer-standalone:4.3.5'
readonly node_digest='midnightntwrk/midnight-node@sha256:915b117f955859a0ab7f34230ca12b43ef7474c84e29463256efcfc7b757040f'
readonly indexer_digest='midnightntwrk/indexer-standalone@sha256:1c69c6632df859140a4019af9d7ebb81cb6073b1d39194d3eabaa1b320883499'
readonly beneficiary='04bcf7ad3be7a5c790460be82a713af570f22e0f801f6659ab8e84a52be6969e'

status() {
  docker ps --all --filter "label=$label=true" --format '{{.Names}} {{.Image}} {{.Status}}'
}

wait_healthy() {
  local container="$1" deadline=$((SECONDS + 300)) state health
  while (( SECONDS < deadline )); do
    state=$(docker inspect --format '{{.State.Status}}' "$container")
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")
    if [[ "$state" != running ]]; then
      printf '%s\n' "$container failed to remain running; no raw logs were collected." >&2
      return 1
    fi
    if [[ "$health" == healthy ]]; then
      printf '%s\n' "$container healthy"
      return 0
    fi
    sleep 2
  done
  printf '%s\n' "$container did not become healthy within 300 seconds." >&2
  return 1
}

start() {
  command -v openssl >/dev/null
  docker info --format '{{.ServerVersion}}' >/dev/null
  # A second invocation must not silently reuse or destroy a previous chain.
  if docker container inspect "$node" >/dev/null 2>&1 || docker container inspect "$indexer" >/dev/null 2>&1; then
    printf '%s\n' 'A named devnet container already exists. Inspect it before explicit cleanup; no change made.' >&2
    return 1
  fi
  if docker network inspect "$network" >/dev/null 2>&1; then
    printf '%s\n' 'The named isolated network already exists. Inspect it before explicit cleanup; no change made.' >&2
    return 1
  fi
  docker pull "$node_image"
  docker pull "$indexer_image"
  # Keep version tags in Config.Image for the existing-service inspection helper,
  # but fail before resource creation if either tag no longer identifies the
  # exact official bytes observed in this continuation's real acceptance run.
  if ! docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$node_image" | grep -Fxq "$node_digest"; then
    printf '%s\n' 'Node image digest differs from the reviewed pin; no devnet resources created.' >&2
    return 1
  fi
  if ! docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$indexer_image" | grep -Fxq "$indexer_digest"; then
    printf '%s\n' 'Indexer image digest differs from the reviewed pin; no devnet resources created.' >&2
    return 1
  fi
  # Docker 29 suppresses effective published ports on an internal network.
  # A dedicated bridge preserves loopback publishing. CFG_PRESET=dev and the
  # explicit undeployed indexer setting select the local chain, not egress rules.
  docker network create --driver bridge --label "$label=true" "$network" >/dev/null
  local node_health
  node_health="curl -sf -H 'Content-Type: application/json' -d '{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"chain_getHeader\",\"params\":[]}' http://localhost:9944 | grep -Eq '\"number\"[[:space:]]*:[[:space:]]*\"0x0*[1-9a-fA-F]'"
  docker run --detach --name "$node" --label "$label=true" \
    --network "$network" --network-alias node --publish 127.0.0.1:29944:9944 \
    --env CFG_PRESET=dev --env "SIDECHAIN_BLOCK_BENEFICIARY=$beneficiary" \
    --env RUST_LOG=warn --env RUST_BACKTRACE=0 --log-driver none \
    --health-cmd "$node_health" --health-interval 2s --health-timeout 5s \
    --health-retries 90 --health-start-period 5s "$node_image" >/dev/null
  wait_healthy "$node"

  # Random service credentials are supplied by environment name, never argv value.
  # They are not wallet credentials and are not written to project files or logs.
  APP__INFRA__STORAGE__PASSWORD=$(openssl rand -hex 24)
  APP__INFRA__PUB_SUB__PASSWORD=$(openssl rand -hex 24)
  APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD=$(openssl rand -hex 24)
  APP__INFRA__SECRET=$(openssl rand -hex 32)
  export APP__INFRA__STORAGE__PASSWORD APP__INFRA__PUB_SUB__PASSWORD APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD APP__INFRA__SECRET
  docker run --detach --name "$indexer" --label "$label=true" \
    --network "$network" --publish 127.0.0.1:28088:8088 \
    --env RUST_LOG=warn --env RUST_BACKTRACE=0 \
    --env APP__INFRA__NODE__URL=ws://node:9944 --env APP__APPLICATION__NETWORK_ID=undeployed \
    --env APP__INFRA__STORAGE__PASSWORD --env APP__INFRA__PUB_SUB__PASSWORD \
    --env APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD --env APP__INFRA__SECRET \
    --env APP__INFRA__SPO_NODE__URL=ws://node:9944 \
    --env APP__INFRA__SPO_NODE__BLOCKFROST_ID=e2e-test-dummy-id \
    --log-driver none --health-cmd 'test -f /var/run/indexer-standalone/running' \
    --health-interval 5s --health-timeout 5s --health-retries 60 \
    --health-start-period 10s "$indexer_image" >/dev/null
  unset APP__INFRA__STORAGE__PASSWORD APP__INFRA__PUB_SUB__PASSWORD APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD APP__INFRA__SECRET
  wait_healthy "$indexer"
  docker run --detach --name midnight-reviewlab-devnet-prover --label "$label=true" --publish 127.0.0.1:26300:6300 --log-driver none --env NUM_WORKERS=1 --env NO_FETCH_PARAMS=true --env MIDNIGHT_PROOF_SERVER_NUM_WORKERS=1 --env MIDNIGHT_PROOF_SERVER_NO_FETCH_PARAMS=true midnightntwrk/proof-server@sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c >/dev/null
  status
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$node_image" "$indexer_image"
  printf '%s\n' 'Services healthy. Run the public readiness probe; wallet/proving/transaction acceptance is separate.'
}

case "${1:-}" in
  up) [[ $# == 1 ]] && start ;;
  status) [[ $# == 1 ]] && status ;;
  *) printf '%s\n' 'Usage: bash devnet/services.sh up|status' >&2; exit 2 ;;
esac
