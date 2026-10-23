// Fork: audit log of changes and login events. No foreign key on user_id, entries outlive deleted users.
exports.up = function (knex) {
    return knex.schema.createTable("audit_log", (t) => {
        t.increments("id");
        t.datetime("time").notNullable();
        t.string("user_id", 255);
        t.string("username", 255);
        t.string("ip", 255);
        t.string("source", 20).notNullable();
        t.string("action", 100).notNullable();
        t.text("target");
        t.boolean("ok");
        t.text("msg");
        t.index("time", "audit_log_time");
        t.index(["username", "time"], "audit_log_username_time");
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists("audit_log");
};
