#!/usr/bin/env python3
"""Generate DashScope TTS audio segments for a blog article."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict, deque
from typing import Deque, Dict, Iterable, List, Sequence

try:  # optional dependency, fall back to urllib when missing
    import requests  # type: ignore
except Exception:  # pragma: no cover - optional import
    requests = None  # type: ignore

try:  # DashScope SDK provides the MultiModalConversation endpoint
    import dashscope  # type: ignore
except Exception:  # pragma: no cover - optional import
    dashscope = None  # type: ignore

HERE = Path(__file__).resolve()
ROOT = HERE
for candidate in [HERE] + list(HERE.parents):
    if (candidate / "content" / "blog").exists():
        ROOT = candidate
        break
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

CONTENT_DIR = ROOT / "content" / "blog"
AUDIO_ROOT = ROOT / "data" / "blog" / "audio"
META_ROOT = ROOT / "data" / "blog" / "tts"
AUDIO_ROOT.mkdir(parents=True, exist_ok=True)
META_ROOT.mkdir(parents=True, exist_ok=True)


def _load_env(path: Path) -> None:
    if not path.exists():
        return
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            val = value.strip().strip("'\"")
            if key and not os.getenv(key):
                os.environ.setdefault(key, val)
    except Exception:
        pass


_load_env(ROOT / ".env")


def _parse_front_matter(src: str) -> tuple[Dict[str, str], str]:
    normalized = src.replace("\r\n", "\n")
    if normalized.startswith("---\n"):
        end = normalized.find("\n---", 4)
        if end != -1:
            block = normalized[4:end]
            body = normalized[end + 4 :]
            if body.startswith("\n"):
                body = body[1:]
            meta: Dict[str, str] = {}
            for line in block.splitlines():
                if not line or ":" not in line:
                    continue
                key, value = line.split(":", 1)
                meta[key.strip()] = value.strip().strip("'\"")
            return meta, body
    return {}, normalized


_HEADING_REF_RE = re.compile(r"参考文献|references|bibliography", re.IGNORECASE)
_LIST_RE = re.compile(r"^[-*+]\s+")
_ORDERED_RE = re.compile(r"^\d+[\.)]\s+")
_INLINE_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]+\)")
_INLINE_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_INLINE_REF_RE = re.compile(r"\[(?:\d+|[a-z]+)\]", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_INLINE_MATH_RE = re.compile(r"\$(?:\\.|[^$\\])+\$")
_PAREN_MATH_RE = re.compile(r"\\\((?:\\.|[^\\])+?\\\)")
_MATH_FENCE_RE = re.compile(r"^\s*\$\$\s*$")
_SAFE_FILENAME_RE = re.compile(r"[^\w\u4e00-\u9fff-]+", re.UNICODE)

_LATEX_SIMPLE_REPLACEMENTS = {
    r"\\times": " × ",
    r"\\cdot": " · ",
    r"\\pm": " ± ",
    r"\\langle": "〈",
    r"\\rangle": "〉",
    r"\\leq": " ≤ ",
    r"\\geq": " ≥ ",
    r"\\infty": " ∞ ",
    r"\\rightarrow": " → ",
    r"\\left": " ",
    r"\\right": " ",
    r"\\tilde": " tilde ",
}


def _safe_filename(value: str) -> str:
    cleaned = _SAFE_FILENAME_RE.sub("-", value.strip().lower())
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return cleaned or "segment"


def _split_long(text: str, limit: int = 360) -> List[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]
    pieces = re.split(r"(?<=[。！？!?；;\.])\s*", text)
    result: List[str] = []
    current = ""
    for piece in pieces:
        chunk = piece.strip()
        if not chunk:
            continue
        candidate = f"{current} {chunk}".strip() if current else chunk
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            result.append(current)
        if len(chunk) > limit:
            for start in range(0, len(chunk), limit):
                part = chunk[start : start + limit].strip()
                if part:
                    result.append(part)
            current = ""
        else:
            current = chunk
    if current:
        result.append(current)
    return result


def _latex_to_plain(expr: str) -> str:
    expr = expr.replace("\n", " ").strip()
    if not expr:
        return ""
    expr = re.sub(r"\\text\s*\{([^}]*)\}", r"\1", expr)
    expr = re.sub(r"\\operatorname\s*\{([^}]*)\}", r"\1", expr)
    for pattern, replacement in _LATEX_SIMPLE_REPLACEMENTS.items():
        expr = expr.replace(pattern, replacement)
    expr = expr.replace("{", " ").replace("}", " ")
    expr = expr.replace("^", " superscript ")
    expr = expr.replace("_", " sub ")
    expr = re.sub(r"\\[a-zA-Z]+", "", expr)
    expr = expr.replace("\\", "")
    expr = re.sub(r"\s+", " ", expr).strip()
    return expr


def _markdown_to_segments(body: str) -> List[str]:
    lines = body.replace("\r\n", "\n").split("\n")
    segments: List[str] = []
    buffer: List[str] = []
    in_code = False
    in_math = False
    skip_references = False

    def flush() -> None:
        if not buffer:
            return
        paragraph = " ".join(buffer).strip()
        buffer.clear()
        if not paragraph:
            return
        for piece in _split_long(paragraph):
            if piece:
                segments.append(piece)

    for raw in lines:
        line = raw.rstrip()
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if _MATH_FENCE_RE.match(line.strip()):
            if in_math:
                in_math = False
            else:
                flush()
                in_math = True
            continue
        if in_code:
            continue
        if in_math:
            continue
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if stripped.startswith("|"):
            continue
        if stripped.startswith("<!--"):
            continue

        if stripped.startswith(">"):
            stripped = stripped.lstrip("> ")

        heading_match = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading_match:
            flush()
            title = heading_match.group(2).strip()
            if _HEADING_REF_RE.search(title):
                skip_references = True
                continue
            for piece in _split_long(title, limit=140):
                if piece:
                    segments.append(piece)
            continue

        if skip_references and (stripped.startswith("[") or stripped[:2].isdigit()):
            continue

        cleaned = stripped
        cleaned = _LIST_RE.sub("", cleaned)
        cleaned = _ORDERED_RE.sub("", cleaned)
        cleaned = _INLINE_IMAGE_RE.sub("", cleaned)
        cleaned = _INLINE_LINK_RE.sub(r"\1", cleaned)
        cleaned = cleaned.replace("**", "").replace("__", "")
        cleaned = _INLINE_CODE_RE.sub(r"\1", cleaned)
        cleaned = _INLINE_REF_RE.sub("", cleaned)
        cleaned = _INLINE_MATH_RE.sub(lambda m: _latex_to_plain(m.group(0)[1:-1]), cleaned)
        cleaned = _PAREN_MATH_RE.sub(lambda m: _latex_to_plain(m.group(0)[2:-2]), cleaned)
        cleaned = _TAG_RE.sub(" ", cleaned)
        cleaned = cleaned.replace("&nbsp;", " ")
        cleaned = re.sub(r"\\{#.+?\\}", "", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned:
            buffer.append(cleaned)

    flush()
    return [seg for seg in segments if seg]


def _load_existing_records(slug: str, lang: str) -> Dict[str, Deque[Dict[str, str]]]:
    meta_path = META_ROOT / f"{slug}.{lang}.json"
    if not meta_path.exists():
        return defaultdict(deque)
    try:
        data = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return defaultdict(deque)
    mapping: Dict[str, Deque[Dict[str, str]]] = defaultdict(deque)
    counters: Dict[str, int] = defaultdict(int)
    for record in data.get("segments", []):
        text = record.get("text")
        file_path = record.get("file")
        source_text = record.get("source_text") or record.get("source") or text
        if (
            isinstance(text, str)
            and text.strip()
            and isinstance(file_path, str)
            and file_path.strip()
            and isinstance(source_text, str)
            and source_text.strip()
        ):
            idx = counters[source_text]
            counters[source_text] = idx + 1
            mapping[source_text].append({
                "text": text,
                "file": file_path,
                "source_text": source_text,
                "source_index": record.get("source_index", idx),
            })
    return mapping


def _make_unique_filename(text: str, used: set[str]) -> str:
    base = _safe_filename(text[:32]) or "segment"
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
    candidate = f"{base}-{digest}.mp3"
    counter = 1
    while candidate in used:
        counter += 1
        candidate = f"{base}-{digest}-{counter}.mp3"
    used.add(candidate)
    return candidate


def _relative_audio_path(slug: str, lang: str, filename: str) -> str:
    return f"/data/blog/audio/{slug}/{lang}/{filename}"


def _download_audio(url: str, dest: Path) -> bool:
    try:
        if requests:
            resp = requests.get(url, timeout=45)
            resp.raise_for_status()
            dest.write_bytes(resp.content)
            return True
        from urllib.request import urlopen  # type: ignore

        with urlopen(url, timeout=45) as resp:  # type: ignore[attr-defined]
            dest.write_bytes(resp.read())
        return True
    except Exception:
        return False


def synthesize_segments(segments: Sequence[str], slug: str, lang: str, voice: str) -> List[Dict[str, str]]:
    if not dashscope:
        raise RuntimeError("dashscope SDK is not installed")
    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("DASHSCOPE_API_KEY is not configured")
    if not segments:
        return []

    bundle_dir = AUDIO_ROOT / slug / lang
    bundle_dir.mkdir(parents=True, exist_ok=True)
    language_type = "Chinese" if lang.lower().startswith("zh") else "English"
    existing_map = _load_existing_records(slug, lang)
    used_filenames: set[str] = set()
    for records in existing_map.values():
        for record in records:
            file_path = record.get("file")
            if isinstance(file_path, str):
                used_filenames.add(Path(file_path).name)
    for existing_file in bundle_dir.glob("*.mp3"):
        used_filenames.add(existing_file.name)

    final_records: List[Dict[str, str]] = []
    segment_counter = 0

    chunk_counters: Dict[str, int] = defaultdict(int)

    def append_record(text: str, rel_path: str, source_text: str) -> None:
        nonlocal segment_counter
        idx = chunk_counters[source_text]
        chunk_counters[source_text] = idx + 1
        segment_counter += 1
        final_records.append({
            "id": f"segment-{segment_counter}",
            "text": text,
            "file": rel_path,
            "source_text": source_text,
            "source_index": idx,
        })

    def synthesize_text(text: str, source_text: str, depth: int = 0) -> List[Dict[str, str]]:
        text_clean = text.strip()
        if not text_clean:
            return []

        # up to two attempts before considering fallback splitting
        for attempt in range(2):
            try:
                response = dashscope.MultiModalConversation.call(  # type: ignore[attr-defined]
                    model="qwen3-tts-flash",
                    api_key=api_key,
                    text=text_clean,
                    voice=voice,
                    language_type=language_type,
                    stream=False,
                )
            except Exception as exc:  # pragma: no cover
                print(f"[warn] TTS request failed (attempt {attempt + 1}) for text chunk: {exc}")
                continue

            output = getattr(response, "output", None)
            audio = getattr(output, "audio", None)
            url = getattr(audio, "url", None)
            if not isinstance(url, str) or not url:
                print("[warn] Missing audio URL, will retry" if attempt == 0 else "[warn] Missing audio URL, will split text")
                continue

            filename = _make_unique_filename(text_clean, used_filenames)
            dest_path = bundle_dir / filename
            if not _download_audio(url, dest_path):
                print("[warn] Failed to download audio, will retry" if attempt == 0 else "[warn] Failed to download audio, will split text")
                continue

            return [{"text": text_clean, "file": _relative_audio_path(slug, lang, filename), "source_text": source_text}]

        # fallback: split into smaller pieces
        if depth >= 4 or len(text_clean) <= 20:
            print("[warn] Unable to synthesize text chunk even after retries; skipping:", text_clean[:80], "...")
            return []

        limit = max(60, len(text_clean) // 2)
        parts = _split_long(text_clean, limit=limit)
        if len(parts) < 2:
            midpoint = max(1, len(text_clean) // 2)
            parts = [text_clean[:midpoint], text_clean[midpoint:]]

        sub_records: List[Dict[str, str]] = []
        for part in parts:
            part_clean = part.strip()
            if not part_clean:
                continue
            sub_records.extend(synthesize_text(part_clean, source_text, depth + 1))
        return sub_records

    for paragraph in segments:
        text = paragraph.strip()
        if not text:
            continue

        reused = False
        queue = existing_map.get(text)
        while queue:
            candidate = queue.popleft()
            rel_path = candidate.get("file") if isinstance(candidate, dict) else None
            spoken = candidate.get("text") if isinstance(candidate, dict) else None
            if isinstance(rel_path, str) and isinstance(spoken, str):
                fs_path = ROOT / rel_path.lstrip("/")
                if fs_path.exists():
                    used_filenames.add(Path(rel_path).name)
                    append_record(spoken, rel_path, text)
                    reused = True
                    break
        if reused:
            continue

        new_records = synthesize_text(text, text)
        if not new_records:
            continue
        for record in new_records:
            used_filenames.add(Path(record["file"]).name)
            spoken = record.get("text", "")
            append_record(spoken, record["file"], text)

        # Remove unused audio files to keep directory tidy
        referenced = {Path(rec["file"]).name for rec in final_records}
        for mp3 in bundle_dir.glob("*.mp3"):
            if mp3.name not in referenced:
                try:
                    mp3.unlink()
                except Exception:
                    pass

    return final_records


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate DashScope narration for a blog post")
    parser.add_argument("slug", help="Folder name under content/blog")
    parser.add_argument("--lang", default="zh", help="Language code (default: zh)")
    parser.add_argument("--voice", default=None, help="Override DashScope voice (default: Katerina)")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of segments for quick tests")
    parser.add_argument("--dry-run", action="store_true", help="Only print extracted segments, skip TTS")
    args = parser.parse_args()

    slug = args.slug.strip().strip("/")
    lang = args.lang.strip().lower()
    if not slug:
        raise SystemExit("slug is required")

    md_path = CONTENT_DIR / slug / f"{lang}.md"
    if not md_path.exists():
        raise SystemExit(f"Markdown not found: {md_path}")

    raw = md_path.read_text(encoding="utf-8")
    meta, body = _parse_front_matter(raw)
    segments = _markdown_to_segments(body)
    if args.limit is not None and args.limit > 0:
        segments = segments[: args.limit]

    if not segments:
        raise SystemExit("No narratable segments detected after filtering")

    total_chars = sum(len(seg) for seg in segments)
    print(f"Detected {len(segments)} segments ({total_chars} characters)")

    if args.dry_run:
        for idx, seg in enumerate(segments, start=1):
            print(f"[{idx:02d}] {seg}")
        return

    voice = args.voice or meta.get("voice") or os.getenv("BLOG_TTS_VOICE") or "Katerina"

    try:
        records = synthesize_segments(segments, slug, lang, voice)
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc

    if not records:
        raise SystemExit("No audio clips were generated")

    meta_payload = {
        "slug": slug,
        "lang": lang,
        "voice": voice,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "segment_count": len(records),
        "chars_total": sum(len(item["text"]) for item in records),
        "source": f"content/blog/{slug}/{lang}.md",
        "segments": records,
    }

    meta_path = META_ROOT / f"{slug}.{lang}.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps(meta_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved metadata: {meta_path.relative_to(ROOT)}")
    print(f"Audio files directory: {(AUDIO_ROOT / slug / lang).relative_to(ROOT)}")


if __name__ == "__main__":
    main()
