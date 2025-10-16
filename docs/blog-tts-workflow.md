# Blog TTS Generation Workflow

This guide documents the end-to-end flow for producing DashScope narration for a blog article and wiring it into the website playback widget.

## Prerequisites

- Python 3.9+ with `pip` on your path.
- Node.js (already required for the rest of the site tooling).
- DashScope access with a provisioned API key.
- Optional but recommended: the `requests` package for faster downloads and the official `dashscope` SDK (`pip install dashscope requests`). The script falls back to `urllib` if these are missing.

Place your DashScope key in `.env` at the repo root so the tooling can pick it up:

```dotenv
DASHSCOPE_API_KEY=sk-XXXXXXXXXXXXXXXX
# Optional defaults
BLOG_TTS_VOICE=Katerina
```

Restart your shell (or source the file) so the environment variable is available.

## Step-by-step

1. **Regenerate the blog HTML (optional, but keeps things in sync)**

   ```powershell
   node scripts/generate-blog.mjs <slug>
   ```

   Replace `<slug>` with the folder name under `content/blog/` (for example `CIKMA`). This ensures you are recording audio for the latest copy of the article.

2. **Dry-run segmentation (optional)**
   Run the generator in dry-run mode to inspect how the article will be chunked and, if needed, trim the generated segments.

   ```powershell
   python tools/blog/generate_post_tts.py <slug> --lang zh --dry-run
   ```

   Useful flags:
   - `--lang`: language code (default is `zh`).
   - `--limit N`: only render the first `N` segments for spot checks.

3. **Generate narration**

   ```powershell
   python tools/blog/generate_post_tts.py <slug> --lang zh --voice <DashScopeVoice>
   ```

   Key points:
   - The script cleans the Markdown, splits it into manageable segments, and calls DashScope’s `qwen3-tts-flash` model for each paragraph (with automatic sentence-level splitting if a chunk keeps failing).
   - Audio files (MP3) are stored in `data/blog/audio/<slug>/<lang>/`. Filenames include a hash suffix so retries do not collide.
   - Metadata describing all segments lands in `data/blog/tts/<slug>.<lang>.json`. This drives the playback UI and captures `source_text` + `source_index` for each chunk.
   - Existing narration is reused when the text and audio file still match; the script only synthesizes the missing pieces and cleans up orphaned MP3s at the end.

4. **Regenerate the HTML so the player list is embedded**

   ```powershell
   node scripts/generate-blog.mjs <slug>
   ```

   The generator automatically reads the JSON metadata and writes a `<script id="post-tts-data">…</script>` block into each language variant.

5. **Verify locally**
   Serve the site (or open the generated HTML files directly) and ensure:
   - The narration card appears at the top of the article.
   - Audio playback works at multiple speeds.
   - Segment captions update while the audio plays.

6. **Commit artifacts**
   Be sure to commit all new/updated files:
   - `data/blog/audio/<slug>/<lang>/*.mp3`
   - `data/blog/tts/<slug>.<lang>.json`
   - Updated blog HTML in `blog/`

   Example:

   ```powershell
   git add blog/<slug>*.html data/blog/audio/<slug>/<lang> data/blog/tts/<slug>.<lang>.json
   git commit -m "Add TTS narration for <slug> (<lang>)"
   ```

7. **Deploy**
   Push the changes. The site will supply the narration card once the HTML, JSON, and audio files are deployed together.

## Troubleshooting

- **Missing API key**: the script exits with `DASHSCOPE_API_KEY is not configured`. Check that `.env` is loaded or export the key in your shell session.
- **No segments detected**: confirm the Markdown has non-empty paragraphs after cleaning. Use `--dry-run` to inspect how the parser sees the article.
- **Network failures**: the script logs a warning and continues. Re-run to retry failed segments.
- **Segment keeps failing**: the generator progressively splits the text into smaller sentences (up to four levels). If a chunk still cannot be voiced, the log includes the truncated text—edit the Markdown or re-run after fixing the content.
- **Voice selection**: pass `--voice <name>` to override the default. You can also set `BLOG_TTS_VOICE` globally in `.env`.

That’s it—repeat the process for each article/language combination that needs narration.
