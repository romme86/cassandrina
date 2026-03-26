#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo so it can install /etc/systemd/system/cassandrina.service." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "${script_dir}/../.." && pwd -P)"
compose_file="${repo_root}/infrastructure/docker-compose.yml"
service_file="/etc/systemd/system/cassandrina.service"

if [[ ! -f "${compose_file}" ]]; then
  echo "Could not find ${compose_file}." >&2
  exit 1
fi

docker_bin="$(command -v docker || true)"
if [[ -z "${docker_bin}" ]]; then
  echo "docker is not installed or not on PATH." >&2
  exit 1
fi

extra_unit_dependencies=()
for unit in bitcoind.service lnd.service; do
  if systemctl list-unit-files "${unit}" --no-legend >/dev/null 2>&1; then
    extra_unit_dependencies+=("${unit}")
  fi
done

after_line="After=docker.service network-online.target"
wants_line="Wants=network-online.target"

if [[ "${#extra_unit_dependencies[@]}" -gt 0 ]]; then
  joined_units="${extra_unit_dependencies[*]}"
  after_line="${after_line} ${joined_units}"
  wants_line="${wants_line} ${joined_units}"
fi

cat > "${service_file}" <<EOF
[Unit]
Description=Cassandrina Docker Compose Stack
Requires=docker.service
${after_line}
${wants_line}
ConditionPathExists=${compose_file}

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${repo_root}
ExecStart=${docker_bin} compose --env-file ${repo_root}/.env -f ${compose_file} up -d
ExecStop=${docker_bin} compose --env-file ${repo_root}/.env -f ${compose_file} stop
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now cassandrina.service

echo "Installed ${service_file}."
echo "Cassandrina will now start on boot."
if [[ "${#extra_unit_dependencies[@]}" -gt 0 ]]; then
  echo "The unit waits for: ${extra_unit_dependencies[*]}"
else
  echo "No local bitcoind/lnd systemd units were auto-detected."
  echo "If those daemons run on this Pi under different service names, edit ${service_file} and add them to Wants=/After=."
fi
