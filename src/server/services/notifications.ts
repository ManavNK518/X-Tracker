import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { NotificationDTO } from "@/domain/dto";
import type { Db } from "@/server/db/client";
import { notificationDeliveries, notifications } from "@/server/db/schema";

export async function listNotifications(
  db: Db,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number; before?: string },
): Promise<NotificationDTO[]> {
  const conds = [eq(notifications.userId, userId)];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  if (opts.before) conds.push(lt(notifications.createdAt, new Date(opts.before)));
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  const deliveries = rows.length
    ? await db.select().from(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, rows.map((r) => r.id)))
    : [];
  return rows.map((n) => ({
    id: n.id,
    eventId: n.eventId,
    kind: n.kind,
    title: n.title,
    payload: n.payload as Record<string, unknown>,
    isDemo: n.isDemo,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    deliveries: deliveries
      .filter((d) => d.notificationId === n.id)
      .map((d) => ({ channel: d.channel, status: d.status, attempts: d.attempts, lastError: d.lastError, deliveredAt: d.deliveredAt?.toISOString() ?? null })),
  }));
}

export async function markRead(db: Db, userId: string, input: { ids?: string[]; all?: boolean }): Promise<number> {
  const now = new Date();
  if (input.all) {
    const rows = await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return rows.length;
  }
  if (!input.ids?.length) return 0;
  const rows = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, input.ids), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}
