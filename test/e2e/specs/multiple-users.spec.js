import { expect, test } from "@playwright/test";
import { addVirtualAuthenticator, login, passwordLogin, restoreSqliteSnapshot, screenshot } from "../util-test";

const serverUrl = require("../../../playwright.config.js").url;

/**
 * Read the generated password from the dialog and close it
 * @param {import('@playwright/test').Page} page Admin page
 * @returns {Promise<string>} Password
 */
async function takeShownPassword(page) {
    const passwordInput = page.getByTestId("initial-password").locator("input");
    await expect(passwordInput).not.toHaveValue("");
    const password = await passwordInput.inputValue();
    const link = await page.getByTestId("first-login-link").locator("input").inputValue();
    await page.locator(".modal.show").getByRole("button", { name: "Continue" }).click();
    return { password, link };
}

/**
 * First login with a password: the user has to set up a passkey before anything else
 * @param {import('@playwright/test').Page} page User page with a virtual authenticator
 * @param {string} username Username
 * @param {string} password Start password
 * @returns {Promise<void>}
 */
async function firstLogin(page, username, password) {
    await passwordLogin(page, username, password);
    await setUpPasskey(page);
}

/**
 * The user has to set up a passkey before anything else
 * @param {import('@playwright/test').Page} page User page with a virtual authenticator
 * @returns {Promise<void>}
 */
async function setUpPasskey(page) {
    await expect(page.getByRole("heading", { name: "Set up a passkey" })).toBeVisible();
    await expect(page.getByText("Add New Monitor")).toHaveCount(0);
    await page.getByRole("button", { name: "Create passkey" }).click();
    await page.getByText("Add New Monitor").first().waitFor();
}

test.describe("Multiple users (all admins)", () => {
    test.beforeEach(async () => {
        await restoreSqliteSnapshot();
    });

    test("a second user sets up a passkey, sees live updates, can be reset and deactivated", async ({
        page,
        browser,
    }, testInfo) => {
        // Admin adds bob and gets a start password
        await page.goto("./settings/users");
        await login(page);
        await page.getByTestId("add-user-button").click();
        await page.locator("#new-user-username").fill("bob");
        await page.locator(".modal.show").getByRole("button", { name: "Add User" }).click();
        const { password, link } = await takeShownPassword(page);
        expect(link).toBe(serverUrl + "/dashboard?login=password");
        const bobItem = page.getByTestId("user-item").filter({ hasText: "bob" });
        await expect(bobItem).toContainText("No passkey yet");

        // Bob logs in with the start password and has to set up a passkey first
        const bobContext = await browser.newContext();
        const bobPage = await bobContext.newPage();
        await addVirtualAuthenticator(bobPage);

        // The first-login link opens the password form directly
        await bobPage.goto(link);
        await bobPage.getByPlaceholder("Username").fill("bob");
        await bobPage.getByPlaceholder("Password").fill(password);
        await bobPage.getByRole("button", { name: "Log in", exact: true }).click();
        await setUpPasskey(bobPage);
        await screenshot(testInfo, bobPage);

        // From now on the password alone is not enough for bob
        await page.reload();
        await expect(bobItem).toContainText("Passkeys: 1");

        // Admin adds a monitor, Bob sees it live without reloading
        await page.goto("./add");
        await page.getByTestId("monitor-type-select").selectOption("push");
        await page.getByTestId("friendly-name-input").fill("Shared Push Monitor");
        await page.getByTestId("save-button").click();
        await page.waitForURL("/dashboard/*");
        await expect(bobPage.getByText("Shared Push Monitor").first()).toBeVisible();

        // Admin resets bob's access: passkeys gone, new password, bob is logged out
        await page.goto("./settings/users");
        await bobItem.getByRole("button", { name: "Reset Access" }).click();
        await page.locator(".modal.show").getByRole("button", { name: "Yes" }).click();
        const { password: newPassword } = await takeShownPassword(page);
        await expect(bobItem).toContainText("No passkey yet");
        // Bob is logged out: his page shows the login again (the form directly, he came via the first-login link)
        await expect(
            bobPage.getByPlaceholder("Username").or(bobPage.getByRole("button", { name: "Log in with passkey" }))
        ).toBeVisible();
        await expect(bobPage.getByText("Add New Monitor")).toHaveCount(0);
        await firstLogin(bobPage, "bob", newPassword);

        // Admin deactivates bob: his session ends and he cannot log in again
        await bobItem.getByTestId("deactivate-user-button").click();
        await page.locator(".modal.show").getByRole("button", { name: "Yes" }).click();
        await expect(bobItem).toContainText("Inactive");

        await bobPage.goto(serverUrl + "/dashboard");
        await bobPage.getByRole("button", { name: "Log in with passkey" }).click();
        await expect(bobPage.locator(".alert.alert-danger")).toBeVisible();
        await screenshot(testInfo, bobPage);

        await bobContext.close();
    });

    test("own account cannot be reset, deactivated or deleted", async ({ page }) => {
        await page.goto("./settings/users");
        await login(page);
        const self = page.getByTestId("user-item").filter({ hasText: "admin" });
        await expect(self).toContainText("You");
        await expect(self.getByRole("button")).toHaveCount(0);
    });
});
