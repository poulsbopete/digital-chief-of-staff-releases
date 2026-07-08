#!/usr/bin/env node
/**
 * Jina MCP for Claude Desktop — runs bundled mcp-remote in-process (no child spawn).
 * Claude's built-in Node cannot spawn Electron helper children (spawn npx / execPath fails).
 * API key: ~/.config/dcos/env.sh (JINA_API_KEY) or process env.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readDcosEnv } from "./lib/load-dcos-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const JINA_MCP_URL = "https://mcp.jina.ai/v1?include_tags=search,read,utility";

function authHeader() {
  const vars = readDcosEnv();
  const raw = (vars.JINA_API_KEY || process.env.JINA_API_KEY || "").trim();
  if (!raw || raw === "YOUR_JINA_API_KEY") return "Bearer ";
  return raw.startsWith("Bearer ") ? raw : `Bearer ${raw}`;
}

const proxyPath = join(__dirname, "node_modules", "mcp-remote", "dist", "proxy.js");
if (!existsSync(proxyPath)) {
  console.error("[jina-mcp] Missing bundled mcp-remote — reinstall jina.mcpb from the DCOS installer.");
  process.exit(1);
}

// mcp-remote/proxy.js reads process.argv.slice(2) at load time.
process.argv = [process.argv[0], proxyPath, JINA_MCP_URL, "--header", `Authorization:${authHeader()}`];

await import(pathToFileURL(proxyPath).href);
