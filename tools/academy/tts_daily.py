#!/usr/bin/env python3
"""Generate Academy lesson TTS audio via DashScope (borrowing wealth pipeline guards)."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = REPO_ROOT / "data" / "ai" / "daily-academy" / "daily.json"
AUDIO_ROOT = REPO_ROOT / "assets" / "audio" / "daily"
DOT_ENV = REPO_ROOT / ".env"

MAX_SEG_CHARS = 280
MIN_SEG_CHARS = 100
SAFE_PUNCT = ["。", "！", "？", ".", "!", "?", ";", "；", "\n"]

try:
    import dashscope  # type: ignore[attr-defined]
    _DEFAULT_BASE = "https://dashscope.aliyuncs.com/api/v1"
    _env_base = (os.getenv("DASHSCOPE_BASE_URL") or "").strip()
    dashscope.base_http_api_url = _env_base or _DEFAULT_BASE  # type: ignore[attr-defined]
except Exception:  # pragma: no cover - optional dependency
    dashscope = None  # type: ignore

try:
    import requests  # type: ignore
except Exception:  # pragma: no cover
    requests = None  # type: ignore


def _load_local_env() -> None:
    if os.getenv("DASHSCOPE_API_KEY"):
        return
    if not DOT_ENV.exists():
        return
    try:
        for raw in DOT_ENV.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key and not os.getenv(key):
                os.environ[key] = value.strip().strip("'\"")
    except Exception:
        pass


def _strip_html(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<pre[\s\S]*?</pre>", " ", value, flags=re.IGNORECASE)
    text = re.sub(r"<code[\s\S]*?</code>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"`[^`]+`", " ", text)
    text = re.sub(r"\$\$[\s\S]*?\$\$", " ", text)
    text = re.sub(r"\\\([^)]*?\\\)", " ", text)
    text = re.sub(r"\\\[[^]]*?\\\]", " ", text)
    text = re.sub(r"</?p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&nbsp;", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _normalize_text(value: str) -> str:
    value = (value or "").strip()
    return re.sub(r"\s+", " ", value)


def _force_chunks(text: str, cap: int) -> List[str]:
    if len(text) <= cap:
        return [text]
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + cap)
        slice_text = text[start:end]
        boundary = max((slice_text.rfind(sym) for sym in SAFE_PUNCT), default=-1)
        if boundary > 32:
            end = start + boundary + 1
            slice_text = text[start:end]
        chunks.append(slice_text.strip())
        start = end
    return [c for c in chunks if c]


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
                if len(seg) > cap:
                    parts.extend(_force_chunks(seg, cap))
                else:
                    parts.append(seg)
            buf = []
            length = 0
        elif length >= cap:
            seg = "".join(buf).strip()
            if seg:
                if len(seg) > cap:
                    parts.extend(_force_chunks(seg, cap))
                else:
                    parts.append(seg)
            buf = []
            length = 0
    tail = "".join(buf).strip()
    if tail:
        if len(tail) > cap:
            parts.extend(_force_chunks(tail, cap))
        else:
            parts.append(tail)
    return parts


def _select_lesson(doc: Dict[str, Any], lesson_id: str | None) -> Dict[str, Any]:
    lessons = doc.get("lessons") if isinstance(doc, dict) else None
    if not isinstance(lessons, list) or not lessons:
        raise RuntimeError("No academy lessons found in daily.json")
    if not lesson_id:
        return lessons[0]
    for entry in lessons:
        if entry.get("id") == lesson_id:
            return entry
    raise RuntimeError(f"Lesson with id {lesson_id} not found")


def _pick_lang(data: Any, lang: str) -> str:
    if isinstance(data, str):
        return data.strip()
    if isinstance(data, dict):
        for key in (lang, "zh", "en"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _collect_segments(lesson: Dict[str, Any], lang: str) -> List[str]:
    lang_key = (lang or "zh").strip()
    segments: List[str] = []
    title = _pick_lang(lesson.get("title"), lang_key) or lesson.get("id", "")
    if title:
        segments.append(title)
    summary = _strip_html(_pick_lang(lesson.get("summary"), lang_key))
    if summary:
        segments.append(summary)
    content = _strip_html(_pick_lang(lesson.get("content"), lang_key))
    if content:
        segments.append(content)
    # Practice questions excluded from TTS as per user request
    return [seg for seg in segments if seg]


def _find_audio_url(obj: Any) -> Optional[str]:
    if obj is None:
        return None
    if isinstance(obj, str) and obj.startswith("http"):
        return obj
    if isinstance(obj, dict):
        for key in ("url", "audio_url", "audio", "download_url"):
            val = obj.get(key)
            if isinstance(val, str) and val.startswith("http"):
                return val
        for val in obj.values():
            found = _find_audio_url(val)
            if found:
                return found
    if isinstance(obj, list):
        for val in obj:
            found = _find_audio_url(val)
            if found:
                return found
    return None


def _response_to_dict(resp: Any) -> Dict[str, Any]:
    if isinstance(resp, dict):
        return resp
    if hasattr(resp, "to_dict"):
        try:
            data = resp.to_dict()
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    if hasattr(resp, "__dict__"):
        payload = dict(vars(resp))
        if isinstance(payload, dict):
            return payload
    return {"repr": repr(resp)}


def _call_dashscope_tts(text: str, api_key: str, model: str, voice: str, lang: str) -> Dict[str, Any]:
    if dashscope is None:
        raise RuntimeError("dashscope SDK not installed")
    language_type = "Chinese" if lang.lower().startswith("zh") else "English"
    base_kwargs = {
        "model": model,
        "api_key": api_key,
        "language_type": language_type,
        "stream": False,
    }
    voice_candidates = []
    if voice:
        voice_candidates.append(voice)
    fallback = "Cherry" if language_type == "Chinese" else "Alex"
    if fallback.lower() != (voice or "").lower():
        voice_candidates.append(fallback)
    voice_candidates.append("")
    last_error: Optional[Exception] = None
    for candidate in voice_candidates:
        params = dict(base_kwargs)
        if candidate:
            params["voice"] = candidate
        params["text"] = text
        try:
            resp = dashscope.MultiModalConversation.call(**params)  # type: ignore[attr-defined]
        except Exception as exc:  # pragma: no cover - network errors
            last_error = exc
            time.sleep(1)
            continue
        payload = _response_to_dict(resp)
        code = str(payload.get("code") or "").lower()
        if code and code not in {"ok", "success"}:
            message = str(payload.get("message") or payload.get("msg") or "")
            if "voice" in message.lower() and candidate != "":
                continue
            raise RuntimeError(message or code)
        return payload
    if last_error:
        raise last_error
    raise RuntimeError("DashScope call failed")


def _synthesize_segments(segments: List[str], api_key: str, voice: str, model: str, lang: str) -> List[Path]:
    if dashscope is None or requests is None:
        raise RuntimeError("dashscope SDK and requests are required")
    tmp_root = REPO_ROOT / "data" / "ai" / "daily-academy" / "__tts_tmp__"
    tmp_root.mkdir(parents=True, exist_ok=True)
    work_dir = tmp_root / f"{lang}-{int(time.time() * 1000)}"
    work_dir.mkdir(parents=True, exist_ok=True)
    out_paths: List[Path] = []
    min_interval = float(os.getenv("DASHSCOPE_TTS_MIN_INTERVAL", "0.8"))
    next_allowed = 0.0
    for idx, seg in enumerate(segments, start=1):
        chunk = _normalize_text(seg)
        if not chunk:
            continue
        now = time.time()
        if now < next_allowed:
            time.sleep(next_allowed - now)
        payload = _call_dashscope_tts(chunk, api_key, model, voice, lang)
        url = _find_audio_url(payload)
        if not url:
            raise RuntimeError("DashScope response missing audio url")
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        seg_path = work_dir / f"seg-{idx:02d}.mp3"
        seg_path.write_bytes(resp.content)
        out_paths.append(seg_path)
        next_allowed = time.time() + min_interval
    return out_paths


def _cleanup_paths(paths: List[Path]) -> None:
    seen: Set[Path] = set()
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
        seen.add(path.parent)
    for folder in sorted(seen, key=lambda p: len(p.parts), reverse=True):
        try:
            if folder.exists() and not any(folder.iterdir()):
                folder.rmdir()
        except Exception:
            pass


def _ensure_ffmpeg() -> Optional[str]:
    ffmpeg_env = os.getenv("DASHSCOPE_TTS_FFMPEG") or os.getenv("FFMPEG_PATH")
    candidates: List[Path] = []
    if ffmpeg_env:
        path = Path(ffmpeg_env).expanduser()
        if path.is_file():
            return str(path)
        candidates.append(path)
        exe = path / "ffmpeg.exe"
        candidates.append(exe)
    which = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if which:
        return which
    if sys.platform.startswith("win"):
        candidates.extend([
            Path("C:/Program Files/ffmpeg/bin/ffmpeg.exe"),
            Path("C:/ffmpeg/bin/ffmpeg.exe"),
        ])
    else:
        candidates.extend([
            Path("/usr/bin/ffmpeg"),
            Path("/usr/local/bin/ffmpeg"),
        ])
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def _concat_segments(paths: List[Path], dest: Path, ffmpeg_bin: str) -> None:
    if not paths:
        raise RuntimeError("No audio segments to merge")
    concat_list = dest.with_suffix(dest.suffix + ".parts.txt")
    with open(concat_list, "w", encoding="utf-8") as handle:
        for path in paths:
            handle.write(f"file '{path.as_posix()}'\n")
    cmd = [
        ffmpeg_bin,
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list),
        "-c:a",
        "libmp3lame",
        "-b:a",
        os.getenv("DASHSCOPE_TTS_MERGE_BITRATE", "192k"),
        str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    concat_list.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffmpeg merge failed")


def _update_daily_doc(doc: Dict[str, Any], lesson: Dict[str, Any], lang: str, rel_path: str) -> None:
    lesson.setdefault("audio", {})
    lesson["audio"][lang] = rel_path
    lessons = doc.get("lessons") if isinstance(doc, dict) else []
    updated: List[Dict[str, Any]] = []
    for entry in lessons:
        if entry.get("id") == lesson.get("id"):
            updated.append(lesson)
        else:
            updated.append(entry)
    if updated:
        doc["lessons"] = updated
    with open(DATA_PATH, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lesson-id", help="Lesson id to synthesize")
    parser.add_argument("--lang", default="zh", help="Language key (zh/en)")
    args = parser.parse_args()
    _load_local_env()
    api_key = (os.getenv("DASHSCOPE_API_KEY") or "").strip()
    if not api_key:
        print("[TTS] Missing DASHSCOPE_API_KEY; aborting")
        return 1
    if dashscope is None or requests is None:
        print("[TTS] dashscope SDK and requests must be installed")
        return 1
    if not DATA_PATH.exists():
        print(f"[TTS] {DATA_PATH} missing")
        return 1
    with open(DATA_PATH, "r", encoding="utf-8") as handle:
        doc = json.load(handle)
    lesson = _select_lesson(doc, args.lesson_id)
    lang = args.lang or "zh"
    segments_raw = _collect_segments(lesson, lang)
    segments: List[str] = []
    for seg in segments_raw:
        segments.extend(_split_by_punct(seg, MAX_SEG_CHARS))
    if not segments:
        raise RuntimeError("Nothing to synthesize; lesson content empty")
    model = (os.getenv("DASHSCOPE_TTS_MODEL") or "qwen3-tts-flash").strip()
    voice = os.getenv("DASHSCOPE_TTS_VOICE") or os.getenv("TTS_VOICE") or "Cherry"
    print(f"[TTS] Synthesizing {lesson.get('id')} ({lang}) with {len(segments)} chunks")
    try:
        temp_paths = _synthesize_segments(segments, api_key=api_key, voice=voice, model=model, lang=lang)
        if not temp_paths:
            raise RuntimeError("DashScope did not return any audio segments")
        AUDIO_ROOT.mkdir(parents=True, exist_ok=True)
        final_path = AUDIO_ROOT / f"{lesson.get('id')}-{lang}.mp3"
        ffmpeg_bin = _ensure_ffmpeg()
        if not ffmpeg_bin:
            print("[TTS] ffmpeg not found; copying first segment only")
            shutil.copyfile(temp_paths[0], final_path)
        else:
            _concat_segments(temp_paths, final_path, ffmpeg_bin)
        _cleanup_paths(temp_paths)
        rel_path = f"/assets/audio/daily/{final_path.name}"
        _update_daily_doc(doc, lesson, lang, rel_path)
        print(f"[TTS] Saved {rel_path}")
    except Exception as e:
        print(f"[TTS] Synthesis failed (ignoring to preserve lesson content): {e}")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
