# [braxton.is](https://braxton.is)

my personal website

## Color scheme / theme

[Catppuccin](https://github.com/catppuccin/palette), using Mocha for dark mode
and Latte for light mode. The theme follows the visitor's system preference
through CSS, without JavaScript.

## Status

The line beside the site name is the newest `is.braxton.now` record in my repo.
An Apple Shortcut writes it and mirrors it as a post on
[@now.braxton.is](https://bsky.app/profile/now.braxton.is). See
[`lexicons/NOW.md`](lexicons/NOW.md) for the schema and the Shortcut.

Each status links to an `is.braxton.state` record, a reading of my heart rate,
activity and phone battery taken as I post it. The header shows that reading
after the status. See [`lexicons/STATE.md`](lexicons/STATE.md).

## Lexicons

The schemas for my own record types live in [`lexicons/`](lexicons/). To let
other software look them up by name, each is also published as a
`com.atproto.lexicon.schema` record in my repo, and a DNS TXT record at
`_lexicon.braxton.is` with the value `did=did:plc:2grdruc2p6fjhksrfpt366yl`
points resolvers at that repo.

```sh
npm run lexicons:check                               # compare, change nothing
ATPROTO_APP_PASSWORD=... npm run lexicons:publish    # write what differs
```

A published schema cannot change its constraints. Adding an optional field is
allowed. Changing a type, a limit or the required list is not, and needs a new
name instead.

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
