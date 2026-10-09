import { ATTRIBUTION_PATTERNS } from "@/config/classification-rules";

/**
 * Independence analysis. Two items are independent only if they do not share
 * an underlying origin. Reposts/quotes inherit the referenced item's key,
 * explicit attributions ("via @X", "according to Reuters") map to the
 * attributed origin, and accounts of the same organisation share a key.
 */
export interface IndependenceInput {
  provider: string;
  authorHandle: string | null;
  sourceOrganization: string | null;
  text: string;
  referenced: { type: string; id: string }[];
}

export interface IndependenceLookups {
  /** Independence key of an already-ingested item, by provider + external ID. */
  referencedKey: (provider: string, externalId: string) => string | null;
  /** Organisation of a registered account handle, if known. */
  handleOrganization?: (handle: string) => string | null;
}

const ORG_ALIASES: Record<string, string> = {
  wsj: "dow jones",
  "the wall street journal": "dow jones",
  "dow jones": "dow jones",
  ft: "financial times",
  "financial times": "financial times",
  ap: "associated press",
  "associated press": "associated press",
  bloomberg: "bloomberg",
  reuters: "reuters",
  cnbc: "cnbc",
  "the information": "the information",
  axios: "axios",
  nikkei: "nikkei",
};

export function attributionOf(text: string): { kind: "acct" | "org"; name: string } | null {
  for (const re of ATTRIBUTION_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const raw = m[1];
    const isHandle = m[0].includes("@");
    const lower = raw.toLowerCase().replace(/^@/, "");
    if (isHandle) return { kind: "acct", name: lower };
    return { kind: "org", name: ORG_ALIASES[lower] ?? lower };
  }
  return null;
}

export function independenceKey(input: IndependenceInput, lookups: IndependenceLookups): string {
  for (const ref of input.referenced) {
    if (ref.type === "retweeted" || ref.type === "quoted") {
      return lookups.referencedKey(input.provider, ref.id) ?? `ref:${input.provider}:${ref.id}`;
    }
  }
  const attributed = attributionOf(input.text);
  if (attributed) {
    if (attributed.kind === "org") return `org:${attributed.name}`;
    const org = lookups.handleOrganization?.(attributed.name);
    return org ? `org:${org.toLowerCase()}` : `acct:${attributed.name}`;
  }
  if (input.sourceOrganization) return `org:${input.sourceOrganization.toLowerCase()}`;
  if (input.authorHandle) return `acct:${input.authorHandle.toLowerCase()}`;
  return `anon:${input.provider}`;
}
