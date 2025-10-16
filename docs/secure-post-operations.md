# Secure Post Operations

This note records the end-to-end workflow for locking or unlocking a blog article with the secure-post overlay.

## Prerequisites

- Node.js available (already required by the site tooling).
- Python 3.x available (for the toggle helper).
- The shared passphrase (e.g. `zw2026`) that readers will enter in the overlay.
- Fresh HTML for every language variant you plan to protect. Regenerate from markdown when in doubt so that the encrypted copy stays current.

## 1. Regenerate the static HTML

From the repo root run the specific generator for the post. Example for `DTDA`:

```powershell
node scripts/generate-blog.mjs DTDA
```

Repeat any other build steps you normally run before publishing (OG images, RSS, etc.) so the plaintext HTML matches what you expect to serve post-decryption.

## 2. Produce encrypted payloads

For each language variant, run the encryption CLI against the freshly generated HTML. Supply the passphrase with `--password` (or by exporting `SECURE_POST_PASSWORD`). Always target the `<main>` block and pass `--inner` so only the inner markup is stored.

Example commands (replace the password value as needed):

```powershell
# 中文
node tools/secure-post/encrypt-post.mjs `
  --input blog/DTDA.html `
  --output data/secure/DTDA.zh.json `
  --password zw2026 `
  --selector main `
  --inner

node tools/secure-post/encrypt-post.mjs `
  --input blog/CIKMA.html `
  --output data/secure/CIKMA.zh.json `
  --password zw2026 `
  --selector main `
  --inner

node tools/secure-post/encrypt-post.mjs `
  --input blog/CIKMA.en.html `
  --output data/secure/CIKMA.en.json `
  --password zw2026 `
  --selector main `
  --inner

node tools/secure-post/encrypt-post.mjs `
  --input blog/CIKMA.es.html `
  --output data/secure/CIKMA.es.json `
  --password zw2026 `
  --selector main `
  --inner

# English
node tools/secure-post/encrypt-post.mjs `
  --input blog/DTDA.en.html `
  --output data/secure/DTDA.en.json `
  --password zw2026 `
  --selector main `
  --inner

# Español
node tools/secure-post/encrypt-post.mjs `
  --input blog/DTDA.es.html `
  --output data/secure/DTDA.es.json `
  --password zw2026 `
  --selector main `
  --inner
```

The tool writes AES-256-GCM records into `data/secure/*.json`. Re-run this step whenever you edit the article body; the JSON must stay in sync with the plaintext backup.

## 3. Swap the HTML into secure mode

Use the toggle helper to replace the visible `<main>` block with the secure overlay placeholder. The helper automatically injects `secure-post.js`, stores the original markup, and wires the correct metadata for each language.

```powershell
python tools/blog/secure_post_toggle.py --slug DTDA --mode enable
```

- Backups are written to `data/secure/backups/<slug>.<lang>.main.html` if they do not already exist.
- The published HTML (`blog/DTDA*.html`) now contains the guard UI instead of the plaintext body.
- After deployment readers see the overlay, enter the passphrase, and the decrypted payload (including the hero, audio player, table of contents, etc.) is rehydrated client-side.
- Rebuild the blog index so the homepage lock badge stays in sync:

  ```powershell
  node scripts/build-blog-index.mjs
  ```

## 4. Verify locally

Open the localized pages in a browser, clear cache, and test:

1. Overlay prompts for the passphrase and rejects incorrect input.
2. Correct passphrase unlocks content, showing the hero section, audio controls, TOC, and other dynamic widgets.
3. Audio playback and internal navigation operate as before (the secure script automatically fires the `secure-post:rehydrate` event to rebuild front-end hooks).

## 5. Revert to plaintext (if needed)

If you need to publish the article without protection, run the toggle helper in disable mode.

```powershell
python tools/blog/secure_post_toggle.py --slug DTDA --mode disable
```

- The helper restores the original `<main>` from `data/secure/backups`. If the backup is missing you will be prompted to regenerate it.
- Double-check the restored HTML and remove `secure-post.js` if it is no longer required on that page.
- Refresh the blog index to remove the lock badge:

  ```powershell
  node scripts/build-blog-index.mjs
  ```

## 6. Maintaining the config

- Add new slugs to `SECURE_CONFIG` inside `tools/blog/secure_post_toggle.py`. Provide localized copy for the guard badge, hints, metadata list items, and the relative path to the encrypted JSON.
- Keep the backup files under version control to make it easy to review changes.
- When rotating passphrases, regenerate the encrypted JSON files and re-run the toggle helper to ensure the placeholders point to the updated payloads.

## Quick Reference

| Action | Command |
| --- | --- |
| Encrypt (per language) | `node tools/secure-post/encrypt-post.mjs --input blog/<slug>.<lang>.html --output data/secure/<slug>.<lang>.json --password <pass> --selector main --inner` |
| Enable protection | `python tools/blog/secure_post_toggle.py --slug <slug> --mode enable` |
| Disable protection | `python tools/blog/secure_post_toggle.py --slug <slug> --mode disable` |

Always commit both the HTML changes and the encrypted payloads so CI/CD deploys the complete bundle.
