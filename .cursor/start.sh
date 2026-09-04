#!/usr/bin/env bash
# Per-boot startup for the TDLS storefront Cloud Agent environment.
# Brings up the local PostgreSQL cluster and waits until it is ready.
# Idempotent: tolerates an already-running cluster.
set -euo pipefail

PG_VERSION=16
PG_CLUSTER=main

# Key off real readiness (not cluster status): a snapshot may have captured a
# running cluster, leaving a stale postmaster.pid that pg_ctlcluster clears on start.
if ! sudo -u postgres pg_isready -q 2>/dev/null; then
  echo "[start] Starting PostgreSQL ${PG_VERSION}/${PG_CLUSTER}..."
  sudo pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start || true
fi

for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q 2>/dev/null; then
    echo "[start] PostgreSQL is ready."
    exit 0
  fi
  sleep 1
done

echo "[start] WARNING: PostgreSQL did not report ready in time." >&2
exit 0
