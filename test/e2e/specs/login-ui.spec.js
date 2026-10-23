import { expect, test } from "@playwright/test";
import { login, screenshot } from "../util-test";

/**
 * WCAG contrast ratio between an element's text colour and the page background
 * @param {import('@playwright/test').Locator} locator Element with text
 * @returns {Promise<number>} Contrast ratio (1 to 21)
 */
async function contrastWithPage(locator) {
    return locator.evaluate((el) => {
        const rgb = (value) =>
            value
                .match(/\d+(\.\d+)?/g)
                .slice(0, 3)
                .map(Number);
        const luminance = ([r, g, b]) => {
            const [R, G, B] = [r, g, b].map((c) => {
                c /= 255;
                return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * R + 0.7152 * G + 0.0722 * B;
        };
        let node = el;
        let background = "rgba(0, 0, 0, 0)";
        while (node && /rgba\(.*, 0\)|transparent/.test(background)) {
            background = getComputedStyle(node).backgroundColor;
            node = node.parentElement;
        }
        const a = luminance(rgb(getComputedStyle(el).color));
        const b = luminance(rgb(background));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
}

test.describe("Login page", () => {
    for (const colorScheme of ["light", "dark"]) {
        test(`password login link is readable in ${colorScheme} mode`, async ({ page }, testInfo) => {
            await page.emulateMedia({ colorScheme });
            await page.goto("./dashboard");
            const link = page.getByRole("button", { name: "Log in with password" });
            await expect(link).toBeVisible();
            expect(await contrastWithPage(link)).toBeGreaterThanOrEqual(4.5);
            await screenshot(testInfo, page);
        });
    }

    // The minifier keeps only one of backdrop-filter / -webkit-backdrop-filter; Chromium needs the standard one
    test("login card is frosted glass in light mode", async ({ page }) => {
        await page.emulateMedia({ colorScheme: "light" });
        await page.goto("./dashboard");
        const card = page.locator(".form-container .form");
        await expect(card).toBeVisible();
        expect(await card.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain("blur(50px)");
    });

    // backdrop-filter on a panel would trap modals inside it below Bootstrap's backdrop
    test("panels that hold dialogs have no backdrop-filter", async ({ page }) => {
        await page.emulateMedia({ colorScheme: "light" });
        await page.goto("./settings/api-keys");
        await login(page);
        const panel = page.locator(".shadow-box-settings");
        await expect(panel).toBeVisible();
        expect(await panel.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");
    });

    test("?login=password opens the password form directly", async ({ page }) => {
        await page.goto("./dashboard?login=password");
        await expect(page.getByPlaceholder("Username")).toBeVisible();
        await expect(page.getByPlaceholder("Password")).toBeVisible();
    });
});
