#!/bin/sh
set -eu

mkdir -p /data/backups/node-1

cat > /RTL/RTL-Config.json <<EOF
{
  "multiPass": "${RTL_PASSWORD:?RTL_PASSWORD is required}",
  "port": "${RTL_PORT:-3000}",
  "defaultNodeIndex": 1,
  "dbDirectoryPath": "/data",
  "SSO": {
    "rtlSSO": 0,
    "rtlCookiePath": "",
    "logoutRedirectLink": ""
  },
  "nodes": [
    {
      "index": 1,
      "lnNode": "${RTL_NODE_LABEL:-Cassandrina LND}",
      "lnImplementation": "LND",
      "Authentication": {
        "macaroonPath": "/lnd/mainnet",
        "configPath": "/lnd/lnd.conf"
      },
      "Settings": {
        "userPersona": "OPERATOR",
        "themeMode": "DAY",
        "themeColor": "INDIGO",
        "channelBackupPath": "/data/backups/node-1",
        "bitcoindConfigPath": "/bitcoin/bitcoind.conf",
        "logLevel": "INFO",
        "fiatConversion": false,
        "unannouncedChannels": false,
        "lnServerUrl": "https://${RTL_LND_REST_HOST:-${LND_HOST:?LND_HOST is required}}:${RTL_LND_REST_PORT:-${LND_PORT:-8080}}",
        "blockExplorerUrl": "https://mempool.space"
      }
    }
  ]
}
EOF

cd /RTL
exec node rtl
