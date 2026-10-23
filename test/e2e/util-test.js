import { expect } from "@playwright/test";
const fs = require("fs");
const path = require("path");
const serverUrl = require("../../playwright.config.js").url;

const dbPath = "./../../data/playwright-test/kuma.db";

/**
 * @param {TestInfo} testInfo Test info
 * @param {Page} page Page
 * @returns {Promise<void>}
 */
export async function screenshot(testInfo, page) {
    const screenshot = await page.screenshot();
    await testInfo.attach("screenshot", {
        body: screenshot,
        contentType: "image/png",
    });
}

// The admin's passkey from the setup run, so every test can log in with it (fork: passkey-only login)
const adminPasskeyPath = path.resolve(__dirname, "./../../data/playwright-test/e2e-admin-passkey.json");

/**
 * Attach a virtual WebAuthn authenticator (platform, with user verification) to a page
 * @param {Page} page Page
 * @returns {Promise<{client: object, authenticatorId: string}>} CDP session and authenticator
 */
export async function addVirtualAuthenticator(page) {
    const client = await page.context().newCDPSession(page);
    await client.send("WebAuthn.enable");
    const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
        options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });
    return { client, authenticatorId };
}

/**
 * Store the admin's passkey from an authenticator, including its sign counter
 * @param {{client: object, authenticatorId: string}} authenticator Authenticator holding the passkey
 * @returns {Promise<void>}
 */
export async function saveAdminPasskey({ client, authenticatorId }) {
    const { credentials } = await client.send("WebAuthn.getCredentials", { authenticatorId });
    fs.writeFileSync(adminPasskeyPath, JSON.stringify(credentials[0]));
}

/**
 * Log in as admin with the stored passkey
 * @param {Page} page Page
 * @returns {Promise<{client: object, authenticatorId: string}>} The authenticator used
 */
export async function login(page) {
    const authenticator = await addVirtualAuthenticator(page);
    await authenticator.client.send("WebAuthn.addCredential", {
        authenticatorId: authenticator.authenticatorId,
        credential: JSON.parse(fs.readFileSync(adminPasskeyPath, "utf8")),
    });
    await page.getByRole("button", { name: "Log in with passkey" }).click();
    await page.getByText("Add New Monitor").first().waitFor();

    // Keep the stored sign counter ahead of the server's
    await saveAdminPasskey(authenticator);
    return authenticator;
}

/**
 * Log in with username and password (first login or after an access reset)
 * @param {Page} page Page
 * @param {string} username Username
 * @param {string} password Password
 * @returns {Promise<void>}
 */
export async function passwordLogin(page, username, password) {
    // The form is open already when the page came from a first-login link (?login=password)
    const usernameInput = page.getByPlaceholder("Username");
    const toggle = page.getByRole("button", { name: "Log in with password" });
    await expect(usernameInput.or(toggle)).toBeVisible();
    if (!(await usernameInput.isVisible())) {
        await toggle.click();
    }
    await usernameInput.fill(username);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
}

/**
 * Determines if the SQLite database has been created. This indicates setup has completed.
 * @returns {boolean} True if exists
 */
export function getSqliteDatabaseExists() {
    return fs.existsSync(path.resolve(__dirname, dbPath));
}

/**
 * Makes a request to the server to take a snapshot of the SQLite database.
 * @param {Page|null} page Page
 * @returns {Promise<Response>} Promise of response from snapshot request.
 */
export async function takeSqliteSnapshot(page = null) {
    if (page) {
        return page.goto("./_e2e/take-sqlite-snapshot");
    } else {
        return fetch(`${serverUrl}/_e2e/take-sqlite-snapshot`);
    }
}

/**
 * Makes a request to the server to restore the snapshot of the SQLite database.
 * @returns {Promise<Response>} Promise of response from restoration request.
 */
export async function restoreSqliteSnapshot() {
    return fetch(`${serverUrl}/_e2e/restore-sqlite-snapshot`);
}
