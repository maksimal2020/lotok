#!/usr/bin/env bash
# Восстановление из дампа в ЦЕЛЕВУЮ базу (по умолчанию — отдельную, не рабочую).
# Использование: TARGET_DATABASE_URL=postgres://.../lotok_restore ./restore.sh lotok-20260101T000000Z.dump
set -euo pipefail

DUMP="${1:?usage: restore.sh <dump-file>}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"

if [[ -f "${DUMP}.sha256" ]]; then
  sha256sum --check "${DUMP}.sha256"
fi

if [[ "${TARGET_DATABASE_URL}" == "${DATABASE_URL:-}" && "${CONFIRM_OVERWRITE:-}" != "yes" ]]; then
  echo "Отказ: целевая база совпадает с рабочей. Установите CONFIRM_OVERWRITE=yes, если это осознанно." >&2
  exit 1
fi

echo "[restore] restoring ${DUMP} into target database"
pg_restore --clean --if-exists --no-owner --no-privileges --jobs=4 --dbname="${TARGET_DATABASE_URL}" "${DUMP}"
psql "${TARGET_DATABASE_URL}" -c "SELECT count(*) AS users FROM users; SELECT count(*) AS listings FROM listings;"
echo "[restore] done"
