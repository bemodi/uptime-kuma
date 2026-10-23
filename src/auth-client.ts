import { createAuthClient } from "better-auth/vue";
import { twoFactorClient, usernameClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { reconnectSocket } from "./mixins/socket";

export const baseURL =
    process.env.NODE_ENV === "development" || localStorage.dev === "dev"
        ? location.protocol + "//" + location.hostname + ":3001"
        : "";

export const authClient = createAuthClient({
    baseURL,
    plugins: [usernameClient(), twoFactorClient(), apiKeyClient(), passkeyClient()],
});
/**
 * @returns Check if the user is logged in
 */
export async function isLoggedIn() {
    const session = await authClient.getSession();
    return session.data !== null;
}

/**
 * @param username Username
 * @param password Password
 * @param remember Remember Me
 */
export async function login(username: string, password: string, remember: boolean = true) {
    const { data, error } = await authClient.signIn.username({
        username,
        password,
        rememberMe: remember,
    });

    if (error) {
        throw new Error(passkeyErrorKey(error.code) ?? error.message);
    }

    if ("twoFactorRedirect" in data) {
        return "twoFactorRequired";
    }

    reconnectSocket();
}

/**
 * @param token Token
 */
export async function verifyTotp(token: string) {
    const { error } = await authClient.twoFactor.verifyTotp({
        code: token,
    });

    if (error) {
        throw new Error(error.message);
    }

    reconnectSocket();
}

/**
 * @param onSuccess
 */
export async function logout(onSuccess = () => {}) {
    await authClient.signOut({
        fetchOptions: {
            onSuccess,
        },
    });
}

// Translation keys for passkey related error codes from the server and the browser
const passkeyErrorKeys: Record<string, string> = {
    PASSKEY_REQUIRED: "passkeyRequiredMsg",
    PASSKEY_USER_VERIFICATION_REQUIRED: "passkeyUserVerificationMsg",
    PASSKEY_LIMIT_REACHED: "passkeyLimitMsg",
    PASSKEY_MINIMUM_REACHED: "passkeyMinimumMsg",
    AUTH_CANCELLED: "passkeyCancelledMsg",
    ERROR_CEREMONY_ABORTED: "passkeyCancelledMsg",
    ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: "passkeyAlreadyRegisteredMsg",
    ERROR_INVALID_DOMAIN: "passkeyInvalidDomainMsg",
    ERROR_INVALID_RP_ID: "passkeyInvalidDomainMsg",
};

/**
 * @param code Error code from better-auth or @simplewebauthn/browser
 * @returns Translation key, or undefined if the code is not passkey related
 */
export function passkeyErrorKey(code?: string): string | undefined {
    return code ? passkeyErrorKeys[code] : undefined;
}

/**
 * @param error Error returned by the better-auth client
 * @param error.code Error code
 * @param error.message Error message
 * @returns Error with a translation key as message where possible
 */
function toError(error: { code?: string; message?: string }) {
    return new Error(passkeyErrorKey(error.code) ?? error.message ?? error.code ?? "Unknown error");
}

/**
 * Log in with a passkey. No username is needed, the browser offers the stored passkeys.
 */
export async function loginWithPasskey() {
    const result = await authClient.signIn.passkey();
    if (result?.error) {
        throw toError(result.error);
    }
    reconnectSocket();
}

/**
 * Create a passkey for the logged-in user
 * @param name Label, e.g. the device
 */
export async function addPasskey(name: string) {
    const result = await authClient.passkey.addPasskey({ name: name || undefined });
    if (result?.error) {
        throw toError(result.error);
    }
}

/**
 * @returns Passkeys of the logged-in user
 */
export async function listPasskeys() {
    const { data, error } = await authClient.passkey.listUserPasskeys();
    if (error) {
        throw toError(error);
    }
    return data ?? [];
}

/**
 * @param id Passkey ID
 */
export async function deletePasskey(id: string) {
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) {
        throw toError(error);
    }
}

/**
 * @param id Passkey ID
 * @param name New label
 */
export async function renamePasskey(id: string, name: string) {
    const { error } = await authClient.passkey.updatePasskey({ id, name });
    if (error) {
        throw toError(error);
    }
}
