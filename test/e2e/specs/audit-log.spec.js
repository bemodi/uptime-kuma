import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { login, passwordLogin, restoreSqliteSnapshot, screenshot } from "../util-test";

test.describe("Audit log", () => {
    test.beforeEach(async () => {
        await restoreSqliteSnapshot();
    });

    test("shows logins and changes, filters failures and exports CSV", async ({ page }, testInfo) => {
        // A failed password attempt, then the real passkey login
        await page.goto("./dashboard");
        await passwordLogin(page, "admin", "wrongpassword");
        await expect(page.locator(".alert.alert-danger")).toBeVisible();
        await page.reload();
        await login(page);

        // A change
        await page.goto("./add");
        await page.getByTestId("monitor-type-select").selectOption("push");
        await page.getByTestId("friendly-name-input").fill("Audited Monitor");
        await page.getByTestId("save-button").click();
        await page.waitForURL("/dashboard/*");

        await page.goto("./settings/audit-log");
        const rows = page.getByTestId("audit-row");
        await expect(rows.filter({ hasText: "Audited Monitor" }).filter({ hasText: "add" })).toHaveCount(1);
        await expect(rows.filter({ hasText: "login:passkey" }).filter({ hasText: "Success" }).first()).toBeVisible();
        await expect(rows.filter({ has: page.locator("code", { hasText: /^setup$/ }) })).toHaveCount(1);
        await screenshot(testInfo, page);

        // Only failures
        await page.locator("#audit-result").selectOption("failed");
        await expect(rows.filter({ hasText: "login:password" }).first()).toBeVisible();
        await expect(rows.filter({ hasText: "Success" })).toHaveCount(0);

        // CSV export with the same filter
        const downloadPromise = page.waitForEvent("download");
        await page.getByRole("button", { name: "Export CSV" }).click();
        const download = await downloadPromise;
        const csv = fs.readFileSync(await download.path(), "utf8");
        expect(csv.split("\n")[0]).toBe("time,username,user_id,ip,source,action,target,ok,msg");
        expect(csv).toContain("login:password");
        expect(csv).not.toContain("login:passkey");
        expect(csv).not.toContain("wrongpassword");
    });
});
