/** Detecta se a entrada é uma URL (e normaliza). */
export function extractUrl(input: string): string | null {
  const t = input.trim();
  if (/\s/.test(t) || !/^(https?:\/\/|www\.)/i.test(t)) return null;
  return /^www\./i.test(t) ? `https://${t}` : t;
}

/** Só http/https e nada de hosts locais/privados. */
export function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (h.startsWith("[") || h.includes(":")) return false;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  } else if (!h.includes(".")) return false;
  return true;
}

type Bucket = { minute: number[]; day: number[] };
const buckets = new Map<string, Bucket>();
let globalDay = { date: "", count: 0 };

export function rateLimit(
  ip: string,
  now = Date.now(),
  limits = {
    perMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 4),
    perDay: Number(process.env.RATE_LIMIT_PER_DAY ?? 60),
    global: Number(process.env.GLOBAL_DAILY_LIMIT ?? 1500),
  },
): { ok: boolean; retryAfter?: number; reason?: string } {
  const today = new Date(now).toISOString().slice(0, 10);
  if (globalDay.date !== today) globalDay = { date: today, count: 0 };
  if (globalDay.count >= limits.global) return { ok: false, retryAfter: 3600, reason: "Limite diário do serviço atingido. Tente mais tarde." };
  const b = buckets.get(ip) ?? { minute: [], day: [] };
  b.minute = b.minute.filter((t) => now - t < 60_000);
  b.day = b.day.filter((t) => now - t < 86_400_000);
  if (b.minute.length >= limits.perMinute) {
    buckets.set(ip, b);
    return { ok: false, retryAfter: Math.ceil((60_000 - (now - b.minute[0])) / 1000), reason: "Muitas verificações em pouco tempo. Aguarde um instante." };
  }
  if (b.day.length >= limits.perDay) {
    buckets.set(ip, b);
    return { ok: false, retryAfter: 3600, reason: "Limite diário de verificações atingido." };
  }
  b.minute.push(now);
  b.day.push(now);
  buckets.set(ip, b);
  globalDay.count++;
  if (buckets.size > 5000) buckets.clear();
  return { ok: true };
}

export function resetRateLimit() {
  buckets.clear();
  globalDay = { date: "", count: 0 };
}
