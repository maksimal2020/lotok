#!/bin/sh
# Создание бакетов MinIO для локального окружения. Публичный — только для изображений объявлений.
set -e
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb -p local/lotok-media local/lotok-private local/lotok-backups
mc anonymous set download local/lotok-media
