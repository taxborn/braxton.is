# [braxton.is](https://braxton.is)

my personal website

## Color scheme / theme

[Evergarden](https://evergarden.moe) - `curl -L evergarden.moe`

## Deployment

A push to `main` runs `.tangled/workflows/deploy.yml` on the spindle at
`spindle.biscuits.at`, a microVM on Carbon. It builds the site, packs `client/`,
`server/` and production `node_modules/`, and streams the tarball over SSH to a
forced command. It logs in with the `DEPLOY_SSH_KEY` repository secret and
connects to `DEPLOY_HOST`, Carbon's public IPv4, both under Settings → Pipelines
→ Secrets on Tangled. The tailnet address will not do: the spindle blocks
private and CGNAT ranges from inside its microVMs. That command unpacks it into
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
