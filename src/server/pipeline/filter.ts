/**
 * Stage 1 — basic filtering. Flags spam, promotion, engagement bait and
 * low-information posts. Posts from registered (tracked) or primary sources are
 * never discarded, only flagged. Unusual or unpopular views are not penalised:
 * only form-based signals (promotion, bait, formatting abuse) are used.
 */
export type FilterFlag =
  | "promotional"
  | "engagement_bait"
  | "cashtag_spam"
  | "hype_formatting"
  | "low_information"
  | "coordinated_repetition"
  | "contains_instructions";

export interface FilterInput {
  text: string;
  isTrackedSource: boolean;
  /** Entities resolved in the text (assets / organisations). */
  entityCount: number;
  /** How many *other* authors posted identical normalized content recently. */
  identicalFromOtherAuthors: number;
}

export interface FilterResult {
  action: "keep" | "discard";
  outcome: "kept" | "filtered_spam" | "filtered_low_info";
  flags: FilterFlag[];
  reasons: string[];
  spamScore: number;
}

const PROMO = [
  /\b(giveaway|airdrop|presale|whitelist spot|free signals?|vip group|use (my )?code|referral link|link in (my )?bio)\b/i,
  /\b(join (my|our) (telegram|discord|whatsapp|group)|dm (me|us)( now)?( for)?)\b/i,
  /\b\d{2,5}x (incoming|gains?|potential|soon)\b|\b(100|1000)x\b/i,
  /\b(guaranteed (profits?|returns?|gains?)|risk[- ]free (profit|returns?))\b/i,
  /\bto the moon\b/i,
];
const BAIT = [
  /\b(like (and|&) (retweet|rt|repost)|rt if|retweet if|follow (me|us) for (more|daily))\b/i,
  /\b(drop a .{1,10} (below|if)|comment below|tag (a|your) friends?|who('s| is) (buying|in)\??)\b/i,
];
const INSTRUCTION_LIKE = [
  /\bignore (all |any )?(previous|prior|above|earlier) (instructions|prompts?|rules)\b/i,
  /\b(system prompt|you are (now )?(an? )?(ai|assistant|language model)|developer mode)\b/i,
  /\b(mark|classify|label|score) (this|it)( post)? as (confirmed|verified|critical|important|true)\b/i,
  /\b(set|give) (the )?(importance|confidence|score) (to|of) \d+\b/i,
];

const EMOJI = /\p{Extended_Pictographic}/gu;
const CASHTAG = /\$[A-Za-z][A-Za-z0-9.]{0,10}/g;

export function filterItem(input: FilterInput): FilterResult {
  const flags: FilterFlag[] = [];
  const reasons: string[] = [];
  let spamScore = 0;
  const text = input.text;

  const promoHits = PROMO.filter((re) => re.test(text)).length;
  if (promoHits > 0) {
    flags.push("promotional");
    reasons.push(`${promoHits} promotional pattern(s)`);
    spamScore += 0.6 * promoHits;
  }
  if (BAIT.some((re) => re.test(text))) {
    flags.push("engagement_bait");
    reasons.push("engagement-bait phrasing");
    spamScore += 0.6;
  }
  const cashtags = text.match(CASHTAG)?.length ?? 0;
  if (cashtags > 6) {
    flags.push("cashtag_spam");
    reasons.push(`${cashtags} cashtags`);
    spamScore += 0.6;
  }
  const emojis = text.match(EMOJI)?.length ?? 0;
  const letters = text.replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "").length;
  const capsRatio = letters.length > 0 ? upper / letters.length : 0;
  if (emojis >= 5 || (letters.length > 40 && capsRatio > 0.7) || /!{3,}/.test(text)) {
    flags.push("hype_formatting");
    reasons.push(emojis >= 5 ? `${emojis} emoji` : capsRatio > 0.7 ? "mostly capital letters" : "repeated exclamation marks");
    spamScore += 0.4;
  }
  if (input.identicalFromOtherAuthors >= 3) {
    flags.push("coordinated_repetition");
    reasons.push(`identical text posted by ${input.identicalFromOtherAuthors} other accounts`);
    spamScore += 0.5;
  }
  if (INSTRUCTION_LIKE.some((re) => re.test(text))) {
    // Not discarded: treated strictly as untrusted data and surfaced to the user.
    flags.push("contains_instructions");
    reasons.push("text addressed to automated systems (treated as untrusted data)");
  }

  const words = text.replace(/https?:\/\/\S+/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const hasNumber = /\d/.test(text);
  const lowInfo = words.length < 6 && input.entityCount === 0 && !hasNumber;
  if (lowInfo) {
    flags.push("low_information");
    reasons.push("very short text with no entities or figures");
  }

  if (input.isTrackedSource) {
    return { action: "keep", outcome: "kept", flags, reasons, spamScore };
  }
  if (spamScore >= 1) return { action: "discard", outcome: "filtered_spam", flags, reasons, spamScore };
  if (lowInfo) return { action: "discard", outcome: "filtered_low_info", flags, reasons, spamScore };
  return { action: "keep", outcome: "kept", flags, reasons, spamScore };
}
