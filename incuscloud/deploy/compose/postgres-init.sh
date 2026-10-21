#!/bin/sh
# Runs once, on an empty data directory: a database and an owner for each service.
set -eu
for svc in hydra openfga incuscloud; do
  pw=$(eval "printf %s \"\$$(echo "$svc" | tr a-z A-Z)_DB_PASSWORD\"")
  psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE $svc LOGIN PASSWORD '$pw';
CREATE DATABASE $svc OWNER $svc;
SQL
done
