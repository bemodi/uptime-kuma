import { passkey } from "@better-auth/passkey";
import { APIError, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import type { HookEndpointContext } from "@better-auth/core";
import { R } from "redbean-node";
import { isDevEnv, log } from "../src/util";

/*
 * Login requires a passkey (fork policy):
 * - every account has between MIN_PASSKEYS and MAX_PASSKEYS passkeys
 * - passkeys must verify the user (PIN or biometrics), so a passkey alone is multi-factor
 * - the password only works while an account has no passkey (first login, recovery);
 *   such a session is held at passkey setup by the socket server
 */
export const MAX_PASSKEYS = 3;
export const MIN_PASSKEYS = 1;

/**
 * Count the passkeys of a user
 * @param userId better-auth user ID
 * @returns Number of passkeys
 */
export async function countPasskeys(userId: string): Promise<number> {
    const row = await R.knex("better_auth_passkey").where({ userId }).count("id as count").first();
    return Number(row?.count ?? 0);
}

/**
 * Whether a user still has to set up a passkey before using the app
 * @param userId better-auth user ID
 * @returns True if the user has fewer than MIN_PASSKEYS passkeys
 */
export async function needsPasskeyEnrollment(userId: string): Promise<boolean> {
    return (await countPasskeys(userId)) < MIN_PASSKEYS;
}

/**
 * Remove all passkeys of a user, for an admin reset or the CLI.
 * Bypasses MIN_PASSKEYS on purpose: the user sets up a new passkey at the next login.
 * @param userId better-auth user ID
 * @returns Number of removed passkeys
 */
export async function deleteAllPasskeys(userId: string): Promise<number> {
    return R.knex("better_auth_passkey").where({ userId }).del();
}

/**
 * Relying party from the environment.
 * UPTIME_KUMA_PASSKEY_ORIGIN is the public URL, e.g. https://status.example.com.
 * UPTIME_KUMA_PASSKEY_RP_ID defaults to the hostname of that URL.
 * Changing the RP ID later invalidates all existing passkeys.
 * @returns RP ID and expected origin (null: use the request origin)
 */
export function getRelyingParty(): { rpID: string; origin: string | null } {
    const origin = process.env.UPTIME_KUMA_PASSKEY_ORIGIN?.trim().replace(/\/+$/, "") || null;
    let rpID = process.env.UPTIME_KUMA_PASSKEY_RP_ID?.trim();
    if (!rpID && origin) {
        rpID = new URL(origin).hostname;
    }
    return {
        rpID: rpID || "localhost",
        origin,
    };
}

/**
 * Reject a passkey ceremony without user verification
 * @param userVerified Whether the authenticator verified the user
 * @throws {APIError} If the user was not verified
 */
function requireUserVerification(userVerified: boolean | undefined) {
    if (!userVerified) {
        throw new APIError("UNAUTHORIZED", {
            message: "The passkey must verify you with a PIN or biometrics",
            code: "PASSKEY_USER_VERIFICATION_REQUIRED",
        });
    }
}

/**
 * The better-auth passkey plugin, configured for this policy
 * @returns better-auth plugin
 */
export function createPasskeyPlugin() {
    const { rpID, origin } = getRelyingParty();
    if (!process.env.UPTIME_KUMA_PASSKEY_ORIGIN && !isDevEnv()) {
        log.warn("auth", "UPTIME_KUMA_PASSKEY_ORIGIN is not set, passkeys only work on http://localhost");
    }
    log.info("auth", `Passkey relying party: ${rpID}`);

    return passkey({
        rpID,
        rpName: "Uptime Kuma",
        origin,
        authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
        },
        schema: {
            passkey: {
                modelName: "better_auth_passkey",
            },
        },
        registration: {
            afterVerification: ({ verification }) => {
                requireUserVerification(verification.registrationInfo?.userVerified);
            },
        },
        authentication: {
            afterVerification: ({ verification }) => {
                requireUserVerification(verification.authenticationInfo?.userVerified);
            },
        },
    });
}

/**
 * Before hook: keep the number of passkeys between MIN_PASSKEYS and MAX_PASSKEYS
 * @param ctx better-auth hook context
 * @throws {APIError} If the action would leave the allowed range
 */
export async function passkeyBeforeHook(ctx: HookEndpointContext) {
    const adding = ctx.path === "/passkey/generate-register-options" || ctx.path === "/passkey/verify-registration";
    const deleting = ctx.path === "/passkey/delete-passkey";
    if (!adding && !deleting) {
        return;
    }

    const session = await getSessionFromCtx(ctx);
    if (!session) {
        return;
    }

    const count = await countPasskeys(session.user.id);
    if (adding && count >= MAX_PASSKEYS) {
        throw new APIError("BAD_REQUEST", {
            message: `At most ${MAX_PASSKEYS} passkeys per account`,
            code: "PASSKEY_LIMIT_REACHED",
        });
    }
    if (deleting && count <= MIN_PASSKEYS) {
        throw new APIError("BAD_REQUEST", {
            message: `At least ${MIN_PASSKEYS} passkey is required`,
            code: "PASSKEY_MINIMUM_REACHED",
        });
    }
}

/**
 * After hook: a password (with or without TOTP) only logs in accounts without a passkey.
 * Accounts with a passkey must use it, so the new session is removed again.
 * @param ctx better-auth hook context
 * @throws {APIError} If the account has a passkey
 */
export async function passkeyAfterHook(ctx: HookEndpointContext) {
    if (!ctx.path.startsWith("/sign-in/") && !ctx.path.startsWith("/two-factor/")) {
        return;
    }

    const data = ctx.context.newSession;
    if (!data || (await needsPasskeyEnrollment(data.user.id))) {
        return;
    }

    deleteSessionCookie(ctx);
    await ctx.context.internalAdapter.deleteSession(data.session.token);
    ctx.context.setNewSession(null);
    throw new APIError("FORBIDDEN", {
        message: "This account has a passkey. Please log in with your passkey.",
        code: "PASSKEY_REQUIRED",
    });
}
