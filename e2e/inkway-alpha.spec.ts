import { test, expect } from "@playwright/test";
import { loginAsDefault } from "./helpers";

test("Inkway routes and issue entry points load without seeded run data", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const slug = await loginAsDefault(page);

  // Avoid networkidle because the app keeps a realtime connection open. Wait
  // for each route's own content; first visits in dev may compile lazily.
  const routes = [
    ["runtimes", "Providers"],
    ["agents", "Agents"],
    ["fastpaths", "FastPaths"],
    ["inbox", "Inbox"],
    ["settings", "Settings"],
    ["issues", "Issues"],
  ] as const;
  for (const [route, heading] of routes) {
    await page.goto(`/${slug}/${route}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("body")).not.toContainText("Application error");
  }

  await page.getByRole("main").getByRole("button", { name: "New Issue", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toBeVisible();
  await page.getByRole("textbox", { name: "Issue title" }).press("Escape");

  await page.goto(`/${slug}/agents/new`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Issues", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible({ timeout: 60_000 });
});
