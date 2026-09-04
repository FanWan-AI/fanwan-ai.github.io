import path from "node:path";

export const PIPELINE_VERSION = "startup-1.0.0";
export const SCHEMA_VERSION = 1;
export const MAX_OPPORTUNITIES = 10;
export const DEEP_OPPORTUNITIES = 3;
export const MIN_OPPORTUNITY_SCORE = 68;
export const MIN_SOURCE_COUNT = 2;
export const MIN_SOURCE_COVERAGE = 0.85;
export const MAX_CASE_SECTIONS = 8;
export const MIN_CASE_SECTIONS = 3;

export const ROOT = process.cwd();
export const DEFAULT_DATA_ROOT = path.resolve(ROOT, "data/ai/startup");
export const DEFAULT_OPPORTUNITY_PATH = path.join(DEFAULT_DATA_ROOT, "opportunities/latest.json");
export const DEFAULT_OPPORTUNITY_ARCHIVE = path.join(DEFAULT_DATA_ROOT, "opportunities/archive");
export const DEFAULT_CASE_ROOT = path.join(DEFAULT_DATA_ROOT, "cases");
export const DEFAULT_CASE_DRAFT_ROOT = path.join(DEFAULT_CASE_ROOT, "drafts");
export const DEFAULT_CASE_INDEX_PATH = path.join(DEFAULT_CASE_ROOT, "index.json");

export const DEFAULT_TIMEOUT_MS = 12_000;
export const DEFAULT_MAX_BYTES = 1_500_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_CONCURRENCY = 4;

export const SOURCE_TIERS = ["primary", "reputable_secondary", "discovery_only"];
export const EVIDENCE_LABELS = ["fact", "company_claim", "editorial_inference", "unknown"];
export const STORY_TYPES = [
  "growth",
  "pivotal_decision",
  "failure",
  "business_model",
  "technical_commercialization",
  "comparison"
];

export const BANNED_PHRASES = [
  /万亿蓝海/iu,
  /颠覆行业/iu,
  /人人都需要/iu,
  /trillion[- ]dollar blue ocean/iu,
  /disrupt(?:ive|ing) the industry/iu,
  /everyone needs/iu
];

export const CURATED_FEEDS = [
  { url: "https://openai.com/news/rss.xml", publisher: "OpenAI", tier: "primary" },
  { url: "https://www.anthropic.com/rss.xml", publisher: "Anthropic", tier: "primary" },
  { url: "https://www.ftc.gov/feeds/press-release-consumer-protection.xml", publisher: "FTC", tier: "primary" },
  { url: "https://www.federalregister.gov/api/v1/documents.rss", publisher: "Federal Register", tier: "primary" },
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", publisher: "TechCrunch", tier: "reputable_secondary" },
  { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", publisher: "The Verge", tier: "reputable_secondary" },
  { url: "https://www.technologyreview.com/feed/", publisher: "MIT Technology Review", tier: "reputable_secondary" }
];

export const DEFAULT_SEARCH_QUERIES = [
  "AI startup customer pain regulation workflow 2026",
  "enterprise AI adoption procurement compliance 2026",
  "AI product launch pricing workflow small business 2026",
  "AI startup failure lesson customer demand 2026"
];
