# Site Assistant Build Toolkit

This toolkit generates the unified knowledge bus that powers the upgraded AI 智答站内助理. It reads the registry declared in `data/ai/siteAI/content_registry.json`, normalises the raw JSON feeds into `doc_chunk.jsonl` and `entity_card.jsonl`, and prepares hybrid retrieval indexes for downstream APIs.

## Components

- `extractors/`: source-specific transformers that understand each data feed in `data/ai/*`.
- `scripts/build-site-assistant.mjs`: orchestrator that runs all extractors, emits JSONL artefacts, and writes build metadata.

## Outputs

Running the build script produces files under `data/ai/siteAI/bus/`:

- `doc_chunk.jsonl`: newline-delimited documents ready for embedding/BM25.
- `entity_card.jsonl`: entity summaries for lookups and comparison tasks.
- `registry_state.json`: build stamp plus per-source counts.

The next iteration will add hybrid retrieval indexes (`bm25/*`, `vec/*`).

## Usage

```bash
node scripts/build-site-assistant.mjs
```

By default the script:

1. Loads the registry and resolves all sources.
2. Runs each extractor, collecting documents/entities.
3. Writes JSONL outputs with stable hashing for incremental builds.
4. Prints a summary table with counts and warnings.

Use the `--since <ISO8601>` flag (planned) to limit processing to recently updated sources once incremental hashing is wired.
