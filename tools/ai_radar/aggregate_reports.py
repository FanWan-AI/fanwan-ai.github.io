import json, os, re, sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

# Ensure project root on sys.path for importing tools.ai_llm and to find .env
_HERE = Path(__file__).resolve()
ROOT = _HERE.parent
for candidate in [_HERE.parent] + list(_HERE.parents):
    if (candidate / 'tools' / 'ai_llm.py').exists():
        ROOT = candidate
        break
else:
    ROOT = _HERE.parents[2]  # fallback guess

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

def _load_env_dotenv(path: Path) -> None:
    if not path.exists():
        return
    try:
        for raw in path.read_text(encoding='utf-8').splitlines():
            s = raw.strip()
            if not s or s.startswith('#'):
                continue
            if '=' not in s:
                continue
            k, v = s.split('=', 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and not os.getenv(k):
                os.environ.setdefault(k, v)
    except Exception:
        pass

_load_env_dotenv(ROOT / '.env')

# If caller set a translation timeout, propagate to ai_llm default read-timeout BEFORE import
if os.getenv('RADAR_TRANSLATE_TIMEOUT') and not os.getenv('LLM_READ_TIMEOUT'):
    os.environ['LLM_READ_TIMEOUT'] = os.getenv('RADAR_TRANSLATE_TIMEOUT', '180')

try:
    # Optional LLM translator
    from tools.ai_llm import chat_once  # type: ignore
except Exception:
    chat_once = None

from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent
# find repo root
REPO_ROOT = BASE_DIR
for _ in range(6):
    if (REPO_ROOT / '.git').exists() or (REPO_ROOT / 'README.md').exists():
        break
    if REPO_ROOT.parent == REPO_ROOT:
        break
    REPO_ROOT = REPO_ROOT.parent
OUT_DIR = str(REPO_ROOT.joinpath('data', 'ai', 'airadar'))
TMP_PATH = os.path.join(OUT_DIR, '_events_tmp.json')
LATEST_PATH = os.path.join(OUT_DIR, 'latest.json')
DATES_INDEX = os.path.join(OUT_DIR, 'dates.json')
BRIEFINGS_DIR = Path(OUT_DIR) / 'briefings'

WINDOW_HOURS = int(os.getenv('RADAR_WINDOW_HOURS', '48'))
MAX_ITEMS = int(os.getenv('RADAR_MAX_ITEMS', '80'))

now = datetime.now(timezone.utc)

with open(TMP_PATH, 'r', encoding='utf-8') as f:
    payload = json.load(f)

items = payload.get('items', [])

threshold = now - timedelta(hours=WINDOW_HOURS)

def within_window(iso):
    try:
        dt = datetime.fromisoformat(iso.replace('Z', '+00:00'))
        return dt >= threshold
    except Exception:
        return True

filtered = [it for it in items if within_window(it.get('published_at',''))]
filtered.sort(key=lambda x: x.get('published_at',''), reverse=True)

# --- Additional AI-topic filtering (post-fetch, pre-scoring) ---
AI_KEYWORDS = re.compile(r"\b(ai|artificial intelligence|machine learning|ml|deep learning|llm|gpt|chatgpt|diffusion|gen(erative)?|transformer|rag|retriev|agent|vision|lora|fine[- ]?tune|sora|gemini|copilot|cuda|nvidia|hugging face|openai|deepmind|multimodal|alignment)\b", re.I)

EXCLUDE_NOISE = re.compile(r"(招聘|体育|票务|打折|折扣|旅行|旅游|八卦|明星|影评|综艺)", re.I)

def _is_ai_story(it: dict) -> bool:
    title = (it.get('title') or '')
    ex = (it.get('raw_excerpt') or '')
    # Require keyword in title or excerpt
    if not (AI_KEYWORDS.search(title) or AI_KEYWORDS.search(ex)):
        return False
    # Exclude obvious non-tech noise words
    if EXCLUDE_NOISE.search(title) or EXCLUDE_NOISE.search(ex):
        return False
    # HN frontpage: keep stricter requirement already enforced by fetcher; here we just pass
    return True

def _clean_hn_excerpt(text: str) -> str:
    if not text:
        return ''
    s = re.sub(r'<[^>]+>', ' ', str(text))
    s = re.sub(r"Article URL:\s*\S+", '', s, flags=re.I)
    s = re.sub(r"Comments URL:\s*\S+", '', s, flags=re.I)
    s = re.sub(r"Points:\s*\d+", '', s, flags=re.I)
    s = re.sub(r"#\s*Comments:\s*\d+", '', s, flags=re.I)
    s = re.sub(r"\s{2,}", ' ', s).strip()
    return s

FETCH_PREVIEWS = os.getenv('RADAR_FETCH_PREVIEW', '1').lower() in ('1', 'true', 'yes')
PREVIEW_MAX = int((os.getenv('RADAR_PREVIEW_MAX', '') or '12').split('#')[0] or 12)
PREVIEW_MIN_LEN = int((os.getenv('RADAR_PREVIEW_MIN_LEN', '') or '60').split('#')[0] or 60)
PREVIEW_TIMEOUT = float(os.getenv('RADAR_PREVIEW_TIMEOUT', '6') or 6)
PREVIEW_DENY = tuple(filter(None, [h.strip().lower() for h in os.getenv('RADAR_PREVIEW_DENY', 'youtube.com,youtu.be,apps.apple.com,github.com,twitter.com,x.com,instagram.com').split(',')]))
PREVIEW_UA = os.getenv('RADAR_PREVIEW_UA', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')

_preview_session = None
_preview_cache = {}

def _preview_session_instance():
    global _preview_session
    if _preview_session is None:
        sess = requests.Session()
        sess.headers.update({
            'User-Agent': PREVIEW_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8'
        })
        _preview_session = sess
    return _preview_session

def _normalize_preview(text: str) -> str:
    if not text:
        return ''
    cleaned = re.sub(r'\s+', ' ', str(text)).strip()
    return cleaned[:480]

def _extract_preview_from_html(html: str) -> str:
    if not html:
        return ''
    soup = BeautifulSoup(html, 'html.parser')
    candidates = []
    meta_props = (
        ('property', 'og:description'),
        ('name', 'description'),
        ('name', 'og:description'),
        ('name', 'twitter:description'),
        ('itemprop', 'description'),
    )
    for attr, value in meta_props:
        tag = soup.find('meta', attrs={attr: value})
        if tag and tag.get('content'):
            candidates.append(tag['content'])
    def _collect_from(node, limit=5):
        if not node:
            return
        for p in node.find_all('p', limit=limit):
            text = p.get_text(' ', strip=True)
            if len(text) >= PREVIEW_MIN_LEN:
                candidates.append(text)
    _collect_from(soup.find('article'), limit=6)
    _collect_from(soup.find('main'), limit=5)
    if not candidates:
        for p in soup.find_all('p', limit=6):
            text = p.get_text(' ', strip=True)
            if len(text) >= PREVIEW_MIN_LEN:
                candidates.append(text)
                break
    for cand in candidates:
        norm = _normalize_preview(cand)
        if len(norm) >= PREVIEW_MIN_LEN:
            return norm
    if candidates:
        return _normalize_preview(candidates[0])
    return ''

def _should_fetch_preview(it: dict) -> bool:
    raw = (it.get('raw_excerpt') or '').strip()
    if len(raw) >= PREVIEW_MIN_LEN:
        return False
    url = it.get('url') or ''
    try:
        host = (urlparse(url).hostname or '').lower()
    except Exception:
        host = ''
    if any(block in host for block in PREVIEW_DENY):
        return False
    return bool(url)

def _fetch_preview(it: dict) -> str:
    url = it.get('url') or ''
    if not url:
        return ''
    if url in _preview_cache:
        return _preview_cache[url]
    try:
        sess = _preview_session_instance()
        resp = sess.get(url, timeout=PREVIEW_TIMEOUT, allow_redirects=True)
        ctype = resp.headers.get('Content-Type', '')
        if resp.status_code >= 400 or ('text/html' not in ctype.lower() and 'application/xhtml+xml' not in ctype.lower()):
            _preview_cache[url] = ''
            return ''
        text = _extract_preview_from_html(resp.text)
        _preview_cache[url] = text
        return text
    except Exception as exc:
        _preview_cache[url] = ''
        print(f"[ai-radar] preview fetch failed: {url} ({exc})")
        return ''

def _strip_code_fence(text: str) -> str:
    if not text:
        return ''
    t = text.strip()
    if t.startswith('```') and t.endswith('```'):
        t = re.sub(r'^```[a-zA-Z]*', '', t, count=1).strip()
        if t.endswith('```'):
            t = t[:-3]
    return t.strip()

def _summarize_with_llm(it: dict) -> dict:
    if FAKE_TRANSLATE:
        base = (it.get('title') or '').strip() or '测试摘要'
        return {
            'summary_en': f'[test-summary] {base}',
            'summary_zh': f'（测试摘要）{base}'
        }
    if not DO_TRANSLATE or not chat_once:
        return {}
    title = (it.get('title') or '').strip()
    url = it.get('url') or ''
    known = (it.get('raw_excerpt') or '').strip()
    site = ''
    try:
        site = (it.get('source', {}) or {}).get('site') or urlparse(url).netloc or ''
    except Exception:
        site = ''
    payload = {
        'title': title,
        'source': site,
        'url': url,
        'published_at': it.get('published_at'),
        'known_excerpt': known,
    }
    prompt = (
        "你是一名专业的科技新闻编辑，需要为网站生成摘要。"
        "请优先生成简体中文摘要，同时给出英文摘要。"
        "如果能够访问链接，请综合文章内容；否则基于已有信息做出最合理的概括，但不要明确说明无法访问。"
        "保持事实准确，避免捏造具体数字。"
        "\n输出严格 JSON（不使用代码块、不添加多余文本）：\n"
        "{\"summary_zh\": \"中文摘要，2-3 句\", \"summary_en\": \"English summary, 1-2 sentences\"}\n\n"
        f"文章信息：{json.dumps(payload, ensure_ascii=False)}"
    )
    try:
        raw = chat_once(prompt, system='You generate concise, high-accuracy news summaries.', temperature=0.15, max_tokens=SUMMARY_MAX_TOKENS, want_json=True)
    except Exception as exc:
        print(f"[ai-radar] summary LLM error for {url}: {exc}")
        return {}
    text = _strip_code_fence(raw)
    try:
        data = json.loads(text)
    except Exception:
        try:
            data = json.loads(text.replace('\n', '').replace('\r', ''))
        except Exception:
            print(f"[ai-radar] failed to parse summary JSON: {raw[:180]}")
            return {}
    if not isinstance(data, dict):
        return {}
    return data

# Clean excerpts and filter to AI stories
for it in filtered:
    it['raw_excerpt'] = _clean_hn_excerpt(it.get('raw_excerpt') or '')
filtered = [it for it in filtered if _is_ai_story(it)]

if FETCH_PREVIEWS and filtered:
    targets = [it for it in filtered if _should_fetch_preview(it)]
    targets.sort(key=lambda x: x.get('published_at', ''), reverse=True)
    fetched = 0
    for it in targets:
        if fetched >= PREVIEW_MAX:
            break
        preview = _fetch_preview(it)
        if preview:
            it['raw_excerpt'] = preview
            fetched += 1
    if fetched:
        print(f"[ai-radar] enriched {fetched} items with preview summaries")

# --- Optional i18n translation for Top K items to control cost ---
TOP_TRANSLATE = (os.getenv('RADAR_TRANSLATE_TOP', '') or '').strip().lower()
TRANSLATE_ALL = os.getenv('RADAR_TRANSLATE_ALL', '1').lower() in ('1','true','yes')
FAKE_TRANSLATE = os.getenv('RADAR_FAKE_TRANSLATE', '0').lower() in ('1','true','yes')
TRANSLATE_EXCERPTS = os.getenv('RADAR_TRANSLATE_EXCERPTS', '1').lower() in ('1','true','yes')
_HAS_ANY_LLM_KEY = any([
    bool(os.getenv('DEEPSEEK_API_KEY')),
    bool(os.getenv('OPENAI_API_KEY')),
    bool(os.getenv('OPENROUTER_API_KEY')),
    bool(os.getenv('TOGETHER_API_KEY')),
    bool(os.getenv('DASHSCOPE_API_KEY')),
])
DO_TRANSLATE = (
    os.getenv('RADAR_DO_TRANSLATE', '1').lower() in ('1','true','yes')
    and (FAKE_TRANSLATE or (bool(chat_once) and _HAS_ANY_LLM_KEY))
)
CAN_SUMMARIZE = FAKE_TRANSLATE or (bool(chat_once) and _HAS_ANY_LLM_KEY)


def _int_env(name: str, default: int) -> int:
    """Parse integer env vars robustly: tolerate inline comments and non-numeric tails."""
    raw = os.getenv(name, '')
    try:
        s = (raw or '').strip()
        # Keep only the first integer in the string, ignore inline comments
        m = re.search(r"\d+", s)
        return int(m.group(0)) if m else int(default)
    except Exception:
        return int(default)

SUMMARIZE_MISSING = os.getenv('RADAR_SUMMARIZE_MISSING', '1').lower() in ('1','true','yes')
SUMMARY_LIMIT = _int_env('RADAR_SUMMARIZE_LIMIT', 16)
SUMMARY_MAX_TOKENS = _int_env('RADAR_SUMMARIZE_MAX_TOKENS', 480)
SUMMARY_TRIGGER_LEN = _int_env('RADAR_SUMMARY_TRIGGER_LEN', 48)

def _looks_cjk(s: str) -> bool:
    try:
        return bool(re.search(r'[\u3400-\u9fff]', s or ''))
    except Exception:
        return False


def _needs_summary(it: dict) -> bool:
    base_excerpt = (it.get('raw_excerpt') or '').strip()
    bundle = it.get('excerpt_i18n') or {}
    zh = (bundle.get('zh') or '').strip()
    en = (bundle.get('en') or '').strip()
    if zh and len(zh) >= SUMMARY_TRIGGER_LEN:
        return False
    if base_excerpt and len(base_excerpt) >= SUMMARY_TRIGGER_LEN:
        return False
    if en and len(en) >= SUMMARY_TRIGGER_LEN:
        return False
    title = (it.get('title') or '').strip()
    if _looks_cjk(title) or _looks_cjk(base_excerpt):
        return False
    return True

def _translate_pair(text: str, src_lang: str, tgt_lang: str) -> str:
    if not DO_TRANSLATE:
        return ''
    t = (text or '').strip()
    if not t or src_lang == tgt_lang:
        return ''
    # Local fake mode for verification without API keys
    if FAKE_TRANSLATE:
        if (src_lang, tgt_lang) == ('en','zh'):
            return f"（测试译）{t}"
        if (src_lang, tgt_lang) == ('en','es'):
            return f"[ES test] {t}"
        if (src_lang, tgt_lang) == ('zh','en'):
            return f"[EN test] {t}"
        if (src_lang, tgt_lang) == ('zh','es'):
            return f"[ES test] {t}"
        if (src_lang, tgt_lang) == ('es','zh'):
            return f"（测试译）{t}"
        if (src_lang, tgt_lang) == ('es','en'):
            return f"[EN test] {t}"
        return f"[TEST {src_lang}->{tgt_lang}] {t}"
    # Truncate to keep calls cheap and avoid provider limits
    limit = 220 if len(t) > 220 and (src_lang != 'zh' or tgt_lang != 'en') else 500
    t = t[:limit]
    prompts = {
        ('en','zh'): '将以下英文文本译为「简体中文」，语言简洁自然，保留事实与数字。不要加引号、不要解释、不要双语，只输出译文：\n\n',
        ('en','es'): 'Traduce el siguiente texto del inglés al español (es-ES) en un estilo natural y fiel. Conserva hechos y números. No añadas comillas ni explicaciones; devuelve solo la traducción:\n\n',
        ('zh','en'): 'Translate the following Chinese text into concise, fluent English. Preserve facts and numbers. No quotes or explanations; return only the translation.\n\n',
        ('zh','es'): 'Traduce el siguiente texto chino al español (es-ES) de manera concisa y natural. Conserva hechos y números. No añadas comillas ni explicaciones; devuelve solo la traducción:\n\n',
    }
    key = (src_lang, tgt_lang)
    prefix = prompts.get(key)
    if not prefix:
        # Best-effort via English pivot
        if src_lang == 'zh' and tgt_lang == 'es':
            mid = _translate_pair(t, 'zh', 'en')
            return _translate_pair(mid, 'en', 'es') if mid else ''
        if src_lang == 'es' and tgt_lang == 'zh':
            mid = _translate_pair(t, 'es', 'en')
            return _translate_pair(mid, 'en', 'zh') if mid else ''
        return ''
    def _once() -> str:
        mt = _int_env('RADAR_TRANSLATE_MAX_TOKENS', 900)
        return (chat_once(prefix + t, system='You are a precise translator.', temperature=0.0, max_tokens=mt) or '').strip()
    try:
        out = _once()
        if not out:
            # one quick retry
            out = _once()
        return out
    except Exception as e:
        print(f"[ai-radar] translate error {src_lang}->{tgt_lang}: {e}")
        return ''

def _host_weight(host: str) -> float:
    h = (host or '').lower()
    weights = {
        'openai.com': 1.6, 'ai.googleblog.com': 1.5, 'huggingface.co': 1.4,
        'jiqizhixin.com': 1.25, 'qbitai.com': 1.2, 'technologyreview.com': 1.2,
        'techcrunch.com': 1.1, 'theverge.com': 1.05,
        'arxiv.org': 1.3, 'github.com': 1.25,
    }
    for k, v in weights.items():
        if k in h:
            return v
    return 1.0

def _hotness(it: dict) -> float:
    # Time decay (48h half-life)
    try:
        dt = datetime.fromisoformat((it.get('published_at','') or '').replace('Z','+00:00'))
    except Exception:
        dt = now
    age_h = max(0.0, (now - dt).total_seconds() / 3600.0)
    decay = 0.5 ** (age_h / 48.0)
    # Source weight
    host = ''
    try:
        from urllib.parse import urlparse
        host = (urlparse(it.get('url','')).hostname or '')
    except Exception:
        pass
    w = _host_weight(host)
    # Interaction (HN points, GH stars if present)
    blob = (it.get('raw_excerpt') or '')
    m = re.search(r'Points:\s*(\d+)', blob)
    points = int(m.group(1)) if m else 0
    score = decay * w * (1.0 + min(points, 500) / 120.0)
    return float(f"{score:.6f}")

# Compute hotness and attach
for it in filtered:
    it['hotness'] = _hotness(it)

# --- Build latest.json candidate set with 48h de-duplication vs recent daily archives ---
def _load_recent_archive_ids(n_days: int = 2):
    seen_ids, seen_urls = set(), set()
    try:
        if os.path.exists(DATES_INDEX):
            with open(DATES_INDEX, 'r', encoding='utf-8') as f:
                dates = json.load(f)
                if isinstance(dates, list):
                    dates = dates[:n_days]
                else:
                    dates = []
        else:
            dates = []
    except Exception:
        dates = []
    for d in dates:
        p = os.path.join(OUT_DIR, f"{d}.json")
        if not os.path.exists(p):
            continue
        try:
            data = json.load(open(p, 'r', encoding='utf-8'))
            for it in data.get('items', []):
                if it.get('id'):
                    seen_ids.add(it['id'])
                if it.get('url'):
                    seen_urls.add(it['url'])
        except Exception:
            pass
    return seen_ids, seen_urls

_seen_ids, _seen_urls = _load_recent_archive_ids(2)

def _is_new_item(it: dict) -> bool:
    i = it.get('id')
    u = it.get('url')
    return (i not in _seen_ids) and (u not in _seen_urls)

# Split candidates into new vs previously shown, then order by recency within each bucket
new_items = [it for it in filtered if _is_new_item(it)]
shown_items = [it for it in filtered if not _is_new_item(it)]
new_items.sort(key=lambda x: x.get('published_at',''), reverse=True)
shown_items.sort(key=lambda x: x.get('published_at',''), reverse=True)
final_items = (new_items + shown_items)[:MAX_ITEMS]

# Translate top K by hotness if needed
if filtered and DO_TRANSLATE:
    # Decide translate scope: all or top by hotness, but ALWAYS include zh-base items for zh->en reliability
    if TRANSLATE_ALL or TOP_TRANSLATE in ('all','0','-1',''):
        targets = list(filtered)
    else:
        try:
            k = int(TOP_TRANSLATE)
        except Exception:
            k = 12
        topk = sorted(filtered, key=lambda x: x.get('hotness', 0), reverse=True)[:max(1,k)]
        zh_base = [it for it in filtered if _looks_cjk((it.get('title') or '')) or _looks_cjk((it.get('raw_excerpt') or ''))]
        # de-dup while preserving order preference: zh_base first to guarantee coverage
        seen = set()
        targets = []
        for it in zh_base + topk:
            key = it.get('id') or it.get('url') or it.get('title')
            if key in seen:
                continue
            seen.add(key)
            targets.append(it)
    print(f"[ai-radar] translation enabled; targets={len(targets)}/{len(filtered)} (all={TRANSLATE_ALL or TOP_TRANSLATE in ('all','0','-1','')})")

    zh_ok = es_ok = en_ok = 0
    for it in targets:
        title = (it.get('title') or '').strip()
        ex = (it.get('raw_excerpt') or '').strip()
        ti = it.setdefault('title_i18n', {})
        ei = it.setdefault('excerpt_i18n', {})
        # Normalize suspicious prefilled values: if 'en' looks CJK or equals zh title, clear it to allow translation
        try:
            if ti.get('en') and (_looks_cjk(ti['en']) or ti['en'].strip() == (ti.get('zh') or '').strip()):
                ti.pop('en', None)
            if ei.get('en') and (_looks_cjk(ei['en']) or ei['en'].strip() == (ei.get('zh') or '').strip()):
                ei.pop('en', None)
        except Exception:
            pass
        # Detect source language (CJK heuristic on title or excerpt)
        src_is_zh = _looks_cjk(title) or _looks_cjk(ex)
        if src_is_zh:
            # Ensure zh
            ti.setdefault('zh', title)
            ei.setdefault('zh', ex)
            # Translate to en
            if not ti.get('en') or _looks_cjk(ti.get('en','')) or ti.get('en','').strip()==title.strip():
                en_t = _translate_pair(title, 'zh', 'en')
                if en_t and not _looks_cjk(en_t) and en_t.lower() != title.lower():
                    ti['en'] = en_t; en_ok += 1
            if TRANSLATE_EXCERPTS and ex and not ei.get('en'):
                en_e = _translate_pair(ex, 'zh', 'en')
                if en_e and not _looks_cjk(en_e) and en_e.lower() != ex.lower():
                    ei['en'] = en_e
            # Translate to es (via zh->es direct or pivot)
            if not ti.get('es'):
                es_t = _translate_pair(title, 'zh', 'es')
                if es_t and not _looks_cjk(es_t) and es_t.lower() != title.lower():
                    ti['es'] = es_t; es_ok += 1
            if TRANSLATE_EXCERPTS and ex and not ei.get('es'):
                es_e = _translate_pair(ex, 'zh', 'es')
                if es_e and not _looks_cjk(es_e) and es_e.lower() != ex.lower():
                    ei['es'] = es_e
        else:
            # Source is English (or non-CJK) → ensure en
            ti.setdefault('en', title)
            ei.setdefault('en', ex)
            # Translate to zh
            if not ti.get('zh') or (_looks_cjk(title) and ti.get('zh','').strip()==title.strip()):
                zh_t = _translate_pair(title, 'en', 'zh')
                if zh_t and _looks_cjk(zh_t) and zh_t != title:
                    ti['zh'] = zh_t; zh_ok += 1
            if TRANSLATE_EXCERPTS and ex and not ei.get('zh'):
                zh_e = _translate_pair(ex, 'en', 'zh')
                if zh_e and _looks_cjk(zh_e) and zh_e != ex:
                    ei['zh'] = zh_e
            # Translate to es
            if not ti.get('es'):
                es_t = _translate_pair(title, 'en', 'es')
                if es_t and not _looks_cjk(es_t) and es_t.lower() != title.lower():
                    ti['es'] = es_t; es_ok += 1
            if TRANSLATE_EXCERPTS and ex and not ei.get('es'):
                es_e = _translate_pair(ex, 'en', 'es')
                if es_e and not _looks_cjk(es_e) and es_e.lower() != ex.lower():
                    ei['es'] = es_e
    print(f"[ai-radar] translation results: zh_titles={zh_ok}, es_titles={es_ok}, en_titles={en_ok}")
elif filtered and not DO_TRANSLATE:
    reason = 'no LLM key or adapter unavailable'
    if os.getenv('RADAR_DO_TRANSLATE','1').lower() not in ('1','true','yes'):
        reason = 'RADAR_DO_TRANSLATE disabled'
    print(f"[ai-radar] translation disabled: {reason}")

# --- Summaries via LLM for items missing excerpts ---
if SUMMARIZE_MISSING and CAN_SUMMARIZE and filtered and SUMMARY_LIMIT > 0:
    summary_candidates = [it for it in filtered if _needs_summary(it)]
    if summary_candidates:
        summary_candidates.sort(key=lambda x: x.get('published_at', ''), reverse=True)
        taken = 0
        for it in summary_candidates:
            if taken >= SUMMARY_LIMIT:
                break
            data = _summarize_with_llm(it)
            if not data:
                continue
            zh = (data.get('summary_zh') or '').strip()
            en = (data.get('summary_en') or '').strip()
            bundle = it.setdefault('excerpt_i18n', {})
            if zh:
                bundle['zh'] = zh
            if en:
                bundle.setdefault('en', en)
            if en and not (it.get('raw_excerpt') or '').strip():
                it['raw_excerpt'] = en
            if zh or en:
                taken += 1
        if taken:
            print(f"[ai-radar] generated LLM summaries for {taken} items (limit {SUMMARY_LIMIT})")
elif SUMMARIZE_MISSING and filtered and SUMMARY_LIMIT > 0 and not CAN_SUMMARIZE:
    print("[ai-radar] summarization skipped: no LLM provider configured")

# Ensure tri-language alignment without faking translations: only set base language
for it in filtered:
    ti = it.setdefault('title_i18n', {})
    ei = it.setdefault('excerpt_i18n', {})
    base_title = (it.get('title') or '').strip()
    base_excerpt = (it.get('raw_excerpt') or '').strip()
    src_is_zh = _looks_cjk(base_title) or _looks_cjk(base_excerpt)
    if src_is_zh:
        if not ti.get('zh'):
            ti['zh'] = base_title
        if not ei.get('zh'):
            ei['zh'] = base_excerpt
        # Do not backfill en/es here; leave empty if translation failed
    else:
        if not ti.get('en'):
            ti['en'] = base_title
        if not ei.get('en'):
            ei['en'] = base_excerpt
        # Do not backfill zh/es here; leave empty if translation failed

out = {
    'generated_at': now.isoformat().replace('+00:00','Z'),
    'window_hours': WINDOW_HOURS,
    'count': len(final_items),
    'items': final_items
}

def _briefing_reference(date_str: str):
    path = BRIEFINGS_DIR / f'{date_str}.json'
    if not path.exists():
        return None
    try:
        with path.open('r', encoding='utf-8') as fh:
            data = json.load(fh)
    except Exception:
        return None
    script = data.get('script') if isinstance(data, dict) else None
    segments = script.get('segments') if isinstance(script, dict) else None
    segment_ids = []
    if isinstance(segments, list):
        for seg in segments:
            if isinstance(seg, dict) and seg.get('id'):
                segment_ids.append(seg['id'])
    sections = []
    for sec in data.get('sections', []) or []:
        if isinstance(sec, dict) and sec.get('title'):
            sections.append(sec['title'])
    deep_id = ''
    if segment_ids:
        deep_id = segment_ids[0]
    else:
        try:
            deep_id = (data.get('deep_dive') or {}).get('id') or ''
        except Exception:
            deep_id = ''
    return {
        'date': date_str,
        'url': f"/data/ai/airadar/briefings/{date_str}.json",
        'sections': sections,
        'segments': segment_ids,
        'mode': data.get('mode', ''),
        'deep_dive_id': deep_id,
    }

brief_date = (now + timedelta(hours=8)).strftime('%Y-%m-%d')
ref = _briefing_reference(brief_date)
if ref:
    out['briefing'] = ref

with open(LATEST_PATH, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f"[ai-radar] latest.json generated: {out['count']} items -> {LATEST_PATH}")

def _merge_item(existing: dict, fresh: dict) -> None:
    if existing is fresh:
        return
    for key, value in (fresh or {}).items():
        if key in ('title_i18n', 'excerpt_i18n'):
            if not isinstance(value, dict):
                continue
            dest = existing.setdefault(key, {})
            if not isinstance(dest, dict):
                existing[key] = value
                continue
            for lang, text in value.items():
                if text or lang not in dest:
                    dest[lang] = text
            continue
        if isinstance(value, dict) and isinstance(existing.get(key), dict):
            dest = existing.setdefault(key, {})
            dest.update(value)
            continue
        if value is not None:
            existing[key] = value

# Helper to compute Beijing date string for an ISO8601 timestamp
def _bj_date_str(iso: str) -> str:
    try:
        dt = datetime.fromisoformat((iso or '').replace('Z', '+00:00'))
    except Exception:
        dt = now
    bj = dt + timedelta(hours=8)
    return bj.strftime('%Y-%m-%d')

# Partition and write daily archives by Beijing date (no cross-day duplication)
by_date = {}
for it in filtered:
    d = _bj_date_str(it.get('published_at', ''))
    by_date.setdefault(d, []).append(it)

# Sort items per date
for d, arr in by_date.items():
    arr.sort(key=lambda x: x.get('published_at',''), reverse=True)

# Write each daily file and maintain dates index
dates = []
if os.path.exists(DATES_INDEX):
    try:
        with open(DATES_INDEX, 'r', encoding='utf-8') as f:
            dates = json.load(f)
            if not isinstance(dates, list):
                dates = []
    except Exception:
        dates = []

for d, arr in by_date.items():
    # Merge-or-append with existing daily file if present; refresh metadata/translations when re-seen
    daily_path = os.path.join(OUT_DIR, f'{d}.json')
    existing_items = []
    if os.path.exists(daily_path):
        try:
            prev = json.load(open(daily_path, 'r', encoding='utf-8'))
            if isinstance(prev, dict) and isinstance(prev.get('items'), list):
                existing_items = prev.get('items') or []
        except Exception:
            existing_items = []
    by_id = {}
    by_url = {}
    for idx, existing in enumerate(existing_items):
        key_id = existing.get('id')
        key_url = existing.get('url')
        if key_id:
            by_id[key_id] = idx
        if key_url:
            by_url[key_url] = idx

    new_unique = []
    refreshed = 0
    for it in arr:
        idx = None
        key_id = it.get('id')
        key_url = it.get('url')
        if key_id and key_id in by_id:
            idx = by_id[key_id]
        elif key_url and key_url in by_url:
            idx = by_url[key_url]
        if idx is not None:
            _merge_item(existing_items[idx], it)
            refreshed += 1
            continue
        existing_items.append(it)
        idx = len(existing_items) - 1
        if key_id:
            by_id[key_id] = idx
        if key_url:
            by_url[key_url] = idx
        new_unique.append(it)

    combined = existing_items
    daily_out = {
        'generated_at': now.isoformat().replace('+00:00','Z'),
        'window_hours': WINDOW_HOURS,
        'count': len(combined),
        'items': combined
    }
    daily_ref = _briefing_reference(d)
    if daily_ref:
        daily_out['briefing'] = daily_ref
    with open(daily_path, 'w', encoding='utf-8') as f:
        json.dump(daily_out, f, ensure_ascii=False, indent=2)
    msg_bits = [f"+{len(new_unique)} new"]
    if refreshed:
        msg_bits.append(f"{refreshed} refreshed")
    print(f"[ai-radar] daily archive updated: {daily_path} ({', '.join(msg_bits)}, total {daily_out['count']})")
    if d in dates:
        dates.remove(d)
    dates.insert(0, d)

# Keep dates sorted (newest first)
dates = sorted(list(dict.fromkeys(dates)), reverse=True)
with open(DATES_INDEX, 'w', encoding='utf-8') as f:
    json.dump(dates, f, ensure_ascii=False, indent=2)
print(f"[ai-radar] dates index updated: {len(dates)} days -> {DATES_INDEX}")
