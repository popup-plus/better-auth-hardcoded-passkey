import { hardcodedPasskeyClient } from "better-auth-hardcoded-passkey/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ plugins: [hardcodedPasskeyClient()] });
