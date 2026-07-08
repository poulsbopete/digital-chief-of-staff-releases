#!/usr/bin/env node
/** Create DCOS Elasticsearch indices if missing (macOS, Windows, Linux). */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root =
  process.env.DCOS_VENDOR_ROOT ||
  (existsSync(join(scriptDir, "..", "docker")) ? join(scriptDir, "..") : join(homedir(), ".config", "dcos", "vendor", "digital-chief-of-staff"));

const esUrl = (process.env.ELASTICSEARCH_URL || "").replace(/\/$/, "");
if (!esUrl) {
  console.error("Set ELASTICSEARCH_URL.");
  process.exit(1);
}

const headers = { Accept: "application/json", "Content-Type": "application/json" };
const apiKey = process.env.ELASTICSEARCH_API_KEY;
if (apiKey) headers.Authorization = `ApiKey ${apiKey}`;

const indices = [
  [process.env.DCOS_INDEX_NOTES || "dcos_notes", "dcos-notes-index.json"],
  [process.env.DCOS_INDEX_OPPORTUNITIES || "dcos_opportunities", "dcos-opportunities-index.json"],
  [process.env.DCOS_INDEX_SIGNALS || "dcos_signals", "dcos-signals-index.json"],
  [process.env.DCOS_INDEX_ACTIVITIES || "dcos_activities", "dcos-activities-index.json"],
];

async function ensureIndex(index, mappingFile) {
  const mappingPath = join(root, "docker", mappingFile);
  if (!existsSync(mappingPath)) {
    throw new Error(`Missing mapping file: ${mappingPath}`);
  }
  const check = await fetch(`${esUrl}/${index}`, { method: "GET", headers });
  if (check.ok) {
    console.log(`Index "${index}" already exists.`);
    return;
  }
  console.log(`Creating index "${index}"...`);
  const body = readFileSync(mappingPath, "utf8");
  const res = await fetch(`${esUrl}/${index}`, { method: "PUT", headers, body });
  const text = await res.text();
  console.log(text);
  if (!res.ok) throw new Error(`Failed to create ${index}: ${text.slice(0, 400)}`);
}

for (const [index, file] of indices) {
  await ensureIndex(index, file);
}
console.log("Done.");
