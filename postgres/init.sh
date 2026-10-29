#!/usr/bin/env bash
# Postgres runs this once, the first time it starts with an empty volume.
# Each service gets its own database, owned by its own user, and neither user
# can connect to the other's database.
set -euo pipefail

psql --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=postgres \
  --set=metrics_password="$METRICS_DB_PASSWORD" \
  --set=gateway_password="$GATEWAY_DB_PASSWORD" <<'SQL'
CREATE ROLE metrics LOGIN PASSWORD :'metrics_password';
CREATE ROLE gateway LOGIN PASSWORD :'gateway_password';

CREATE DATABASE metrics OWNER metrics;
CREATE DATABASE gateway OWNER gateway;

-- By default every user may connect to every database. An owner keeps its
-- access, so after this only metrics reaches metrics, and gateway gateway.
REVOKE CONNECT ON DATABASE metrics FROM PUBLIC;
REVOKE CONNECT ON DATABASE gateway FROM PUBLIC;
SQL
