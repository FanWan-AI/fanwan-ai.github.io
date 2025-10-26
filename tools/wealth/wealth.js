const DAILY_URL = "/data/ai/wealth/finance-daily.json";
const PULSE_URL = "/data/ai/wealth/pulse.json";
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const PAGE_SIZE = 10;

const style = document.createElement("style");
style.textContent = `
.wealth-daily-card { display: grid; gap: 16px; padding: 24px; border-radius: 18px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.24); box-shadow: 0 22px 54px -32px rgba(15,118,110,0.24); }
.wealth-daily-card h3 { margin: 0; font-size: 1.5rem; color: var(--text-strong, #0f172a); }
.wealth-daily-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.9rem; color: rgba(15,118,110,0.8); }
.wealth-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; }
.wealth-badge--degraded { background: rgba(248,113,113,0.16); border: 1px solid rgba(248,113,113,0.32); color: #b91c1c; }
.wealth-badge--fresh { background: rgba(59,130,246,0.16); border: 1px solid rgba(59,130,246,0.32); color: #1d4ed8; }
.wealth-list { display: grid; gap: 18px; }
.wealth-list-item { padding: 20px; border-radius: 18px; border: 1px solid rgba(15,118,110,0.16); background: color-mix(in srgb, var(--surface, #ffffff) 90%, rgba(16,185,129,0.06)); box-shadow: 0 18px 48px -30px rgba(15,118,110,0.18); display: grid; gap: 14px; }
.wealth-list-item h4 { margin: 0; font-size: 1.2rem; color: var(--text-strong, #0f172a); }
.wealth-points { margin: 0; padding-left: 20px; color: var(--text, #1f2937); line-height: 1.6; }
.wealth-links { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.9rem; }
.wealth-links a { color: #0f766e; text-decoration: underline; }
.wealth-load-more { align-self: center; padding: 10px 18px; border-radius: 999px; border: 1px solid rgba(15,118,110,0.24); background: rgba(16,185,129,0.12); color: var(--text-strong, #0f172a); font-weight: 600; cursor: pointer; }
.wealth-load-more:disabled { opacity: 0.6; cursor: not-allowed; }
.wealth-pulse-group { border-radius: 18px; border: 1px solid rgba(59,130,246,0.18); background: color-mix(in srgb, var(--surface, #ffffff) 92%, rgba(59,130,246,0.06)); overflow: hidden; box-shadow: 0 18px 44px -28px rgba(37,99,235,0.22); }
.wealth-pulse-group details { border-bottom: 1px solid rgba(59,130,246,0.12); }
.wealth-pulse-group details:last-of-type { border-bottom: none; }
.wealth-pulse-group summary { cursor: pointer; padding: 18px 22px; font-weight: 600; font-size: 1rem; display: flex; align-items: center; justify-content: space-between; }
.wealth-pulse-item { padding: 0 22px 22px; display: grid; gap: 10px; border-top: 1px solid rgba(59,130,246,0.1); }
.wealth-pulse-item h5 { margin: 0; font-size: 1.05rem; color: var(--text-strong, #0f172a); }
.wealth-pulse-facts, .wealth-pulse-impact { margin: 0; font-size: 0.95rem; line-height: 1.55; color: var(--text, #1f2937); }
.wealth-empty { font-size: 0.95rem; color: var(--muted, #4b5563); text-align: center; padding: 36px 0; }
`;
document.head.appendChild(style);

const dailyContainer = document.querySelector("#daily");
const pulseContainer = document.querySelector("#pulse");

function cacheKey(name) {
  return `wealth_${name}`;
}

function setCache(name, data) {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify({ timestamp: Date.now(), data }));
  } catch (error) {
    console.warn("Cache write failed", error);
  }
}

function getCache(name) {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (Date.now() - payload.timestamp > CACHE_TTL) {
      localStorage.removeItem(cacheKey(name));
      return null;
    }
    return payload.data;
  } catch (error) {
    console.warn("Cache read failed", error);
    return null;
  }
}

async function fetchJSON(url, cacheName) {
  try {
    const response = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    setCache(cacheName, data);
    return data;
  } catch (error) {
    console.warn(`Fetch ${cacheName} failed`, error);
    const cached = getCache(cacheName);
    if (cached) {
      renderNotice(cacheName, "已加载缓存数据，稍后请刷新重试。");
      return cached;
    }
    throw error;
  }
}

function renderNotice(name, message) {
  const target = name === "daily" ? dailyContainer : pulseContainer;
  const banner = document.createElement("div");
  banner.className = "wealth-notice";
  banner.textContent = message;
  target.prepend(banner);
}

function pickLang(obj) {
  if (!obj) return "";
  if (obj.zh) return obj.zh;
  if (obj.en) return obj.en;
  if (obj.es) return obj.es;
  return "";
}

function pickList(obj) {
  if (!obj) return [];
  return obj.zh || obj.en || obj.es || [];
}

function createDailyCard(entry, isToday) {
  const card = document.createElement("article");
  card.className = "wealth-daily-card";
  card.setAttribute("tabindex", "0");

  const header = document.createElement("div");
  header.className = "wealth-daily-meta";
  const date = document.createElement("span");
  date.textContent = entry.date;
  header.append(date);

  const freshBadge = document.createElement("span");
  freshBadge.className = "wealth-badge wealth-badge--fresh";
  freshBadge.textContent = isToday ? "今日主题" : "近期课程";
  header.append(freshBadge);

  if (entry.degraded) {
    const badge = document.createElement("span");
    badge.className = "wealth-badge wealth-badge--degraded";
    badge.textContent = "降级：沿用上一条内容";
    header.append(badge);
  }

  const title = document.createElement("h3");
  title.textContent = pickLang(entry.topic) || "今日主题";

  const summary = document.createElement("p");
  summary.textContent = pickLang(entry.summary) || "暂无摘要，稍后再试。";

  const pointsList = pickList(entry.key_points);
  const points = document.createElement("ul");
  points.className = "wealth-points";
  pointsList.slice(0, 5).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    points.append(li);
  });

  const practice = document.createElement("p");
  practice.innerHTML = `<strong>今日练习：</strong> ${pickLang(entry.practice) || "写下今日体会。"}`;

  const links = document.createElement("div");
  links.className = "wealth-links";
  if (Array.isArray(entry.sources) && entry.sources.length) {
    entry.sources.slice(0, 6).forEach((source, index) => {
      const anchor = document.createElement("a");
      anchor.href = typeof source === "string" ? source : source.url || "#";
      anchor.textContent = typeof source === "string" ? `参考 ${index + 1}` : source.title || `参考 ${index + 1}`;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      links.append(anchor);
    });
  }

  card.append(header, title, summary, points, practice);
  if (links.childNodes.length) {
    card.append(links);
  }
  return card;
}

function renderDaily(data) {
  dailyContainer.innerHTML = "";
  if (!Array.isArray(data) || !data.length) {
    const empty = document.createElement("p");
    empty.className = "wealth-empty";
    empty.textContent = "暂未加载到课程内容，稍后再试。";
    dailyContainer.append(empty);
    return;
  }

  const todayCard = createDailyCard(data[0], true);
  dailyContainer.append(todayCard);

  const history = data.slice(1);
  if (!history.length) return;

  const listWrapper = document.createElement("div");
  listWrapper.className = "wealth-list";
  listWrapper.setAttribute("aria-live", "polite");

  const state = { page: 1 };

  function renderPage() {
    const visible = history.slice(0, state.page * PAGE_SIZE);
    listWrapper.innerHTML = "";
    visible.forEach((entry) => {
      const item = document.createElement("article");
      item.className = "wealth-list-item";

      const title = document.createElement("h4");
      title.textContent = pickLang(entry.topic) || entry.date;

      const meta = document.createElement("div");
      meta.className = "wealth-daily-meta";
      const date = document.createElement("span");
      date.textContent = entry.date;
      meta.append(date);
      if (entry.degraded) {
        const badge = document.createElement("span");
        badge.className = "wealth-badge wealth-badge--degraded";
        badge.textContent = "降级";
        meta.append(badge);
      }

      const summary = document.createElement("p");
      summary.textContent = pickLang(entry.summary) || "暂无摘要";

      const pointsList = pickList(entry.key_points);
      const points = document.createElement("ul");
      points.className = "wealth-points";
      pointsList.slice(0, 5).forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        points.append(li);
      });

      const practice = document.createElement("p");
      practice.innerHTML = `<strong>小练习：</strong> ${pickLang(entry.practice) || "记录今日行动。"}`;

      item.append(title, meta, summary, points, practice);
      listWrapper.append(item);
    });
  }

  renderPage();

  const loadMore = document.createElement("button");
  loadMore.className = "wealth-load-more";
  loadMore.type = "button";
  loadMore.textContent = "加载更多";
  loadMore.addEventListener("click", () => {
    state.page += 1;
    renderPage();
    if (state.page * PAGE_SIZE >= history.length) {
      loadMore.disabled = true;
      loadMore.textContent = "没有更多了";
    }
  });

  dailyContainer.append(listWrapper);
  if (history.length > PAGE_SIZE) {
    dailyContainer.append(loadMore);
  }
}

function renderPulse(data) {
  pulseContainer.innerHTML = "";
  if (!Array.isArray(data) || !data.length) {
    const empty = document.createElement("p");
    empty.className = "wealth-empty";
    empty.textContent = "暂无市场快讯，周一再来看看。";
    pulseContainer.append(empty);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "wealth-pulse-group";

  data.slice(0, 14).forEach((group, index) => {
    const details = document.createElement("details");
    if (index === 0) details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = group.date;
    details.append(summary);

    group.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "wealth-pulse-item";

      const title = document.createElement("h5");
      title.textContent = item.title || "市场快讯";

      const source = document.createElement("span");
      source.className = "wealth-daily-meta";
      source.textContent = item.source || "";

      const facts = document.createElement("p");
      facts.className = "wealth-pulse-facts";
      facts.textContent = pickLang(item.facts) || "暂无事实摘要。";

      const impact = document.createElement("p");
      impact.className = "wealth-pulse-impact";
      impact.innerHTML = `<strong>可能影响：</strong> ${pickLang(item.impact_one_liner) || "待更新"}`;

      if (Array.isArray(item.links) && item.links.length) {
        const links = document.createElement("div");
        links.className = "wealth-links";
        item.links.slice(0, 5).forEach((href, idx) => {
          const anchor = document.createElement("a");
          anchor.href = href;
          anchor.target = "_blank";
          anchor.rel = "noopener";
          anchor.textContent = `延伸阅读 ${idx + 1}`;
          links.append(anchor);
        });
        row.append(links);
      }

      row.prepend(title, source, facts, impact);
      details.append(row);
    });

    wrapper.append(details);
  });

  pulseContainer.append(wrapper);
}

async function init() {
  try {
    const [daily, pulse] = await Promise.all([
      fetchJSON(DAILY_URL, "daily"),
      fetchJSON(PULSE_URL, "pulse")
    ]);
    renderDaily(daily);
    renderPulse(pulse);
  } catch (error) {
    console.error("Wealth module failed", error);
    const fallbackDaily = getCache("daily");
    if (fallbackDaily) {
      renderDaily(fallbackDaily);
    }
    const fallbackPulse = getCache("pulse");
    if (fallbackPulse) {
      renderPulse(fallbackPulse);
    }
    if (!fallbackDaily && !fallbackPulse) {
      const msg = document.createElement("p");
      msg.className = "wealth-empty";
      msg.textContent = "未能加载数据，请稍后刷新重试。";
      dailyContainer.append(msg.cloneNode(true));
      pulseContainer.append(msg);
    }
  }
}

init();
