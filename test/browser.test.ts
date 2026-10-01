// Real Chromium + Playwright's virtual authenticator: the setup page registers a passkey, the client signs in.
import { createAuthClient } from "better-auth/client";
import { expect, test } from "vitest";
import { commands, page } from "vitest/browser";
import { hardcodedPasskeyClient } from "../src/client.ts";

declare module "vitest/browser" {
  interface BrowserCommands {
    installPasskeys: () => Promise<void>;
  }
}

test("register on the setup page, then sign in with the client", async () => {
  await commands.installPasskeys();

  // Setup page, in a same-origin iframe, driven through Playwright
  const iframe = document.createElement("iframe");
  iframe.src = "/api/auth/hardcoded-passkey/setup";
  document.body.append(iframe);
  const setup = page.frameLocator(page.elementLocator(iframe));
  await setup.getByLabelText("Name").fill("Team");
  await setup.getByLabelText("Email").fill("team@example.com");
  await setup.getByRole("button", { name: "Create passkey" }).click();
  await expect.element(setup.getByText(/^Done/)).toBeVisible();
  const snippet = iframe.contentDocument?.querySelector("pre")?.textContent ?? "";
  const user = JSON.parse(snippet.replace(/,$/, "")) as { passkeys: string[] };
  expect(user).toMatchObject({
    name: "Team",
    email: "team@example.com",
    passkeys: [expect.stringMatching(/^[\w-]+\.[\w-]+$/)],
  });

  // "Redeploy" with the snippet pasted in
  await fetch("/test/users", { method: "POST", body: JSON.stringify([user]) });

  const client = createAuthClient({
    baseURL: location.origin,
    plugins: [hardcodedPasskeyClient()],
  });
  expect((await client.getSession()).data).toBeNull();
  const signIn = await client.signIn.hardcodedPasskey();
  expect(signIn.error).toBeNull();
  expect((await client.getSession()).data?.user.email).toBe("team@example.com");
  await client.signOut();
  expect((await client.getSession()).data).toBeNull();

  // Autofill (conditional UI)
  document.body.insertAdjacentHTML("beforeend", '<input autocomplete="username webauthn">');
  const autoFill = client.signIn.hardcodedPasskey({ autoFill: true });
  await page.getByRole("textbox").click();
  expect((await autoFill).error).toBeNull();
  expect((await client.getSession()).data?.user.email).toBe("team@example.com");
});
