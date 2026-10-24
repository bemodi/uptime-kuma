import { expect, test } from "@playwright/test";
import { login, restoreSqliteSnapshot, screenshot } from "../util-test";

test.describe("Hosting info", () => {
    test.beforeEach(async () => {
        await restoreSqliteSnapshot();
    });

    // The test server only reaches localhost, so the lookup ends at "private network" without a DNS query outside
    test("the monitor page shows where the site is hosted", async ({ page }, testInfo) => {
        await page.goto("./dashboard");
        await login(page);

        await page.goto("./add");
        await page.getByTestId("monitor-type-select").selectOption("http");
        await page.getByTestId("friendly-name-input").fill("Hosted Website");
        await page.getByTestId("url-input").fill("http://localhost:3001/api/auth/ok");
        await page.getByTestId("save-button").click();
        await page.waitForURL("/dashboard/*");

        const chip = page.getByTestId("hosting-chip");
        await expect(chip).toContainText("Hosting");
        await expect(chip).toContainText("private network");
        await expect(chip).toHaveAttribute("title", /IP (127\.0\.0\.1|::1)/);
        // No certificate on plain HTTP
        await expect(page.getByTestId("issuer-chip")).toHaveCount(0);
        await screenshot(testInfo, page);
    });
});
