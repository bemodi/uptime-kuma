const { R } = require("redbean-node");
const { checkLogin } = require("../util-server");

const PAGE_SIZE_MAX = 200;
const EXPORT_MAX = 10000;

/**
 * Build the filtered query for the audit log
 * @param {object} filter Filter from the client
 * @param {string} filter.username Exact username
 * @param {string} filter.action Part of the action name
 * @param {string} filter.result "ok", "failed" or empty for all
 * @param {string} filter.from Earliest time (ISO, UTC)
 * @param {string} filter.to Latest time (ISO, UTC)
 * @returns {import("knex").Knex.QueryBuilder} Query
 */
function filteredQuery(filter = {}) {
    const query = R.knex("audit_log");
    if (filter.username) {
        query.where("username", String(filter.username));
    }
    if (filter.action) {
        query.where("action", "like", `%${String(filter.action).replace(/[%_]/g, "")}%`);
    }
    if (filter.result === "ok") {
        query.where("ok", true);
    } else if (filter.result === "failed") {
        query.where("ok", false);
    }
    if (filter.from) {
        query.where("time", ">=", String(filter.from));
    }
    if (filter.to) {
        query.where("time", "<=", String(filter.to));
    }
    return query;
}

/**
 * Socket handler to read the audit log. There is no way to change or delete entries.
 * @param {import("socket.io").Socket} socket Socket.io socket
 * @returns {void}
 */
module.exports.auditLogSocketHandler = (socket) => {
    socket.on("getAuditLog", async (filter, callback) => {
        try {
            checkLogin(socket);

            const exporting = filter?.export === true;
            const pageSize = exporting
                ? EXPORT_MAX
                : Math.min(Math.max(parseInt(filter?.pageSize) || 50, 1), PAGE_SIZE_MAX);
            const page = exporting ? 1 : Math.max(parseInt(filter?.page) || 1, 1);

            const { total } = await filteredQuery(filter).count("id as total").first();
            const rows = await filteredQuery(filter)
                .select("id", "time", "user_id", "username", "ip", "source", "action", "target", "ok", "msg")
                .orderBy("id", "desc")
                .limit(pageSize)
                .offset((page - 1) * pageSize);

            const usernames = (
                await R.knex("audit_log").distinct("username").whereNotNull("username").orderBy("username")
            ).map((row) => row.username);

            callback({
                ok: true,
                total: Number(total),
                page,
                pageSize,
                usernames,
                rows: rows.map((row) => ({
                    ...row,
                    ok: row.ok === null ? null : Boolean(row.ok),
                })),
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
