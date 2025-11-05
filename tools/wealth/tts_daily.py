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
import os, json, re, argparse, shutil, time, errno, subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime

_REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = _REPO_ROOT / "data" / "ai" / "wealth" / "finance-daily.json"
OUT_BASE = _REPO_ROOT / "data" / "ai" / "wealth"
_DOTENV_PATH = _REPO_ROOT / ".env"

try:  # pragma: no cover - optional dependency
    import dashscope  # type: ignore[attr-defined]
    _DEFAULT_DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/api/v1"
    _env_base = (os.getenv("DASHSCOPE_BASE_URL") or "").strip()
    dashscope.base_http_api_url = _env_base or _DEFAULT_DASHSCOPE_BASE  # type: ignore[attr-defined]
except Exception:  # pragma: no cover - optional dependency missing
    dashscope = None  # type: ignore

try:  # optional network error helpers
    from requests.exceptions import SSLError as RequestsSSLError, ConnectionError as RequestsConnectionError
except Exception:  # pragma: no cover
    RequestsSSLError = None  # type: ignore
    RequestsConnectionError = None  # type: ignore

try:  # optional network error helpers
    from urllib3.exceptions import SSLError as Urllib3SSLError, ProtocolError as Urllib3ProtocolError
except Exception:  # pragma: no cover
    Urllib3SSLError = None  # type: ignore
    Urllib3ProtocolError = None  # type: ignore

_RETRY_ERRNOS = {
    v for v in (
        getattr(errno, "ECONNRESET", None),
        getattr(errno, "ECONNABORTED", None),
        getattr(errno, "ETIMEDOUT", None),
        getattr(errno, "EPIPE", None),
    )
    if v is not None
}
def _is_retryable_network_error(exc: Exception) -> bool:
    if RequestsSSLError and isinstance(exc, RequestsSSLError):
        return True
    if RequestsConnectionError and isinstance(exc, RequestsConnectionError):
        return True
    if Urllib3SSLError and isinstance(exc, Urllib3SSLError):
        return True
    if Urllib3ProtocolError and isinstance(exc, Urllib3ProtocolError):
        return True
    if isinstance(exc, OSError) and getattr(exc, "errno", None) in _RETRY_ERRNOS:
        return True
    message = str(exc).lower()
    keywords = [
        "ssl",
        "connection aborted",
        "connection reset",
        "max retries",
        "timed out",
        "unexpected eof",
        "protocol",
        "eof occurred",
    ]
    return any(word in message for word in keywords)

# ---- text helpers (simplified, inspired by scholarpush pipeline) ----
MAX_SEG_CHARS = 280
MIN_SEG_CHARS = 100
SAFE_PUNCT = ["。", "！", "？", ".", "!", "?", ";", "；", "\n"]


def _estimate_mp3_duration(path: Path) -> float:
    """Approximate mp3 duration (seconds) without optional deps."""
    try:
        data = path.read_bytes()
    except Exception:
        return 0.0
    size = len(data)
    if size <= 10:
        return 0.0
    idx = 0
    if data[:3] == b"ID3" and size >= 10:
        tag_size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
        idx = min(size, 10 + tag_size)

    version_table = {0: 2.5, 2: 2, 3: 1}
    layer_table = {1: 3, 2: 2, 3: 1}
    bitrate_table = {
        (1, 1): [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        (1, 2): [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        (1, 3): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
        (2, 1): [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        (2, 2): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
        (2, 3): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    }
    sr_table = {
        0: {0: 44100, 2: 22050, 3: 11025},
        1: {0: 48000, 2: 24000, 3: 12000},
        2: {0: 32000, 2: 16000, 3: 8000},
    }
    duration = 0.0
    while idx + 4 <= size:
        if data[idx] != 0xFF or (data[idx + 1] & 0xE0) != 0xE0:
            idx += 1
            continue
        version_id = (data[idx + 1] >> 3) & 0x03
        layer_desc = (data[idx + 1] >> 1) & 0x03
        bitrate_idx = (data[idx + 2] >> 4) & 0x0F
        sample_idx = (data[idx + 2] >> 2) & 0x03
        padding = (data[idx + 2] >> 1) & 0x01
        if (
            version_id == 1
            or layer_desc == 0
            or bitrate_idx in (0, 15)
            or sample_idx == 3
        ):
            idx += 1
            continue
        version = version_table.get(version_id, 1)
        layer = layer_table.get(layer_desc, 1)
        key = (1 if version == 1 else 2, layer)
        bitrate_list = bitrate_table.get(key)
        if not bitrate_list:
            idx += 1
            continue
        bitrate = bitrate_list[bitrate_idx] * 1000
        sr_map = sr_table.get(sample_idx)
        if not sr_map:
            idx += 1
            continue
        sample_rate = sr_map.get(version_id, 0)
        if bitrate == 0 or sample_rate == 0:
            idx += 1
            continue
        if layer == 1:
            frame_length = int((12 * bitrate / sample_rate + padding) * 4)
            frame_duration = 384 / sample_rate
        else:
            frame_length = int(144 * bitrate / sample_rate + padding)
            frame_duration = 1152 / sample_rate
        if idx + frame_length > size:
            break
        duration += frame_duration
        idx += frame_length
    return duration


def _load_local_env() -> None:
    """Populate os.environ from .env when running locally without extra deps."""
    if os.getenv("DASHSCOPE_API_KEY"):
        return
    if not _DOTENV_PATH.exists():
        return
    try:
        for raw_line in _DOTENV_PATH.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip()
    except Exception:
        pass


def _normalize_text(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    # normalize some punct
    s = s.replace("\u3000", " ")
    return s


def _force_chunks(text: str, cap: int) -> List[str]:
    text = text.strip()
    if len(text) <= cap:
        return [text] if text else []
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + cap)
        # Try to backtrack to nearest punctuation boundary
        slice_text = text[start:end]
        boundary = max(slice_text.rfind(sym) for sym in SAFE_PUNCT)
        if boundary > 32:  # accept meaningful chunk
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


def _collect_segments(entry: dict, lang: str) -> List[str]:
    order = [lang, "zh", "en"]
    segments: List[str] = []

    title = _pick_lang(entry.get("topic") or entry.get("title"), order)
    if title:
        segments.append(title)

    summary = _pick_lang(entry.get("summary"), order)
    if summary:
        segments.append(summary)

    points_block = entry.get("key_points")
    if isinstance(points_block, dict):
        points_iter = points_block.get(lang) or points_block.get("zh") or points_block.get("en") or []
    else:
        points_iter = points_block if isinstance(points_block, list) else []
    if isinstance(points_iter, list):
        for idx, raw_point in enumerate(points_iter, start=1):
            text = str(raw_point or "").strip()
            if not text:
                continue
            text = text.rstrip("。")
            segments.append(f"重点洞察{idx}：{text}。")

    practice_raw = entry.get("practice")
    practice_text = ""
    if isinstance(practice_raw, dict):
        practice_text = str(practice_raw.get(lang) or practice_raw.get("zh") or practice_raw.get("en") or "")
    elif isinstance(practice_raw, str):
        practice_text = practice_raw
    if practice_text:
        cleaned_lines: List[str] = []
        for chunk in practice_text.replace("\r", "\n").split("\n"):
            part = chunk.strip()
            if not part:
                continue
            part = part.lstrip("-•0123456789. ")
            cleaned_lines.append(part)
        for idx, item in enumerate(cleaned_lines, start=1):
            segments.append(f"实践建议{idx}：{item}")

    risk_raw = entry.get("risk_notes")
    risk_text = ""
    if isinstance(risk_raw, dict):
        risk_text = str(risk_raw.get(lang) or risk_raw.get("zh") or risk_raw.get("en") or "")
    elif isinstance(risk_raw, str):
        risk_text = risk_raw
    if risk_text:
        segments.append(f"风险提示：{risk_text}")

    return [seg.strip() for seg in segments if seg and seg.strip()]


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
    if hasattr(resp, "model_dump"):
        try:
            data = resp.model_dump()  # type: ignore[attr-defined]
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    if hasattr(resp, "__dict__"):
        payload = dict(vars(resp))
        if isinstance(payload, dict):
            return payload
    return {"repr": repr(resp)}


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
        "language_type": language_type,
        "stream": False,
    }

    voice_candidates = []
    voice_value = (voice or "").strip()
    if voice_value:
        voice_candidates.append(voice_value)
    # DashScope defaults: Cherry for zh, Alex for others
    fallback_voice = "Cherry" if language_type == "Chinese" else "Alex"
    if fallback_voice.lower() != voice_value.lower():
        voice_candidates.append(fallback_voice)
    voice_candidates.append("")  # let service auto-pick

    last_payload: Optional[Dict[str, Any]] = None
    last_error: Optional[Exception] = None

    for idx, candidate in enumerate(voice_candidates, start=1):
        call_kwargs = dict(base_kwargs)
        if candidate:
            call_kwargs["voice"] = candidate
        call_kwargs["text"] = text
        last_call_error: Optional[Exception] = None
        resp: Any = None
        for attempt_idx in range(3):
            print(
                f"[TTS][dashscope] attempt voice='{candidate or 'auto'}' len={len(text)} try={attempt_idx + 1}/3"
            )
            try:
                resp = dashscope.MultiModalConversation.call(  # type: ignore[attr-defined]
                    **call_kwargs,
                )
                break
            except Exception as exc:
                last_call_error = exc
                if _is_retryable_network_error(exc) and attempt_idx < 2:
                    delay = 1 + attempt_idx
                    print(f"[TTS][dashscope] transient network error: {exc}; retrying in {delay}s")
                    time.sleep(delay)
                    continue
                break

        if resp is None:
            if last_call_error is not None:
                raise last_call_error
            continue

        payload = _response_to_dict(resp)
        code = str(payload.get("code") or "").strip()
        if code and code.lower() not in {"ok", "success"}:
            message = str(payload.get("message") or "")
            print(f"[TTS][dashscope] response error code={code} message={message!r}")
            if "voice" in message.lower() and idx < len(voice_candidates):
                print("[TTS][dashscope] falling back due to voice error")
                continue
            raise RuntimeError(message or code)

        return payload

    raise RuntimeError("DashScope call failed without usable payload")


def _synthesize_segments(segments: List[str], api_key: str, voice: str, model: str, lang_hint: str) -> List[Path]:
    if dashscope is None:
        raise RuntimeError("dashscope SDK not installed")
    out_paths: List[Path] = []
    base_tmp = OUT_BASE / "__tmp__"
    base_tmp.mkdir(parents=True, exist_ok=True)

    def _env_float(name: str, default: float) -> float:
        raw = os.getenv(name)
        if raw is None:
            return default
        try:
            return float(raw)
        except ValueError:
            return default

    def _env_int(name: str, default: int) -> int:
        raw = os.getenv(name)
        if raw is None:
            return default
        try:
            return int(raw)
        except ValueError:
            return default

    min_interval = max(0.0, _env_float("DASHSCOPE_TTS_MIN_INTERVAL", 0.9))
    rate_limit_base = max(1.0, _env_float("DASHSCOPE_TTS_RATE_LIMIT_BASE_WAIT", 3.0))
    rate_limit_max = max(rate_limit_base, _env_float("DASHSCOPE_TTS_RATE_LIMIT_MAX_WAIT", 20.0))
    max_rate_retries = max(1, _env_int("DASHSCOPE_TTS_RATE_LIMIT_MAX_RETRIES", 6))
    rate_attempts: Dict[str, int] = {}
    next_allowed_ts = 0.0

    seg_index = 0
    pending: List[str] = []

    for seg in segments:
        seg = _normalize_text(seg)
        if not seg:
            continue
        pending.append(seg)

        while pending:
            current = pending.pop(0)
            if not current:
                continue
            if len(current) > MAX_SEG_CHARS:
                pending = _force_chunks(current, MAX_SEG_CHARS) + pending
                continue

            if min_interval > 0 and next_allowed_ts > 0:
                now = time.time()
                if now < next_allowed_ts:
                    wait_time = next_allowed_ts - now
                    print(f"[TTS] pacing wait {wait_time:.2f}s to respect DashScope throughput")
                    time.sleep(wait_time)

            preview = current.replace("\n", " ")
            if len(preview) > 80:
                preview = preview[:77] + "..."
            print(f"[TTS] chunk len={len(current)} -> {preview}")

            try:
                payload = _call_dashscope_tts(current, api_key, model, voice, lang_hint)
            except Exception as exc:
                message = str(exc).lower()
                if any(keyword in message for keyword in ("rate limit", "quota", "throttling")):
                    attempt_count = rate_attempts.get(current, 0) + 1
                    rate_attempts[current] = attempt_count
                    if attempt_count > max_rate_retries:
                        raise RuntimeError(
                            f"DashScope rate limit persisted for segment {seg_index + 1} after {attempt_count} retries"
                        )
                    wait_backoff = min(rate_limit_max, rate_limit_base * attempt_count)
                    print(
                        f"[TTS] rate limit hit on segment {seg_index + 1}; waiting {wait_backoff:.1f}s before retry"
                    )
                    time.sleep(wait_backoff)
                    next_allowed_ts = time.time() + min_interval
                    pending.insert(0, current)
                    continue
                if "input length" in message and len(current) > 160:
                    smaller_cap = max(100, MAX_SEG_CHARS // 2)
                    pending = _force_chunks(current, smaller_cap) + pending
                    next_allowed_ts = time.time() + min_interval
                    continue
                raise RuntimeError(f"DashScope synthesis failed at segment {seg_index + 1}: {exc}")

            output = payload.get("output") if isinstance(payload, dict) else None
            url = _find_audio_url(output) or _find_audio_url(payload)
            if not url:
                raise RuntimeError(
                    "DashScope response missing audio url"
                    + (f"; payload={payload}" if payload else "")
                )

            import requests

            seg_index += 1
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            p = base_tmp / f"seg-{seg_index:02d}.mp3"
            with open(p, "wb") as f:
                f.write(r.content)
            out_paths.append(p)
            rate_attempts.pop(current, None)
            next_allowed_ts = time.time() + min_interval
    return out_paths


def _concat_segments(paths: List[Path], dest: Path) -> Path:
    if not paths:
        raise RuntimeError("No audio segments to concatenate")

    ffmpeg_bin = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if ffmpeg_bin:
        concat_list = dest.with_suffix(dest.suffix + ".parts.txt")
        try:
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
                "-c",
                "copy",
                str(dest),
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
                concat_list.unlink(missing_ok=True)
                return dest
            print(
                "[TTS] ffmpeg concat failed, falling back to manual merge",
                result.stderr.strip() if result.stderr else "",
            )
        except Exception as exc:
            print(f"[TTS] ffmpeg concat raised {exc}; falling back to manual merge")
        finally:
            concat_list.unlink(missing_ok=True)

    def _read_segment_bytes(path: Path, keep_id3: bool) -> bytes:
        data = path.read_bytes()
        start = 0
        if len(data) >= 10 and data[:3] == b"ID3":
            tag_size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
            start = min(len(data), 10 + tag_size)
        if keep_id3:
            start = 0
        end = len(data)
        if end >= 128 and data[end - 128:end - 125] == b"TAG":
            end -= 128
        return data[start:end]

    with open(dest, "wb") as out:
        for idx, segment_path in enumerate(paths):
            keep_id3 = idx == 0
            chunk = _read_segment_bytes(segment_path, keep_id3=keep_id3)
            if not chunk:
                continue
            out.write(chunk)
    return dest


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD; default to first entry (today)")
    ap.add_argument("--langs", help="comma list of langs to synthesize (zh,en,es)", default="zh,en,es")
    args = ap.parse_args()

    _load_local_env()

    api_key = (os.getenv("DASHSCOPE_API_KEY") or "").strip()
    if not api_key:
        print("[TTS] DASHSCOPE_API_KEY missing; nothing generated.")
        return 0
    if dashscope is None:
        print("[TTS] dashscope SDK is not installed; nothing generated.")
        return 0

    model = (os.getenv("DASHSCOPE_TTS_MODEL") or "qwen3-tts-flash").strip()
    voice = (os.getenv("DASHSCOPE_TTS_VOICE") or "Cherry").strip()
    if voice.lower() == "zhitian_emo":
        voice = "Cherry"
    keep_segments = (os.getenv("DASHSCOPE_TTS_KEEP_SEGMENTS") or "").strip().lower() in {"1", "true", "yes"}

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
        base_segments = _collect_segments(entry, lang)
        if not base_segments:
            continue
        segments: List[str] = []
        for base in base_segments:
            split = _split_by_punct(base, MAX_SEG_CHARS)
            if split:
                segments.extend(split)
        if not segments:
            continue
        try:
            seg_paths = _synthesize_segments(segments, api_key=api_key, voice=voice, model=model, lang_hint=lang)
        except Exception as e:
            print(f"[TTS] synth {lang} failed: {e}")
            continue
        final_path = out_dir / f"daily.{lang}.mp3"
        _concat_segments(seg_paths, final_path)
        duration = _estimate_mp3_duration(final_path)
        if keep_segments:
            dbg_dir = out_dir / f"segments.{lang}"
            dbg_dir.mkdir(parents=True, exist_ok=True)
            for p in seg_paths:
                try:
                    shutil.move(str(p), dbg_dir / p.name)
                except Exception:
                    pass
        else:
            for p in seg_paths:
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass
        rel = f"/data/ai/wealth/{date_key}/{final_path.name}"
        manifest[lang] = rel
        seg_count = len(seg_paths)
        duration_str = f"~{duration:.1f}s" if duration else "duration unknown"
        print(f"[TTS] wrote {rel} ({seg_count} segments, {duration_str})")

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
