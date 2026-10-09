import { expect, test, type Page } from "@playwright/test";
import { TEST_OWNER } from "./fixtures";

/**
 * Main user journey against the real application (production build, demo mode,
 * no external network sources). Data is the fictional demo script processed by
 * the real pipeline.
 */
test.describe.configure({ mode: "serial" });

async function waitForFeedRows(page: Page, minRows = 5) {
  await expect
    .poll(
      async () => {
        await page.goto("/feed");
        return page.getByTestId("feed-row").count();
      },
      { timeout: 90_000, intervals: [2_000, 3_000, 5_000] },
    )
    .toBeGreaterThanOrEqual(minRows);
}

test("main research journey", async ({ page }) => {
  // 1. Open the application → first-run owner account creation.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Create the owner account" })).toBeVisible();
  await page.getByLabel("Display name").fill(TEST_OWNER.displayName);
  await page.getByLabel("Email").fill(TEST_OWNER.email);
  await page.getByLabel("Password").fill(TEST_OWNER.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("overview")).toBeVisible();

  // 9. Demo/live status is explicit: demo only (no live sources configured in this run).
  await expect(page.getByTestId("data-mode")).toHaveAttribute("data-mode", "demo");
  await expect(page.getByText("Demo mode is on.")).toBeVisible();

  // 2. View the feed: rows appear and every sample row is labelled.
  await waitForFeedRows(page);
  const rows = page.getByTestId("feed-row");
  expect(await rows.count()).toBe(await page.getByTestId("feed-row").filter({ hasText: "Sample data" }).count());

  // 3. Apply filters: credibility = Disputed.
  await page.getByRole("button", { name: "Credibility" }).click();
  await page.getByRole("listbox", { name: "Credibility" }).getByText("Disputed", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/verification=disputed/);
  await expect(page.getByTestId("feed-row")).toHaveCount(1);
  await expect(page.getByTestId("feed-row").first()).toContainText("Orbix");

  // 4. Open the event investigation.
  await page.getByTestId("feed-row").first().getByRole("link", { name: "Open investigation" }).click();
  await expect(page.getByTestId("event-detail")).toBeVisible();

  // 5. Inspect source evidence: repeats are not independent; the denial is a contradiction.
  const evidence = page.getByTestId("source-evidence");
  await expect(evidence.locator('[data-role="contradiction"]')).toHaveCount(1);
  expect(await evidence.locator('[data-role="repeat"]').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("verification")).toContainText("Disputed");
  await expect(page.getByTestId("interpretation")).toContainText("Interpretation — not verified fact");

  // 6. Save a research note from the event.
  await page.getByTestId("create-note").click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.locator('input[name="title"]')).not.toHaveValue("");
  await page.locator('textarea[name="thesis"]').fill("E2E: the acquisition rumor is unlikely given the issuer's denial.");
  await page.locator('textarea[name="invalidation"]').fill("A definitive agreement or regulatory filing.");
  await page.getByTestId("save-note").click();
  await expect(page).toHaveURL(/\/research\/[0-9a-f-]{36}$/);
  await page.goto("/research");
  await expect(page.getByTestId("notes-list")).toContainText("Orbix");

  // 7. Configure a watchlist.
  await page.goto("/watchlists");
  await page.getByTestId("new-watchlist").click();
  const editor = page.getByTestId("watchlist-editor");
  await editor.getByPlaceholder("e.g. Semiconductors").fill("E2E Semis");
  await editor.getByLabel("Add asset").fill("HLCN.DEMO");
  await editor.getByLabel("Add asset").press("Enter");
  await expect(editor).toContainText("HLCN.DEMO");
  await editor.getByRole("button", { name: "Save watchlist" }).click();
  await expect(page.getByText("E2E Semis").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /E2E Semis/ })).toBeVisible();

  // 8. Configure an alert threshold.
  await page.goto("/alerts?tab=rules");
  await page.getByTestId("new-rule").click();
  await page.locator('input[name="ruleName"]').fill("E2E critical only");
  await page.getByTestId("rule-min-importance").fill("80");
  await page.getByTestId("save-rule").click();
  await expect(page.getByTestId("rule-list")).toContainText("E2E critical only");
  await expect(page.getByTestId("rule-list")).toContainText("imp ≥ 80");

  // 10. Expected handling when an integration is unavailable.
  await page.goto("/status");
  await expect(page.getByTestId("status-mode")).toContainText(/demo/i);
  await expect(page.getByText("not configured", { exact: false }).first()).toBeVisible();
  await page.goto("/settings?tab=integrations");
  const xPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "X API v2" }) });
  await expect(xPanel).toContainText("not configured");
  await expect(xPanel).toContainText("X_BEARER_TOKEN");

  // Unknown event → error state, not a crash or fabricated content.
  await page.goto("/events/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("alert").filter({ hasText: "Could not load data" })).toContainText("Event not found");
});
