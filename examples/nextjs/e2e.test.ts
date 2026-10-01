// Builds and runs the example, then registers on the setup page and signs in, in real Chromium.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { setTimeout } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, test } from "vitest";

const dir = import.meta.dirname;
const url = "http://localhost:63316";
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
let server: ChildProcess | undefined;
let browser: Browser;

// Starting with different users is what a redeploy does.
const start = async (users: unknown[]) => {
  if (server) {
    server.kill();
    await once(server, "exit");
  }
  server = spawn(process.execPath, [next, "start", "-p", new URL(url).port], {
    cwd: dir,
    stdio: "inherit",
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: "a-very-long-test-secret-that-is-random-enough-1234567890",
      BETTER_AUTH_URL: url,
      ADMIN_USERS: JSON.stringify(users),
    },
  });
  while (
    !(await fetch(url).then(
      (r) => r.ok,
      () => false,
    ))
  )
    await setTimeout(100);
};

beforeAll(async () => {
  execFileSync("pnpm", ["build"], { cwd: `${dir}/../..`, stdio: "inherit" });
  execFileSync(process.execPath, [next, "build"], { cwd: dir, stdio: "inherit" });
  browser = await chromium.launch();
});

afterAll(async () => {
  server?.kill();
  await browser.close();
});

test("register on the setup page, then sign in on the example app", async () => {
  await start([]);
  const context = await browser.newContext();
  await context.credentials.install();
  const page = await context.newPage();

  await page.goto(`${url}/api/auth/hardcoded-passkey/setup`);
  await page.getByLabel("Name").fill("Team");
  await page.getByLabel("Email").fill("team@example.com");
  await page.getByRole("button", { name: "Create passkey" }).click();
  await page.getByText(/^Done/).waitFor();
  const snippet = (await page.locator("pre").textContent()) ?? "";

  await start([JSON.parse(snippet.replace(/,$/, ""))]);
  await page.goto(url);
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await page.getByText("Signed in as team@example.com").waitFor();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in with passkey" }).waitFor();
});
