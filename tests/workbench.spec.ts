import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

const reviewLabel = "I’ve reviewed the sanitized payloads and export metadata.";

test("full workbench review, export, input recovery, and privacy flow", async ({
  page,
}) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:4173") &&
      !request.url().startsWith("ws://127.0.0.1:4173")
    )
      externalRequests.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Keep the edge cases." }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Before sanitized JSON" }),
  ).toContainText("[REDACTED]");
  const exportButton = page.getByRole("button", { name: /Export fixture/ });
  await expect(exportButton).toBeDisabled();
  await page.getByRole("checkbox", { name: reviewLabel }).check();
  const downloadEvent = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(
    "fixturefolio-payment-succeeded.json",
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await fs.readFile(path!, "utf8"));
  expect(exported.before.data.object.receipt_email).toBe("[REDACTED]");
  expect(exported.after.data.object.amount).toBe(2900);
  expect(JSON.stringify(exported)).not.toContain("alex@example.test");
  expect(exported.manifest.ruleVersion).toBe("1.0.0");
  await page.getByRole("button", { name: "Edit before original" }).click();
  await page
    .getByRole("textbox", { name: "Before original JSON" })
    .fill('{"broken":');
  await expect(page.getByRole("alert")).toContainText("Invalid JSON");
  await expect(
    page.getByRole("region", { name: "After sanitized JSON" }),
  ).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Before original JSON" })
    .fill('{"private note ":"private-string","ok":1}');
  await page.getByRole("button", { name: "Preview sanitized before" }).click();
  await page.getByRole("button", { name: "Your redaction paths" }).click();
  await page.getByLabel("One JSON Pointer per line").fill("/private note ");
  await expect(
    page.getByRole("region", { name: "Before sanitized JSON" }),
  ).not.toContainText("private-string");
  await page.getByRole("tab", { name: /Changes/ }).click();
  await expect(
    page.getByText("Compared before redaction.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Export preview" }).click();
  await page.getByLabel("Scenario", { exact: true }).fill("Reviewed fixture");
  await expect(
    page.getByRole("checkbox", { name: reviewLabel }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Open guide" }).click();
  await expect(
    page.getByRole("dialog", { name: "Good fixtures start with a review." }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("upload, review reset, keyboard tabs, and sample switching", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Before JSON file").setInputFiles({
    name: "fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"email":"upload@example.test","number":1}'),
  });
  await expect(
    page.getByRole("region", { name: "Before sanitized JSON" }),
  ).toContainText("[REDACTED]");
  await page.getByRole("checkbox", { name: reviewLabel }).check();
  await page
    .getByRole("button", { name: /GitHub Pull request updated/ })
    .click();
  await expect(
    page.getByRole("checkbox", { name: reviewLabel }),
  ).not.toBeChecked();
  await page.getByRole("tab", { name: "Payloads" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Changes/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Export preview" })).toBeFocused();
  await page.getByRole("button", { name: "New blank fixture" }).click();
  await expect(
    page.getByRole("textbox", { name: "Before original JSON" }),
  ).toHaveValue("");
  await page
    .getByRole("textbox", { name: "Before original JSON" })
    .fill("null");
  await page
    .getByRole("textbox", { name: "After original JSON" })
    .fill("false");
  await page.getByRole("button", { name: "Preview sanitized before" }).click();
  await page.getByRole("button", { name: "Preview sanitized after" }).click();
  await expect(
    page.getByRole("region", { name: "Before sanitized JSON" }),
  ).toHaveText(/null/);
});

test("desktop and mobile layouts render without horizontal overflow", async ({
  page,
}, testInfo) => {
  await fs.mkdir("test-results/screenshots", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Keep the edge cases." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/screenshots/fixturefolio-desktop.png",
    fullPage: true,
  });
  await testInfo.attach("desktop", {
    path: "test-results/screenshots/fixturefolio-desktop.png",
    contentType: "image/png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/screenshots/fixturefolio-mobile.png",
    fullPage: true,
  });
  await testInfo.attach("mobile", {
    path: "test-results/screenshots/fixturefolio-mobile.png",
    contentType: "image/png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open guide" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close guide" }).click();
  await page.getByRole("checkbox", { name: reviewLabel }).check();
  await expect(
    page.getByRole("button", { name: /Export fixture/ }),
  ).toBeEnabled();
});
