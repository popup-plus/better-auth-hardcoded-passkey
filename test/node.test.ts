import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";
import { betterAuth } from "better-auth";
// Server-side cases a real browser cannot reach (other domains): hand-rolled software authenticator.
import { test } from "vitest";
import { hardcodedPasskey, type HardcodedPasskeyOptions } from "../src/index.ts";

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
type CBOR = Parameters<typeof isoCBOR.encode>[0];

function authenticator(rpID: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const credId = crypto.getRandomValues(new Uint8Array(16));
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x ?? "")],
      [-3, isoBase64URL.toBuffer(jwk.y ?? "")],
    ]),
  );
  const rpIdHash = sha256(rpID);
  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    create: (challenge: string, origin: string) => {
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([0x45, 0, 0, 0, 0]),
        Buffer.alloc(16),
        Buffer.from([0, 16]),
        credId,
        cose,
      ]);
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(clientData("webauthn.create", challenge, origin)),
          attestationObject: b64(
            isoCBOR.encode(
              new Map<string, CBOR>([
                ["fmt", "none"],
                ["attStmt", new Map<string, CBOR>()],
                ["authData", authData],
              ]),
            ),
          ),
        },
      };
    },
    get: (challenge: string, origin: string, tamper = false) => {
      const cd = clientData("webauthn.get", challenge, origin);
      const ad = Buffer.concat([rpIdHash, Buffer.from([0x05, 0, 0, 0, 0])]);
      const sig = sign(
        "sha256",
        Buffer.concat([ad, sha256(tamper ? Buffer.from("x") : cd)]),
        privateKey,
      );
      return {
        id: b64(credId),
        rawId: b64(credId),
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64(cd), authenticatorData: b64(ad), signature: b64(sig) },
      };
    },
  };
}

function app(baseURL: string, plugin: HardcodedPasskeyOptions, trustedOrigins: string[] = []) {
  const auth = betterAuth({
    baseURL,
    trustedOrigins,
    secret: "a-very-long-test-secret-that-is-random-enough-" + baseURL,
    plugins: [hardcodedPasskey(plugin)],
  });
  const cookies = new Map<string, string>();
  const call = async (path: string, body?: unknown, origin = baseURL) => {
    const res = await auth.handler(
      new Request(baseURL + "/api/auth" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return res;
  };
  const register = async (a: ReturnType<typeof authenticator>, name: string, email: string) => {
    const o = (await (
      await call("/hardcoded-passkey/register-options", { name, email })
    ).json()) as { challenge: string };
    const res = await call("/hardcoded-passkey/register-verify", a.create(o.challenge, baseURL));
    const data = (await res.json()) as { passkey: string };
    assert.equal(res.status, 200, JSON.stringify(data));
    return data.passkey;
  };
  const signIn = async (a: ReturnType<typeof authenticator>, origin = baseURL, tamper = false) => {
    const o = (await (await call("/hardcoded-passkey/sign-in-options", {}, origin)).json()) as {
      challenge: string;
    };
    return call("/hardcoded-passkey/sign-in-verify", a.get(o.challenge, origin, tamper), origin);
  };
  const me = async () =>
    ((await (await call("/get-session")).json()) as { user: { email: string } } | null)?.user
      .email ?? null;
  return { call, register, signIn, me };
}

test("register, sign in, get session, sign out", async () => {
  const setup = app("http://localhost:3000", { users: [] });
  assert.match(await (await setup.call("/hardcoded-passkey/setup")).text(), /<form id="go">/);
  const a = authenticator("localhost");
  const passkey = await setup.register(a, "Team", "team@example.com");
  assert.match(passkey, /^[\w-]+\.[\w-]+$/);

  const prod = app("http://localhost:3000", {
    users: [{ name: "Team", email: "team@example.com", passkeys: [passkey] }],
  });
  assert.equal(await prod.me(), null);
  assert.equal((await prod.signIn(a, undefined, true)).status, 401);
  assert.equal((await prod.signIn(a)).status, 200);
  assert.equal(await prod.me(), "team@example.com");
  assert.equal((await prod.call("/sign-out", {})).status, 200);
  assert.equal(await prod.me(), null);
});

test("one passkey across domains and apps via shared rpID; several users", async () => {
  const bart = authenticator("example.com"),
    team = authenticator("example.com");
  const setup = app("https://admin.example.com", { rpID: "example.com", users: [] });
  const bartKey = await setup.register(bart, "Bart", "bart@example.com");
  const teamKey = await setup.register(team, "Team", "team@example.com");
  const users = [
    { name: "Bart", email: "bart@example.com", passkeys: [bartKey] },
    { name: "Team", email: "team@example.com", passkeys: [teamKey] },
  ];

  // App 1 deployed on two domains
  const app1 = app("https://admin.example.com", { rpID: "example.com", users }, [
    "https://admin-staging.example.com",
  ]);
  assert.equal((await app1.signIn(bart, "https://admin-staging.example.com")).status, 200);
  assert.equal(await app1.me(), "bart@example.com");
  assert.equal((await app1.signIn(team)).status, 200);
  assert.equal(await app1.me(), "team@example.com");
  assert.equal(
    (await app1.call("/hardcoded-passkey/sign-in-options", {}, "https://evil.com")).status,
    403,
  );

  // App 2 only knows the team passkey
  const app2 = app("https://stats.example.com", { rpID: "example.com", users: [users[1]] });
  assert.equal((await app2.signIn(team)).status, 200);
  assert.equal((await app2.signIn(bart)).status, 401);
});

test("rejects malformed config", () => {
  assert.throws(() =>
    hardcodedPasskey({ users: [{ name: "x", email: "x@x", passkeys: ["nodot"] }] }),
  );
});
