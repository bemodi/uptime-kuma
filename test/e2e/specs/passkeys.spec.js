import { expect, test } from "@playwright/test";
import { addVirtualAuthenticator, login, restoreSqliteSnapshot, screenshot } from "../util-test";

test.describe("Passkey management", () => {
    test.beforeEach(async () => {
        await restoreSqliteSnapshot();
    });

    test("add, rename and delete passkeys, the last one stays", async ({ page }, testInfo) => {
        await page.goto("./settings/security");
        const { client, authenticatorId } = await login(page);

        const items = page.getByTestId("passkey-item");
        await expect(items).toHaveCount(1);
        await expect(items.first().getByRole("button", { name: "Delete" })).toBeDisabled();

        // A second authenticator, e.g. a security key. The first one already holds a passkey for this account.
        await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
        await addVirtualAuthenticator(page);
        await page.getByPlaceholder("Name, e.g. MacBook or YubiKey").fill("Security Key");
        await page.getByRole("button", { name: "Add Passkey" }).click();
        await expect(items).toHaveCount(2);
        await screenshot(testInfo, page);

        // Rename
        page.once("dialog", (dialog) => dialog.accept("Backup Key"));
        await items.filter({ hasText: "Security Key" }).getByRole("button", { name: "Rename" }).click();
        await expect(items.filter({ hasText: "Backup Key" })).toHaveCount(1);

        // Delete down to one; then delete is disabled again
        await items.filter({ hasText: "Backup Key" }).getByRole("button", { name: "Delete" }).click();
        await page.locator(".modal.show").getByRole("button", { name: "Yes" }).click();
        await expect(items).toHaveCount(1);
        await expect(items.first().getByRole("button", { name: "Delete" })).toBeDisabled();
        await screenshot(testInfo, page);
    });
});
