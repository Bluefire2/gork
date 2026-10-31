# gork

Discord bot (discord.js v14 + `@google/genai`). Models are hard-coded in `src/index.ts`
(`GEMINI_MODEL_REGULAR`, `GEMINI_MODEL_ADVANCED`). Setup and scripts: see README.md.

The pre-commit hook (`.githooks/pre-commit`, enabled by `npm install`) regenerates
`src/version.ts` and adds it to every commit. That build ID is what `--version` reports.

## Production

| | |
|---|---|
| GCP project | `gen-lang-client-0117549220` (display name "Personal") |
| VM | `discord-bot-vm`, zone `us-central1-c`, Debian 12, e2-micro |
| Checkout | `/opt/gork`, owned by system user `gork` |
| Service | systemd `gork.service` (unit source: `deploy/gork.service`) |
| Secrets | `/opt/gork/config.json` (mode 600, owner `gork`) - never in the repo or in chat |
| Per-server settings | `/opt/gork/serverConfig.json` - written by the bot, the only copy, keep it |
| Gemini key | the "Discord" API key in the same GCP project |

The external IP is ephemeral; nothing depends on it.

**Also on this VM - do not touch:** TeXifier, run by pm2 as user `chernyshov_k`
(`pm2-chernyshov_k.service` resurrects it at boot). gork is *not* in pm2 any more; never
`pm2 start` gork or restore an old pm2 dump that contains it, or two bots will answer.

## Deploying

1. Push to `master` on GitHub. `deploy.sh` always deploys `origin/master`.
2. On the VM: `sudo bash /opt/gork/deploy/deploy.sh`. It fast-forwards, runs `npm ci` and
   the build, installs the unit if it changed, restarts, and exits 0 only after the bot
   logs `Bot is ready!` (= Discord login worked). On failure it prints the journal.
3. Verify in Discord - the script's check does not cover the Gemini calls:
   - `--version` shows the `BUILD_ID` from `src/version.ts` at the deployed commit
   - one normal message and one with `--advanced` both get answers

**Rollback:** `git revert` the bad commit, push, deploy again. Never edit files in
`/opt/gork` by hand; the next deploy refuses to fast-forward over local changes.

**Changing secrets:** edit `/opt/gork/config.json` on the VM, then
`sudo systemctl restart gork` and check `journalctl -u gork -n 20`.

Logs: `sudo journalctl -u gork -n 50`.

## Bug reports: traces

Each mention gork handles is saved to `/opt/gork/traces/<message ID>.json` (newest 500 kept,
mode 600): build ID, guild/channel/author, parsed flags, model, the **full prompt** (which
includes the channel history as the bot saw it) and how many history messages it used, each
tool call as it ran (so calls before a failed Gemini request are kept) with long strings truncated,
the response, any error with its stack, and the IDs of the bot's reply messages.

A bug report is usually a Discord message link,
`https://discord.com/channels/<guild>/<channel>/<message>`. The last ID is either the user's
message (the trace's file name) or one of the bot's replies (listed in `replies`). The directory
is readable only by `gork`, so search it with `sudo` rather than `cd`-ing in:

```bash
sudo grep -rl '"<message ID>"' /opt/gork/traces
```

Pruning deletes old traces, but the daily disk snapshots keep them for as long as the snapshots
are retained. Traces hold other people's messages: read them on the VM, quote only what the
bug needs, and don't copy whole files off the VM or into commits.

## Running commands on the VM from Windows

gcloud on Windows uses PuTTY (plink). It stops at a host-key prompt and swallows stdin, so:
pipe `n` into it, and pass multi-line scripts base64-encoded in `--command`.

```bash
B64=$(base64 -w0 script.sh)
echo n | gcloud compute ssh discord-bot-vm --zone us-central1-c \
  --project gen-lang-client-0117549220 --quiet --command "echo $B64 | base64 -d | bash"
```

- Redirect output to a log and check `$?`; don't pipe through `tail`, which hides the exit code.
- Never print `config.json` contents. Copy secrets server-side (`sudo install -m 600 ...`).
- In remote one-liners, `pkill -f` / `ps | grep` can match the command's own text. Use
  `pgrep -x <name>` instead.
- If SSH says "Server refused our key" for both gcloud and the Console's browser SSH,
  the Google guest agent has stopped installing keys. Restarting it fixed this once
  (2026-10): add a temporary `startup-script` metadata entry that runs
  `systemctl restart google-guest-agent`, reboot, then remove the metadata. The serial
  console (`gcloud compute instances get-serial-port-output`) is readable without SSH.

## Backups

The boot disk has a daily snapshot schedule. Take an extra snapshot
(`gcloud compute disks snapshot discord-bot-vm --zone us-central1-c ...`) before risky changes.
