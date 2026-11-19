#!/usr/bin/env bash
# Резервная копия PostgreSQL: pg_dump (custom format) → локальный каталог + S3 (опционально).
# Использование: DATABASE_URL=... BACKUP_DIR=/backups [S3_BUCKET=s3://lotok-backups] [RETENTION_DAYS=14] ./backup.sh
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/lotok-${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"
echo "[backup] dumping to ${FILE}"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="${FILE}" "${DATABASE_URL}"
sha256sum "${FILE}" > "${FILE}.sha256"

# Проверка, что дамп читается.
pg_restore --list "${FILE}" > /dev/null

if [[ -n "${S3_BUCKET:-}" ]]; then
  echo "[backup] uploading to ${S3_BUCKET}"
  aws s3 cp "${FILE}" "${S3_BUCKET}/" ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"}
  aws s3 cp "${FILE}.sha256" "${S3_BUCKET}/" ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"}
fi

echo "[backup] removing local dumps older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name 'lotok-*.dump*' -type f -mtime "+${RETENTION_DAYS}" -print -delete
echo "[backup] done"
