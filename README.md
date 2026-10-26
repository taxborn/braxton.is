# [braxton.is](https://braxton.is)

my personal website

## Deployment

A push to `main` runs `.forgejo/workflows/deploy.yaml` on Carbon's runner. It
builds the site, packs `client/`, `server/` and production `node_modules/`, and
streams the tarball over SSH to a forced command. That command unpacks it into
`/srv/braxton-is/releases/<sha>`, repoints `current` and writes
`/srv/braxton-is/.deployed`. A systemd path unit restarts `braxton-is.service`
from that write. The server-side half lives in nixcfg
(`modules/nixos/services/braxton-is.nix`).

The newest five releases are kept.

### Rollback

On Carbon:

```sh
ls -1t /srv/braxton-is/releases                       # newest first
sudo -u braxton-deploy sh -c '
  ln -sfn releases/<sha> /srv/braxton-is/current.new &&
  mv -T /srv/braxton-is/current.new /srv/braxton-is/current &&
  echo <sha> > /srv/braxton-is/.deployed'
```

The write to `.deployed` is what triggers the restart. `touch` does not. Check
with `journalctl -u braxton-is-restart -u braxton-is -n 20`.

The next push to `main` deploys forward again. To stay on the old release,
revert the bad commit on `main` instead, so CI builds and ships the fix.
