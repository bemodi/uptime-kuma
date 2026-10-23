import { test } from "node:test";
import assert from "node:assert";
import { instanceNameFromHostname } from "../../src/util";
// @ts-ignore
import { getInstanceName } from "../../server/util-server.js";

test("Instance name from the subdomain (fork: no product name)", async (t) => {
    await t.test("first label of the hostname", () => {
        assert.strictEqual(instanceNameFromHostname("watchtowr.bemodi.de"), "watchtowr");
        assert.strictEqual(instanceNameFromHostname("Status.Example.COM."), "status");
        assert.strictEqual(instanceNameFromHostname("kuma.local"), "kuma");
    });

    await t.test("no name for localhost and IP addresses", () => {
        for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "::1", "[::1]", "", null, undefined]) {
            assert.strictEqual(instanceNameFromHostname(host), null, String(host));
        }
    });

    await t.test("server: UPTIME_KUMA_INSTANCE_NAME wins, then the passkey origin", () => {
        const saved = { ...process.env };
        try {
            process.env.UPTIME_KUMA_INSTANCE_NAME = "Leitstand";
            process.env.UPTIME_KUMA_PASSKEY_ORIGIN = "https://watchtowr.bemodi.de";
            assert.strictEqual(getInstanceName(), "Leitstand");

            delete process.env.UPTIME_KUMA_INSTANCE_NAME;
            assert.strictEqual(getInstanceName(), "watchtowr");

            delete process.env.UPTIME_KUMA_PASSKEY_ORIGIN;
            assert.strictEqual(getInstanceName(), null);
        } finally {
            process.env = saved;
        }
    });
});
