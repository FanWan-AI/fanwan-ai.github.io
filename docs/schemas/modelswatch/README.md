# ModelSwatch Pipeline Schemas

This directory contains JSON Schema definitions for the v6 ModelSwatch pipeline. Each artifact produced by the pipeline must validate against the corresponding schema before it is atomically written to disk. Schemas are grouped by pipeline stage:

- `raw_corpus.schema.json` – output of the daily raw corpus aggregator for GitHub and HuggingFace sources.
- `daily_draft.schema.json` – draft payload consumed by downstream triage and publish steps.
- `unqualified.schema.json` – queue of items requiring LLM enrichment before qualification.
- `pending_summaries.schema.json` – tri_worker queue keeping pending prompt hashes and priority metadata.
- `tri_cache_staging.schema.json` – transient LLM output staged before merging into the production cache.
- `summary_cache.schema.json` – durable bilingual summary cache consumed by downstream analysis and publishing steps.
- `runlog.schema.json` – audit log entries written per run in `tools/modelswatch/audit/`.
- `state.schema.json` – pipeline state snapshot containing lock metadata and rolling counters.

Validators in `tools/modelswatch/lib/schema.mjs` load these schemas to enforce the contracts described in `docs/modelswatch-redesign_v6.md`.
