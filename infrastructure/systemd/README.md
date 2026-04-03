# Cassandrina Pi Boot Setup

Use the production compose file together with a small `systemd` unit so the
Cassandrina stack comes back after every Raspberry Pi reboot.

## 1. Enable the underlying daemons

If Bitcoin Core and LND run on the same Pi as Cassandrina, enable them first:

```bash
sudo systemctl enable --now docker
sudo systemctl enable --now bitcoind
sudo systemctl enable --now lnd
```

If your Bitcoin or Lightning node is managed by another platform such as
Umbrel, StartOS, or myNode, keep using that platform's startup mechanism
instead of creating duplicate services.

## 2. Install the Cassandrina boot service

From the repository root on the Pi:

```bash
sudo ./infrastructure/systemd/install-cassandrina-service.sh
```

That script writes `/etc/systemd/system/cassandrina.service`, reloads
`systemd`, and enables the service immediately. If `bitcoind.service` and
`lnd.service` exist locally, it also makes Cassandrina wait for them during
boot.

## 3. Verify after a reboot

```bash
sudo reboot
```

Then check:

```bash
systemctl status cassandrina --no-pager
systemctl status bitcoind --no-pager
systemctl status lnd --no-pager
docker compose --env-file .env -f infrastructure/docker-compose.yml ps
journalctl -u cassandrina -b --no-pager
```

You should see the Cassandrina containers in `Up` state:

- `timescaledb`
- `redis`
- `webapp`
- `trading-bot`
- `telegram-bot`

## Notes

- The production compose file already uses `restart: unless-stopped` for all
  Cassandrina containers, so Docker will also try to recover them on daemon
  restart.
- This setup does not rebuild images on every boot. After code changes, deploy
  them once with `docker compose --env-file .env -f infrastructure/docker-compose.yml up -d --build`.
- After a deploy that changes the webapp schema, run
  `docker compose --env-file .env -f infrastructure/docker-compose.yml exec -T webapp sh -lc 'cd /repo/apps/webapp && pnpm migrate:up'`
  so the production database stays aligned with the running API code.
- If LND runs on another host, leave `bitcoind` and `lnd` managed there and
  make sure `.env` points `LND_HOST` to the correct machine.
