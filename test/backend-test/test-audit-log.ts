import { test } from "node:test";
import assert from "node:assert";
import { R } from "redbean-node";
import dayjs from "dayjs";
import { auth } from "../../server/better-auth";
import { CLIENT_IP_HEADER } from "../../server/audit-auth";
import { createUser } from "../../server/socket-handlers/user-socket-handler";
import { SoftAuthenticator, TestBrowser } from "../soft-authenticator";
// @ts-ignore
import { auditSocketMiddleware, clearOldAuditLog, summarizeArgs } from "../../server/audit-log.js";

// @ts-ignore
import TestDB from "../mock-testdb";

const testDb = new TestDB("./data/test-audit-log");
const BASE = "http://localhost:3000/api/auth";
const ORIGIN = "http://localhost:3000";
const CLIENT_IP = "203.0.113.7";

/**
 * A browser whose requests carry the client IP header like the better-auth router sets it
 * @returns TestBrowser
 */
function browser() {
    return new TestBrowser(
        BASE,
        (req) => {
            const headers = new Headers(req.headers);
            headers.set(CLIENT_IP_HEADER, CLIENT_IP);
            return auth().handler(new Request(req, { headers }));
        },
        ORIGIN
    );
}

/**
 * Entries written so far, oldest first
 * @returns Audit rows
 */
async function entries() {
    // Entries are written without awaiting the caller, give them a moment
    await new Promise((resolve) => setTimeout(resolve, 50));
    return R.knex("audit_log").orderBy("id");
}

/**
 * Feed one packet through the socket middleware and answer its ack
 * @param socket Fake socket
 * @param packet Event name and arguments, with an ack function last if any
 * @param response Ack response
 * @returns Whether the middleware let the packet through
 */
async function sendPacket(socket: object, packet: any[], response?: object) {
    const middleware = auditSocketMiddleware(socket, async () => "198.51.100.1");
    await new Promise<void>((resolve) => middleware(packet, () => resolve()));
    const last = packet[packet.length - 1];
    if (typeof last === "function") {
        last(response);
    }
}

test("Audit log", async (t) => {
    t.before(async () => {
        process.env.UPTIME_KUMA_DISABLE_LEAK_PWD_CHECK = "1";
        await testDb.create();
    });

    t.after(async () => {
        await testDb.destroy();
    });

    await t.test("arguments are stored only through the allowlist", () => {
        assert.deepStrictEqual(summarizeArgs("setSettings", [{ primaryBaseURL: "x" }, "current-password"]), [
            { keys: ["primaryBaseURL"] },
            "[string]",
        ]);
        assert.deepStrictEqual(
            summarizeArgs("add", [{ name: "Web", type: "http", url: "https://u:p@x", basic_auth_pass: "secret" }]),
            [{ name: "Web", type: "http" }]
        );
        assert.deepStrictEqual(summarizeArgs("addStatusPage", ["My Page", "my-page"]), ["My Page", "my-page"]);
        assert.deepStrictEqual(summarizeArgs("cloudflared_start", ["tunnel-token"]), ["[string]"]);
    });

    await t.test("socket middleware records changes with their result, but not reads", async () => {
        await R.knex("audit_log").del();
        const socket = { userID: "u1", session: { user: { username: "alice" } } };

        await sendPacket(socket, ["editMonitor", { id: 7, name: "Web", basic_auth_pass: "secret" }, () => {}], {
            ok: true,
        });
        await sendPacket(socket, ["deleteMonitor", 8, false, () => {}], { ok: false, msg: "Not found" });
        await sendPacket(socket, ["getMonitorList", () => {}], { ok: true });
        await sendPacket({}, ["editMonitor", { id: 9 }, () => {}], { ok: true });

        const rows = await entries();
        assert.deepStrictEqual(
            rows.map((r) => [r.username, r.ip, r.source, r.action, JSON.parse(r.target), Boolean(r.ok), r.msg]),
            [
                ["alice", "198.51.100.1", "socket", "editMonitor", { args: [{ id: 7, name: "Web" }] }, true, null],
                ["alice", "198.51.100.1", "socket", "deleteMonitor", { args: [8, false] }, false, "Not found"],
            ]
        );
        assert.ok(!JSON.stringify(rows).includes("secret"));
    });

    await t.test("login events are recorded, including failures and the passkey rule", async () => {
        await R.knex("audit_log").del();
        const password = await createUser({ username: "alice" });
        const authenticator = new SoftAuthenticator("localhost", ORIGIN);

        await browser().req("POST", "/sign-in/username", { username: "alice", password: "wrong-password" });

        const session = browser();
        await session.req("POST", "/sign-in/username", { username: "alice", password });
        const options = await session.req("GET", "/passkey/generate-register-options");
        await session.req("POST", "/passkey/verify-registration", {
            response: authenticator.create(options.json),
            name: "Laptop",
        });

        await browser().req("POST", "/sign-in/username", { username: "alice", password });

        const [cred] = authenticator.creds;
        for (const uv of [false, true]) {
            const b = browser();
            const authOptions = await b.req("GET", "/passkey/generate-authenticate-options");
            await b.req("POST", "/passkey/verify-authentication", {
                response: authenticator.get(authOptions.json, cred, { uv }),
            });
            if (uv) {
                await b.req("POST", "/sign-out", {});
            }
        }

        const rows = await entries();
        assert.deepStrictEqual(
            rows.map((r) => [r.action, r.username, Boolean(r.ok), r.msg, r.ip]),
            [
                ["login:password", "alice", false, "INVALID_USERNAME_OR_PASSWORD", CLIENT_IP],
                ["login:password", "alice", true, null, CLIENT_IP],
                ["addPasskey", "alice", true, null, CLIENT_IP],
                ["login:password", "alice", false, "PASSKEY_REQUIRED", CLIENT_IP],
                ["login:passkey", "alice", false, "PASSKEY_USER_VERIFICATION_REQUIRED", CLIENT_IP],
                ["login:passkey", "alice", true, null, CLIENT_IP],
                ["logout", "alice", true, null, CLIENT_IP],
            ]
        );
        assert.deepStrictEqual(JSON.parse(rows[2].target), { name: "Laptop" });
        assert.ok(!JSON.stringify(rows).includes(password));
    });

    await t.test("old entries are removed after the keep period", async () => {
        await R.knex("audit_log").del();
        const old = R.isoDateTimeMillis(dayjs.utc().subtract(400, "day"));
        const recent = R.isoDateTimeMillis(dayjs.utc().subtract(10, "day"));
        await R.knex("audit_log").insert([
            { time: old, source: "socket", action: "old" },
            { time: recent, source: "socket", action: "recent" },
        ]);

        process.env.UPTIME_KUMA_AUDIT_LOG_KEEP_DAYS = "0";
        await clearOldAuditLog();
        assert.strictEqual((await entries()).length, 2, "0 keeps everything");

        delete process.env.UPTIME_KUMA_AUDIT_LOG_KEEP_DAYS;
        await clearOldAuditLog();
        assert.deepStrictEqual(
            (await entries()).map((r) => r.action),
            ["recent"]
        );
    });
});
