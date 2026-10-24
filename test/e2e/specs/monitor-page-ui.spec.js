import { expect, test } from "@playwright/test";
import { login, restoreSqliteSnapshot, screenshot } from "../util-test";

/**
 * Columns of the statistics tiles and every label or number wider than its box
 * @param {import("@playwright/test").Page} page Page
 * @returns {Promise<{columns: number, overflow: string[]}>} Layout of the tiles
 */
async function tileLayout(page) {
    return page.evaluate(() => {
        const row = document.querySelector(".shadow-box.stats > .row");
        const overflow = [...row.querySelectorAll("h4, p, .num")]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => el.textContent.trim());
        return { columns: getComputedStyle(row).gridTemplateColumns.split(" ").length, overflow };
    });
}

test.describe("Monitor page in the glass theme", () => {
    test.beforeEach(async () => {
        await restoreSqliteSnapshot();
    });

    test("statistics tiles fit and fill equal rows", async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: "light" });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("./dashboard");
        await login(page);

        await page.goto("./add");
        await page.getByTestId("monitor-type-select").selectOption("http");
        await page.getByTestId("friendly-name-input").fill("Tile Website");
        await page.getByTestId("url-input").fill("http://localhost:3001/api/auth/ok");
        await page.getByTestId("save-button").click();
        await page.waitForURL("/dashboard/*");
        await expect(page.getByTestId("monitor-status")).toBeVisible();

        // Five tiles on a wide screen: one row, nothing runs over the edge
        expect(await tileLayout(page)).toEqual({ columns: 5, overflow: [] });

        // The status is a calm pill, not the 30 px block of upstream
        expect(await page.getByTestId("monitor-status").evaluate((el) => getComputedStyle(el).fontSize)).toBe("20px");
        await screenshot(testInfo, page);

        // Narrower: two rows of three and two instead of four and one
        await page.setViewportSize({ width: 1100, height: 900 });
        await expect.poll(async () => (await tileLayout(page)).columns).toBe(3);
        expect((await tileLayout(page)).overflow).toEqual([]);
    });
});
