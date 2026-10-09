import { z } from "zod";
import { EVENT_CATEGORIES } from "@/domain/categories";
import { FEEDBACK_LABELS, NOTE_STATUSES, NOTIFICATION_CHANNELS } from "@/domain/misc";
import { SOURCE_CATEGORIES } from "@/domain/sources";
import { VERIFICATION_STATES } from "@/domain/verification";

/** Input validation schemas shared by API routes. All inputs are bounded. */

const csv = <T extends z.ZodType>(item: T, max = 20) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean)))
    .pipe(z.array(item).max(max) as unknown as z.ZodType<z.output<T>[], string[]>);

const intParam = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const boolParam = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true" || v === "1"));

export const FeedQuery = z.object({
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["newest", "importance", "updated"]).default("newest"),
  categories: csv(z.enum(EVENT_CATEGORIES)),
  assets: csv(z.string().max(20).regex(/^[A-Za-z0-9.\-]+$/)),
  sources: csv(z.string().uuid(), 50),
  verification: csv(z.enum(VERIFICATION_STATES)),
  minImportance: intParam(0, 100).optional(),
  minConfidence: intParam(0, 100).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  includeDemo: boolParam,
  hideReviewed: boolParam,
  savedOnly: boolParam,
  cursor: z.string().max(500).optional(),
  limit: intParam(1, 100).default(30),
});
export type FeedQueryInput = z.infer<typeof FeedQuery>;

export const SignupBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(80),
});

export const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export const EventStateBody = z.object({
  saved: z.boolean().optional(),
  reviewed: z.boolean().optional(),
});

export const FeedbackBody = z.object({
  label: z.enum(FEEDBACK_LABELS),
  comment: z.string().trim().max(1000).optional(),
  remove: z.boolean().optional(),
});

const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(20)
  .regex(/^[A-Z0-9.\-]+$/, "Symbols may contain letters, digits, '.' and '-'");

export const WatchlistBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  minImportance: z.number().int().min(0).max(100).default(40),
  minConfidence: z.number().int().min(0).max(100).default(0),
  categories: z.array(z.enum(EVENT_CATEGORIES)).max(EVENT_CATEGORIES.length).default([]),
  sourceIds: z.array(z.string().uuid()).max(100).default([]),
  keywords: z.array(z.string().trim().min(2).max(60)).max(50).default([]),
  notify: z.boolean().default(true),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).max(5).default(["in_app"]),
  assets: z
    .array(z.object({ symbol, name: z.string().trim().max(120).optional(), aliases: z.array(z.string().trim().min(2).max(60)).max(10).optional() }))
    .max(200)
    .default([]),
});

export const AlertRuleBody = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  watchlistId: z.string().uuid().nullable().optional(),
  minImportance: z.number().int().min(0).max(100).default(60),
  minConfidence: z.number().int().min(0).max(100).default(0),
  categories: z.array(z.enum(EVENT_CATEGORIES)).default([]),
  assetSymbols: z.array(symbol).max(100).default([]),
  sourceCategories: z.array(z.enum(SOURCE_CATEGORIES)).default([]),
  verificationStates: z.array(z.enum(VERIFICATION_STATES)).default([]),
  requireTimeSensitive: z.boolean().default(false),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).max(5).default(["in_app"]),
  cooldownMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  includeDemo: z.boolean().default(true),
});

export const SourceBody = z.object({
  provider: z.enum(["x", "rss"]),
  externalId: z.string().trim().min(1).max(500),
  handle: z.string().trim().max(50).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  category: z.enum(SOURCE_CATEGORIES),
  isPrimary: z.boolean().default(false),
  authorityDomains: z.array(z.enum(EVENT_CATEGORIES)).default([]),
  organization: z.string().trim().max(120).nullable().optional(),
  topics: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const SourcePatchBody = SourceBody.partial().omit({ provider: true, externalId: true });

export const ReliabilityObservationBody = z.object({
  category: z.enum(EVENT_CATEGORIES),
  outcome: z.enum(["confirmed", "refuted", "corrected", "unresolved"]),
  note: z.string().trim().min(3).max(1000),
  eventId: z.string().uuid().nullable().optional(),
});

export const CollectionRuleBody = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.string().trim().min(3).max(1024),
  enabled: z.boolean().default(false),
  maxResults: z.number().int().min(10).max(100).default(25),
  intervalSeconds: z.number().int().min(60).max(86_400).default(900),
});

const longText = z.string().max(10_000).default("");

export const NoteBody = z.object({
  eventId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  summary: longText,
  sources: z
    .array(z.object({ label: z.string().trim().min(1).max(200), url: z.string().url().max(2048).nullable(), itemId: z.string().uuid().nullable().optional() }))
    .max(50)
    .default([]),
  thesis: longText,
  assets: z.array(symbol).max(50).default([]),
  transmission: longText,
  bullish: longText,
  bearish: longText,
  alternatives: longText,
  risks: longText,
  evidenceNeeded: longText,
  invalidation: longText,
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(NOTE_STATUSES).default("open"),
});

export const PreferencesBody = z.object({
  timezone: z.string().max(64).optional(),
  theme: z.enum(["dark", "light"]).optional(),
  feedSort: z.enum(["newest", "importance", "updated"]).optional(),
  feedMinImportance: z.number().int().min(0).max(100).optional(),
  showDemo: z.boolean().optional(),
  hideReviewed: z.boolean().optional(),
  quietHours: z
    .object({
      enabled: z.boolean(),
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      allowCritical: z.boolean(),
    })
    .optional(),
  channels: z.record(z.enum(NOTIFICATION_CHANNELS), z.boolean()).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
});

export const NotificationsReadBody = z.object({
  ids: z.array(z.string().uuid()).max(200).optional(),
  all: z.boolean().optional(),
});

export const RunJobBody = z.object({
  job: z.string().max(40).regex(/^[a-z:\-]+$/),
});

export const TestChannelBody = z.object({
  channel: z.enum(["email", "telegram", "discord"]),
});
