import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
// Self-contained so it works with any framework. Uses relative URLs, as it's served at <basePath>/hardcoded-passkey/setup.
import setupPage from "./setup-page.html" with { type: "text" };

export interface HardcodedPasskeyUser {
  /** Defaults to `email`. */
  id?: string;
  name: string;
  email: string;
  image?: string | null;
  /** `"<credentialId>.<publicKey>"` strings, as printed by the setup page. */
  passkeys: string[];
}

export interface HardcodedPasskeyOptions {
  users: HardcodedPasskeyUser[];
  /**
   * Domain the passkeys are bound to. Defaults to the hostname the request came from.
   * Set it to a parent domain (e.g. `"example.com"`) to use the same passkey on all its subdomains,
   * and in every app that lives on them. Ignored on localhost.
   */
  rpID?: string;
  /** Shown by the password manager. Defaults to the Better Auth `appName`. */
  rpName?: string;
}

export const hardcodedPasskey = (options: HardcodedPasskeyOptions) => {
  const byCredentialId = new Map<
    string,
    { user: HardcodedPasskeyUser; publicKey: Uint8Array<ArrayBuffer> }
  >();
  for (const user of options.users) {
    for (const passkey of user.passkeys) {
      const [id = "", publicKey = "", ...rest] = passkey.split(".");
      if (!id || !publicKey || rest.length)
        throw new Error(`hardcodedPasskey: invalid passkey for ${user.email}: "${passkey}"`);
      if (byCredentialId.has(id))
        throw new Error(`hardcodedPasskey: passkey ${id} is configured twice`);
      byCredentialId.set(id, { user, publicKey: isoBase64URL.toBuffer(publicKey) });
    }
  }

  // The browser puts the page's origin in clientDataJSON, so we accept whatever Better Auth already trusts
  // (baseURL, baseURL.allowedHosts, trustedOrigins). Better Auth's own origin check also guards these POSTs.
  const origin = (ctx: GenericEndpointContext): string => {
    const value = ctx.headers?.get("origin");
    if (!value || !ctx.context.isTrustedOrigin(value))
      throw new APIError("FORBIDDEN", { message: "Untrusted origin." });
    return value;
  };
  const rpID = (ctx: GenericEndpointContext) => {
    const { hostname } = new URL(origin(ctx));
    // localhost can never use a real domain as rpID, so it always gets its own passkeys.
    return hostname === "localhost" || hostname.endsWith(".localhost")
      ? hostname
      : (options.rpID ?? hostname);
  };

  const saveChallenge = async (ctx: GenericEndpointContext, challenge: string) => {
    const cookie = ctx.context.createAuthCookie("hardcoded_passkey_challenge", { maxAge: 300 });
    await ctx.setSignedCookie(cookie.name, challenge, ctx.context.secret, cookie.attributes);
  };
  const takeChallenge = async (ctx: GenericEndpointContext) => {
    const cookie = ctx.context.createAuthCookie("hardcoded_passkey_challenge");
    const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
    if (!challenge) throw new APIError("BAD_REQUEST", { message: "Challenge expired, try again." });
    return challenge;
  };

  return {
    id: "hardcoded-passkey",
    endpoints: {
      // Setup is always open: it only *generates* keys, and they do nothing until you deploy them.
      hardcodedPasskeySetup: createAuthEndpoint("/hardcoded-passkey/setup", { method: "GET" }, () =>
        Promise.resolve(
          new Response(setupPage, {
            headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
          }),
        ),
      ),
      hardcodedPasskeyRegisterOptions: createAuthEndpoint(
        "/hardcoded-passkey/register-options",
        { method: "POST" },
        async (ctx) => {
          const { name, email } = (ctx.body ?? {}) as { name?: string; email?: string };
          if (!name || !email)
            throw new APIError("BAD_REQUEST", { message: "Name and email are required." });
          const opts = await generateRegistrationOptions({
            rpName: options.rpName ?? ctx.context.options.appName ?? "Better Auth",
            rpID: rpID(ctx),
            userName: email,
            userDisplayName: name,
            attestationType: "none",
            authenticatorSelection: { residentKey: "required", userVerification: "required" },
          });
          await saveChallenge(ctx, opts.challenge);
          return ctx.json(opts);
        },
      ),
      hardcodedPasskeyRegisterVerify: createAuthEndpoint(
        "/hardcoded-passkey/register-verify",
        { method: "POST" },
        async (ctx) => {
          const expectedChallenge = await takeChallenge(ctx);
          const result = await verifyRegistrationResponse({
            response: ctx.body as RegistrationResponseJSON,
            expectedChallenge,
            expectedOrigin: origin(ctx),
            expectedRPID: rpID(ctx),
            requireUserVerification: true,
          }).catch((e: unknown) => {
            throw new APIError("BAD_REQUEST", {
              message: e instanceof Error ? e.message : String(e),
            });
          });
          if (!result.verified)
            throw new APIError("BAD_REQUEST", { message: "Registration failed." });
          const { credential } = result.registrationInfo;
          return ctx.json({
            rpID: rpID(ctx),
            passkey: `${credential.id}.${isoBase64URL.fromBuffer(credential.publicKey)}`,
          });
        },
      ),
      hardcodedPasskeySignInOptions: createAuthEndpoint(
        "/hardcoded-passkey/sign-in-options",
        { method: "POST" },
        async (ctx) => {
          if (!byCredentialId.size)
            throw new APIError("SERVICE_UNAVAILABLE", { message: "No passkeys configured." });
          // allowCredentials: when apps share an rpID, only offer the passkeys configured in *this* app.
          const opts = await generateAuthenticationOptions({
            rpID: rpID(ctx),
            userVerification: "required",
            allowCredentials: [...byCredentialId.keys()].map((id) => ({ id })),
          });
          await saveChallenge(ctx, opts.challenge);
          return ctx.json(opts);
        },
      ),
      hardcodedPasskeySignInVerify: createAuthEndpoint(
        "/hardcoded-passkey/sign-in-verify",
        { method: "POST" },
        async (ctx) => {
          const expectedChallenge = await takeChallenge(ctx);
          const response = ctx.body as AuthenticationResponseJSON;
          const match = byCredentialId.get(response.id);
          if (!match)
            throw new APIError("UNAUTHORIZED", {
              message: "This passkey is not configured for this app.",
            });
          const result = await verifyAuthenticationResponse({
            response,
            expectedChallenge,
            expectedOrigin: origin(ctx),
            expectedRPID: rpID(ctx),
            requireUserVerification: true,
            // The stored counter is always 0 (no DB). Synced passkeys (1Password, iCloud) never
            // increment it. Hardware keys still verify, but without clone detection.
            credential: { id: response.id, publicKey: match.publicKey, counter: 0 },
          }).catch(() => ({ verified: false }));
          if (!result.verified)
            throw new APIError("UNAUTHORIZED", { message: "Passkey not recognized." });

          const { passkeys: _, ...configured } = match.user;
          const now = new Date();
          const user = {
            id: configured.email,
            image: null,
            ...configured,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          };
          const session = {
            id: crypto.randomUUID(),
            token: isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32))),
            userId: user.id,
            expiresAt: new Date(now.getTime() + ctx.context.sessionConfig.expiresIn * 1000),
            createdAt: now,
            updatedAt: now,
            ipAddress: null,
            userAgent: null,
          };
          await setSessionCookie(ctx, { user, session });
          return ctx.json({ user });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
};
