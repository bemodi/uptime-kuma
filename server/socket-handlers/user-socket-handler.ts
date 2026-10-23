import { Socket } from "socket.io";
import { randomInt } from "node:crypto";
import { R } from "redbean-node";
import { auth, createHeaders } from "../better-auth";
import { deleteAllPasskeys } from "../passkey-policy";
import { log } from "../../src/util";
// @ts-ignore
import { checkLogin } from "../util-server.js";
// @ts-ignore
import { UptimeKumaServer } from "../uptime-kuma-server.js";
// @ts-ignore
import TranslatableError from "../translatable-error.js";

// Same rules as the better-auth username plugin, which admin createUser does not run
const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;

const PASSWORD_LENGTH = 20;
const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!";

export interface UserListItem {
    id: string;
    username: string;
    name: string;
    active: boolean;
    passkeyCount: number;
    createdAt: string;
    isSelf: boolean;
}

/**
 * Generate a random password for a new user or a reset
 * @returns Password with PASSWORD_LENGTH characters
 */
export function generatePassword(): string {
    let password = "";
    for (let i = 0; i < PASSWORD_LENGTH; i++) {
        password += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)];
    }
    return password;
}

/**
 * List all users. Every user is an admin, so there is no role column.
 * @param selfId ID of the requesting user
 * @returns Users ordered by creation
 */
export async function getUserList(selfId: string): Promise<UserListItem[]> {
    const rows = await R.knex("better_auth_user")
        .leftJoin("better_auth_passkey", "better_auth_passkey.userId", "better_auth_user.id")
        .select(
            "better_auth_user.id",
            "username",
            "displayUsername",
            "better_auth_user.name",
            "banned",
            "better_auth_user.createdAt"
        )
        .count("better_auth_passkey.id as passkeyCount")
        .groupBy("better_auth_user.id")
        .orderBy("better_auth_user.createdAt");

    return rows.map((row: Record<string, any>) => ({
        id: row.id,
        username: row.displayUsername || row.username,
        name: row.name,
        active: !row.banned,
        passkeyCount: Number(row.passkeyCount),
        createdAt: row.createdAt,
        isSelf: row.id === selfId,
    }));
}

/**
 * Create a user with a generated password. All users get the admin role.
 * @param input New user
 * @param input.username Login name, stored lowercase
 * @param input.name Optional display name
 * @returns The generated password, shown once to the creating admin
 * @throws {TranslatableError} If the username is invalid or taken
 */
export async function createUser(input: { username?: string; name?: string }): Promise<string> {
    const displayUsername = String(input?.username ?? "").trim();
    const username = displayUsername.toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
        throw new TranslatableError("usernameInvalid");
    }

    const existing = await R.knex("better_auth_user").where({ username }).first();
    if (existing) {
        throw new TranslatableError("usernameTaken");
    }

    const password = generatePassword();
    await auth().api.createUser({
        body: {
            name: String(input?.name ?? "").trim() || displayUsername,
            email: `${username}@noreply.uptime-kuma.internal`,
            password,
            role: "admin",
            data: {
                username,
                displayUsername,
            },
        },
    });
    return password;
}

/**
 * Reject actions on the own account. Since the acting user is active and not the target,
 * at least one active user always remains.
 * @param socket Socket of the acting user
 * @param userId Target user
 * @throws {TranslatableError} If the target is the acting user
 */
function ensureOtherUser(socket: Socket, userId: string) {
    // @ts-ignore
    if (!userId || userId === socket.userID) {
        throw new TranslatableError("cannotChangeOwnAccount");
    }
}

/**
 * Headers that carry the acting user's session, for better-auth admin endpoints
 * @param socket Socket of the acting user
 * @returns Headers with the session cookie
 */
function sessionHeaders(socket: Socket) {
    return createHeaders(socket.request.headers.cookie ?? "");
}

/**
 * Close all live connections of a user, e.g. after deactivation
 * @param userId User to disconnect
 */
function disconnectUser(userId: string) {
    UptimeKumaServer.getInstance().disconnectAllSocketClients(userId);
}

/**
 * Socket handlers for user management. There is no RBAC: every logged-in user may manage users.
 * @param socket Socket.io socket
 */
export function userSocketHandler(socket: Socket): void {
    socket.on("getUserList", async (callback) => {
        try {
            checkLogin(socket);
            // @ts-ignore
            callback({ ok: true, users: await getUserList(socket.userID) });
        } catch (e) {
            callback({ ok: false, msg: (e as Error).message, msgi18n: (e as any).msgi18n });
        }
    });

    socket.on("addUser", async (user, callback) => {
        try {
            checkLogin(socket);
            const password = await createUser(user);
            log.info("user", `User added: ${user?.username}`);
            callback({ ok: true, msg: "successAdded", msgi18n: true, password });
        } catch (e) {
            callback({ ok: false, msg: (e as Error).message, msgi18n: (e as any).msgi18n });
        }
    });

    // Recovery: remove all passkeys and set a new password. The user logs in with it once
    // and has to set up a new passkey before anything else.
    socket.on("resetUserAccess", async (userId, callback) => {
        try {
            checkLogin(socket);
            ensureOtherUser(socket, userId);
            const password = generatePassword();
            const headers = sessionHeaders(socket);
            await auth().api.setUserPassword({ body: { userId, newPassword: password }, headers });
            await deleteAllPasskeys(userId);
            await auth().api.revokeUserSessions({ body: { userId }, headers });
            disconnectUser(userId);
            callback({ ok: true, password });
        } catch (e) {
            callback({ ok: false, msg: (e as Error).message, msgi18n: (e as any).msgi18n });
        }
    });

    socket.on("setUserActive", async (userId, active, callback) => {
        try {
            checkLogin(socket);
            ensureOtherUser(socket, userId);
            const headers = sessionHeaders(socket);
            if (active) {
                await auth().api.unbanUser({ body: { userId }, headers });
            } else {
                await auth().api.banUser({ body: { userId, banReason: "Deactivated" }, headers });
                disconnectUser(userId);
            }
            callback({ ok: true, msg: active ? "userActivated" : "userDeactivated", msgi18n: true });
        } catch (e) {
            callback({ ok: false, msg: (e as Error).message, msgi18n: (e as any).msgi18n });
        }
    });

    socket.on("deleteUser", async (userId, callback) => {
        try {
            checkLogin(socket);
            ensureOtherUser(socket, userId);
            await auth().api.removeUser({ body: { userId }, headers: sessionHeaders(socket) });
            disconnectUser(userId);
            callback({ ok: true, msg: "successDeleted", msgi18n: true });
        } catch (e) {
            callback({ ok: false, msg: (e as Error).message, msgi18n: (e as any).msgi18n });
        }
    });
}
