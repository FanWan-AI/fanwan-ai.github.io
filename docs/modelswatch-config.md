# ModelWatch: configuration & runtime knobs

This short doc records recommended configuration, default values, and the runtime data-source precedence used by the ModelWatch pipelines (weekly/daily) in this repository.

Goals

- Make it clear which artifacts are authoritative for the UI (snapshots vs hotlists).
- Provide a small set of tunable repo/workflow variables to control batch/timeouts/concurrency and snapshot-vs-hotlist behavior.

Summary of runtime precedence

- weekly pipeline: performs full corpus/tops fetch, writes `data/ai/modelswatch/snapshots/<YYYY-MM-DD>/gh.json` and `hf.json` sidecars, generates hotlists (`models_hotlist.json`, `projects_hotlist.json`) and may run batch summarization.

- frontend / daily: UI prefers a valid snapshot sidecar (e.g. `snapshots/<date>/gh_summaries.json` / `hf_summaries.json`) when available and not placeholder-heavy. If snapshot is missing or judged placeholder-heavy, the UI falls back to hotlist JSONs (`projects_hotlist.json` / `models_hotlist.json`). If those are missing, it falls back to `top_github.json` / `top_hf.json`.

Recommended repo/workflow variables (defaults used in workflows)

- SNAPSHOT_USE_BATCH = 1
  - Weekly default: enable batch summarization for weekly runs (more complete bilingual summaries).
  - Daily still uses conservative batching by default; control via workflow envs.

- SNAPSHOT_BATCH_KILL_TIMEOUT = 1800
  - Seconds. Kill watchdog for long-running snapshot summarizer. Weekly default increased to 1800s; tri_worker job uses a larger default (3600s) to give the long-running enrichment more time.

- TRI_GROUP_JSON_SIZE = 2
  - Controls grouping size for batch prompts. Lower values reduce per-batch latency.

- TRI_BATCH_CONCURRENCY = 4
  - Default concurrency for tri_worker job. Tune down if provider rate limits are hit.

- MODELSWATCH_DAILY_REQUIRE_BILINGUAL = 1
  - When set, `daily.mjs` will prefer picks that already have bilingual summaries (summary_en + summary_zh) from snapshot sidecars. If insufficient bilingual items exist, it will fill remaining slots from the general pool.

- SNAPSHOT_PLACEHOLDER_THRESHOLD = 0.5 (recommended)
  - Frontend uses a placeholder-detection check on snapshot sidecars (the fraction of items whose summary looks like a placeholder). If the placeholder fraction is above this threshold, the frontend will skip the snapshot and fall back to hotlist. Default in code is 0.5; you may raise to 0.75 to be more tolerant of placeholder content.
  - Implementation detail: the UI will attempt to read `data/ai/modelswatch/config.json` at runtime (client-side `fetch`). If present and containing a numeric `snapshot_placeholder_threshold` value that overrides the default, the front-end will use that runtime value.
  - For local development you can create or edit `data/ai/modelswatch/config.json`, e.g.:

    {
      "snapshot_placeholder_threshold": 0.5
    }

  - GitHub-hosted deployment: if you prefer to control this value via CI / repo settings, keep the file updated in the repo or we can instead read a repository variable and bake it into the site at build time (ask me and I can add that flow).

Notes on behavior already implemented

- Weekly is forced to batch mode by default in `.github/workflows/modelswatch-weekly.yml` (SNAPSHOT_USE_BATCH=1). The pipeline still writes hotlists and summary caches.
- `tri_worker` enrichment was moved into a separate job with a longer timeout and higher default concurrency to reduce the chance of CI kills during large batch processing.
- Daily (`tools/modelswatch/daily.mjs`) will read snapshot sidecars produced by weekly runs, prefer bilingual summaries when available, and will fall back to fast summaries or pending enrichment when needed. Selection logic is rule-based (diversity / quota / cooldown) with optional LLM summarization for summaries; LLM-based re-ranking is not used as the primary pick algorithm currently.

Operational tips

- Tuning for cost and reliability:

  - To reduce LLM cost, lower `SNAPSHOT_MAX_NEW` for weekly/tri runs.

  - If tri batch processes are frequently killed, increase `SNAPSHOT_BATCH_KILL_TIMEOUT` or reduce `TRI_GROUP_JSON_SIZE` and `TRI_BATCH_CONCURRENCY`.

- Changing UI precedence:

  - The front-end currently prefers snapshots. To force hotlist-first behavior you can either remove the snapshot pointer `data/ai/modelswatch/latest_snapshot.json` or modify the UI logic in `lab/modelswatch.html`.

Where this doc lives

- `docs/modelswatch-config.md` (this file)

If you'd like, I can:

- open a separate PR that exposes `SNAPSHOT_PLACEHOLDER_THRESHOLD` as a repo variable and read it from the frontend, or

- add a tiny UI toggle to `lab/modelswatch.html` to switch Snapshot-first vs Hotlist-first at runtime.

Recommended default values and rationale

- `snapshot_placeholder_threshold = 0.5` (default)
  - Rationale: tolerates a moderate fraction of placeholders (e.g., some items may be synthesized as short placeholders) while avoiding presenting obviously empty snapshots. Good trade-off for general use.
- `snapshot_placeholder_threshold = 0.75` (more tolerant)
  - Rationale: accept snapshots with more placeholders (useful if your batch summarizer sometimes returns fallbacks but overall snapshot quality is still helpful).
- `snapshot_placeholder_threshold = 0.25` (strict)
  - Rationale: only accept snapshots with high-quality majority summaries; use when you want the UI to avoid any snapshot that appears to be mostly placeholders.

----
Last updated: 2025-09-29
