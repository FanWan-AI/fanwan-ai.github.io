# -*- coding: utf-8 -*-
"""Generate AI Radar daily briefing files (narrative script mode).

This script reads the freshly produced ``latest.json`` payload, selects the
strongest items for the day, and asks the configured LLM (via ``tools.ai_llm``)
for a presenter-style daily briefing. When the LLM is unavailable or fails, a
conservative template-based briefing is produced instead so the rest of the
pipeline can continue running.

Output path: ``data/ai/airadar/briefings/YYYY-MM-DD.json``

Usage (after ``aggregate_reports.py``):
    python tools/ai_radar/generate_briefing.py

Environment knobs (all optional):
    BRIEFING_TOP_K            default 12
    BRIEFING_MODE             default "narrative_script"
    BRIEFING_MAX_TOKENS       default 2200
    BRIEFING_SOURCE_BLACKLIST comma-separated hostnames to skip
    BRIEFING_FORCE_TEMPLATE   set to 1 to skip LLM and use template
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Resolve repository root so we can import helpers comfortably.
_HERE = Path(__file__).resolve()
ROOT = _HERE
for candidate in [_HERE] + list(_HERE.parents):
    if (candidate / "tools" / "ai_llm.py").exists():
        ROOT = candidate
        break
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_env(path: Path) -> None:
    """Minimal dotenv loader so GitHub Actions can share secrets locally."""
    if not path.exists():
        return
    try:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'\"")
            if key and not os.getenv(key):
                os.environ.setdefault(key, value)
    except Exception:
        pass


_load_env(ROOT / ".env")

try:
    from tools.ai_llm import LLMError, chat_once  # type: ignore
except Exception:  # pragma: no cover - running without an LLM provider is valid.
    chat_once = None  # type: ignore
    LLMError = Exception  # type: ignore

# Directories used by downstream writes.
DATA_DIR = ROOT / "data" / "ai" / "airadar"
LATEST_PATH = DATA_DIR / "latest.json"
BRIEFINGS_DIR = DATA_DIR / "briefings"
BRIEFINGS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class NewsItem:
    """Strongly typed view over a latest.json entry."""

    id: str
    title: str
    url: str
    source_host: str
    raw_excerpt: str
    tags: List[str]
    published_at: str
    published_dt: datetime
    hotness: float
    score: float


def _env_int(name: str, default: int) -> int:
    try:
        raw = os.getenv(name, "").strip()
        if not raw:
            return int(default)
        match = re.search(r"-?\d+", raw)
        return int(match.group(0)) if match else int(default)
    except Exception:
        return int(default)


def _env_list(name: str) -> List[str]:
    raw = os.getenv(name, "")
    if not raw:
        return []
    return [chunk.strip().lower() for chunk in raw.split(",") if chunk.strip()]


def _parse_iso8601(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except Exception:
        return None


def _guess_source_host(url: str) -> str:
    if not url:
        return ""
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        return host.replace("www.", "")
    except Exception:
        return ""


def _extract_excerpt(record: Dict[str, Any]) -> str:
    base = (record.get("raw_excerpt") or "").strip()
    if base:
        return base
    bundle = record.get("excerpt_i18n") or {}
    for key in ("zh", "en", "es"):
        text = (bundle.get(key) or "").strip()
        if text:
            return text
    return ""


def _normalize_text(text: str, limit: int = 420) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def _tag_bonus(tags: Iterable[str]) -> float:
    bonus = 0.0
    tags_lower = {t.lower() for t in tags}
    if {"policy", "regulation"} & tags_lower:
        bonus += 0.12
    if {"funding", "finance"} & tags_lower:
        bonus += 0.1
    if {"research", "paper", "model"} & tags_lower:
        bonus += 0.08
    if {"tools", "product", "industry"} & tags_lower:
        bonus += 0.06
    return bonus


def _compute_score(item: Dict[str, Any], now: datetime) -> float:
    hotness = float(item.get("hotness") or 0.0)
    published = _parse_iso8601(item.get("published_at", "")) or now
    age_hours = max(0.0, (now - published).total_seconds() / 3600.0)
    recency = max(0.0, 1.0 - min(age_hours, 72.0) / 72.0)
    bonus = _tag_bonus(item.get("tags") or [])
    score = hotness * 0.65 + recency * 0.3 + bonus
    return float(f"{score:.6f}")


def _select_top(items: List[Dict[str, Any]], top_k: int, blacklist: List[str]) -> List[NewsItem]:
    now = datetime.now(timezone.utc)
    picked: List[NewsItem] = []
    for raw in items:
        host = _guess_source_host(raw.get("url") or "")
        if host and host in blacklist:
            continue
        item_id = str(raw.get("id") or (raw.get("url") or raw.get("title") or "")).strip()
        if not item_id:
            continue
        published_dt = _parse_iso8601(raw.get("published_at", "")) or now
        excerpt = _normalize_text(_extract_excerpt(raw))
        news = NewsItem(
            id=item_id,
            title=(raw.get("title") or "").strip(),
            url=(raw.get("url") or "").strip(),
            source_host=host,
            raw_excerpt=excerpt,
            tags=[str(t) for t in raw.get("tags") or []],
            published_at=raw.get("published_at") or "",
            published_dt=published_dt,
            hotness=float(raw.get("hotness") or 0.0),
            score=_compute_score(raw, now),
        )
        picked.append(news)
    picked.sort(key=lambda x: (x.score, x.published_at), reverse=True)
    dedup: Dict[str, NewsItem] = {}
    for item in picked:
        if item.id in dedup:
            continue
        dedup[item.id] = item
        if len(dedup) >= top_k:
            break
    return list(dedup.values())


CATEGORY_RULES: List[Tuple[str, Tuple[str, ...]]] = [
    ("政策/融资", ("policy", "funding", "regulation", "safety", "governance")),
    ("研究/模型", ("research", "paper", "model", "science", "benchmark")),
    ("工具/产业", ("tools", "tool", "industry", "product", "deployment", "platform")),
]
KEYWORD_FALLBACKS: Dict[str, Tuple[str, ...]] = {
    "政策/融资": ("监管", "政策", "安全", "投资", "融资", "合规"),
    "研究/模型": ("研究", "论文", "模型", "架构", "参数", "发布"),
    "工具/产业": ("工具", "应用", "平台", "部署", "企业", "产品"),
}
THEME_LINES: Dict[str, str] = {
    "政策/融资": "政策与资本面持续发力，评估监管与投入节奏。",
    "研究/模型": "研究迭代加速，新模型与论文值得重点跟进。",
    "工具/产业": "工具链与落地方案增多，关注集成与业务影响。",
}
SCRIPT_MAX_SEGMENTS = 8
SCRIPT_MIN_SEGMENTS = 5


def _classify(item: NewsItem) -> str:
    tags_lower = {t.lower() for t in item.tags}
    for label, keys in CATEGORY_RULES:
        if tags_lower & set(keys):
            return label
    haystack = f"{item.title} {item.raw_excerpt}"
    for label, keywords in KEYWORD_FALLBACKS.items():
        if any(kw in haystack for kw in keywords):
            return label
    return "工具/产业"


def _bj_date(now: Optional[datetime] = None) -> str:
    base = now or datetime.now(timezone.utc)
    bj = base + timedelta(hours=8)
    return bj.strftime("%Y-%m-%d")


def _bj_date_chinese(date_str: str) -> str:
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return date_str
    return f"{dt.month}月{dt.day}日"


def _collect_stats(items: List[NewsItem]) -> Dict[str, Any]:
    tag_counter: Counter[str] = Counter()
    host_counter: Counter[str] = Counter()
    section_counter: Counter[str] = Counter()
    for it in items:
        if it.source_host:
            host_counter[it.source_host] += 1
        for tag in it.tags:
            tag_counter[tag] += 1
        section_counter[_classify(it)] += 1
    return {
        "tag_counter": tag_counter,
        "host_counter": host_counter,
        "section_counter": section_counter,
    }


def _format_theme_line(section_counter: Counter[str]) -> str:
    if not section_counter:
        return "—"
    top_sections = [label for label, _ in section_counter.most_common(2)]
    lines = []
    for label in top_sections:
        lines.append(f"{label}：{THEME_LINES.get(label, '关注相关动态。')}")
    return "；".join(lines) if lines else "—"


def _hotness_delta(latest: List[NewsItem]) -> str:
    if not latest:
        return "—"
    current_avg = sum(it.hotness for it in latest) / max(len(latest), 1)
    prev_path = _latest_previous_archive_path()
    if not prev_path or not prev_path.exists():
        return "≈0%"
    try:
        data = json.loads(prev_path.read_text(encoding="utf-8"))
        items = data.get("items", [])
    except Exception:
        return "≈0%"
    if not items:
        return "≈0%"
    prev_scores = []
    for raw in items:
        try:
            prev_scores.append(float(raw.get("hotness") or 0.0))
        except Exception:
            continue
    if not prev_scores:
        return "≈0%"
    prev_avg = sum(prev_scores) / len(prev_scores)
    if prev_avg <= 0:
        return "+∞%"
    delta = (current_avg - prev_avg) / prev_avg
    pct = delta * 100.0
    if abs(pct) < 1.2:
        return "≈0%"
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct:.1f}%"


def _latest_previous_archive_path() -> Optional[Path]:
    dates_path = DATA_DIR / "dates.json"
    if not dates_path.exists():
        return None
    try:
        dates = json.loads(dates_path.read_text(encoding="utf-8"))
        if not isinstance(dates, list):
            return None
    except Exception:
        return None
    if len(dates) < 2:
        return None
    return DATA_DIR / f"{dates[1]}.json"


def _default_next_step(section: str) -> str:
    if section == "政策/融资":
        return "建议企业关注政策解读，及时评估合规影响。"
    if section == "研究/模型":
        return "建议研究者快速浏览原文或实验细节，判断对现有工作影响。"
    return "建议开发者尝试相关工具或关注后续落地更新。"


def _default_impact(section: str) -> str:
    if section == "政策/融资":
        return "意味着监管与资本动向正在影响行业节奏。"
    if section == "研究/模型":
        return "突显模型或方法的新进展，值得关注实验细节。"
    return "提示工具或产业落地正在加速，关注实际应用影响。"


def _compose_script_text(script: Dict[str, Any]) -> str:
    if not isinstance(script, dict):
        return ""
    opening = (script.get("opening") or "").strip()
    closing = (script.get("closing") or "").strip()
    call_to_action = (script.get("call_to_action") or "").strip()
    segments = script.get("segments") if isinstance(script.get("segments"), list) else []
    lines: List[str] = []
    if opening:
        lines.append(opening)
    for idx, seg in enumerate(segments, start=1):
        if not isinstance(seg, dict):
            continue
        fact = (seg.get("fact") or "").strip()
        impact = (seg.get("impact") or "").strip()
        tag = (seg.get("tag") or "").strip()
        prefix = f"第{idx}条"
        if tag:
            prefix += f"（{tag}）"
        body_parts = [fact] if fact else []
        if impact:
            body_parts.append(impact)
        if body_parts:
            lines.append(f"{prefix}：{' '.join(body_parts)}")
    if closing:
        lines.append(closing)
    if call_to_action:
        lines.append(call_to_action)
    return "\n\n".join(filter(None, lines))


def _fallback_briefing(date_str: str, mode: str, items: List[NewsItem], stats: Dict[str, Any]) -> Dict[str, Any]:
    lead_items = items[:SCRIPT_MAX_SEGMENTS]
    if len(lead_items) < SCRIPT_MIN_SEGMENTS:
        lead_items = items[: max(SCRIPT_MIN_SEGMENTS, len(items))]

    segments: List[Dict[str, Any]] = []

    def _segment_fact(it: NewsItem) -> str:
        if it.raw_excerpt:
            return _normalize_text(it.raw_excerpt, 140)
        return _normalize_text(it.title, 140)

    for it in lead_items:
        section = _classify(it)
        fact = _segment_fact(it)
        impact = _default_impact(section)
        segments.append(
            {
                "id": it.id,
                "tag": section,
                "fact": fact or _normalize_text(it.title, 120),
                "impact": impact,
                "source_host": it.source_host or "",
            }
        )

    if not segments:
        segments = [
            {
                "id": "none",
                "tag": "行业动态",
                "fact": "今日暂无足够新闻条目，建议稍后再查看。",
                "impact": "",
                "source_host": "",
            }
        ]

    host_counter: Counter[str] = stats.get("host_counter") or Counter()
    section_counter: Counter[str] = stats.get("section_counter") or Counter()
    themes = [
        {"topic": label, "one_line": THEME_LINES.get(label, "持续跟进相关进展。")}
        for label, _ in section_counter.most_common(2)
    ]
    if not themes:
        themes = [{"topic": "行业动态", "one_line": "关注行业与工具落地的最新动向。"}]

    opening = (
        f"这里是AI前沿要闻导读，{_bj_date_chinese(date_str)}为您带来{len(segments)}条重点资讯。"
    )
    top_host = host_counter.most_common(1)[0][0] if host_counter else "重点来源"
    closing = "以上是今天的核心动态，感谢收听，查看更多详情请访问官网。"
    call_to_action = f"关注 {top_host} 等重点渠道，第一时间掌握后续更新。"

    script_payload = {
        "language": "zh",
        "opening": opening,
        "segments": segments,
        "closing": closing,
        "call_to_action": call_to_action,
    }

    script_text = _compose_script_text(script_payload)

    return {
        "date": date_str,
        "mode": mode,
        "meta": {
            "hotness_delta": _hotness_delta(items),
            "themes": themes,
            "length_sec_estimate": 120,
        },
        "script": script_payload,
        "script_text": script_text,
        "references": {
            "items": [
                {
                    "id": it.id,
                    "title": it.title,
                    "url": it.url,
                    "tag": _classify(it),
                }
                for it in lead_items
            ]
        },
    }


def _prompt_payload(date_str: str, mode: str, items: List[NewsItem], stats: Dict[str, Any]) -> Dict[str, Any]:
    def _item_dict(it: NewsItem) -> Dict[str, Any]:
        return {
            "id": it.id,
            "title": it.title,
            "url": it.url,
            "source_host": it.source_host,
            "published_at": it.published_at,
            "tags": it.tags,
            "hotness": it.hotness,
            "score": it.score,
            "excerpt": it.raw_excerpt,
        }

    tag_counter: Counter[str] = stats.get("tag_counter") or Counter()
    host_counter: Counter[str] = stats.get("host_counter") or Counter()
    section_counter: Counter[str] = stats.get("section_counter") or Counter()
    return {
        "date": date_str,
        "mode": mode,
        "top_items": [_item_dict(it) for it in items],
        "stats": {
            "tag_distribution": tag_counter.most_common(12),
            "host_distribution": host_counter.most_common(6),
            "section_distribution": section_counter.most_common(),
            "hotness_delta_hint": _hotness_delta(items),
            "theme_lines": _format_theme_line(section_counter),
        },
        "output_schema": {
            "date": "YYYY-MM-DD",
            "mode": "narrative_script",
            "meta": {
                "hotness_delta": "字符串，带百分号或≈0%",
                "themes": "数组，2 条核心主题",
                "length_sec_estimate": "播报时长估算（秒）",
            },
            "script": {
                "language": "zh",
                "opening": "开场一句",
                "segments": "数组，6-8 条事件段落，每条含 id/tag/fact/impact",
                "closing": "收束一句",
                "call_to_action": "可选收尾行动号召",
            },
            "script_text": "将 opening/segments/closing 组合后的完整文本",
        },
    }


def _build_prompt(data: Dict[str, Any]) -> str:
    return (
        "你是一名专业的科技新闻播报脚本编辑，需要生成 2 分钟左右的中文口播稿。\n"
        "请仔细阅读提供的新闻列表，只能基于输入事实改写，不得添加未出现的数字或结论。\n"
        "输出必须是严格 JSON，禁止添加代码块或额外文字。\n"
        "结构包括：meta（热度信息与主题），script（language/opening/segments/closing/call_to_action），以及组合后的 script_text。\n"
        "script.segments 需包含 6-8 条事件，每条含 id、tag、fact、impact；fact 和 impact 都要通俗准确，且与输入事实一致。\n"
        "语气稳重、克制，避免夸张形容，保持播音员节奏。\n"
        "若某条信息不足，请用含糊表达，不得虚构细节。\n"
        f"输入：{json.dumps(data, ensure_ascii=False)}"
    )


def _validate_briefing(payload: Dict[str, Any], date_str: str) -> Tuple[bool, str]:
    if not isinstance(payload, dict):
        return False, "payload-not-dict"
    if payload.get("date") != date_str:
        return False, "date-mismatch"
    script = payload.get("script")
    if not isinstance(script, dict):
        return False, "script-missing"
    segments = script.get("segments") if isinstance(script.get("segments"), list) else None
    if not segments:
        return False, "segments-empty"
    if len(segments) < SCRIPT_MIN_SEGMENTS:
        return False, "segments-too-few"
    for seg in segments:
        if not isinstance(seg, dict):
            return False, "segment-not-dict"
        seg_id = str(seg.get("id") or "").strip()
        fact = str(seg.get("fact") or "").strip()
        if not seg_id or not fact:
            return False, "segment-missing-fields"
    script_text = payload.get("script_text")
    if script_text is not None and not isinstance(script_text, str):
        return False, "script-text-invalid"
    return True, "ok"


def _deep_copy(data: Dict[str, Any]) -> Dict[str, Any]:
    return json.loads(json.dumps(data, ensure_ascii=False))


def _merge_briefings(primary: Dict[str, Any], fallback: Dict[str, Any]) -> Dict[str, Any]:
    base = _deep_copy(fallback)

    def _normalize_meta(meta: Any, fallback_meta: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(meta, dict):
            return _deep_copy(fallback_meta)
        normalized = _deep_copy(meta)
        themes = normalized.get("themes")
        valid_themes: List[Dict[str, str]] = []
        if isinstance(themes, list):
            for entry in themes:
                if isinstance(entry, dict):
                    topic = str(entry.get("topic") or "").strip()
                    line = str(entry.get("one_line") or "").strip()
                    if topic and line:
                        valid_themes.append({"topic": topic, "one_line": line})
                elif isinstance(entry, str):
                    raw = entry.strip()
                    if raw:
                        if "：" in raw:
                            topic, line = raw.split("：", 1)
                            topic = topic.strip()
                            line = line.strip()
                        elif ":" in raw:
                            topic, line = raw.split(":", 1)
                            topic = topic.strip()
                            line = line.strip()
                        else:
                            topic = raw[:6].strip() or "主题"
                            line = raw
                        if line:
                            valid_themes.append({"topic": topic or "主题", "one_line": line})
        if not valid_themes:
            fallback_themes = (fallback_meta or {}).get("themes")
            if isinstance(fallback_themes, list):
                valid_themes = _deep_copy(fallback_themes)
            else:
                valid_themes = []
        normalized["themes"] = valid_themes

        hotness = normalized.get("hotness_delta")
        if not isinstance(hotness, str) or not hotness.strip():
            normalized["hotness_delta"] = str((fallback_meta or {}).get("hotness_delta") or "≈0%")

        length_est = normalized.get("length_sec_estimate")
        if not isinstance(length_est, (int, float)):
            normalized["length_sec_estimate"] = (fallback_meta or {}).get("length_sec_estimate", 120)
        else:
            normalized["length_sec_estimate"] = int(length_est)
        return normalized

    if isinstance(primary, dict):
        fallback_meta = fallback.get("meta") if isinstance(fallback, dict) else {}
        meta_src = primary.get("meta")
        if meta_src:
            merged_meta = _normalize_meta(meta_src, fallback_meta if isinstance(fallback_meta, dict) else {})
            base["meta"] = _normalize_meta({**base.get("meta", {}), **merged_meta}, fallback_meta if isinstance(fallback_meta, dict) else {})
        else:
            base["meta"] = _normalize_meta(base.get("meta"), fallback_meta if isinstance(fallback_meta, dict) else {})

        fallback_script = fallback.get("script") if isinstance(fallback, dict) else {}

        def _normalize_segment(seg: Any, fallback_segments: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
            if not isinstance(seg, dict):
                return None
            seg_id = str(seg.get("id") or "").strip()
            fact = _normalize_text(seg.get("fact"), 160)
            if not seg_id or not fact:
                return None
            fallback_seg = fallback_segments.get(seg_id, {})
            tag = str(seg.get("tag") or fallback_seg.get("tag") or "").strip() or "行业动态"
            impact = _normalize_text(seg.get("impact"), 160)
            if not impact and fallback_seg.get("impact"):
                impact = fallback_seg.get("impact")
            source_host = str(seg.get("source_host") or fallback_seg.get("source_host") or "").strip()
            return {
                "id": seg_id,
                "tag": tag,
                "fact": fact,
                "impact": impact,
                "source_host": source_host,
            }

        def _normalize_script(script: Any, fallback_script_data: Dict[str, Any]) -> Dict[str, Any]:
            fallback_segments = {}
            fallback_list = fallback_script_data.get("segments") if isinstance(fallback_script_data.get("segments"), list) else []
            for seg in fallback_list:
                if isinstance(seg, dict) and seg.get("id"):
                    fallback_segments[str(seg["id"])] = seg

            normalized: Dict[str, Any] = _deep_copy(fallback_script_data)
            if not isinstance(normalized, dict):
                normalized = {}

            if isinstance(script, dict):
                if script.get("language"):
                    normalized["language"] = str(script.get("language") or "").strip() or normalized.get("language") or "zh"
                if script.get("opening"):
                    normalized["opening"] = _normalize_text(script.get("opening"), 200)
                if script.get("closing"):
                    normalized["closing"] = _normalize_text(script.get("closing"), 180)
                if script.get("call_to_action"):
                    normalized["call_to_action"] = _normalize_text(script.get("call_to_action"), 160)

                segs = script.get("segments") if isinstance(script.get("segments"), list) else []
                normalized_segments = []
                for seg in segs:
                    norm_seg = _normalize_segment(seg, fallback_segments)
                    if norm_seg:
                        normalized_segments.append(norm_seg)
                if normalized_segments:
                    normalized["segments"] = normalized_segments
            if "segments" not in normalized or not isinstance(normalized["segments"], list) or not normalized["segments"]:
                normalized["segments"] = fallback_list
            if not normalized.get("language"):
                normalized["language"] = "zh"
            if not normalized.get("opening"):
                normalized["opening"] = fallback_script_data.get("opening") or ""
            if not normalized.get("closing"):
                normalized["closing"] = fallback_script_data.get("closing") or ""
            if not normalized.get("call_to_action") and fallback_script_data.get("call_to_action"):
                normalized["call_to_action"] = fallback_script_data.get("call_to_action")
            return normalized

        script_src = primary.get("script")
        base["script"] = _normalize_script(script_src, fallback_script if isinstance(fallback_script, dict) else {})

        if primary.get("script_text") and isinstance(primary.get("script_text"), str):
            base["script_text"] = primary["script_text"].strip()

        if primary.get("references"):
            base["references"] = primary["references"]

    else:
        fallback_meta = fallback.get("meta") if isinstance(fallback, dict) else {}
        base["meta"] = _normalize_meta(base.get("meta"), fallback_meta if isinstance(fallback_meta, dict) else {})

    base["date"] = primary.get("date") if isinstance(primary, dict) and primary.get("date") else fallback.get("date")
    base["mode"] = primary.get("mode") if isinstance(primary, dict) and primary.get("mode") else fallback.get("mode")
    base["script_text"] = _compose_script_text(base.get("script") or {})
    return base


def _generation_log(start: float, llm_used: bool, items: List[NewsItem], model_hint: Optional[str]) -> Dict[str, Any]:
    return {
        "generated_at": datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "duration_ms": int((time.time() - start) * 1000),
        "llm_used": llm_used,
        "model_hint": model_hint or "auto",
        "tokens": None,
        "items": [it.id for it in items],
        "top_k": len(items),
    }


def _model_hint() -> Optional[str]:
    for key in ("DEEPSEEK_MODEL", "OPENAI_MODEL", "OPENROUTER_MODEL", "TOGETHER_MODEL", "DASHSCOPE_MODEL"):
        val = os.getenv(key)
        if val:
            return val
    return None


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _update_latest_reference(date_str: str, briefing: Dict[str, Any]) -> None:
    if not LATEST_PATH.exists():
        return
    try:
        latest = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return
    script = briefing.get("script") if isinstance(briefing, dict) else {}
    segments = script.get("segments") if isinstance(script, dict) else []
    segment_ids = [seg.get("id") for seg in segments if isinstance(seg, dict) and seg.get("id")]
    ref = {
        "date": date_str,
        "url": f"/data/ai/airadar/briefings/{date_str}.json",
        "mode": briefing.get("mode", ""),
        "segment_count": len(segment_ids),
        "segments": segment_ids,
        "sections": [sec.get("title") for sec in briefing.get("sections", []) if isinstance(sec, dict) and sec.get("title")],
        "deep_dive_id": segment_ids[0] if segment_ids else "",
    }
    latest["briefing"] = ref
    write_json(LATEST_PATH, latest)
    # Mirror into the daily archive when present.
    archive_path = DATA_DIR / f"{date_str}.json"
    if archive_path.exists():
        try:
            archive = json.loads(archive_path.read_text(encoding="utf-8"))
        except Exception:
            archive = {}
        archive["briefing"] = ref
        write_json(archive_path, archive)


def main() -> None:
    if not LATEST_PATH.exists():
        raise SystemExit("latest.json not found; run aggregate_reports.py first")
    try:
        latest = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"failed to read latest.json: {exc}")
    raw_items = latest.get("items", [])
    if not isinstance(raw_items, list) or not raw_items:
        raise SystemExit("latest.json has no items to brief")

    top_k = max(4, _env_int("BRIEFING_TOP_K", 12))
    mode = (os.getenv("BRIEFING_MODE") or "narrative_script").strip() or "narrative_script"
    blacklist = _env_list("BRIEFING_SOURCE_BLACKLIST")
    items = _select_top(raw_items, top_k, blacklist)
    if not items:
        raise SystemExit("no items left after applying filters; adjust BRIEFING_SOURCE_BLACKLIST or data")

    date_str = _bj_date()
    stats = _collect_stats(items)
    prompt_data = _prompt_payload(date_str, mode, items, stats)
    force_template = os.getenv("BRIEFING_FORCE_TEMPLATE", "0").lower() in {"1", "true", "yes"}

    fallback_briefing = _fallback_briefing(date_str, mode, items, stats)

    briefing: Dict[str, Any]
    start = time.time()
    llm_ok = False
    if not force_template and chat_once:
        prompt = _build_prompt(prompt_data)
        max_tokens = _env_int("BRIEFING_MAX_TOKENS", 2200)
        try:
            raw = chat_once(prompt, system="You craft accurate Chinese news briefings in JSON.", temperature=0.2, max_tokens=max_tokens, want_json=True)
            text = raw.strip().strip("` ")
            briefing = json.loads(text)
            briefing = _merge_briefings(briefing, fallback_briefing)
            ok, reason = _validate_briefing(briefing, date_str)
            if not ok:
                print(f"[ai-radar] briefing validation failed ({reason}); falling back to template")
                briefing = fallback_briefing
            else:
                llm_ok = True
        except (LLMError, json.JSONDecodeError, ValueError) as exc:
            print(f"[ai-radar] briefing LLM error: {exc}; using template fallback")
            briefing = fallback_briefing
    else:
        briefing = fallback_briefing

    if not isinstance(briefing.get("script_text"), str) or not briefing.get("script_text", "").strip():
        briefing["script_text"] = _compose_script_text(briefing.get("script") or {})

    log = _generation_log(start, llm_ok, items, _model_hint())
    briefing["generation_log"] = log

    output_path = BRIEFINGS_DIR / f"{date_str}.json"
    write_json(output_path, briefing)
    _update_latest_reference(date_str, briefing)
    print(f"[ai-radar] briefing generated -> {output_path}")


if __name__ == "__main__":
    main()
