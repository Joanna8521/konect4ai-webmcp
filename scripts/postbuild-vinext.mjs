import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = resolve("dist/server/index.js");
mkdirSync(dirname(outputPath), { recursive: true });

writeFileSync(
  outputPath,
  [
    '"use strict";',
    "",
    'const http = require("node:http");',
    'const next = require("next");',
    "",
    'const port = Number(process.env.PORT || process.env.VINEXT_PORT || 3000);',
    'const host = process.env.HOST || "0.0.0.0";',
    'const dev = process.env.NODE_ENV !== "production";',
    "",
    "async function main() {",
    '  const app = next({ dev, dir: process.cwd() });',
    "  const handler = app.getRequestHandler();",
    "",
    "  await app.prepare();",
    "",
    "  const server = http.createServer((req, res) => {",
    "    handler(req, res);",
    "  });",
    "",
    "  server.listen(port, host, () => {",
    '    console.log("Konect4AI WebMCP listening on http://" + host + ":" + port);',
    "  });",
    "}",
    "",
    "main().catch((error) => {",
    "  console.error(error);",
    "  process.exit(1);",
  "});",
  "",
].join("\n"),
  "utf8",
);

const hostingMetadataPath = resolve("dist/.openai/hosting.json");
mkdirSync(dirname(hostingMetadataPath), { recursive: true });
writeFileSync(hostingMetadataPath, JSON.stringify({ static: null }, null, 2), "utf8");
