console.log("== Uptime Kuma Reset Passkeys Tool ==");

// Emergency recovery when no other user can reset an account (e.g. the only user lost all passkeys).
// Removes all passkeys of the selected user and ends their sessions. The user then logs in with
// the password once and has to set up a new passkey. Run reset-password first if it is lost too.

import { loadEnvFile } from "node:process";
import { auth } from "../server/better-auth";
import { deleteAllPasskeys } from "../server/passkey-policy";
import { confirm, select } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";
import { isDevEnv } from "../src/util";

// @ts-ignore
import Database from "../server/database.js";

// @ts-ignore No type package is available
import parseArgs from "args-parser";

/**
 * Select a user, remove their passkeys and sessions
 * @returns {Promise<void>}
 */
async function main() {
    const args = parseArgs(process.argv);
    try {
        loadEnvFile();
    } catch {}

    console.log("Dev Environment:", isDevEnv());

    Database.initDataDir(args);
    await Database.connect();

    const internalAdapter = (await auth().$context).internalAdapter;
    const users = await internalAdapter.listUsers();

    const userId = await select({
        message: "Select a username:",
        choices: users.map((user) => ({
            name: user.name || user.email,
            value: user.id,
        })),
    });

    const ok = await confirm({
        message: "Remove all passkeys of this user and end all their sessions?",
        default: false,
    });

    if (ok) {
        const removed = await deleteAllPasskeys(userId);
        await internalAdapter.deleteSessions(userId);
        console.log(
            `Removed ${removed} passkey(s). The user can now log in with the password and set up a new passkey.`
        );
    } else {
        console.log("Nothing changed.");
    }

    await cleanUp();
}

/**
 * Close the database
 * @returns {Promise<void>}
 */
async function cleanUp() {
    await Database.close();
}

// Gracefully handle Ctrl+C
process.on("SIGINT", async () => {
    console.log("\nGracefully shutting down from SIGINT (Ctrl+C)");
    await cleanUp();
    process.exit(0);
});

try {
    await main();
} catch (e) {
    // Ignore prompt exit errors
    if (!(e instanceof ExitPromptError)) {
        throw e;
    }
}
