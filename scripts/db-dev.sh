#!/usr/bin/env bash
# PostgreSQL cho dev: khởi tạo thư mục dữ liệu .pgdata/ (lần đầu), chạy postgres ở cổng 5432, tạo database "tentides".
# Dùng:  scripts/db-dev.sh          (bật)
#        scripts/db-dev.sh stop     (tắt)
#        scripts/db-dev.sh status
# Rồi chạy server với: DATABASE_URL=postgres://tentides:tentides@localhost:5432/tentides pnpm dev
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${PGDATA_DIR:-$ROOT/.pgdata}"
PORT="${PGPORT:-5432}"
DB_NAME="${DB_NAME:-tentides}"
DB_USER="${DB_USER:-tentides}"
DB_PASS="${DB_PASS:-tentides}"

# Tìm pg_ctl: ưu tiên bản trong PATH, không có thì thử bản cài sẵn của Debian/Ubuntu.
if command -v pg_ctl >/dev/null 2>&1; then
  BIN="$(dirname "$(command -v pg_ctl)")"
else
  BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n1 || true)"
fi
if [[ -z "${BIN}" || ! -x "${BIN}/pg_ctl" ]]; then
  echo "Không tìm thấy PostgreSQL (pg_ctl). Cài postgresql, hoặc dùng docker:" >&2
  echo "  docker run -d --name tentides-pg -p ${PORT}:5432 -e POSTGRES_USER=${DB_USER} -e POSTGRES_PASSWORD=${DB_PASS} -e POSTGRES_DB=${DB_NAME} postgres:16" >&2
  exit 1
fi

# initdb, postgres không chạy được bằng root: khi là root thì chạy dưới user "postgres".
as_owner() {
  if [[ "$(id -u)" == "0" ]]; then
    if command -v runuser >/dev/null 2>&1; then runuser -u postgres -- "$@"; else su postgres -s /bin/sh -c "$(printf '%q ' "$@")"; fi
  else
    "$@"
  fi
}

case "${1:-start}" in
  stop)
    as_owner "${BIN}/pg_ctl" -D "${DATA}" stop -m fast
    exit 0
    ;;
  status)
    as_owner "${BIN}/pg_ctl" -D "${DATA}" status
    exit $?
    ;;
  start) ;;
  *)
    echo "Dùng: $0 [start|stop|status]" >&2
    exit 2
    ;;
esac

if [[ ! -f "${DATA}/PG_VERSION" ]]; then
  echo "Khởi tạo thư mục dữ liệu ${DATA}"
  mkdir -p "${DATA}"
  if [[ "$(id -u)" == "0" ]]; then chown postgres:postgres "${DATA}"; fi
  chmod 700 "${DATA}"
  as_owner "${BIN}/initdb" -D "${DATA}" -U postgres --auth-local=trust --auth-host=scram-sha-256 -E UTF8 --locale=C.UTF-8 >/dev/null
fi

if as_owner "${BIN}/pg_ctl" -D "${DATA}" status >/dev/null 2>&1; then
  echo "PostgreSQL đã chạy sẵn."
else
  # Socket để trong thư mục dữ liệu, khỏi cần quyền ghi /var/run/postgresql.
  as_owner "${BIN}/pg_ctl" -D "${DATA}" -l "${DATA}/server.log" -o "-p ${PORT} -k ${DATA} -c listen_addresses=localhost" -w start
fi

PSQL=(as_owner "${BIN}/psql" -h "${DATA}" -p "${PORT}" -U postgres -v ON_ERROR_STOP=1 -qtA)
if [[ "$("${PSQL[@]}" -d postgres -c "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'")" != "1" ]]; then
  "${PSQL[@]}" -d postgres -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'"
fi
if [[ "$("${PSQL[@]}" -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != "1" ]]; then
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
  echo "Đã tạo database ${DB_NAME}."
fi

echo
echo "PostgreSQL sẵn sàng ở cổng ${PORT}. Chạy game có tài khoản:"
echo "  DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:${PORT}/${DB_NAME} pnpm dev"
