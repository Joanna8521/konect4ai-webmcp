import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const filePath = resolve("src/components/WebMcpWorkspace.tsx");
const source = readFileSync(filePath, "utf8");

const banned = [
  "UI language",
  "Connection status",
  "WebMCP checking",
  "Backend connected",
  "agent tools registered",
  "No description.",
  "Waiting for Konect4AI backend...",
  "Awaiting Konect4AI source creation.",
  "Source proposal created.",
  "Source is ready.",
  "Source creation failed.",
  "Source is still processing.",
  "Unable to read source status.",
  "Source became available too slowly to verify through tools/list.",
  "Konect4AI job is ready, but the new capability has not appeared in tools/list yet.",
  "New tool added to the agent toolbox.",
  "Select a capability first.",
  "Select a source first.",
  "Enter a question.",
  "Select an agent first.",
  "Goal is required.",
  "No source capabilities are available for the Data Analyst Agent.",
  "Describe the task goal.",
  "Auto",
  "English",
  "繁體中文",
];

const allowedBoundaryMarkers = [
  "SENT TO AGENT",
  "NOT RETURNED THROUGH WEBMCP",
];

const findings = banned.filter((literal) => source.includes(literal));

if (findings.length > 0) {
  console.error("Hardcoded UI copy found in WebMcpWorkspace.tsx:");
  for (const literal of findings) {
    console.error(`- ${literal}`);
  }
  process.exit(1);
}

for (const literal of allowedBoundaryMarkers) {
  if (!source.includes(literal)) {
    console.error(`Expected boundary marker missing: ${literal}`);
    process.exit(1);
  }
}

console.log("Workspace copy scan passed.");
