import dns from "node:dns/promises";
import net from "node:net";
import { StartupError } from "./errors.mjs";

const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source)$/iu;

function isPrivateIpv4(host) {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) || (octets[0] === 169 && octets[1] === 254) || octets[0] === 0;
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase();
  if (net.isIPv4(normalized)) return isPrivateIpv4(normalized);
  if (!net.isIPv6(normalized)) return false;
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export function normalizeUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) throw new StartupError("URL is required", "UNSAFE_URL");
  let parsed;
  try { parsed = new URL(rawUrl.trim()); } catch { throw new StartupError("Malformed URL", "UNSAFE_URL"); }
  if (!/^https?:$/iu.test(parsed.protocol)) throw new StartupError("Only HTTP(S) URLs are allowed", "UNSAFE_URL");
  if (parsed.username || parsed.password) throw new StartupError("URLs with credentials are not allowed", "UNSAFE_URL");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || isPrivateAddress(hostname)) {
    throw new StartupError("Private or loopback hosts are not allowed", "UNSAFE_URL");
  }
  parsed.hostname = hostname;
  for (const key of [...parsed.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  parsed.hash = "";
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString();
}

export async function assertPublicUrl(rawUrl, { resolveDns = true } = {}) {
  const normalized = normalizeUrl(rawUrl);
  if (!resolveDns) return normalized;
  const hostname = new URL(normalized).hostname;
  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (addresses.some(({ address }) => isPrivateAddress(address))) throw new StartupError("URL resolves to a private address", "UNSAFE_URL");
  } catch (error) {
    if (error instanceof StartupError) throw error;
    throw new StartupError(`Host DNS lookup failed: ${hostname}`, "UNSAFE_URL");
  }
  return normalized;
}

export function isSafeUrl(rawUrl) {
  try { normalizeUrl(rawUrl); return true; } catch { return false; }
}
