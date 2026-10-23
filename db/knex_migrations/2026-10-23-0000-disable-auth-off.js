// Fork: login always needs a passkey, so "Disable Auth" is switched off for instances that had it on
exports.up = async function (knex) {
    await knex("setting").where({ key: "disableAuth" }).update({ value: "false" });
};

exports.down = async function () {};
