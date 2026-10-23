import { expect, test } from "@playwright/test";
import { login, restoreSqliteSnapshot, screenshot } from "../util-test";

const serverUrl = require("../../../playwright.config.js").url;

/**
 * Log in with username and password on the login form
 * @param {import('@playwright/test').Page} page Page
 * @param {string} username Username
 * @param {string} password Password
 * @returns {Promise<void>}
 */
async function loginAs(page, username, password) {
    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
}

test.describe("Multiple users (all admins)", () => {
    test.beforeEach(async () => {
        await restoreSqliteSnapshot();
    });

    test("a second user sees live updates and can be deactivated", async ({ page, browser }, testInfo) => {
        // Admin adds bob and gets a start password
        await page.goto("./settings/users");
        await login(page);
        await page.getByTestId("add-user-button").click();
        await page.locator("#new-user-username").fill("bob");
        await page.locator(".modal.show").getByRole("button", { name: "Add User" }).click();

        const passwordInput = page.getByTestId("initial-password").locator("input");
        await expect(passwordInput).not.toHaveValue("");
        const password = await passwordInput.inputValue();
        await screenshot(testInfo, page);
        await page.locator(".modal.show").getByRole("button", { name: "Continue" }).click();
        await expect(page.getByTestId("user-item")).toHaveCount(2);

        // Bob logs in with the start password in his own browser context
        const bobContext = await browser.newContext();
        const bobPage = await bobContext.newPage();
        await bobPage.goto(serverUrl + "/dashboard");
        await loginAs(bobPage, "bob", password);
        await expect(bobPage.getByText("Add New Monitor").first()).toBeVisible();

        // Admin adds a monitor, Bob sees it live without reloading
        await page.goto("./add");
        await page.getByTestId("monitor-type-select").selectOption("push");
        await page.getByTestId("friendly-name-input").fill("Shared Push Monitor");
        await page.getByTestId("save-button").click();
        await page.waitForURL("/dashboard/*");
        await expect(bobPage.getByText("Shared Push Monitor").first()).toBeVisible();
        await screenshot(testInfo, bobPage);

        // Admin deactivates bob: his session ends and he cannot log in again
        await page.goto("./settings/users");
        const bobItem = page.getByTestId("user-item").filter({ hasText: "bob" });
        await bobItem.getByTestId("deactivate-user-button").click();
        await page.locator(".modal.show").getByRole("button", { name: "Yes" }).click();
        await expect(bobItem).toContainText("Inactive");

        await expect(bobPage.getByPlaceholder("Username")).toBeVisible();
        await loginAs(bobPage, "bob", password);
        await expect(bobPage.locator(".alert.alert-danger")).toBeVisible();
        await screenshot(testInfo, bobPage);

        await bobContext.close();
    });

    test("own account cannot be deactivated or deleted", async ({ page }) => {
        await page.goto("./settings/users");
        await login(page);
        const self = page.getByTestId("user-item").filter({ hasText: "admin" });
        await expect(self).toContainText("You");
        await expect(self.getByRole("button")).toHaveCount(0);
    });
});
