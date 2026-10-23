/*
 * The schema from: https://better-auth.com/docs/plugins/passkey#schema
 */
exports.up = function (knex) {
    return knex.schema.createTable("better_auth_passkey", (t) => {
        t.string("id").primary();
        t.string("name");
        t.text("publicKey").notNullable();
        t.string("userId")
            .notNullable()
            .references("id")
            .inTable("better_auth_user")
            .onDelete("CASCADE")
            .onUpdate("CASCADE");
        t.string("credentialID").notNullable();
        t.integer("counter").notNullable();
        t.string("deviceType").notNullable();
        t.boolean("backedUp").notNullable();
        t.string("transports");
        t.timestamp("createdAt");
        t.string("aaguid");
        t.index("userId");
        t.index("credentialID");
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists("better_auth_passkey");
};
