import { test } from "node:test";
import assert from "node:assert";
import { R } from "redbean-node";
import {
    cymruOriginQuery,
    detectCdn,
    expandIPv6,
    lookupHosting,
    parseAsName,
    parseAsn,
    providerName,
    refreshHostingInfo,
    resetHostingInfoThrottle,
    sendHostingInfo,
    // @ts-ignore
} from "../../server/hosting-info.js";

// @ts-ignore
import TestDB from "../mock-testdb";

const testDb = new TestDB("./data/test-hosting-info");

/**
 * Resolver with fixed answers that records its queries, so the tests need no network
 * @param ips Hostname -> IP
 * @param txt Query name -> TXT records
 * @returns Resolver and the list of queries
 */
function fakeResolver(ips: Record<string, string>, txt: Record<string, string[]>) {
    const queries: string[] = [];
    return {
        queries,
        lookup: async (host: string) => {
            queries.push(`A ${host}`);
            if (!ips[host]) {
                throw new Error(`getaddrinfo ENOTFOUND ${host}`);
            }
            return ips[host];
        },
        resolveTxt: async (name: string) => {
            queries.push(`TXT ${name}`);
            if (!txt[name]) {
                throw new Error(`queryTxt ENODATA ${name}`);
            }
            return txt[name];
        },
    };
}

const CLOUDFLARE_TXT = {
    "31.2.21.104.origin.asn.cymru.com": ["13335 | 104.21.0.0/20 | US | arin | 2014-03-28"],
    "AS13335.asn.cymru.com": ["13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US"],
};

test("Hosting info", async (t) => {
    t.before(async () => {
        await testDb.create();
    });

    t.after(async () => {
        await testDb.destroy();
    });

    await t.test("CDN from response headers", () => {
        assert.strictEqual(detectCdn({ "cf-ray": "8d1f-FRA", server: "cloudflare" }), "Cloudflare");
        assert.strictEqual(detectCdn({ server: "cloudflare" }), "Cloudflare");
        assert.strictEqual(detectCdn({ "x-amz-cf-id": "abc" }), "Amazon CloudFront");
        assert.strictEqual(detectCdn({ "x-azure-ref": "abc" }), "Azure Front Door");
        assert.strictEqual(detectCdn({ "x-served-by": "cache-fra-etou8220123-FRA" }), "Fastly");
        assert.strictEqual(detectCdn({ "x-vercel-id": "fra1::abc" }), "Vercel");
        assert.strictEqual(detectCdn({ server: "nginx" }), null);
        assert.strictEqual(detectCdn(undefined), null);
    });

    await t.test("Team Cymru query names for IPv4 and IPv6", () => {
        assert.strictEqual(cymruOriginQuery("104.21.2.31"), "31.2.21.104.origin.asn.cymru.com");
        assert.strictEqual(
            expandIPv6("2606:4700::6810:21f"),
            ["2606", "4700", "0000", "0000", "0000", "0000", "6810", "021f"].join("")
        );
        assert.strictEqual(expandIPv6("::ffff:192.0.2.1"), "00000000000000000000ffffc0000201");
        assert.strictEqual(
            cymruOriginQuery("2a01:4f8::1"),
            "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.f.4.0.1.0.a.2.origin6.asn.cymru.com"
        );
    });

    await t.test("ASN, AS name and readable operator", () => {
        assert.strictEqual(parseAsn(["13335 209242 | 104.21.0.0/20 | US | arin | 2014-03-28"]), 13335);
        assert.strictEqual(parseAsn([]), null);
        assert.strictEqual(
            parseAsName(["24940 | DE | ripencc | 2004-06-03 | HETZNER-AS - Hetzner Online GmbH, DE"]),
            "HETZNER-AS - Hetzner Online GmbH, DE"
        );
        assert.strictEqual(providerName(24940, "HETZNER-AS - Hetzner Online GmbH, DE"), "Hetzner");
        assert.strictEqual(providerName(3214, "XTOM - xTom GmbH, DE"), "xTom GmbH");
        assert.strictEqual(providerName(64512, "SOME-NET"), "SOME-NET");
        assert.strictEqual(providerName(null, null), null);
    });

    await t.test("lookup of a public host behind Cloudflare", async () => {
        resetHostingInfoThrottle();
        const resolver = fakeResolver({ "www.example.de": "104.21.2.31" }, CLOUDFLARE_TXT);
        const info = await lookupHosting("www.example.de", { "cf-ray": "x" }, resolver);
        assert.strictEqual(info.ip, "104.21.2.31");
        assert.strictEqual(info.asn, 13335);
        assert.strictEqual(info.provider, "Cloudflare");
        assert.strictEqual(info.cdn, "Cloudflare");
        assert.strictEqual(info.private, false);
    });

    await t.test("private addresses are not sent to Team Cymru", async () => {
        const resolver = fakeResolver({ intranet: "10.1.2.3" }, {});
        const info = await lookupHosting("intranet", undefined, resolver);
        assert.strictEqual(info.private, true);
        assert.strictEqual(info.provider, null);
        assert.deepStrictEqual(resolver.queries, ["A intranet"]);
        assert.strictEqual((await lookupHosting("::1", undefined, resolver)).private, true);
    });

    await t.test("an unanswered ASN query keeps IP and CDN", async () => {
        const resolver = fakeResolver({ "a.example": "203.0.113.9" }, {});
        const info = await lookupHosting("a.example", { "x-amz-cf-id": "y" }, resolver);
        assert.strictEqual(info.ip, "203.0.113.9");
        assert.strictEqual(info.asn, null);
        assert.strictEqual(info.cdn, "Amazon CloudFront");
    });

    await t.test("refresh stores, sends and looks up at most once an hour", async () => {
        resetHostingInfoThrottle();
        const [monitorID] = await R.knex("monitor").insert({
            name: "Website",
            type: "http",
            url: "https://www.example.de/",
        });
        const monitor = { id: monitorID, type: "http", getUrl: () => new URL("https://www.example.de/") };
        const resolver = fakeResolver({ "www.example.de": "104.21.2.31" }, CLOUDFLARE_TXT);
        const emitted: any[] = [];
        const io = { to: () => ({ emit: (...args: any[]) => emitted.push(args) }) };

        const info = await refreshHostingInfo(monitor, { "cf-ray": "x" }, io, resolver);
        assert.strictEqual(info.provider, "Cloudflare");
        assert.strictEqual(emitted.length, 1);
        assert.strictEqual(emitted[0][0], "hostingInfo");
        assert.strictEqual(JSON.parse(emitted[0][2]).provider, "Cloudflare");

        const row = await R.knex("monitor_hosting_info").where({ monitor_id: monitorID }).first();
        assert.strictEqual(JSON.parse(row.info_json).ip, "104.21.2.31");

        // Same host within the hour: no new lookup
        assert.strictEqual(await refreshHostingInfo(monitor, undefined, io, resolver), null);
        assert.strictEqual(resolver.queries.filter((q) => q.startsWith("A ")).length, 1);

        // Another host: looked up at once, the row is updated, not duplicated
        const moved = { ...monitor, getUrl: () => new URL("https://shop.example.de/") };
        const resolver2 = fakeResolver({ "shop.example.de": "10.0.0.5" }, {});
        assert.strictEqual((await refreshHostingInfo(moved, undefined, io, resolver2)).private, true);
        const rows = await R.knex("monitor_hosting_info").where({ monitor_id: monitorID });
        assert.strictEqual(rows.length, 1);

        await sendHostingInfo(io, monitorID);
        assert.strictEqual(JSON.parse(emitted[emitted.length - 1][2]).host, "shop.example.de");

        // Other monitor types are left alone
        assert.strictEqual(await refreshHostingInfo({ ...monitor, type: "ping" }, undefined, io, resolver), null);

        // Deleting the monitor removes its row
        await R.knex("monitor").where({ id: monitorID }).del();
        assert.strictEqual((await R.knex("monitor_hosting_info").where({ monitor_id: monitorID })).length, 0);
    });

    await t.test("a host that does not resolve is retried after a few minutes, not an hour", async () => {
        resetHostingInfoThrottle();
        const monitor = { id: 999, type: "http", getUrl: () => new URL("https://gone.example/") };
        const resolver = fakeResolver({}, {});
        await assert.rejects(refreshHostingInfo(monitor, undefined, undefined, resolver), /ENOTFOUND/);
        // Within the retry window: no new attempt
        assert.strictEqual(await refreshHostingInfo(monitor, undefined, undefined, resolver), null);
    });
});
