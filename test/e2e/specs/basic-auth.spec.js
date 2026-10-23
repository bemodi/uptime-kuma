import { test, expect } from "@playwright/test";
import { login, restoreSqliteSnapshot } from "../util-test";

const serverUrl = require("../../../playwright.config.js").url;

test.describe("/metrics basic auth", () => {
    test.beforeEach(async () => {
        await restoreSqliteSnapshot();
    });

    test("returns 401 without credentials", async ({ request }) => {
        const response = await request.get(`${serverUrl}/metrics`);
        expect(response.status()).toBe(401);
    });

    test("returns 401 with wrong password", async ({ request }) => {
        const response = await request.get(`${serverUrl}/metrics`, {
            headers: {
                Authorization: "Basic " + btoa("admin:wrongpassword"),
            },
        });
        expect(response.status()).toBe(401);
    });

    // Fork: username and password would bypass the passkey, so only API keys are accepted
    test("returns 401 with correct username and password", async ({ request }) => {
        const response = await request.get(`${serverUrl}/metrics`, {
            headers: {
                Authorization: "Basic " + btoa("admin:Kuma-E2E-8f4Q2xR9p"),
            },
        });
        expect(response.status()).toBe(401);
    });

    test("returns prometheus metrics with an API key", async ({ page, request }) => {
        await page.goto("./settings/api-keys");
        await login(page);
        await page.getByRole("button", { name: "Add API Key" }).click();
        await page.locator("#name").fill("e2e metrics");
        await page.getByLabel("Don't expire").check();
        await page.getByRole("button", { name: "Generate" }).click();

        const keyInput = page.locator(".modal.show").filter({ hasText: "Key Added" }).locator("input");
        await expect(keyInput).not.toHaveValue("");
        const apiKey = await keyInput.inputValue();

        const response = await request.get(`${serverUrl}/metrics`, {
            headers: {
                Authorization: "Basic " + btoa(":" + apiKey),
            },
        });
        expect(response.status()).toBe(200);
        const body = await response.text();
        expect(body).toContain("# HELP");
        expect(body).toContain("# TYPE");
    });
});
