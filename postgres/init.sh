#!/usr/bin/env bash
# Postgres runs this once, the first time it starts with an empty volume.
# The backend gets its own database, owned by its own user, so it never signs
# in as the admin.
set -euo pipefail

psql --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=postgres \
  --set=dashgen_password="$DASHGEN_DB_PASSWORD" <<'SQL'
CREATE ROLE dashgen LOGIN PASSWORD :'dashgen_password';
CREATE DATABASE dashgen OWNER dashgen;

-- By default every user may connect to every database. The owner keeps its
-- access, so after this only dashgen (and the admin) reaches it.
REVOKE CONNECT ON DATABASE dashgen FROM PUBLIC;
SQL
