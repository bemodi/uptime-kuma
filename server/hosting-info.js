// Fork: where a monitored website is hosted. The network operator comes from the IP address via the
// public IP-to-ASN service of Team Cymru (DNS queries only, no key), a CDN or proxy in front of the site
// from the response headers of the check. Looked up at most once an hour per monitor, stored in
// monitor_hosting_info and sent to all logged-in clients.
//
// Behind a CDN or proxy (Cloudflare and the like) only the CDN is visible from outside, never the
// origin server. That is the point of such a proxy, not a gap in the lookup.

const dns = require("node:dns");
const net = require("node:net");
const { R } = require("redbean-node");
const { LOGGED_IN_ROOM } = require("./util-server");

const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const HTTP_TYPES = ["http", "keyword", "json-query"];

// Readable names for the networks most websites run on (ASN: name), checked against Team Cymru
// on 2026-10-24. Other networks show the organisation from the AS name.
const PROVIDERS = {
    13335: "Cloudflare",
    209242: "Cloudflare",
    24940: "Hetzner",
    213230: "Hetzner",
    212317: "Hetzner",
    16509: "AWS",
    14618: "AWS",
    8075: "Microsoft Azure",
    8068: "Microsoft Azure",
    8069: "Microsoft Azure",
    15169: "Google",
    19527: "Google",
    396982: "Google Cloud",
    16276: "OVHcloud",
    35540: "OVHcloud",
    197540: "netcup",
    8560: "IONOS",
    6724: "Strato",
    34788: "ALL-INKL",
    15817: "Mittwald",
    20773: "Host Europe",
    34011: "Host Europe",
    21499: "Host Europe",
    8972: "Host Europe",
    61157: "PlusServer",
    24961: "myLoc",
    51167: "Contabo",
    3320: "Deutsche Telekom",
    14061: "DigitalOcean",
    20473: "Vultr",
    63949: "Akamai (Linode)",
    12876: "Scaleway",
    31898: "Oracle Cloud",
    45102: "Alibaba Cloud",
    60781: "Leaseweb",
    28753: "Leaseweb",
    47583: "Hostinger",
    204915: "Hostinger",
    26496: "GoDaddy",
    58182: "Wix",
    397273: "Render",
    36459: "GitHub",
    54113: "Fastly",
    20940: "Akamai",
    16625: "Akamai",
    19551: "Imperva",
    30148: "Sucuri",
};

// Response headers a CDN or proxy adds to every response
const CDN_HEADERS = [
    ["cf-ray", "Cloudflare"],
    ["x-amz-cf-id", "Amazon CloudFront"],
    ["x-azure-ref", "Azure Front Door"],
    ["x-vercel-id", "Vercel"],
    ["x-nf-request-id", "Netlify"],
    ["x-fastly-request-id", "Fastly"],
    ["akamai-grn", "Akamai"],
    ["x-akamai-transformed", "Akamai"],
    ["cdn-pullzone", "bunny.net"],
    ["x-sucuri-id", "Sucuri"],
    ["x-iinfo", "Imperva"],
];

const SERVER_HEADERS = [
    [/^cloudflare$/i, "Cloudflare"],
    [/^AkamaiGHost/i, "Akamai"],
    [/^Netlify$/i, "Netlify"],
    [/^Vercel$/i, "Vercel"],
    [/^BunnyCDN/i, "bunny.net"],
];

// No public operator for these, the Team Cymru query would only fail
const PRIVATE = new net.BlockList();
for (const [address, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
]) {
    PRIVATE.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
]) {
    PRIVATE.addSubnet(address, prefix, "ipv6");
}

// AS names barely change, one query per ASN and process is enough
const asNameCache = new Map();
// monitorID -> { host, at }: when the last lookup started
const lastLookup = new Map();

/**
 * Name of the CDN or proxy in front of a site, from the response headers of a check
 * @param {object|undefined} headers Response headers with lower-case names (axios, Node)
 * @returns {string|null} CDN name or null
 */
function detectCdn(headers) {
    if (!headers) {
        return null;
    }
    for (const [name, cdn] of CDN_HEADERS) {
        if (headers[name] != null) {
            return cdn;
        }
    }
    if (/^cache-/.test(String(headers["x-served-by"] ?? ""))) {
        return "Fastly";
    }
    const server = String(headers["server"] ?? "");
    for (const [pattern, cdn] of SERVER_HEADERS) {
        if (pattern.test(server)) {
            return cdn;
        }
    }
    return null;
}

/**
 * All 32 hex digits of an IPv6 address
 * @param {string} ip IPv6 address, also with :: or an embedded IPv4 address
 * @returns {string} Hex digits without separators
 */
function expandIPv6(ip) {
    const [head, tail] = ip.split("::");
    const split = (part) => (part ? part.split(":") : []);
    const left = split(head);
    const right = split(tail);
    const last = tail === undefined ? left : right;
    if (last.length > 0 && last[last.length - 1].includes(".")) {
        const [a, b, c, d] = last.pop().split(".").map(Number);
        last.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
    }
    const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
    return groups.map((group) => group.padStart(4, "0")).join("");
}

/**
 * DNS name that Team Cymru answers with the ASN announcing an IP address
 * @param {string} ip IPv4 or IPv6 address
 * @returns {string} TXT query name
 */
function cymruOriginQuery(ip) {
    if (net.isIPv4(ip)) {
        return `${ip.split(".").reverse().join(".")}.origin.asn.cymru.com`;
    }
    return `${expandIPv6(ip).split("").reverse().join(".")}.origin6.asn.cymru.com`;
}

/**
 * ASN from an origin answer such as "13335 | 104.21.0.0/20 | US | arin | 2014-03-28"
 * @param {string[]} records TXT records
 * @returns {number|null} First ASN or null
 */
function parseAsn(records) {
    const asn = parseInt(String(records?.[0] ?? "").split("|")[0], 10);
    return Number.isInteger(asn) ? asn : null;
}

/**
 * AS name from an answer such as "13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US"
 * @param {string[]} records TXT records
 * @returns {string|null} AS name or null
 */
function parseAsName(records) {
    const name = String(records?.[0] ?? "")
        .split("|")
        .pop()
        .trim();
    return name || null;
}

/**
 * Readable operator name: from the list above, else the organisation part of the AS name
 * @param {number|null} asn ASN
 * @param {string|null} asName AS name as Team Cymru returns it
 * @returns {string|null} Operator name or null
 */
function providerName(asn, asName) {
    if (asn != null && PROVIDERS[asn]) {
        return PROVIDERS[asn];
    }
    if (!asName) {
        return null;
    }
    const organisation = asName.includes(" - ") ? asName.slice(asName.indexOf(" - ") + 3) : asName;
    return organisation.replace(/, [A-Z]{2}$/, "").trim() || null;
}

/**
 * Resolver with short timeouts; TXT records come back as single strings
 * @returns {{lookup: function(string): Promise<string>, resolveTxt: function(string): Promise<string[]>}} Resolver
 */
function defaultResolver() {
    const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
    return {
        lookup: async (host) => {
            try {
                return (await dns.promises.lookup(host, { family: 4 })).address;
            } catch (e) {
                return (await dns.promises.lookup(host, { family: 6 })).address;
            }
        },
        resolveTxt: async (name) => (await resolver.resolveTxt(name)).map((chunks) => chunks.join("")),
    };
}

/**
 * Where a host is hosted. Throws only if the host itself does not resolve.
 * @param {string} host Hostname or IP address
 * @param {object|undefined} headers Response headers of the check, if any
 * @param {object} resolver Resolver with lookup and resolveTxt, see defaultResolver
 * @returns {Promise<object>} { host, ip, asn, asName, provider, cdn, private, checkedAt }
 */
async function lookupHosting(host, headers, resolver = defaultResolver()) {
    const ip = net.isIP(host) ? host : await resolver.lookup(host);
    const info = {
        host,
        ip,
        asn: null,
        asName: null,
        provider: null,
        cdn: detectCdn(headers),
        private: PRIVATE.check(ip, net.isIPv6(ip) ? "ipv6" : "ipv4"),
        checkedAt: new Date().toISOString(),
    };
    if (info.private) {
        return info;
    }
    try {
        info.asn = parseAsn(await resolver.resolveTxt(cymruOriginQuery(ip)));
        if (info.asn != null) {
            if (!asNameCache.has(info.asn)) {
                asNameCache.set(info.asn, parseAsName(await resolver.resolveTxt(`AS${info.asn}.asn.cymru.com`)));
            }
            info.asName = asNameCache.get(info.asn);
        }
    } catch (e) {
        // Not announced or the service is unreachable: keep IP and CDN
    }
    info.provider = providerName(info.asn, info.asName);
    return info;
}

/**
 * Store the hosting info of a monitor
 * @param {number} monitorID Monitor ID
 * @param {object} info Hosting info
 * @returns {Promise<void>}
 */
async function storeHostingInfo(monitorID, info) {
    let bean = await R.findOne("monitor_hosting_info", " monitor_id = ? ", [monitorID]);
    if (!bean) {
        bean = R.dispense("monitor_hosting_info");
        bean.monitor_id = monitorID;
    }
    bean.info_json = JSON.stringify(info);
    await R.store(bean);
}

/**
 * Send the stored hosting info of a monitor to all logged-in clients
 * @param {object} io Socket.io server
 * @param {number} monitorID Monitor ID
 * @returns {Promise<void>}
 */
async function sendHostingInfo(io, monitorID) {
    const bean = await R.findOne("monitor_hosting_info", " monitor_id = ? ", [monitorID]);
    if (bean) {
        io.to(LOGGED_IN_ROOM).emit("hostingInfo", monitorID, bean.info_json);
    }
}

/**
 * Look up, store and send the hosting info of an HTTP monitor, at most once an hour or when the
 * host changes. The check and the throttle run before the first await, so concurrent calls of one
 * beat start a single lookup.
 * @param {object} monitor Monitor with id, type and getUrl()
 * @param {object|undefined} headers Response headers of the check, if any
 * @param {object|undefined} io Socket.io server
 * @param {object} resolver Resolver, see defaultResolver
 * @returns {Promise<object|null>} Hosting info, or null if nothing was looked up
 */
async function refreshHostingInfo(monitor, headers, io, resolver = undefined) {
    if (!HTTP_TYPES.includes(monitor.type)) {
        return null;
    }
    const host = monitor.getUrl()?.hostname?.replace(/^\[|\]$/g, "");
    if (!host) {
        return null;
    }
    const last = lastLookup.get(monitor.id);
    if (last && last.host === host && Date.now() - last.at < REFRESH_MS) {
        return null;
    }
    lastLookup.set(monitor.id, { host, at: Date.now() });
    try {
        const info = await lookupHosting(host, headers, resolver);
        await storeHostingInfo(monitor.id, info);
        io?.to(LOGGED_IN_ROOM).emit("hostingInfo", monitor.id, JSON.stringify(info));
        return info;
    } catch (e) {
        // Try again in a few minutes, not only in an hour
        lastLookup.set(monitor.id, { host, at: Date.now() - REFRESH_MS + RETRY_MS });
        throw e;
    }
}

/**
 * Forget the throttle state (tests)
 * @returns {void}
 */
function resetHostingInfoThrottle() {
    lastLookup.clear();
    asNameCache.clear();
}

module.exports = {
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
};
