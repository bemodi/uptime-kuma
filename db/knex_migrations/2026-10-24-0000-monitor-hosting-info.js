// Fork: where a monitored website is hosted (operator by ASN, CDN by headers), one row per monitor
exports.up = function (knex) {
    return knex.schema.createTable("monitor_hosting_info", (t) => {
        t.increments("id");
        t.integer("monitor_id")
            .unsigned()
            .notNullable()
            .unique()
            .references("id")
            .inTable("monitor")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        t.text("info_json");
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists("monitor_hosting_info");
};
