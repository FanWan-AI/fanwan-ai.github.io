export const SUPPORTED_LANGS = ["zh", "en", "es"];

export function normaliseLang(value, fallback = "zh") {
  const lang = String(value || "").toLowerCase();
  if (SUPPORTED_LANGS.includes(lang)) return lang;
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("es")) return "es";
  return fallback;
}

export function cleanText(value) {
  if (!value) return "";
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function ensureArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

export function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (value == null) continue;
    const key = typeof value === "string" ? value : JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function safeId(seed, fallbackPrefix = "entry") {
  if (seed && typeof seed === "string") {
    return seed.trim().replace(/\s+/g, "-");
  }
  return `${fallbackPrefix}-${Math.random().toString(36).slice(2, 10)}`;
}
