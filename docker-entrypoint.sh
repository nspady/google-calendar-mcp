#!/bin/sh
# Fix ownership of volume-mounted directories (Railway mounts as root)
chown -R nodejs:nodejs /home/nodejs/.config 2>/dev/null || true

# Drop to nodejs user and exec the command
exec su-exec nodejs "$@"
