#!/usr/bin/env node
/**
 * @deprecated Use seed-claude-extension-config.mjs — manifest defaults do not
 * enable Save in Claude Desktop for required/sensitive fields.
 *
 * Inject local Elasticsearch URL + API key into a .mcpb manifest before Claude install.
 *
 *   node scripts/personalize-mcpb.mjs \
 *     --in dist/digital-chief-of-staff.mcpb \
 *     --out ~/.config/dcos/digital-chief-of-staff.mcpb
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readElasticsearchConfig, getDcosInstallDir } from "../lib/load-dcos-env.mjs";

function parseArgs(argv) {
  const args = { in: "", out: "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

function unzip(zipPath, destDir) {
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
      { stdio: "inherit" }
    );
    return;
  }
  execSync(`unzip -q -o ${JSON.stringify(zipPath)} -d ${JSON.stringify(destDir)}`, { stdio: "inherit" });
}

function zipDir(srcDir, outPath) {
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${join(srcDir, "*").replace(/'/g, "''")}' -DestinationPath '${outPath.replace(/'/g, "''")}' -Force"`,
      { stdio: "inherit" }
    );
    return;
  }
  execSync(`cd ${JSON.stringify(srcDir)} && zip -qr ${JSON.stringify(outPath)} manifest.json server`, {
    stdio: "inherit",
  });
}

function main() {
  const { in: inPath, out: outPathArg } = parseArgs(process.argv);
  const installDir = getDcosInstallDir();
  const outPath = outPathArg || join(installDir, "digital-chief-of-staff.mcpb");

  if (!inPath || !existsSync(inPath)) {
    console.error("Usage: personalize-mcpb.mjs --in path/to/bundle.mcpb [--out path.mcpb]");
    process.exit(1);
  }

  const { url, apiKey } = readElasticsearchConfig(installDir);
  if (!url) {
    console.error("No ELASTICSEARCH_URL in ~/.config/dcos/env.sh — run Elasticsearch setup first.");
    process.exit(1);
  }

  const tmp = mkdtempSync(join(tmpdir(), "dcos-mcpb-"));
  try {
    unzip(inPath, tmp);
    const manifestPath = join(tmp, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.user_config ??= {};
    manifest.user_config.elasticsearch_url ??= {};
    manifest.user_config.elasticsearch_api_key ??= {};
    manifest.user_config.dcos_connectors_config ??= {};

    manifest.user_config.elasticsearch_url.default = url;
    manifest.user_config.elasticsearch_api_key.default = apiKey;
    manifest.user_config.dcos_connectors_config.default = join(installDir, "connectors.yaml");

    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    rmSync(outPath, { force: true });
    zipDir(tmp, outPath);

    console.log(
      JSON.stringify(
        {
          ok: true,
          out: outPath,
          elasticsearch_url: url,
          elasticsearch_api_key: apiKey ? `${apiKey.slice(0, 12)}…` : "",
        },
        null,
        2
      )
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main();
