import { test } from "node:test";
import assert from "node:assert";
import { auth } from "../../server/better-auth";
import { createUser } from "../../server/socket-handlers/user-socket-handler";
import { SoftAuthenticator, SoftCredential, TestBrowser } from "../soft-authenticator";

// @ts-ignore
import TestDB from "../mock-testdb";

const testDb = new TestDB("./data/test-passkey-policy");
const BASE = "http://localhost:3000/api/auth";
const ORIGIN = "http://localhost:3000";

/**
 * A browser that talks to the better-auth handler directly
 * @returns TestBrowser
 */
function browser() {
    return new TestBrowser(BASE, (req) => auth().handler(req), ORIGIN);
}

/**
 * Log in with username and password
 * @param username Username
 * @param password Password
 * @returns Browser and the response
 */
async function passwordLogin(username: string, password: string) {
    const b = browser();
    const res = await b.req("POST", "/sign-in/username", { username, password });
    return { b, res };
}

/**
 * Register a passkey for the logged-in browser
 * @param b Browser with a session
 * @param authenticator Authenticator to create the credential
 * @param opts Options
 * @param opts.uv Whether the authenticator verifies the user
 * @returns Status and JSON of the last response
 */
async function registerPasskey(b: TestBrowser, authenticator: SoftAuthenticator, { uv = true } = {}) {
    const options = await b.req("GET", "/passkey/generate-register-options");
    if (options.status !== 200) {
        return options;
    }
    return b.req("POST", "/passkey/verify-registration", { response: authenticator.create(options.json, { uv }) });
}

/**
 * Log in with a passkey only (no username)
 * @param authenticator Authenticator holding the credential
 * @param cred Credential to use
 * @param opts Options
 * @param opts.uv Whether the authenticator verifies the user
 * @returns Browser, login response and the resulting session user
 */
async function passkeyLogin(authenticator: SoftAuthenticator, cred: SoftCredential, { uv = true } = {}) {
    const b = browser();
    const options = await b.req("GET", "/passkey/generate-authenticate-options");
    const res = await b.req("POST", "/passkey/verify-authentication", {
        response: authenticator.get(options.json, cred, { uv }),
    });
    const session = await b.req("GET", "/get-session");
    return { b, res, user: session.json?.user?.username ?? null };
}

test("Passkey policy: login needs a passkey, 1 to 3 per account, user verification required", async (t) => {
    let password = "";
    const authenticator = new SoftAuthenticator("localhost", ORIGIN);

    t.before(async () => {
        process.env.UPTIME_KUMA_DISABLE_LEAK_PWD_CHECK = "1";
        await testDb.create();
        password = await createUser({ username: "alice" });
    });

    t.after(async () => {
        await testDb.destroy();
    });

    let session: TestBrowser;

    await t.test("password login without a passkey gives a session (first login)", async () => {
        const { b, res } = await passwordLogin("alice", password);
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        session = b;
    });

    await t.test("up to 3 passkeys can be registered, the 4th is rejected", async () => {
        for (let i = 1; i <= 3; i++) {
            const res = await registerPasskey(session, authenticator);
            assert.strictEqual(res.status, 200, `passkey ${i}: ${JSON.stringify(res.json)}`);
        }
        const fourth = await registerPasskey(session, authenticator);
        assert.strictEqual(fourth.status, 400);
        assert.strictEqual(fourth.json.code, "PASSKEY_LIMIT_REACHED");
    });

    await t.test("passkeys can be deleted down to one, the last one stays", async () => {
        const list = await session.req("GET", "/passkey/list-user-passkeys");
        assert.strictEqual(list.json.length, 3);

        const results = [];
        for (const pk of list.json) {
            results.push(await session.req("POST", "/passkey/delete-passkey", { id: pk.id }));
        }
        assert.deepStrictEqual(
            results.map((r) => r.status),
            [200, 200, 400]
        );
        assert.strictEqual(results[2].json.code, "PASSKEY_MINIMUM_REACHED");
    });

    await t.test("password login is rejected once the account has a passkey", async () => {
        const { b, res } = await passwordLogin("alice", password);
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.json.code, "PASSKEY_REQUIRED");
        const s = await b.req("GET", "/get-session");
        assert.strictEqual(s.json, null);
    });

    let remaining: SoftCredential;

    await t.test("passkey login without user verification is rejected", async () => {
        const list = await session.req("GET", "/passkey/list-user-passkeys");
        remaining = authenticator.creds.find((c) => c.credId.toString("base64url") === list.json[0].credentialID)!;
        const { res, user } = await passkeyLogin(authenticator, remaining, { uv: false });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.json.code, "PASSKEY_USER_VERIFICATION_REQUIRED");
        assert.strictEqual(user, null);
    });

    await t.test("passkey login with user verification gives a session, no username needed", async () => {
        const { res, user } = await passkeyLogin(authenticator, remaining);
        assert.strictEqual(res.status, 200, JSON.stringify(res.json));
        assert.strictEqual(user, "alice");
    });

    await t.test("a passkey without user verification cannot be registered", async () => {
        const fresh = await passkeyLogin(authenticator, remaining);
        const res = await registerPasskey(fresh.b, authenticator, { uv: false });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.json.code, "PASSKEY_USER_VERIFICATION_REQUIRED");
    });

    await t.test("a deactivated user cannot log in with a passkey", async () => {
        const { R } = await import("redbean-node");
        await R.knex("better_auth_user").where({ username: "alice" }).update({ banned: true });
        const { res, user } = await passkeyLogin(authenticator, remaining);
        assert.notStrictEqual(res.status, 200);
        assert.strictEqual(user, null);
        await R.knex("better_auth_user").where({ username: "alice" }).update({ banned: false });
    });
});
