import { betterAuth } from "better-auth";
import { hardcodedPasskey, type HardcodedPasskeyUser } from "better-auth-hardcoded-passkey";

export const auth = betterAuth({
  plugins: [
    hardcodedPasskey({
      // Paste the output of /api/auth/hardcoded-passkey/setup here, or keep it in an env var like this.
      users: JSON.parse(process.env.ADMIN_USERS ?? "[]") as HardcodedPasskeyUser[],
    }),
  ],
});
