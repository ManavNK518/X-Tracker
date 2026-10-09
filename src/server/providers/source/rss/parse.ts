import { XMLParser } from "fast-xml-parser";
import { stripHtml } from "@/server/lib/text";
import { safeHttpUrl } from "@/server/lib/url";

export interface FeedEntry {
  externalId: string;
  title: string | null;
  link: string | null;
  text: string;
  publishedAt: Date | null;
}

const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 2_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

type Node = Record<string, unknown> | string | undefined | null;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["#text"] === "string" || typeof obj["#text"] === "number") return String(obj["#text"]);
    if (typeof obj["__cdata"] === "string") return obj["__cdata"] as string;
  }
  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function atomLink(node: unknown): string | null {
  for (const l of asArray(node as Node | Node[])) {
    if (typeof l === "string") return safeHttpUrl(l);
    if (l && typeof l === "object") {
      const obj = l as Record<string, unknown>;
      const rel = obj["@_rel"];
      if (!rel || rel === "alternate") {
        const href = safeHttpUrl(obj["@_href"]);
        if (href) return href;
      }
    }
  }
  return null;
}

/**
 * Parses RSS 2.0, RSS 1.0 (RDF) and Atom feeds into normalized entries.
 * Rejects documents that declare custom entities (entity-expansion defence).
 */
export function parseFeed(xml: string): { title: string | null; entries: FeedEntry[] } {
  if (xml.length > MAX_FEED_BYTES) throw new Error("Feed exceeds maximum size");
  if (/<!ENTITY/i.test(xml)) throw new Error("Feed declares XML entities; refusing to parse");
  const doc = parser.parse(xml.replace(/^﻿/, "")) as Record<string, unknown>;

  // RSS 2.0
  const rss = doc.rss as Record<string, unknown> | undefined;
  if (rss) {
    const channel = rss.channel as Record<string, unknown> | undefined;
    return {
      title: textOf(channel?.title) ?? null,
      entries: asArray(channel?.item as Node | Node[]).map((item) => rssEntry(item as Record<string, unknown>)).filter(isEntry),
    };
  }
  // RSS 1.0 / RDF
  const rdf = doc.RDF as Record<string, unknown> | undefined;
  if (rdf) {
    const channel = rdf.channel as Record<string, unknown> | undefined;
    return {
      title: textOf(channel?.title) ?? null,
      entries: asArray(rdf.item as Node | Node[]).map((item) => rssEntry(item as Record<string, unknown>)).filter(isEntry),
    };
  }
  // Atom
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    return {
      title: textOf(feed.title) ?? null,
      entries: asArray(feed.entry as Node | Node[]).map((entry) => atomEntry(entry as Record<string, unknown>)).filter(isEntry),
    };
  }
  throw new Error("Unrecognised feed format");
}

function isEntry(e: FeedEntry | null): e is FeedEntry {
  return e !== null;
}

function compose(title: string | null, body: string | null): string {
  const cleanTitle = title ? stripHtml(title) : "";
  const cleanBody = body ? stripHtml(body) : "";
  const parts = [cleanTitle, cleanBody && cleanBody !== cleanTitle ? cleanBody : ""].filter(Boolean);
  const text = parts.join("\n").trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function rssEntry(item: Record<string, unknown>): FeedEntry | null {
  if (!item || typeof item !== "object") return null;
  const title = textOf(item.title);
  const link = safeHttpUrl(textOf(item.link));
  const guid = textOf(item.guid);
  const body = textOf(item.description) ?? textOf(item.encoded);
  const text = compose(title, body);
  if (!text) return null;
  const externalId = (guid && guid.trim()) || link || null;
  if (!externalId) return null;
  return {
    externalId: externalId.slice(0, 500),
    title: title ? stripHtml(title) : null,
    link,
    text,
    publishedAt: parseDate(textOf(item.pubDate) ?? textOf(item.date) ?? textOf(item.updated)),
  };
}

function atomEntry(entry: Record<string, unknown>): FeedEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const title = textOf(entry.title);
  const link = atomLink(entry.link);
  const body = textOf(entry.summary) ?? textOf(entry.content);
  const text = compose(title, body);
  if (!text) return null;
  const externalId = textOf(entry.id) ?? link;
  if (!externalId) return null;
  return {
    externalId: externalId.slice(0, 500),
    title: title ? stripHtml(title) : null,
    link,
    text,
    publishedAt: parseDate(textOf(entry.published) ?? textOf(entry.updated)),
  };
}
