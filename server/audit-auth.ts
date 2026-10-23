import { getSessionFromCtx } from "better-auth/api";
import type { HookEndpointContext } from "@better-auth/core";
import { R } from "redbean-node";
// @ts-ignore
import { writeAuditEntry } from "./audit-log.js";

/*
 * Audit entries for login events and account changes that go through better-auth (fork).
 * Admin actions on other users go through socket handlers and are recorded there.
 */

// Header set by the better-auth router with the client IP (honours trustProxy)
export const CLIENT_IP_HEADER = "x-uptime-kuma-client-ip";

const AUTH_ACTIONS: Record<string, string> = {
    "/sign-in/username": "login:password",
    "/sign-in/email": "login:password",
    "/passkey/verify-authentication": "login:passkey",
    "/two-factor/verify-totp": "login:totp",
    "/two-factor/verify-otp": "login:otp",
    "/two-factor/verify-backup-code": "login:backupCode",
    "/sign-out": "logout",
    "/change-password": "changePassword",
    "/passkey/verify-registration": "addPasskey",
    "/passkey/delete-passkey": "deletePasskey",
    "/passkey/update-passkey": "renamePasskey",
    "/two-factor/enable": "enable2FA",
    "/two-factor/disable": "disable2FA",
};

type Actor = { id: string; username?: string | null } | null;

/**
 * Before hook: remember who acts, because some endpoints end the session (logout)
 * @param ctx better-auth hook context
 * @returns {Promise<void>}
 */
export async function auditAuthBeforeHook(ctx: HookEndpointContext) {
    if (!AUTH_ACTIONS[ctx.path] || ctx.path.startsWith("/sign-in/")) {
        return;
    }
    const session = await getSessionFromCtx(ctx).catch(() => null);
    // @ts-ignore Stored for the after hook of the same request
    ctx.context.auditActor = session?.user ?? null;
}

/**
 * The user a failed passkey login tried to log in as
 * @param credentialID Credential ID from the authentication response
 * @returns The passkey's user, or null
 */
async function passkeyOwner(credentialID: unknown): Promise<Actor> {
    if (typeof credentialID !== "string") {
        return null;
    }
    const row = await R.knex("better_auth_passkey")
        .join("better_auth_user", "better_auth_user.id", "better_auth_passkey.userId")
        .select("better_auth_user.id", "better_auth_user.username")
        .where({ credentialID })
        .first();
    return row ?? null;
}

/**
 * After hook: record the action with its result
 * @param ctx better-auth hook context
 * @param rejection Error thrown by an earlier after hook of this request (e.g. PASSKEY_REQUIRED)
 * @returns {Promise<void>}
 */
export async function auditAuthAfterHook(ctx: HookEndpointContext, rejection?: unknown) {
    const action = AUTH_ACTIONS[ctx.path];
    if (!action) {
        return;
    }

    const result = rejection ?? ctx.context.returned;
    const failed = result instanceof Error;
    const body = (ctx.body ?? {}) as Record<string, any>;

    // @ts-ignore Set by auditAuthBeforeHook
    let actor: Actor = failed ? null : (ctx.context.newSession?.user ?? ctx.context.auditActor ?? null);
    if (!actor && ctx.path === "/passkey/verify-authentication") {
        actor = await passkeyOwner(body.response?.id);
    }
    if (!actor) {
        // @ts-ignore Set by auditAuthBeforeHook
        actor = ctx.context.auditActor ?? null;
    }

    let target: Record<string, unknown> | null = null;
    if (ctx.path.startsWith("/sign-in/")) {
        target = { username: typeof body.username === "string" ? body.username.slice(0, 100) : null };
    } else if (ctx.path === "/passkey/verify-registration") {
        target = { name: typeof body.name === "string" ? body.name.slice(0, 100) : null };
    } else if (ctx.path === "/passkey/delete-passkey" || ctx.path === "/passkey/update-passkey") {
        target = { id: body.id ?? null };
        if (typeof body.name === "string") {
            target.name = body.name.slice(0, 100);
        }
    }

    const error = failed ? (result as Error & { body?: { code?: string } }) : null;
    await writeAuditEntry({
        userId: actor?.id ?? null,
        username: actor?.username ?? (ctx.path.startsWith("/sign-in/") ? (target?.username ?? null) : null),
        ip: ctx.headers?.get(CLIENT_IP_HEADER) ?? null,
        source: "auth",
        action,
        target,
        ok: !failed,
        msg: error ? (error.body?.code ?? error.message) : null,
    });
}
