/**
 * Subscription readiness. Entitlements are resolved on the server from the
 * user's plan stored in the database — never from a client-side flag. There is
 * no billing integration yet; every account is on the "personal" plan.
 * When billing is added, the plan must be set only from verified payment
 * provider webhooks.
 */
export interface Entitlements {
  maxWatchlists: number;
  maxAlertRules: number;
  maxNotes: number;
  externalNotificationChannels: boolean;
  historicalResearch: boolean;
}

const PLANS: Record<string, Entitlements> = {
  personal: { maxWatchlists: 25, maxAlertRules: 50, maxNotes: 2_000, externalNotificationChannels: true, historicalResearch: true },
};

export function entitlementsFor(plan: string): Entitlements {
  return PLANS[plan] ?? PLANS.personal;
}
