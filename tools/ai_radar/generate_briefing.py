# -*- coding: utf-8 -*-
"""Generate AI Radar daily briefing files (host script mode).

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
    BRIEFING_MODE             default "host_script"
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
from collections import Counter, defaultdict
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

REQUIRED_SECTIONS = ["今日大事", "政策/融资", "研究/模型", "工具/产业"]


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


def _fallback_briefing(date_str: str, mode: str, items: List[NewsItem], stats: Dict[str, Any]) -> Dict[str, Any]:
    # Use first 3 items as今日大事; rest go by category buckets.
    leading = items[: min(3, len(items))]
    buckets: Dict[str, List[NewsItem]] = defaultdict(list)
    for it in items:
        buckets[_classify(it)].append(it)
    def _one_line(it: NewsItem) -> str:
        if it.raw_excerpt:
            return _normalize_text(it.raw_excerpt, 96)
        return _normalize_text(it.title, 96)

    def _why(it: NewsItem, section: str) -> str:
        if section == "研究/模型":
            return "突出了模型或方法的新亮点，值得关注实验细节。"
        if section == "政策/融资":
            return "反映政策或资本动向，可能改变行业方向。"
        return "涉及实际落地与工具更新，对业务有直接影响。"

    sections_payload: List[Dict[str, Any]] = []
    # 今日大事
    sections_payload.append(
        {
            "title": "今日大事",
            "items": [
                {
                    "id": it.id,
                    "one_liner": _one_line(it),
                    "why_it_matters": "焦点事件，建议优先了解要点。",
                    "next_step": _default_next_step(_classify(it)),
                }
                for it in leading
            ],
        }
    )
    for label, _ in CATEGORY_RULES:
        entries = []
        for it in buckets.get(label, []):
            entries.append(
                {
                    "id": it.id,
                    "one_liner": _one_line(it),
                    "why_it_matters": _why(it, label),
                    "next_step": _default_next_step(label),
                }
            )
        sections_payload.append({"title": label, "items": entries})

    deep_source = max(items, key=lambda it: (len(it.raw_excerpt), it.hotness), default=None)
    deep_payload = {
        "id": deep_source.id if deep_source else (items[0].id if items else ""),
        "why_read": _normalize_text(
            (deep_source.raw_excerpt if deep_source else "重点条目，建议完整阅读原文。"), 180
        )
        or "重点条目，建议完整阅读原文。",
        "counterpoint": "同时关注潜在风险与局限，避免过度解读。",
        "takeaway": "带走一个关键结论，帮助指导接下来的决策。",
    }
    host_counter: Counter[str] = stats.get("host_counter") or Counter()
    top_host = host_counter.most_common(1)[0][0] if host_counter else "重点来源"
    outro = {
        "tomorrow_watch": f"关注 {top_host} 及相关发布节奏，可能还有后续更新。",
        "call_to_action": "收藏导读卡片或订阅邮件，次日快速掌握重点。",
    }
    themes = [
        {"topic": label, "one_line": THEME_LINES.get(label, "持续跟进相关进展。")}
        for label, _ in (stats.get("section_counter") or Counter()).most_common(2)
    ]
    if not themes:
        themes = [{"topic": "行业动态", "one_line": "关注行业与工具落地的最新动向。"}]
    return {
        "date": date_str,
        "mode": mode,
        "meta": {
            "hotness_delta": _hotness_delta(items),
            "themes": themes,
            "length_sec_estimate": 120,
        },
        "sections": sections_payload,
        "deep_dive": deep_payload,
        "outro": outro,
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
            "mode": "host_script",
            "meta.hotness_delta": "字符串，带百分号或≈0%",
            "meta.themes": "数组，两条主题脉络",
            "sections": [
                "今日大事",
                "政策/融资",
                "研究/模型",
                "工具/产业",
            ],
        },
    }


def _build_prompt(data: Dict[str, Any]) -> str:
    return (
        "你是一名专业的科技新闻编辑，需要输出主持人播报手稿。\n"
        "请仔细阅读提供的新闻列表，只能基于输入事实改写。\n"
        "输出必须是严格 JSON，禁止添加代码块或额外文字。\n"
        "结构包括：meta、sections（含今日大事/政策/融资/研究/模型/工具/产业）、deep_dive、outro。\n"
        "每条 items 需给出 one_liner、why_it_matters、next_step。\n"
        "中文输出，语气稳重、通俗、避免夸张。\n"
        "若事实不足，请使用模糊表述，不得捏造数字。\n"
        f"输入：{json.dumps(data, ensure_ascii=False)}"
    )


def _validate_briefing(payload: Dict[str, Any], date_str: str) -> Tuple[bool, str]:
    if not isinstance(payload, dict):
        return False, "payload-not-dict"
    if payload.get("date") != date_str:
        return False, "date-mismatch"
    if "sections" not in payload or not isinstance(payload["sections"], list):
        return False, "sections-missing"
    needed = {"今日大事", "政策/融资", "研究/模型", "工具/产业"}
    existing = {sec.get("title") for sec in payload["sections"] if isinstance(sec, dict)}
    if not needed.issubset(existing):
        return False, "sections-incomplete"
    deep = payload.get("deep_dive", {})
    if not isinstance(deep, dict) or not deep.get("id"):
        return False, "deep_dive-missing"
    outro = payload.get("outro", {})
    if not isinstance(outro, dict):
        return False, "outro-invalid"
    return True, "ok"


def _deep_copy(data: Dict[str, Any]) -> Dict[str, Any]:
    return json.loads(json.dumps(data, ensure_ascii=False))


def _merge_briefings(primary: Dict[str, Any], fallback: Dict[str, Any]) -> Dict[str, Any]:
    base = _deep_copy(fallback)

    def _merge_dict(dst: Dict[str, Any], src: Dict[str, Any]) -> None:
        for key, value in (src or {}).items():
            if isinstance(value, dict) and isinstance(dst.get(key), dict):
                _merge_dict(dst[key], value)
            else:
                dst[key] = value

    if isinstance(primary, dict):
        if primary.get("meta"):
            if "meta" not in base or not isinstance(base["meta"], dict):
                base["meta"] = {}
            _merge_dict(base["meta"], primary.get("meta") or {})
        if primary.get("deep_dive"):
            base["deep_dive"] = primary.get("deep_dive")
        if primary.get("outro"):
            if "outro" not in base or not isinstance(base["outro"], dict):
                base["outro"] = {}
            _merge_dict(base["outro"], primary.get("outro") or {})

    fallback_sections = {sec.get("title"): sec for sec in base.get("sections", []) if isinstance(sec, dict)}
    primary_sections = {}
    if isinstance(primary, dict):
        for sec in primary.get("sections", []) or []:
            if isinstance(sec, dict) and sec.get("title"):
                primary_sections[sec["title"]] = sec

    merged_sections: List[Dict[str, Any]] = []
    for title in REQUIRED_SECTIONS:
        sec = _deep_copy(fallback_sections.get(title, {"title": title, "items": []}))
        if title in primary_sections:
            cand = primary_sections[title]
            if isinstance(cand.get("items"), list):
                sec["items"] = cand["items"]
            else:
                sec["items"] = []
        merged_sections.append(sec)

    # Preserve additional sections provided by the LLM (if any)
    for title, sec in primary_sections.items():
        if title in REQUIRED_SECTIONS:
            continue
        merged_sections.append(sec)

    base["sections"] = merged_sections

    deep = base.get("deep_dive")
    if not isinstance(deep, dict) or not deep.get("id"):
        base["deep_dive"] = fallback.get("deep_dive")

    base["date"] = primary.get("date") or fallback.get("date")
    base["mode"] = primary.get("mode") or fallback.get("mode")
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
    ref = {
        "date": date_str,
        "url": f"/data/ai/airadar/briefings/{date_str}.json",
        "sections": [sec.get("title") for sec in briefing.get("sections", []) if isinstance(sec, dict) and sec.get("title")],
        "deep_dive_id": (briefing.get("deep_dive") or {}).get("id", ""),
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
    mode = (os.getenv("BRIEFING_MODE") or "host_script").strip() or "host_script"
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

    log = _generation_log(start, llm_ok, items, _model_hint())
    briefing["generation_log"] = log

    output_path = BRIEFINGS_DIR / f"{date_str}.json"
    write_json(output_path, briefing)
    _update_latest_reference(date_str, briefing)
    print(f"[ai-radar] briefing generated -> {output_path}")


if __name__ == "__main__":
    main()
