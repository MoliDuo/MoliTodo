#!/usr/bin/env bash
# One-off, run it yourself on your own machine (never in CI): creates the key that signs Moli Todo's updates
# (standard 007, 7.5.3; standard 012, 12.7).
#   1. makes a minisign key pair; Tauri asks you for the key's password (twice);
#   2. writes the public key and the update address into desktop/src-tauri/tauri.conf.json (commit it);
#   3. stores the private key and the password in this repo's Actions secrets
#      TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD (read from stdin, never as arguments).
# The app only installs updates signed with this key. If the file or the password is lost, installed copies
# can never update again: put both in your password manager before you do anything else with them.
#   scripts/setup-updater-keys.sh [key file, default ~/.tauri/moli-todo-updater.key]
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="MoliDuo/MoliTodo"
KEY="${1:-$HOME/.tauri/moli-todo-updater.key}"
CONF="desktop/src-tauri/tauri.conf.json"

[ -e "$KEY" ] && { echo "❌ $KEY already exists; pass another path (or remove it if you are sure)." >&2; exit 1; }
command -v gh >/dev/null || { echo "❌ needs gh (https://cli.github.com), logged in with access to $REPO." >&2; exit 1; }
[ -d node_modules ] || { echo "❌ run npm ci first." >&2; exit 1; }
if grep -q '"pubkey"' "$CONF"; then
  echo "❌ $CONF already has an update key. Replacing it strands every installed copy; see standard 007, 7.5.8." >&2
  exit 1
fi

mkdir -p "$(dirname "$KEY")"
echo "Tauri will now ask for a password for the new key."
npx tauri signer generate -w "$KEY"
chmod 600 "$KEY"
[ -s "$KEY" ] && [ -s "$KEY.pub" ] || { echo "❌ no key was written." >&2; exit 1; }

# The password again, to store it as a secret; checked against the key so a typo cannot lock you out.
read -rsp "Type the same password once more (it is stored as a secret): " PASSWORD; echo
probe="$(mktemp)"
trap 'rm -f "$probe" "$probe.sig"' EXIT
echo probe > "$probe"
if ! TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$PASSWORD" npx tauri signer sign -f "$KEY" "$probe" >/dev/null 2>&1; then
  echo "❌ that password does not open the key. Nothing was stored; remove $KEY and $KEY.pub and start again." >&2
  exit 1
fi

# Tauri's .pub file is already the base64 text the app's config wants, on one line.
PUBKEY="$(tr -d '\n' < "$KEY.pub")"
PUBKEY="$PUBKEY" CONF="$CONF" REPO="$REPO" node -e '
  const fs = require("node:fs");
  const conf = JSON.parse(fs.readFileSync(process.env.CONF, "utf-8"));
  conf.plugins = {
    ...conf.plugins,
    updater: {
      pubkey: process.env.PUBKEY,
      endpoints: [`https://github.com/${process.env.REPO}/releases/latest/download/latest.json`],
      // The release build records the version in each update signature, so a signature made for an older
      // release cannot be passed off as a newer one.
      requireSignedVersion: true,
    },
  };
  fs.writeFileSync(process.env.CONF, JSON.stringify(conf, null, 2) + "\n");
'
npx prettier --write "$CONF" >/dev/null
grep -q "$PUBKEY" "$CONF" || { echo "❌ could not write the public key into $CONF." >&2; exit 1; }

gh secret set TAURI_SIGNING_PRIVATE_KEY -R "$REPO" < "$KEY"
printf '%s' "$PASSWORD" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R "$REPO"
gh secret list -R "$REPO" | grep TAURI_SIGNING

cat <<MSG

✅ Public key and update address are in $CONF — commit that file.
✅ Secrets TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD are set on $REPO.

Do now: put $KEY and its password into your password manager. GitHub cannot show the secrets again.
MSG
