<template>
    <div class="my-4">
        <p class="small text-muted">{{ $t("auditLogHint") }}</p>

        <form class="row g-2 align-items-end mb-3" @submit.prevent="load(1)">
            <div class="col-md-3">
                <label for="audit-user" class="form-label">{{ $t("Username") }}</label>
                <select id="audit-user" v-model="filter.username" class="form-select" @change="load(1)">
                    <option value="">{{ $t("All") }}</option>
                    <option v-for="name in usernames" :key="name" :value="name">{{ name }}</option>
                </select>
            </div>
            <div class="col-md-3">
                <label for="audit-action" class="form-label">{{ $t("Action") }}</label>
                <input id="audit-action" v-model="filter.action" type="text" class="form-control" @change="load(1)" />
            </div>
            <div class="col-md-3">
                <label for="audit-result" class="form-label">{{ $t("Result") }}</label>
                <select id="audit-result" v-model="filter.result" class="form-select" @change="load(1)">
                    <option value="">{{ $t("All") }}</option>
                    <option value="ok">{{ $t("Success") }}</option>
                    <option value="failed">{{ $t("Failed") }}</option>
                </select>
            </div>
            <div class="col-md-3 text-md-end">
                <button class="btn btn-normal" type="button" :disabled="exporting" @click="exportCsv">
                    <font-awesome-icon icon="download" />
                    {{ $t("Export CSV") }}
                </button>
            </div>
        </form>

        <div class="table-responsive">
            <table class="table table-sm align-middle" data-testid="audit-log-table">
                <thead>
                    <tr>
                        <th>{{ $t("Time") }}</th>
                        <th>{{ $t("Username") }}</th>
                        <th>{{ $t("Action") }}</th>
                        <th>{{ $t("Result") }}</th>
                        <th>{{ $t("Object") }}</th>
                        <th>{{ $t("IP") }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-if="rows.length === 0">
                        <td colspan="6" class="text-center text-muted py-3">{{ $t("noAuditEntries") }}</td>
                    </tr>
                    <tr v-for="row in rows" :key="row.id" data-testid="audit-row">
                        <td class="text-nowrap">{{ $root.datetime(row.time) }}</td>
                        <td>{{ row.username || "–" }}</td>
                        <td class="text-nowrap">
                            <code>{{ row.action }}</code>
                        </td>
                        <td>
                            <span v-if="row.ok === true" class="badge bg-primary">{{ $t("Success") }}</span>
                            <span v-else-if="row.ok === false" class="badge bg-danger" :title="row.msg">
                                {{ $t("Failed") }}
                            </span>
                            <span v-else>–</span>
                            <div v-if="row.ok === false && row.msg" class="small text-muted msg">{{ row.msg }}</div>
                        </td>
                        <td class="target" :title="row.target">{{ formatTarget(row.target) }}</td>
                        <td class="text-nowrap">{{ row.ip || "–" }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="d-flex align-items-center justify-content-between">
            <span class="small text-muted">{{ $t("auditLogTotal", { total }) }}</span>
            <div class="btn-group">
                <button class="btn btn-sm btn-normal" type="button" :disabled="page <= 1" @click="load(page - 1)">
                    {{ $t("Previous") }}
                </button>
                <span class="btn btn-sm btn-normal disabled">{{ page }} / {{ pageCount }}</span>
                <button
                    class="btn btn-sm btn-normal"
                    type="button"
                    :disabled="page >= pageCount"
                    @click="load(page + 1)"
                >
                    {{ $t("Next") }}
                </button>
            </div>
        </div>
    </div>
</template>

<script>
const CSV_COLUMNS = ["time", "username", "user_id", "ip", "source", "action", "target", "ok", "msg"];

export default {
    data() {
        return {
            rows: [],
            usernames: [],
            total: 0,
            page: 1,
            pageSize: 50,
            exporting: false,
            filter: {
                username: "",
                action: "",
                result: "",
            },
        };
    },

    computed: {
        pageCount() {
            return Math.max(Math.ceil(this.total / this.pageSize), 1);
        },
    },

    mounted() {
        this.load(1);
    },

    methods: {
        /**
         * Load one page of the audit log with the current filter
         * @param {number} page Page number, starting at 1
         * @returns {void}
         */
        load(page) {
            this.$root.getSocket().emit("getAuditLog", { ...this.filter, page, pageSize: this.pageSize }, (res) => {
                if (res.ok) {
                    this.rows = res.rows;
                    this.total = res.total;
                    this.page = res.page;
                    this.usernames = res.usernames;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * Short, readable form of the stored target summary
         * @param {string|null} target JSON from the server
         * @returns {string} Text for the table
         */
        formatTarget(target) {
            if (!target) {
                return "–";
            }
            try {
                const value = JSON.parse(target);
                const parts = [];
                const args = Array.isArray(value.args) ? value.args : [];
                for (const arg of args) {
                    parts.push(typeof arg === "object" && arg !== null ? this.formatObject(arg) : String(arg));
                }
                for (const [key, v] of Object.entries(value)) {
                    if (key !== "args") {
                        parts.push(
                            typeof v === "object" && v !== null ? `${key}: ${this.formatObject(v)}` : `${key}: ${v}`
                        );
                    }
                }
                return parts.join(", ") || "–";
            } catch (_) {
                return target;
            }
        },

        /**
         * @param {object} obj Object of the target summary
         * @returns {string} key=value pairs
         */
        formatObject(obj) {
            return Object.entries(obj)
                .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : v}`)
                .join(" ");
        },

        /**
         * Download all entries matching the filter as CSV (up to the server limit)
         * @returns {void}
         */
        exportCsv() {
            this.exporting = true;
            this.$root.getSocket().emit("getAuditLog", { ...this.filter, export: true }, (res) => {
                this.exporting = false;
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                const escape = (value) => {
                    const text = value === null || value === undefined ? "" : String(value);
                    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
                };
                const lines = [CSV_COLUMNS.join(",")];
                for (const row of res.rows) {
                    lines.push(CSV_COLUMNS.map((column) => escape(row[column])).join(","));
                }
                const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `uptime-kuma-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(link.href);
            });
        },
    },
};
</script>

<style lang="scss" scoped>
.target {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.msg {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
