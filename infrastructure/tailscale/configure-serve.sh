#!/usr/bin/env bash
set -euo pipefail

LOCAL_PORT="${NGINX_LOCAL_PORT:-8081}"

tailscale serve --bg "http://127.0.0.1:${LOCAL_PORT}"
tailscale serve status
