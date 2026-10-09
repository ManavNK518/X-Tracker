export const FEEDBACK_LABELS = [
  "useful",
  "irrelevant",
  "duplicate",
  "incorrect",
  "late",
  "missing_context",
] as const;
export type FeedbackLabel = (typeof FEEDBACK_LABELS)[number];

export const FEEDBACK_LABEL_TEXT: Record<FeedbackLabel, string> = {
  useful: "Useful",
  irrelevant: "Irrelevant",
  duplicate: "Duplicate",
  incorrect: "Incorrect",
  late: "Late",
  missing_context: "Missing important context",
};

export const NOTE_STATUSES = ["open", "investigating", "validated", "invalidated", "archived"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  validated: "Hypothesis supported",
  invalidated: "Hypothesis invalidated",
  archived: "Archived",
};

export const NOTIFICATION_CHANNELS = ["in_app", "browser", "email", "telegram", "discord"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: "In-app",
  browser: "Browser notification",
  email: "Email",
  telegram: "Telegram",
  discord: "Discord",
};

export const DELIVERY_STATUSES = [
  "pending",
  "sent",
  "handed_to_client",
  "failed",
  "deferred",
  "suppressed",
  "skipped",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const NOTIFICATION_KINDS = ["new", "update", "escalation", "correction"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** How a piece of data was obtained. Shown prominently in the UI. */
export const DATA_ORIGINS = ["live", "historical", "cached", "delayed", "demo", "disconnected"] as const;
export type DataOrigin = (typeof DATA_ORIGINS)[number];

export const ASSET_RELATIONS = ["direct", "peer", "supplier", "customer", "macro", "sector"] as const;
export type AssetRelation = (typeof ASSET_RELATIONS)[number];

export const ASSET_RELATION_LABELS: Record<AssetRelation, string> = {
  direct: "Directly named",
  peer: "Peer / competitor",
  supplier: "Supplier",
  customer: "Customer",
  macro: "Macro transmission",
  sector: "Sector exposure",
};

export const ITEM_ROLES = [
  "origin",
  "repeat",
  "corroboration",
  "update",
  "correction",
  "contradiction",
  "primary_source",
  "commentary",
] as const;
export type ItemRole = (typeof ITEM_ROLES)[number];

export const ITEM_ROLE_LABELS: Record<ItemRole, string> = {
  origin: "Origin",
  repeat: "Repeat / repost (not independent)",
  corroboration: "Independent corroboration",
  update: "Follow-up",
  correction: "Correction",
  contradiction: "Contradiction",
  primary_source: "Primary source",
  commentary: "Commentary (not evidence)",
};

/** Roles that count as evidence for independence/corroboration purposes. */
export const EVIDENCE_ROLES: ReadonlySet<ItemRole> = new Set(["origin", "corroboration", "primary_source"]);
