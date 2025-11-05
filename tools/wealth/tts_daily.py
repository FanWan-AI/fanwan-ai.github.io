# -*- coding: utf-8 -*-
"""
Generate server-side TTS audio for AI 理财助手 Daily Lesson using DashScope.
- Reads today's entry from data/ai/wealth/finance-daily.json (or a specific --date YYYY-MM-DD)
- For each language (zh/en/es), builds a short narration text (title + summary + 2-3 key points)
- Splits long text into safe segments (<= ~520 chars) and synthesizes audio via DashScope
- Writes per-lang MP3 under assets/audio/wealth/<date>/daily.<lang>.mp3
- Emits a manifest.json mapping { lang: "/assets/audio/wealth/<date>/daily.<lang>.mp3" }

Environment:
- DASHSCOPE_API_KEY: required for synthesis
- DASHSCOPE_TTS_MODEL (optional): default "qwen3-tts-flash"
- DASHSCOPE_TTS_VOICE (optional): default "zhitian_emo" (Chinese), will also be used for en/es as a default

Usage:
python tools/wealth/tts_daily.py --date 2025-11-05 --langs zh,en,es
"""
import os, json, re, argparse, shutil
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime

_REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = _REPO_ROOT / "data" / "ai" / "wealth" / "finance-daily.json"
OUT_BASE = _REPO_ROOT / "data" / "ai" / "wealth"

try:  # pragma: no cover - optional dependency
    import dashscope  # type: ignore[attr-defined]
    _DEFAULT_DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/api/v1"
    _env_base = (os.getenv("DASHSCOPE_BASE_URL") or "").strip()
    dashscope.base_http_api_url = _env_base or _DEFAULT_DASHSCOPE_BASE  # type: ignore[attr-defined]
except Exception:  # pragma: no cover - optional dependency missing
    dashscope = None  # type: ignore

# ---- text helpers (simplified, inspired by scholarpush pipeline) ----
MAX_SEG_CHARS = 520
MIN_SEG_CHARS = 200
SAFE_PUNCT = ["。", "！", "？", ".", "!", "?", ";", "；", "\n"]


def _normalize_text(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    # normalize some punct
    s = s.replace("\u3000", " ")
    return s


def _split_by_punct(text: str, cap: int = MAX_SEG_CHARS) -> List[str]:
    text = _normalize_text(text)
    if not text:
        return []
    if len(text) <= cap:
        return [text]
    parts: List[str] = []
    buf: List[str] = []
    length = 0
    for ch in text:
        buf.append(ch)
        length += 1
        if ch in SAFE_PUNCT and length >= MIN_SEG_CHARS:
            seg = "".join(buf).strip()
            if seg:
                parts.append(seg)
            buf = []
            length = 0
        elif length >= cap:
            seg = "".join(buf).strip()
            if seg:
                parts.append(seg)
            buf = []
            length = 0
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts[:4]  # hard cap number of segments


# ---- data helpers ----

def _pick_lang(obj, lang_order: List[str]) -> str:
    if not obj:
        return ""
    if isinstance(obj, str):
        return obj.strip()
    if isinstance(obj, dict):
        for l in lang_order:
            v = obj.get(l)
            if isinstance(v, str) and v.strip():
                return v.strip()
        for v in obj.values():
            if isinstance(v, str) and v.strip():
                return v.strip()
    return ""


def _build_text(entry: dict, lang: str) -> str:
    # lang order: exact lang first, then en, zh as fallbacks
    order = [lang, "en", "zh"]
    title = _pick_lang(entry.get("topic") or entry.get("title"), order)
    summary = _pick_lang(entry.get("summary"), order)
    points = entry.get("key_points") or {}
    pts_list: List[str] = []
    if isinstance(points, dict):
        specific = points.get(lang) or points.get("en") or points.get("zh") or []
        if isinstance(specific, list):
            pts_list = [str(x).strip() for x in specific if str(x).strip()][:3]
    # build narration
    blocks = []
    if title:
        blocks.append(title)
    if summary:
        blocks.append(summary)
    if pts_list:
        blocks.append(" ".join(pts_list))
    raw = "。".join([b for b in blocks if b])
    # limit to safe length
    raw = raw.strip()
    return raw


# ---- dashscope helpers ----

def _find_audio_url(obj) -> Optional[str]:
    if obj is None:
        return None
    if isinstance(obj, str):
        low = obj.lower()
        if obj.startswith("http") and any(x in low for x in (".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac", ".opus")):
            return obj
        return None
    if isinstance(obj, dict):
        for k in ("url", "audio_url", "download_url", "file_url", "href"):
            v = obj.get(k)
            if isinstance(v, str) and v.startswith("http"):
                return v
        for v in obj.values():
            u = _find_audio_url(v)
            if u:
                return u
        return None
    if isinstance(obj, (list, tuple)):
        for v in obj:
            u = _find_audio_url(v)
            if u:
                return u
        return None
    if hasattr(obj, "__dict__"):
        return _find_audio_url(vars(obj))
    return None


def _call_dashscope_tts(
    text: str,
    api_key: str,
    model: str,
    voice: str,
    lang_hint: str,
) -> Any:
    if dashscope is None:
        raise RuntimeError("dashscope SDK not installed")

    language_type = "Chinese" if lang_hint.lower().startswith("zh") else "English"
    base_kwargs = {
        "model": model,
        "api_key": api_key,
        "voice": voice,
        "language_type": language_type,
        "stream": False,
    }

    # Attempt legacy signature first (<=1.24.5) for backward compatibility
    try:
        return dashscope.MultiModalConversation.call(  # type: ignore[attr-defined]
            text=text,
            **base_kwargs,
        )
    except KeyError as exc:
        if str(exc).strip("'") != "data":
            raise
    except Exception as exc:
        message = str(exc)
        if "data" not in message and "messages" not in message:
            raise

    # Fallback for 1.24.6+ which expects `input.messages`
    messages = [{
        "role": "user",
        "content": [{"type": "text", "text": text}],
    }]
    return dashscope.MultiModalConversation.call(  # type: ignore[attr-defined]
        input={"messages": messages},
        **base_kwargs,
    )


def _synthesize_segments(segments: List[str], api_key: str, voice: str, model: str, lang_hint: str) -> List[Path]:
    if dashscope is None:
        raise RuntimeError("dashscope SDK not installed")
    out_paths: List[Path] = []
    base_tmp = OUT_BASE / "__tmp__"
    base_tmp.mkdir(parents=True, exist_ok=True)

    for i, seg in enumerate(segments, start=1):
        seg = _normalize_text(seg)
        if not seg:
            continue
        try:
            resp = _call_dashscope_tts(seg, api_key, model, voice, lang_hint)
        except Exception as e:
            raise RuntimeError(f"DashScope synthesis failed at segment {i}: {e}")

        url = _find_audio_url(getattr(resp, "output", None) or getattr(resp, "data", None) or resp)
        if not url:
            # Try to surface API error payload for easier debugging
            error_payload = getattr(resp, "__dict__", None)
            raise RuntimeError(
                "DashScope response missing audio url"
                + (f"; payload={error_payload}" if error_payload else "")
            )

        import requests

        r = requests.get(url, timeout=60)
        r.raise_for_status()
        p = base_tmp / f"seg-{i:02d}.mp3"
        with open(p, "wb") as f:
            f.write(r.content)
        out_paths.append(p)
    return out_paths


def _concat_segments(paths: List[Path], dest: Path) -> Path:
    if not paths:
        raise RuntimeError("No audio segments to concatenate")
    with open(dest, "wb") as out:
        for p in paths:
            with open(p, "rb") as f:
                shutil.copyfileobj(f, out)
    return dest


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD; default to first entry (today)")
    ap.add_argument("--langs", help="comma list of langs to synthesize (zh,en,es)", default="zh,en,es")
    args = ap.parse_args()

    api_key = (os.getenv("DASHSCOPE_API_KEY") or "").strip()
    if not api_key:
        print("[TTS] DASHSCOPE_API_KEY missing; nothing generated.")
        return 0
    if dashscope is None:
        print("[TTS] dashscope SDK is not installed; nothing generated.")
        return 0

    model = (os.getenv("DASHSCOPE_TTS_MODEL") or "qwen3-tts-flash").strip()
    voice = (os.getenv("DASHSCOPE_TTS_VOICE") or "zhitian_emo").strip()

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        daily = json.load(f)
    if not isinstance(daily, list) or not daily:
        print("[TTS] No daily lessons found.")
        return 0

    entry = None
    if args.date:
        for it in daily:
            if str(it.get("date")) == args.date:
                entry = it
                break
    if entry is None:
        entry = daily[0]
    date_key = str(entry.get("date") or datetime.utcnow().strftime("%Y-%m-%d"))

    out_dir = OUT_BASE / date_key
    _ensure_dir(out_dir)

    manifest: Dict[str, str] = {}
    langs = [x.strip() for x in (args.langs or "").split(",") if x.strip()]
    for lang in langs:
        text = _build_text(entry, lang)
        if not text:
            continue
        segments = _split_by_punct(text, MAX_SEG_CHARS)
        if not segments:
            continue
        try:
            seg_paths = _synthesize_segments(segments, api_key=api_key, voice=voice, model=model, lang_hint=lang)
        except Exception as e:
            print(f"[TTS] synth {lang} failed: {e}")
            continue
        final_path = out_dir / f"daily.{lang}.mp3"
        _concat_segments(seg_paths, final_path)
        for p in seg_paths:
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass
        rel = f"/data/ai/wealth/{date_key}/{final_path.name}"
        manifest[lang] = rel
        print(f"[TTS] wrote {rel}")

    if manifest:
        mf_path = out_dir / "manifest.json"
        with open(mf_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        print(f"[TTS] manifest -> /data/ai/wealth/{date_key}/manifest.json ({len(manifest)} langs)")
    else:
        print("[TTS] No audio generated (empty manifest)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
