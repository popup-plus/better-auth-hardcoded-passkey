import { playwright } from "@vitest/browser-playwright";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { runnerImport } from "vite";
import { defineConfig, type Plugin } from "vitest/config";
import type { BrowserCommand } from "vitest/node";
import type * as Src from "./src/index.ts";

const port = 63_315;

// Same as tsdown's `loader: { ".html": "text" }`.
const htmlAsText: Plugin = {
  name: "html-as-text",
  enforce: "pre",
  transform: (code, id) =>
    id.endsWith(".html") ? `export default ${JSON.stringify(code)};` : undefined,
};

// Mounts a real Better Auth server on the vitest server, so the browser test is same-origin.
// POST /test/users swaps the configured users, like a redeploy would.
const authServer = (): Plugin => ({
  name: "auth-server",
  async configureServer(server) {
    // Loaded through Vite, so the .html import goes through htmlAsText.
    const { hardcodedPasskey } = (
      await runnerImport<typeof Src>("./src/index.ts", { plugins: [htmlAsText] })
    ).module;
    const create = (users: Src.HardcodedPasskeyUser[]) =>
      toNodeHandler(
        betterAuth({
          baseURL: `http://localhost:${String(port)}`,
          secret: "a-very-long-test-secret-that-is-random-enough-1234567890",
          // rpID is ignored on localhost, so this proves the autodetect.
          plugins: [hardcodedPasskey({ rpID: "example.com", users })],
        }),
      );
    let handler = create([]);
    server.middlewares.use((req, res, next) => {
      if (req.url === "/test/users") {
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", () => {
          handler = create(JSON.parse(body) as Src.HardcodedPasskeyUser[]);
          res.end("ok");
        });
      } else if (req.url?.startsWith("/api/auth/")) void handler(req, res);
      else next();
    });
  },
});

const installPasskeys: BrowserCommand = async ({ context }) => {
  await context.credentials.install();
};

export default defineConfig({
  test: {
    projects: [
      { plugins: [htmlAsText], test: { name: "node", include: ["test/node.test.ts"] } },
      {
        test: {
          name: "nextjs",
          include: ["examples/nextjs/e2e.test.ts"],
          hookTimeout: 300_000,
          testTimeout: 60_000,
        },
      },
      {
        plugins: [authServer()],
        test: {
          name: "browser",
          api: { port, strictPort: true },
          include: ["test/browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
            commands: { installPasskeys },
          },
        },
      },
    ],
  },
});
