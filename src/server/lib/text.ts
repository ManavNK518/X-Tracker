import { createHash } from "node:crypto";

/** Words ignored for similarity. Short and domain-neutral on purpose. */
const STOPWORDS = new Set(
  "a an and are as at be been but by for from has have had he her his i in into is it its of on or our she that the their them they this to was we were will with you your not no yes rt via just about after before over under than then there these those which who whom what when where why how all any each more most other some such only own same so too very can could should would may might must do does did done also says said say new".split(
    " ",
  ),
);

const URL_RE = /https?:\/\/\S+/gi;

/** Lowercase, strip URLs/mentions/punctuation, collapse whitespace. Keeps numbers. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(URL_RE, " ")
    .replace(/[@#]/g, " ")
    .toLowerCase()
    .replace(/[“”"'’`]/g, "")
    .replace(/[^\p{L}\p{N}%.$\s-]/gu, " ")
    .replace(/(?<!\d)\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .map((t) => t.replace(/^[-.$]+|[-.]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Similarity in [0,1] combining unigram and bigram Jaccard. Robust to light
 * rewording while still separating different events about the same entity.
 */
export function textSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const uni = jaccard(new Set(ta), new Set(tb));
  const bi = jaccard(new Set(bigrams(ta)), new Set(bigrams(tb)));
  // Containment helps when one post is a short excerpt of a longer one.
  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const containment = inter / Math.min(sa.size, sb.size);
  return Math.min(1, 0.45 * uni + 0.35 * bi + 0.2 * containment);
}

export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex").slice(0, 32);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function excerpt(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Removes http(s) links. Used on model-generated text so it cannot introduce unsourced URLs. */
export function stripUrls(text: string): string {
  return text.replace(URL_RE, "[link removed]");
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
