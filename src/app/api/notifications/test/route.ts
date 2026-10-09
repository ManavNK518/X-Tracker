import { api, parseBody } from "@/server/api/handler";
import { TestChannelBody } from "@/server/api/schemas";
import { markChannelHealth } from "@/server/alerts/engine";
import { badRequest } from "@/server/lib/errors";
import { errorMessage } from "@/server/lib/logger";
import { getNotifiers } from "@/server/runtime";
import { audit } from "@/server/services/audit";

/**
 * Sends a clearly labelled TEST message through an external channel. A channel
 * is only shown as "verified" after this succeeds.
 */
export const POST = api({ auth: "owner", rateLimit: { name: "notify-test", limit: 5, windowMs: 10 * 60_000 } }, async ({ req, db, env, user }) => {
  const { channel } = await parseBody(req, TestChannelBody);
  const notifier = getNotifiers(env).find((n) => n.channel === channel);
  if (!notifier || !notifier.configured()) throw badRequest(`${channel} is not configured on the server (see .env.example).`);
  const now = new Date();
  try {
    await notifier.send({
      eventId: "test",
      eventRef: "TEST",
      kind: "new",
      title: "TEST MESSAGE — channel verification (not a market event)",
      category: "other_material",
      importance: 0,
      confidence: 0,
      band: "minimal",
      verification: "unverified",
      assets: [],
      sourceName: "Signal Terminal (test)",
      sourceUrl: null,
      eventTime: now.toISOString(),
      summary: "This is a test notification sent from Settings to verify that the channel works.",
      whyItMatters: "Not applicable (test).",
      keyUncertainty: "Not applicable (test).",
      investigationUrl: `${env.APP_URL.replace(/\/$/, "")}/settings`,
      isDemo: false,
      changes: [],
    });
    await markChannelHealth(db, channel, true, null, now, true);
    await audit(db, { userId: user!.id, action: "notify.test", entityType: "channel", entityId: channel, details: { ok: true } });
    return { ok: true, verifiedAt: now.toISOString() };
  } catch (error) {
    const message = errorMessage(error);
    await markChannelHealth(db, channel, false, message, now);
    await audit(db, { userId: user!.id, action: "notify.test", entityType: "channel", entityId: channel, details: { ok: false } });
    return { ok: false, error: message };
  }
});
