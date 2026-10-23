const { R } = require("redbean-node");
const dayjs = require("dayjs");
const { log } = require("../src/util");

/*
 * Audit log (fork): who changed what, when, from where, and whether it worked.
 * Socket events are recorded by a middleware, login events by a better-auth hook.
 * Arguments are stored only through an allowlist, because handlers receive secrets
 * (setSettings gets the current password as a string, notifications carry tokens).
 * Each entry is also written to stdout as a JSON line for a SIEM.
 */

// Socket events that only read data. Everything else is recorded, so new upstream events are covered.
const READ_ONLY_EVENTS = new Set([
    "checkApprise",
    "checkDomain",
    "cloudflared_join",
    "cloudflared_leave",
    "getAPIKeyList",
    "getAuditLog",
    "getDatabaseSize",
    "getGameList",
    "getIncidentHistory",
    "getMaintenance",
    "getMaintenanceList",
    "getMaintenanceStatusPage",
    "getMonitor",
    "getMonitorBeats",
    "getMonitorChartData",
    "getMonitorList",
    "getMonitorMaintenance",
    "getPushExample",
    "getSettings",
    "getStatusPage",
    "getTags",
    "getUserList",
    "getWebpushVapidPublicKey",
    "monitorImportantHeartbeatListCount",
    "monitorImportantHeartbeatListPaged",
    "needSetup",
]);

// String arguments that are safe to store (slugs, titles, IDs). Other strings are dropped.
const SAFE_STRING_ARGS = {
    addStatusPage: [0, 1],
    saveStatusPage: [0],
    deleteStatusPage: [0],
    postIncident: [0],
    editIncident: [0],
    deleteIncident: [0],
    resolveIncident: [0],
    unpinIncident: [0],
    addMonitorTag: [2],
    editMonitorTag: [2],
    deleteMonitorTag: [2],
    initServerTimezone: [0],
};

// Events whose first argument is a user ID; the entry also gets that user's name
const USER_ID_EVENTS = new Set(["resetUserAccess", "setUserActive", "deleteUser"]);

// Object fields that are safe to store. Everything else may carry secrets.
const SAFE_FIELDS = ["id", "name", "username", "type", "title", "slug", "active"];

// Fields of an ack response that identify what was created
const RESULT_FIELDS = ["monitorID", "keyID", "id", "slug"];

const DEFAULT_KEEP_DAYS = 365;

/**
 * Reduce one socket argument to what may be stored
 * @param {any} arg Argument
 * @param {boolean} stringIsSafe Whether a string argument may be stored
 * @returns {any} Summary of the argument
 */
function summarizeArg(arg, stringIsSafe) {
    if (arg === null || arg === undefined || typeof arg === "number" || typeof arg === "boolean") {
        return arg ?? null;
    }
    if (typeof arg === "string") {
        return stringIsSafe ? arg.slice(0, 200) : "[string]";
    }
    if (Array.isArray(arg)) {
        return { count: arg.length };
    }
    if (typeof arg === "object") {
        const picked = {};
        for (const key of SAFE_FIELDS) {
            if (arg[key] !== undefined && typeof arg[key] !== "object") {
                picked[key] = typeof arg[key] === "string" ? arg[key].slice(0, 200) : arg[key];
            }
        }
        return Object.keys(picked).length > 0 ? picked : { keys: Object.keys(arg).slice(0, 30) };
    }
    return typeof arg;
}

/**
 * Reduce socket arguments to an allowlisted summary
 * @param {string} event Socket event name
 * @param {any[]} args Arguments without the ack callback
 * @returns {any[]} Summary
 */
function summarizeArgs(event, args) {
    const safe = SAFE_STRING_ARGS[event] ?? [];
    return args.map((arg, i) => summarizeArg(arg, safe.includes(i) || (USER_ID_EVENTS.has(event) && i === 0)));
}

/**
 * Pick the identifying fields of an ack response
 * @param {any} res Ack response
 * @returns {object|null} Result fields, or null if there are none
 */
function summarizeResult(res) {
    if (!res || typeof res !== "object") {
        return null;
    }
    const picked = {};
    for (const key of RESULT_FIELDS) {
        if (typeof res[key] === "number" || typeof res[key] === "string") {
            picked[key] = res[key];
        }
    }
    return Object.keys(picked).length > 0 ? picked : null;
}

/**
 * Store an audit entry and print it as a JSON line
 * @param {object} entry Entry
 * @param {string|null} entry.userId Acting user
 * @param {string|null} entry.username Acting user's name at that time
 * @param {string|null} entry.ip Client IP
 * @param {string} entry.source "socket" or "auth"
 * @param {string} entry.action Socket event or auth action
 * @param {any} entry.target Allowlisted summary of what was acted on
 * @param {boolean|null} entry.ok Result, null if unknown
 * @param {string|null} entry.msg Error message if it failed
 * @returns {Promise<void>}
 */
async function writeAuditEntry(entry) {
    const row = {
        time: R.isoDateTimeMillis(dayjs.utc()),
        user_id: entry.userId ?? null,
        username: entry.username ?? null,
        ip: entry.ip ?? null,
        source: entry.source,
        action: entry.action,
        target: entry.target === undefined || entry.target === null ? null : JSON.stringify(entry.target),
        ok: entry.ok ?? null,
        msg: entry.msg ? String(entry.msg).slice(0, 500) : null,
    };
    try {
        await R.knex("audit_log").insert(row);
    } catch (e) {
        log.error("audit", "Failed to store audit entry: " + e.message);
    }
    log.info("audit", JSON.stringify(row));
}

/**
 * Name of a user, for entries that act on another user
 * @param {string} userId better-auth user ID
 * @returns {Promise<string|null>} Username, or null if unknown
 */
async function lookupUsername(userId) {
    if (typeof userId !== "string") {
        return null;
    }
    const row = await R.knex("better_auth_user").select("username").where({ id: userId }).first();
    return row?.username ?? null;
}

/**
 * Socket.io middleware that records every state-changing event of a logged-in user,
 * with the result reported through the ack callback
 * @param {import("socket.io").Socket} socket Socket
 * @param {function(import("socket.io").Socket): Promise<string>} getClientIP Resolves the client IP (honours trustProxy)
 * @returns {function(any[], Function): void} Middleware for socket.use()
 */
function auditSocketMiddleware(socket, getClientIP) {
    return (packet, next) => {
        const event = packet[0];
        if (!socket.userID || typeof event !== "string" || READ_ONLY_EVENTS.has(event)) {
            return next();
        }

        (async () => {
            const last = packet.length - 1;
            const hasAck = typeof packet[last] === "function";
            const args = packet.slice(1, hasAck ? last : undefined);
            const target = { args: summarizeArgs(event, args) };
            if (USER_ID_EVENTS.has(event)) {
                target.username = await lookupUsername(args[0]);
            }
            const entry = {
                userId: socket.userID,
                username: socket.session?.user?.username ?? null,
                ip: await getClientIP(socket),
                source: "socket",
                action: event,
                target,
            };

            if (hasAck) {
                const ack = packet[last];
                packet[last] = (res, ...rest) => {
                    const result = summarizeResult(res);
                    writeAuditEntry({
                        ...entry,
                        target: result ? { ...target, result } : target,
                        ok: typeof res?.ok === "boolean" ? res.ok : null,
                        msg: res?.ok === false ? res.msg : null,
                    });
                    return ack(res, ...rest);
                };
            } else {
                writeAuditEntry({ ...entry, ok: null, msg: null });
            }
        })()
            .catch((e) => log.error("audit", "Audit middleware failed: " + e.message))
            .finally(() => next());
    };
}

/**
 * Delete entries older than UPTIME_KUMA_AUDIT_LOG_KEEP_DAYS (default 365, 0 keeps everything)
 * @returns {Promise<void>}
 */
async function clearOldAuditLog() {
    const env = process.env.UPTIME_KUMA_AUDIT_LOG_KEEP_DAYS;
    const days = env === undefined || env === "" ? DEFAULT_KEEP_DAYS : parseInt(env, 10);
    if (!Number.isFinite(days) || days < 1) {
        return;
    }
    const before = R.isoDateTimeMillis(dayjs.utc().subtract(days, "day"));
    const removed = await R.knex("audit_log").where("time", "<", before).del();
    if (removed > 0) {
        log.info("audit", `Removed ${removed} audit entries older than ${days} days`);
    }
}

module.exports = {
    READ_ONLY_EVENTS,
    auditSocketMiddleware,
    clearOldAuditLog,
    summarizeArgs,
    writeAuditEntry,
};
