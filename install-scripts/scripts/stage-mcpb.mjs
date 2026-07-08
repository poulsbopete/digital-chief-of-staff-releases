#!/usr/bin/env node
/**
 * Copy a clean .mcpb to ~/.config/dcos without injecting broken user_config fields.
 * Credentials load from ~/.config/dcos/env.sh at MCP launch (see seed-claude-* scripts).
 */
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDcosInstallDir } from "../lib/load-dcos-env.mjs";

function parseArgs(argv) {
  const args = { in: "", out: "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

function main() {
  const { in: inPath, out: outPathArg } = parseArgs(process.argv);
  const installDir = getDcosInstallDir();
  const outPath = outPathArg || join(installDir, "digital-chief-of-staff.mcpb");

  if (!inPath || !existsSync(inPath)) {
    console.error("Usage: stage-mcpb.mjs --in path/to/bundle.mcpb [--out path.mcpb]");
    process.exit(1);
  }

  copyFileSync(inPath, outPath);
  console.log(JSON.stringify({ ok: true, out: outPath, note: "No user_config injected — use env.sh" }, null, 2));
}

main();
