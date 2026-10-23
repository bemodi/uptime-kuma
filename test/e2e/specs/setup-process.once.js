import { expect, test } from "@playwright/test";
import {
    addVirtualAuthenticator,
    getSqliteDatabaseExists,
    login,
    passwordLogin,
    saveAdminPasskey,
    screenshot,
    takeSqliteSnapshot,
} from "../util-test";

test.describe("Uptime Kuma Setup", () => {
    test.skip(() => getSqliteDatabaseExists(), "Must only run once per session");

    test.afterEach(async ({ page }, testInfo) => {
        await screenshot(testInfo, page);
    });

    /*
     * Setup
     */

    test("setup sqlite", async ({ page }, testInfo) => {
        await page.goto("./setup-database");
        await page.getByText("SQLite").click();
        await page.getByRole("button", { name: "Next" }).click();
        await screenshot(testInfo, page);
        await page.waitForURL("/setup"); // ensures the server is ready to continue to the next test
    });

    test("setup admin", async ({ page }, testInfo) => {
        const authenticator = await addVirtualAuthenticator(page);
        await page.goto("./setup");
        await page.getByRole("textbox", { name: "Username" }).click();
        await page.getByRole("textbox", { name: "Username" }).fill("admin");
        await page.getByRole("textbox", { name: "Password", exact: true }).fill("Kuma-E2E-8f4Q2xR9p");
        await page.getByRole("textbox", { name: "Repeat Password" }).fill("Kuma-E2E-8f4Q2xR9p");
        await page.getByRole("button", { name: "Create" }).click();
        // User is auto-logged in and redirected to dashboard
        await page.waitForURL("/dashboard");

        // Fork: login requires a passkey, so the new admin sets one up first
        await expect(page.getByRole("heading", { name: "Set up a passkey" })).toBeVisible();
        await screenshot(testInfo, page);
        await page.getByPlaceholder("Name, e.g. MacBook or YubiKey").fill("e2e authenticator");
        await page.getByRole("button", { name: "Create passkey" }).click();
        await page.getByText("Add New Monitor").first().waitFor();
        await saveAdminPasskey(authenticator);
    });

    /*
     * All other tests should be run after setup
     */

    test("login", async ({ page }) => {
        await page.goto("./dashboard");
        await login(page);
    });

    test("failed login shows error alert", async ({ page }, testInfo) => {
        await page.goto("./dashboard");
        await passwordLogin(page, "admin", "wrongpassword");
        await page.waitForSelector(".alert.alert-danger", { state: "visible" });
        await screenshot(testInfo, page);
    });

    test("password login is rejected once the account has a passkey", async ({ page }, testInfo) => {
        await page.goto("./dashboard");
        await passwordLogin(page, "admin", "Kuma-E2E-8f4Q2xR9p");
        await expect(page.locator(".alert.alert-danger")).toContainText("Please log in with your passkey");
        await screenshot(testInfo, page);
    });

    test("logout", async ({ page }) => {
        await page.goto("./dashboard");
        await login(page);
        await page.getByText("A", { exact: true }).click();
        await page.getByRole("button", { name: "Log out" }).click();
    });

    test("take sqlite snapshot", async ({ page }) => {
        await takeSqliteSnapshot(page);
    });
});
