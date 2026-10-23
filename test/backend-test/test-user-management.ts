import { test } from "node:test";
import assert from "node:assert";
import { checkPassword } from "../../server/better-auth";
import { createUser, generatePassword, getUserList } from "../../server/socket-handlers/user-socket-handler";

// @ts-ignore
import TestDB from "../mock-testdb";

const testDb = new TestDB("./data/test-user-management");

test("User management (all users are admins)", async (t) => {
    t.before(async () => {
        await testDb.create();
    });

    t.after(async () => {
        await testDb.destroy();
    });

    await t.test("generated passwords are 20 characters and differ", () => {
        const a = generatePassword();
        const b = generatePassword();
        assert.strictEqual(a.length, 20);
        assert.notStrictEqual(a, b);
    });

    await t.test("createUser stores a lowercase username and the password works", async () => {
        const password = await createUser({ username: "Alice.Admin", name: "Alice" });
        assert.strictEqual(await checkPassword("alice.admin", password), true);
    });

    await t.test("createUser gives every user the admin role", async () => {
        await createUser({ username: "bob" });
        const { R } = await import("redbean-node");
        const row = await R.knex("better_auth_user").where({ username: "bob" }).first();
        assert.strictEqual(row.role, "admin");
        assert.strictEqual(row.name, "bob");
    });

    await t.test("createUser rejects invalid usernames", async () => {
        for (const username of ["ab", "with space", "x".repeat(31), "", "ümlaut"]) {
            await assert.rejects(createUser({ username }), { message: "usernameInvalid" }, username);
        }
    });

    await t.test("createUser rejects a taken username regardless of case", async () => {
        await assert.rejects(createUser({ username: "BOB" }), { message: "usernameTaken" });
    });

    await t.test("getUserList marks the requesting user and lists everyone as active", async () => {
        const { R } = await import("redbean-node");
        const bob = await R.knex("better_auth_user").where({ username: "bob" }).first();
        const users = await getUserList(bob.id);
        assert.deepStrictEqual(
            users.map((u) => [u.username, u.active, u.isSelf]),
            [
                ["Alice.Admin", true, false],
                ["bob", true, true],
            ]
        );
    });
});
