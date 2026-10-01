import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { BetterAuthClientPlugin } from "better-auth/client";
import type { hardcodedPasskey } from "./index.js";

// Derived from the plugin type: with `BetterFetch` from better-auth/client, TypeScript < 7 rejects the plugin in createAuthClient.
type BetterFetch = Parameters<NonNullable<BetterAuthClientPlugin["getActions"]>>[0];

export const hardcodedPasskeyClient = () =>
  ({
    id: "hardcoded-passkey",
    $InferServerPlugin: {} as ReturnType<typeof hardcodedPasskey>,
    getActions: ($fetch: BetterFetch) => ({
      signIn: {
        /**
         * `autoFill: true` offers the passkeys as autofill suggestions instead of opening a dialog.
         * Call it on page load, with an `<input autocomplete="username webauthn">` on the page.
         * The promise resolves once the user picks a passkey.
         */
        hardcodedPasskey: async ({ autoFill = false }: { autoFill?: boolean } = {}) => {
          const options = await $fetch<PublicKeyCredentialRequestOptionsJSON>(
            "/hardcoded-passkey/sign-in-options",
            // Empty body still sets Content-Type: json. Without it, Next.js gets a 415.
            { method: "POST", body: {} },
          );
          if (options.error) return options;
          try {
            const response = await startAuthentication({
              optionsJSON: options.data,
              useBrowserAutofill: autoFill,
            });
            return await $fetch("/hardcoded-passkey/sign-in-verify", {
              method: "POST",
              body: response,
            });
          } catch (e) {
            return {
              data: null,
              error: { message: (e as Error).message, status: 400, statusText: "BAD_REQUEST" },
            };
          }
        },
      },
    }),
    atomListeners: [
      { matcher: (path) => path === "/hardcoded-passkey/sign-in-verify", signal: "$sessionSignal" },
    ],
  }) satisfies BetterAuthClientPlugin;
