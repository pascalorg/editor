#!/bin/sh
set -eu

mkdir -p /data/jobs /data/runs
chown 65532:65532 /data /data/jobs /data/runs

exec gosu 65532:65532 "$@"
