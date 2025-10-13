#!/usr/bin/env python3
"""Generate DashScope TTS audio segments for a blog article."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

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
_SAFE_FILENAME_RE = re.compile(r"[^\w\u4e00-\u9fff-]+", re.UNICODE)


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


def _markdown_to_segments(body: str) -> List[str]:
    lines = body.replace("\r\n", "\n").split("\n")
    segments: List[str] = []
    buffer: List[str] = []
    in_code = False
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
        if in_code:
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
        cleaned = _TAG_RE.sub(" ", cleaned)
        cleaned = cleaned.replace("&nbsp;", " ")
        cleaned = re.sub(r"\\{#.+?\\}", "", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned:
            buffer.append(cleaned)

    flush()
    return [seg for seg in segments if seg]


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
    for existing in bundle_dir.glob("*.mp3"):
        try:
            existing.unlink()
        except Exception:
            pass

    language_type = "Chinese" if lang.lower().startswith("zh") else "English"
    records: List[Dict[str, str]] = []

    for idx, paragraph in enumerate(segments, start=1):
        text = paragraph.strip()
        if not text:
            continue
        try:
            response = dashscope.MultiModalConversation.call(  # type: ignore[attr-defined]
                model="qwen3-tts-flash",
                api_key=api_key,
                text=text,
                voice=voice,
                language_type=language_type,
                stream=False,
            )
        except Exception as exc:  # pragma: no cover - SDK raises on transport issues
            print(f"[warn] TTS request failed for segment {idx}: {exc}")
            continue

        output = getattr(response, "output", None)
        audio = getattr(output, "audio", None)
        url = getattr(audio, "url", None)
        if not isinstance(url, str) or not url:
            print(f"[warn] Missing audio URL for segment {idx}")
            continue

        filename = f"{idx:02d}-{_safe_filename(text[:32])}.mp3"
        dest_path = bundle_dir / filename
        if not _download_audio(url, dest_path):
            print(f"[warn] Failed to download audio for segment {idx}")
            continue

        records.append({
            "id": f"segment-{idx}",
            "text": text,
            "file": f"/data/blog/audio/{slug}/{lang}/{filename}",
        })

    return records


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
