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
from urllib.parse import urlparse

requests = None  # type: ignore
try:
    import requests  # type: ignore
except Exception:
    pass

dashscope = None  # type: ignore
try:
    import dashscope  # type: ignore
except Exception:
    pass

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

AUDIO_DIR = DATA_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class NewsItem:
    """Strongly typed view over a latest.json entry."""

    id: str
    title: str
    title_cn: str
    url: str
    source_host: str
    raw_excerpt: str
    excerpt_cn: str
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


def _extract_cn_title(record: Dict[str, Any]) -> str:
    bundle = record.get("title_i18n") or {}
    if isinstance(bundle, dict):
        for key in ("zh", "zh-cn", "zh_CN", "zh-Hans"):
            text = (bundle.get(key) or "").strip()
            if text:
                return text
    return (record.get("title") or "").strip()


def _extract_cn_excerpt(record: Dict[str, Any]) -> str:
    bundle = record.get("excerpt_i18n") or {}
    if isinstance(bundle, dict):
        for key in ("zh", "zh-cn", "zh_CN", "zh-Hans"):
            text = (bundle.get(key) or "").strip()
            if text:
                return text
    base = (record.get("raw_excerpt") or "").strip()
    if base:
        return base
    return (record.get("title") or "").strip()


def _normalize_text(text: str, limit: int = 420) -> str:
    if not text:
        return ""
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def _chinese_ratio(paragraphs: Iterable[str]) -> float:
    text = "".join(str(p or "") for p in paragraphs)
    stripped = text.strip()
    if not stripped:
        return 0.0
    cjk = 0
    latin = 0
    for ch in stripped:
        if "\u4e00" <= ch <= "\u9fff":
            cjk += 1
        elif "a" <= ch.lower() <= "z":
            latin += 1
    total = cjk + latin
    if total == 0:
        return 1.0 if cjk > 0 else 0.0
    return cjk / total


def _is_mostly_chinese(paragraphs: Iterable[str], threshold: float = 0.65) -> bool:
    return _chinese_ratio(paragraphs) >= threshold


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
        title_cn = _normalize_text(_extract_cn_title(raw), 180)
        excerpt_cn = _normalize_text(_extract_cn_excerpt(raw), 180)
        news = NewsItem(
            id=item_id,
            title=(raw.get("title") or "").strip(),
            title_cn=title_cn or (raw.get("title") or "").strip(),
            url=(raw.get("url") or "").strip(),
            source_host=host,
            raw_excerpt=excerpt,
            excerpt_cn=excerpt_cn or excerpt,
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


def _script_paragraphs(script: Dict[str, Any]) -> List[str]:
    if not isinstance(script, dict):
        return []
    paragraphs: List[str] = []
    raw_paragraphs = script.get("paragraphs")
    if isinstance(raw_paragraphs, list):
        for entry in raw_paragraphs:
            text = str(entry or "").strip()
            if text:
                paragraphs.append(text)
    if paragraphs:
        return paragraphs

    opening = (script.get("opening") or "").strip()
    if opening:
        paragraphs.append(opening)

    segments = script.get("segments") if isinstance(script.get("segments"), list) else []
    for idx, seg in enumerate(segments, start=1):
        if not isinstance(seg, dict):
            continue
        fact = str(seg.get("fact") or "").strip()
        impact = str(seg.get("impact") or "").strip()
        tag = str(seg.get("tag") or "").strip()
        body_parts = [fact] if fact else []
        if impact:
            body_parts.append(impact)
        if body_parts:
            prefix = f"第{idx}条"
            if tag:
                prefix += f"（{tag}）"
            paragraphs.append(f"{prefix}：{' '.join(body_parts)}")

    closing = (script.get("closing") or "").strip()
    if closing:
        paragraphs.append(closing)

    call_to_action = (script.get("call_to_action") or "").strip()
    if call_to_action:
        paragraphs.append(call_to_action)

    return paragraphs


def _compose_script_text(script: Dict[str, Any]) -> str:
    paragraphs = _script_paragraphs(script)
    return "\n\n".join(paragraphs)


def _fallback_briefing(date_str: str, mode: str, items: List[NewsItem], stats: Dict[str, Any]) -> Dict[str, Any]:
    total_items = len(items)
    host_counter: Counter[str] = stats.get("host_counter") or Counter()
    section_counter: Counter[str] = stats.get("section_counter") or Counter()

    section_groups: Dict[str, List[NewsItem]] = {}
    for it in items:
        section_groups.setdefault(_classify(it), []).append(it)

    ordered_sections = [label for label, _ in section_counter.most_common()] or list(section_groups.keys())
    if not ordered_sections:
        ordered_sections = ["行业动态"]

    opening = f"这里是AI前沿要闻导读，{_bj_date_chinese(date_str)}我们精选梳理了{total_items}条重要资讯。"
    segments: List[Dict[str, Any]] = []
    paragraphs: List[str] = [opening]

    for idx, label in enumerate(ordered_sections, start=1):
        entries = section_groups.get(label, [])
        if not entries:
            continue
        sorted_entries = sorted(entries, key=lambda it: it.score, reverse=True)
        covered_ids = [it.id for it in sorted_entries]
        names = [(_normalize_text(it.title_cn or it.title, 40) or it.title) for it in sorted_entries]
        if names:
            # Chunk names into readable pieces
            chunked: List[str] = []
            for i in range(0, len(names), 3):
                chunk = "、".join(names[i : i + 3])
                chunked.append(chunk)
            name_sentence = "；".join(chunked)
        else:
            name_sentence = "多条行业动态"  # fallback
        fact_sentence = f"{label}板块共有{len(sorted_entries)}条动态，重点关注{name_sentence}。"
        impact_sentence = THEME_LINES.get(label, "请持续跟进相关进展。")
        segments.append(
            {
                "id": f"section-{idx}",
                "tag": label,
                "fact": fact_sentence,
                "impact": impact_sentence,
                "source_host": ",".join(sorted({it.source_host for it in sorted_entries if it.source_host})),
                "covered_ids": covered_ids,
            }
        )
        paragraphs.append(fact_sentence + " " + impact_sentence)

    if not segments:
        segments = [
            {
                "id": "section-1",
                "tag": "行业动态",
                "fact": "今日暂无足够新闻条目，建议稍后再查看。",
                "impact": "请留意后续更新。",
                "source_host": "",
                "covered_ids": [],
            }
        ]
        paragraphs.append("今日暂无足够新闻条目，建议稍后再来关注。")

    themes = [
        {"topic": label, "one_line": THEME_LINES.get(label, "持续跟进相关进展。")}
        for label, _ in section_counter.most_common(2)
    ]
    if not themes:
        themes = [{"topic": "行业动态", "one_line": "关注行业与工具落地的最新动向。"}]

    closing = "以上是今天的核心动态，感谢收听，查看更多详情请访问官网。"
    top_host = host_counter.most_common(1)[0][0] if host_counter else "重点来源"
    call_to_action = f"关注 {top_host} 等重点渠道，第一时间掌握后续更新。"
    paragraphs.append(closing)
    paragraphs.append(call_to_action)

    script_payload = {
        "language": "zh",
        "opening": opening,
        "segments": segments,
        "closing": closing,
        "call_to_action": call_to_action,
        "paragraphs": paragraphs,
    }

    script_text = "\n\n".join(paragraphs)

    return {
        "date": date_str,
        "mode": mode,
        "meta": {
            "hotness_delta": _hotness_delta(items),
            "themes": themes,
            "length_sec_estimate": min(600, max(240, len(segments) * 18)),
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
                for it in items
            ]
        },
    }


def _prompt_payload(date_str: str, mode: str, items: List[NewsItem], stats: Dict[str, Any]) -> Dict[str, Any]:
    def _item_dict(it: NewsItem) -> Dict[str, Any]:
        return {
            "id": it.id,
            "title": it.title,
            "title_cn": it.title_cn,
            "url": it.url,
            "source_host": it.source_host,
            "published_at": it.published_at,
            "tags": it.tags,
            "hotness": it.hotness,
            "score": it.score,
            "excerpt": it.raw_excerpt,
            "summary_cn": it.excerpt_cn,
        }

    tag_counter: Counter[str] = stats.get("tag_counter") or Counter()
    host_counter: Counter[str] = stats.get("host_counter") or Counter()
    section_counter: Counter[str] = stats.get("section_counter") or Counter()

    section_groups: Dict[str, List[NewsItem]] = {}
    for it in items:
        section = _classify(it)
        section_groups.setdefault(section, []).append(it)

    ordered_sections: List[str] = [label for label, _ in section_counter.most_common()] or list(section_groups.keys())
    sections_payload: List[Dict[str, Any]] = []
    for label in ordered_sections:
        entries = section_groups.get(label, [])
        if not entries:
            continue
        sorted_entries = sorted(entries, key=lambda x: x.score, reverse=True)
        sections_payload.append(
            {
                "section": label,
                "count": len(entries),
                "theme_hint": THEME_LINES.get(label, "关注行业节奏。"),
                "items": [
                    {
                        "id": it.id,
                        "title_cn": it.title_cn,
                        "summary_cn": it.excerpt_cn,
                        "source_host": it.source_host,
                        "hotness": it.hotness,
                        "published_at": it.published_at,
                    }
                    for it in sorted_entries
                ],
            }
        )

    hot_sorted = sorted(items, key=lambda it: it.hotness, reverse=True)
    quick_highlights = [
        {
            "id": it.id,
            "title_cn": it.title_cn,
            "source_host": it.source_host,
            "hotness": it.hotness,
            "summary_cn": it.excerpt_cn,
        }
        for it in hot_sorted[: min(12, len(hot_sorted))]
    ]

    coverage_instructions = {
        "total_items": len(items),
        "guidance": (
            "请以纯中文完成播报。可按主题或影响将多条新闻融合在同一段落中，但务必让每条新闻都被提及，"
            "必要时可在一句中串联多条资讯并提示来源。"
        ),
    }
    return {
    "date": date_str,
    "mode": mode,
    "total_items": len(items),
        "total_items": len(items),
    "top_items": [_item_dict(it) for it in items],
        "sections": sections_payload,
        "highlights": quick_highlights,
        "coverage": coverage_instructions,
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
                "segments": "数组，数量可自定，每条含 id/tag/fact/impact/covered_ids",
                "closing": "收束一句",
                "call_to_action": "可选收尾行动号召",
                "paragraphs": "数组，按顺序列出完整段落（含开场与收束）",
            },
            "script_text": "将 opening/segments/closing 组合后的完整文本",
        },
    }


def _build_prompt(data: Dict[str, Any]) -> str:
    total_items = int(data.get("total_items") or len(data.get("top_items") or []) or 1)
    suggested_runtime = max(240, min(600, total_items * 18))
    return (
        "你是一名资深科技新闻播报脚本总监，为忙碌的听众制作一段完整的中文口播导览。\n"
        "输入提供了当日全部 AI 相关新闻条目，请做到：逐条覆盖、事实准确、节奏紧凑。\n"
        "写稿原则：\n"
        "1) 仅引用输入中的信息，禁止杜撰数字、结论或未给出的背景。\n"
        "2) 语言必须为自然流畅的中文（专业英文名词可保留，但需要中文解释或上下文），不可出现长篇英文句子。\n"
        "3) 优先按主题、影响、时间线等方式把多条新闻融入同一段，以提高可听性；段落之间要有逻辑过渡。\n"
        "4) 段落要适合口播，每段 2-3 句，可在句中引用多条资讯并注明来源或影响。\n"
        "输出要求（必须返回合法 JSON，无额外文本）：\n"
        f"meta：包含 hotness_delta / themes / length_sec_estimate，播报时长估算建议约 {suggested_runtime} 秒，可结合口播节奏微调。\n"
        "script：language 固定为 'zh'，opening / segments / closing / call_to_action / paragraphs 必须填写。segments 数量可在 6-15 段之间，由你根据主题归纳决定，"
        "但要求在这些段落中覆盖输入的全部新闻。\n"
        "segment 结构：\n"
        "- id：自定义段落编号（如 section-1）。\n"
        "- tag：段落主题标签，可使用输入中的分类或自拟中文主题。\n"
        "- fact：用 1-3 句中文串联该主题下的全部新闻，确保每条资讯被提及（可在句中点名来源或标题核心词）。\n"
        "- impact：用 1-2 句说明这些动向的意义、行业影响或值得关注的下一步。\n"
        "- covered_ids：数组，写出此段落覆盖的新闻 id 列表。\n"
        "paragraphs：按照 opening -> 各 segment -> closing -> call_to_action 输出完整口播段落，段内句式口语化但保持专业度。\n"
        "script_text：将 opening、所有段落正文、closing、call_to_action 拼成单段可朗读文本，段间请用换行分隔。\n"
        "如素材信息不足，可提示仍在跟进或引用公开表述，不得编造细节。\n"
        f"【当日新闻素材】{json.dumps(data, ensure_ascii=False)}"
    )


def _validate_briefing(payload: Dict[str, Any], date_str: str, expected_ids: Optional[List[str]] = None) -> Tuple[bool, str]:
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
    if len(segments) < 3:
        return False, "segments-too-few"
    segment_ids: List[str] = []
    for seg in segments:
        if not isinstance(seg, dict):
            return False, "segment-not-dict"
        seg_id = str(seg.get("id") or "").strip()
        fact = str(seg.get("fact") or "").strip()
        if not seg_id or not fact:
            return False, "segment-missing-fields"
        segment_ids.append(seg_id)
    if expected_ids:
        if len(segment_ids) != len(expected_ids):
            return False, "segment-count-mismatch"
        if segment_ids != expected_ids:
            return False, "segment-order-mismatch"
    paragraphs_field = script.get("paragraphs")
    paragraphs: List[str] = []
    if isinstance(paragraphs_field, list):
        for entry in paragraphs_field:
            text = str(entry or "").strip()
            if text:
                paragraphs.append(text)
    if not paragraphs:
        return False, "paragraphs-missing"
    if len(paragraphs) < 3:
        return False, "paragraphs-too-short"
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
            covered_ids = seg.get("covered_ids")
            if isinstance(covered_ids, list):
                covered_ids = [str(v) for v in covered_ids if str(v).strip()]
            else:
                fallback_ids = fallback_seg.get("covered_ids") if isinstance(fallback_seg, dict) else None
                if isinstance(fallback_ids, list):
                    covered_ids = [str(v) for v in fallback_ids if str(v).strip()]
                else:
                    covered_ids = []
            return {
                "id": seg_id,
                "tag": tag,
                "fact": fact,
                "impact": impact,
                "source_host": source_host,
                "covered_ids": covered_ids,
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

                raw_paragraphs = script.get("paragraphs") if isinstance(script.get("paragraphs"), list) else []
                cleaned_paragraphs: List[str] = []
                for entry in raw_paragraphs:
                    text = str(entry or "").strip()
                    if text:
                        cleaned_paragraphs.append(text)
                if cleaned_paragraphs:
                    normalized["paragraphs"] = cleaned_paragraphs

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
            if not normalized.get("paragraphs") or not isinstance(normalized.get("paragraphs"), list):
                normalized["paragraphs"] = _script_paragraphs(normalized)
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
    paragraphs = _script_paragraphs(script if isinstance(script, dict) else {})
    preview = ""
    if paragraphs:
        preview = paragraphs[0][:180]
    sections = []
    for sec in briefing.get("sections", []) if isinstance(briefing, dict) else []:
        if isinstance(sec, dict) and sec.get("title"):
            sections.append(sec["title"])
    ref = {
        "date": date_str,
        "url": f"/data/ai/airadar/briefings/{date_str}.json",
        "mode": briefing.get("mode", ""),
        "segment_count": len(segment_ids),
        "segments": segment_ids,
        "paragraph_count": len(paragraphs),
        "preview": preview,
        "sections": sections,
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


def _safe_filename(name: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9_-]+", "-", name).strip("-")
    return sanitized or "segment"


def _download_audio(url: str, dest: Path) -> bool:
    if not requests:
        return False
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return False
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return True
    except Exception:
        return False


def _synthesize_audio(
    paragraphs: List[str],
    date_str: str,
    voice: Optional[str],
    language: str,
    log: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    api_key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not api_key or not dashscope:
        log["tts_status"] = "skipped-no-sdk" if dashscope is None else "skipped-no-key"
        return None
    if not paragraphs:
        log["tts_status"] = "skipped-no-paragraphs"
        return None

    bundle_dir = AUDIO_DIR / date_str
    bundle_dir.mkdir(parents=True, exist_ok=True)

    voice_id = voice or os.getenv("VOICE", "").strip() or "Katerina"
    language_type = "Chinese" if language.lower().startswith("zh") else "English"
    entries: List[Dict[str, Any]] = []
    success = 0
    for idx, paragraph in enumerate(paragraphs, start=1):
        text = paragraph.strip()
        if not text:
            continue
        try:
            response = dashscope.MultiModalConversation.call(  # type: ignore[attr-defined]
                model="qwen3-tts-flash",
                api_key=api_key,
                text=text,
                voice=voice_id,
                language_type=language_type,
                stream=False,
            )
        except Exception as exc:  # pragma: no cover - SDK errors
            log.setdefault("tts_errors", []).append(str(exc))
            continue

        output = getattr(response, "output", None)
        audio = getattr(output, "audio", None)
        url = getattr(audio, "url", None)
        if not isinstance(url, str) or not url:
            log.setdefault("tts_errors", []).append("missing-audio-url")
            continue

        filename = f"{idx:02d}-{_safe_filename(text[:32])}.mp3"
        audio_path = bundle_dir / filename
        if not _download_audio(url, audio_path):
            log.setdefault("tts_errors", []).append("download-failed")
            continue

        success += 1
        entries.append(
            {
                "id": f"paragraph-{idx}",
                "text": text,
                "file": f"/data/ai/airadar/audio/{date_str}/{filename}",
            }
        )

    log["tts_status"] = "success" if success else "error"
    log["tts_voice"] = voice_id
    log["tts_count"] = success
    return {"date": date_str, "voice": voice_id, "segments": entries, "language": language_type}


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

    default_top_k = max(len(raw_items), 12)
    top_k = max(4, _env_int("BRIEFING_TOP_K", default_top_k))
    mode = (os.getenv("BRIEFING_MODE") or "narrative_script").strip() or "narrative_script"
    blacklist = _env_list("BRIEFING_SOURCE_BLACKLIST")
    items = _select_top(raw_items, top_k, blacklist)
    if not items:
        raise SystemExit("no items left after applying filters; adjust BRIEFING_SOURCE_BLACKLIST or data")

    generated_dt = _parse_iso8601(latest.get("generated_at", ""))
    date_str = _bj_date(generated_dt)
    stats = _collect_stats(items)
    prompt_data = _prompt_payload(date_str, mode, items, stats)
    force_template = os.getenv("BRIEFING_FORCE_TEMPLATE", "0").lower() in {"1", "true", "yes"}

    fallback_briefing = _fallback_briefing(date_str, mode, items, stats)

    model_hint = _model_hint()
    llm_status = "pending"
    llm_error = ""
    if force_template:
        llm_status = "skipped-force-template"
    elif not chat_once:
        llm_status = "skipped-no-client"

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
            expected_ids = [it.id for it in items]
            ok, reason = _validate_briefing(briefing, date_str, expected_ids)
            if not ok:
                print(f"[ai-radar] briefing validation failed ({reason}); falling back to template")
                briefing = fallback_briefing
                llm_status = f"validation-failed:{reason}"
                llm_error = reason
            else:
                llm_ok = True
                llm_status = "success"
        except (LLMError, json.JSONDecodeError, ValueError) as exc:
            print(f"[ai-radar] briefing LLM error: {exc}; using template fallback")
            briefing = fallback_briefing
            llm_status = "error"
            llm_error = str(exc)
    else:
        briefing = fallback_briefing
        if llm_status == "pending":
            llm_status = "skipped-unknown"

    paragraphs_for_tts = _script_paragraphs(briefing.get("script") or {})
    initial_ratio = _chinese_ratio(paragraphs_for_tts) if paragraphs_for_tts else 0.0
    non_chinese_fallback = False
    if paragraphs_for_tts and not _is_mostly_chinese(paragraphs_for_tts):
        llm_ok = False
        llm_status = (llm_status or "") + "|non_chinese"
        briefing = fallback_briefing
        non_chinese_fallback = True
        paragraphs_for_tts = _script_paragraphs(briefing.get("script") or {})

    if not isinstance(briefing.get("script_text"), str) or not briefing.get("script_text", "").strip():
        briefing["script_text"] = _compose_script_text(briefing.get("script") or {})
    else:
        # Ensure script_text reflects potential fallback adjustments
        briefing["script_text"] = _compose_script_text(briefing.get("script") or {})

    log = _generation_log(start, llm_ok, items, model_hint)
    log["llm_status"] = llm_status
    log["briefing_source"] = "llm" if llm_ok else "template"
    log["force_template"] = force_template
    if llm_error:
        log["llm_error"] = llm_error
    if non_chinese_fallback:
        log["briefing_source"] = "template-non-chinese"
        log["llm_chinese_ratio"] = initial_ratio
    paragraphs_for_tts = _script_paragraphs(briefing.get("script") or {})
    log["chinese_ratio"] = _chinese_ratio(paragraphs_for_tts) if paragraphs_for_tts else 0.0
    briefing["audio"] = _synthesize_audio(paragraphs_for_tts, date_str, os.getenv("VOICE"), briefing.get("script", {}).get("language", "zh"), log)
    briefing["generation_log"] = log

    output_path = BRIEFINGS_DIR / f"{date_str}.json"
    write_json(output_path, briefing)
    _update_latest_reference(date_str, briefing)
    if llm_ok:
        descriptor = f"llm ({model_hint or 'auto'})"
    else:
        descriptor = f"template fallback ({llm_status})"
    print(f"[ai-radar] briefing source -> {descriptor}")
    if llm_error:
        print(f"[ai-radar] llm detail: {llm_error}")
    print(f"[ai-radar] briefing generated -> {output_path}")


if __name__ == "__main__":
    main()
