import crypto from "node:crypto";

/*
 * A software WebAuthn authenticator for backend tests: ES256 keys, attestation "none".
 * It produces the same JSON that @simplewebauthn/browser sends to the server.
 */

type CborValue = Buffer | string | number | Map<CborValue, CborValue>;

const b64u = (buf: Buffer) => buf.toString("base64url");
const sha256 = (data: Buffer | string) => crypto.createHash("sha256").update(data).digest();

/**
 * CBOR header for a major type and length
 * @param major CBOR major type
 * @param len Length or value
 * @returns Encoded header
 */
function cborHead(major: number, len: number): Buffer {
    if (len < 24) {
        return Buffer.from([(major << 5) | len]);
    }
    if (len < 256) {
        return Buffer.from([(major << 5) | 24, len]);
    }
    const b = Buffer.alloc(3);
    b[0] = (major << 5) | 25;
    b.writeUInt16BE(len, 1);
    return b;
}

/**
 * Minimal CBOR encoder, enough for attestation objects and COSE keys
 * @param value Value to encode
 * @returns Encoded value
 */
function cbor(value: CborValue): Buffer {
    if (Buffer.isBuffer(value)) {
        return Buffer.concat([cborHead(2, value.length), value]);
    }
    if (typeof value === "string") {
        const s = Buffer.from(value);
        return Buffer.concat([cborHead(3, s.length), s]);
    }
    if (typeof value === "number") {
        return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
    }
    const parts = [cborHead(5, value.size)];
    for (const [k, v] of value) {
        parts.push(cbor(k), cbor(v));
    }
    return Buffer.concat(parts);
}

export interface SoftCredential {
    credId: Buffer;
    privateKey: crypto.KeyObject;
    userId: string;
    counter: number;
}

export class SoftAuthenticator {
    creds: SoftCredential[] = [];

    /**
     * @param rpID Relying party ID the credentials are scoped to
     * @param origin Origin written into clientDataJSON
     */
    constructor(
        public rpID: string,
        public origin: string
    ) {}

    /**
     * Answer registration options (navigator.credentials.create)
     * @param options Options from /passkey/generate-register-options
     * @param options.challenge Challenge to sign
     * @param options.user User the credential belongs to
     * @param options.user.id User handle
     * @param opts Authenticator behaviour
     * @param opts.uv Whether the user is verified (PIN or biometrics)
     * @returns RegistrationResponseJSON
     */
    create(options: { challenge: string; user: { id: string } }, { uv = true } = {}) {
        const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
        const jwk = publicKey.export({ format: "jwk" });
        const credId = crypto.randomBytes(32);
        const coseKey = cbor(
            new Map<CborValue, CborValue>([
                [1, 2],
                [3, -7],
                [-1, 1],
                [-2, Buffer.from(jwk.x as string, "base64url")],
                [-3, Buffer.from(jwk.y as string, "base64url")],
            ])
        );
        const flags = 0x01 | 0x40 | (uv ? 0x04 : 0);
        const credIdLength = Buffer.alloc(2);
        credIdLength.writeUInt16BE(credId.length);
        const authData = Buffer.concat([
            sha256(this.rpID),
            Buffer.from([flags]),
            Buffer.alloc(4),
            Buffer.alloc(16),
            credIdLength,
            credId,
            coseKey,
        ]);
        const clientDataJSON = Buffer.from(
            JSON.stringify({
                type: "webauthn.create",
                challenge: options.challenge,
                origin: this.origin,
                crossOrigin: false,
            })
        );
        const attestationObject = cbor(
            new Map<CborValue, CborValue>([
                ["fmt", "none"],
                ["attStmt", new Map()],
                ["authData", authData],
            ])
        );
        this.creds.push({ credId, privateKey, userId: options.user.id, counter: 0 });
        return {
            id: b64u(credId),
            rawId: b64u(credId),
            type: "public-key",
            response: {
                clientDataJSON: b64u(clientDataJSON),
                attestationObject: b64u(attestationObject),
                transports: ["internal"],
            },
            clientExtensionResults: {},
            authenticatorAttachment: "platform",
        };
    }

    /**
     * Answer authentication options (navigator.credentials.get)
     * @param options Options from /passkey/generate-authenticate-options
     * @param options.challenge Challenge to sign
     * @param cred Credential to sign with
     * @param opts Authenticator behaviour
     * @param opts.uv Whether the user is verified (PIN or biometrics)
     * @returns AuthenticationResponseJSON
     */
    get(options: { challenge: string }, cred: SoftCredential, { uv = true } = {}) {
        cred.counter++;
        const counter = Buffer.alloc(4);
        counter.writeUInt32BE(cred.counter);
        const authData = Buffer.concat([sha256(this.rpID), Buffer.from([0x01 | (uv ? 0x04 : 0)]), counter]);
        const clientDataJSON = Buffer.from(
            JSON.stringify({
                type: "webauthn.get",
                challenge: options.challenge,
                origin: this.origin,
                crossOrigin: false,
            })
        );
        const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), cred.privateKey);
        return {
            id: b64u(cred.credId),
            rawId: b64u(cred.credId),
            type: "public-key",
            response: {
                clientDataJSON: b64u(clientDataJSON),
                authenticatorData: b64u(authData),
                signature: b64u(signature),
                userHandle: cred.userId,
            },
            clientExtensionResults: {},
        };
    }
}

/**
 * A cookie jar around a fetch-like handler, so tests can act like one browser
 */
export class TestBrowser {
    cookies = new Map<string, string>();

    origin: string;

    /**
     * @param baseUrl Base URL for request paths
     * @param handler Request handler, e.g. auth().handler or fetch
     * @param origin Origin header to send, defaults to the origin of baseUrl
     */
    constructor(
        public baseUrl: string,
        public handler: (req: Request) => Promise<Response>,
        origin?: string
    ) {
        this.origin = origin ?? new URL(baseUrl).origin;
    }

    /**
     * Cookie header for the stored cookies
     * @returns Cookie header value
     */
    cookieHeader(): string {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }

    /**
     * Send a JSON request and keep the cookies it sets
     * @param method HTTP method
     * @param path Path below baseUrl
     * @param body JSON body
     * @returns Status and parsed JSON
     */
    async req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
        const res = await this.handler(
            new Request(this.baseUrl + path, {
                method,
                headers: {
                    "content-type": "application/json",
                    origin: this.origin,
                    cookie: this.cookieHeader(),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            })
        );
        for (const cookie of res.headers.getSetCookie()) {
            const [pair] = cookie.split(";");
            const i = pair.indexOf("=");
            const name = pair.slice(0, i);
            const value = pair.slice(i + 1);
            if (value === "" || /max-age=0/i.test(cookie)) {
                this.cookies.delete(name);
            } else {
                this.cookies.set(name, value);
            }
        }
        const text = await res.text();
        let json: any = text;
        try {
            json = JSON.parse(text);
        } catch {
            // not JSON
        }
        return { status: res.status, json };
    }
}
