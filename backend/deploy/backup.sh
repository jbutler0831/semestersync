#!/usr/bin/env bash
# Writes an encrypted copy of the database to deploy/backups/, and keeps the last 14.
# Encrypted with age (https://age-encryption.org) to BACKUP_AGE_RECIPIENT; the private key that can read the
# backups stays off the server. Run daily from cron:  0 4 * * * /path/to/backend/deploy/backup.sh
# Restore: age -d -i key.txt FILE | gunzip | docker compose --env-file .env.production exec -T db psql -U semestersync semestersync
set -euo pipefail
cd "$(dirname "$0")"
RECIPIENT="$(grep -E '^BACKUP_AGE_RECIPIENT=' .env.production | cut -d= -f2-)"
[ -n "$RECIPIENT" ] || { echo "Set BACKUP_AGE_RECIPIENT in .env.production" >&2; exit 1; }
command -v age >/dev/null || { echo "Install age first" >&2; exit 1; }
mkdir -p backups
umask 077
OUT="backups/semestersync-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.age"
docker compose --env-file .env.production exec -T db pg_dump -U semestersync --no-owner semestersync | gzip | age -r "$RECIPIENT" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
ls -1t backups/*.age | tail -n +15 | xargs -r rm --
echo "Backed up to $OUT"
