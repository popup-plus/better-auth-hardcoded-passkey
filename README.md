# better-auth-hardcoded-passkey

A [Better Auth](https://better-auth.com) plugin for admin panels used only by you and your team. The passkey is hardcoded in your config, the same way you might hardcode an admin password. You don't need a database.

## Setup

```sh
npm i better-auth better-auth-hardcoded-passkey
```

```ts
// auth.ts
import { betterAuth } from "better-auth";
import { hardcodedPasskey } from "better-auth-hardcoded-passkey";

export const auth = betterAuth({
  // no `database`: Better Auth runs stateless and keeps sessions in an encrypted cookie
  plugins: [
    hardcodedPasskey({
      users: [
        // paste output of /api/auth/hardcoded-passkey/setup here
      ],
    }),
  ],
});
```

1. Deploy.
2. Visit `https://your-app/api/auth/hardcoded-passkey/setup`, fill in a name and email, and click **Create passkey**. Save it in your password manager, for example a shared 1Password vault.
3. Paste the snippet into `users` and redeploy. Done.

Each passkey is a single `"<credentialId>.<publicKey>"` string. It's safe to commit, or you can keep it in an env var:

```ts
hardcodedPasskey({
  users: [
    { name: "Bart", email: "bart@example.com", passkeys: ["S2xg….pQEC…"] },
    { name: "Ops team", email: "ops@example.com", passkeys: process.env.OPS_PASSKEYS!.split(",") },
  ],
});
```

The session user is `{ id: email, name, email, image }`. You can override `id` per user.

## Sign in

```ts
import { createAuthClient } from "better-auth/client";
import { hardcodedPasskeyClient } from "better-auth-hardcoded-passkey/client";

const authClient = createAuthClient({ plugins: [hardcodedPasskeyClient()] });

await authClient.signIn.hardcodedPasskey();
await authClient.signOut();
```

Sessions work like any other Better Auth session (`auth.api.getSession`, `useSession`, …).

For a complete app, see the [Next.js example](examples/nextjs).

### Autofill

Autofill makes your passkeys show up as suggestions when you focus the input, so you don't need a sign-in button:

```tsx
<input autocomplete="username webauthn" />
```

```ts
// on page load; resolves once a passkey is picked
const { error } = await authClient.signIn.hardcodedPasskey({ autoFill: true });
```

If you call `signIn.hardcodedPasskey()` again, for example from a button, it cancels the pending autofill request.

## Compared to `@better-auth/passkey`

This plugin replaces the official passkey plugin; it doesn't sit next to it. Without a database you lose:

- Adding, listing, renaming and deleting passkeys at runtime. Edit the config and redeploy instead.
- Linking passkeys to real users who also sign in another way, such as with a password or a social login.
- Signature-counter clone detection. Synced passkeys always report 0 anyway.
- Plugins that store data per user, such as `admin`, `organization` or `twoFactor`. Users here exist only in the session cookie.

## Several domains, several apps, one passkey

A passkey is bound to a domain, the _rpID_. By default the rpID is the hostname the request came from, so each domain gets its own passkeys.

**Subdomains.** Set `rpID` to the parent domain. Then one passkey works on every subdomain, in every app that uses it:

```ts
hardcodedPasskey({
  rpID: "example.com",
  users,
});
```

With this, `admin.example.com`, `staging.admin.example.com` and `stats.example.com` can all share the same passkey string. Each app only accepts the passkeys in its own `users`, so every app decides for itself who gets in. Put the users list in a shared package or env var if several apps need the same list.

Every origin must be one Better Auth trusts: `baseURL`, `baseURL.allowedHosts`, or `trustedOrigins`.

`rpID` is ignored on `localhost` because browsers never accept a real domain there. Local development just works, with its own passkey.

**Unrelated domains** (`foo.com` and `bar.io`). Pick one of them as the `rpID`, say `foo.com`. Then serve this file from `https://foo.com/.well-known/webauthn`:

```json
{ "origins": ["https://foo.com", "https://bar.io"] }
```

This uses [Related Origin Requests](https://passkeys.dev/docs/advanced/related-origins/). Browser and password-manager support varies, so test it with your own setup.

## Why is this safe?

- The config holds only **public** keys. The private key stays in your password manager.
- The setup page is always open, but that's fine: it only _generates_ a key pair. A new key does nothing until someone with repo access pastes it into the config and deploys it.
- Without a database there's no stored signature counter. Synced passkeys (1Password, iCloud, Google) always report 0 anyway. Hardware keys still work, but you lose clone detection.
- If a passkey leaks, remove it from the config and redeploy. To end all existing sessions too, rotate `BETTER_AUTH_SECRET`.

## Options

| option   | default                                              |
| -------- | ---------------------------------------------------- |
| `users`  | required, `{ id?, name, email, image?, passkeys }[]` |
| `rpID`   | hostname of the request (always that on localhost)   |
| `rpName` | `appName`                                            |

## Development

```sh
pnpm install
pnpm exec playwright install chromium
pnpm build  # also runs publint and attw; lint and the Next.js example need dist/
pnpm lint && pnpm format:check
pnpm test   # node tests, plus real Chromium with Playwright's virtual authenticator against a test server and the Next.js example
```

## License

MIT
