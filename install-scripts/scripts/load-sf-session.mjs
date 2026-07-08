#!/usr/bin/env node
/** Print shell exports from active Salesforce CLI org. */
import { exportSessionShell, getSessionFromSfCli } from "../lib/sf-cli-session.mjs";

const asExport = process.argv.includes("--export");

try {
  if (asExport) {
    const out = exportSessionShell();
    if (out) process.stdout.write(`${out}\n`);
    process.exit(out ? 0 : 1);
  }
  const session = getSessionFromSfCli();
  if (!session) throw new Error("No active Salesforce CLI org");
  console.log(`export DCOS_SF_ACCESS_TOKEN='${session.access_token.replace(/'/g, `'\\''`)}'`);
  console.log(`export DCOS_SF_INSTANCE_URL='${session.instance_url}'`);
  if (session.username) console.log(`# logged in as ${session.username}`);
} catch (e) {
  console.error("Run: ./scripts/salesforce-login.sh");
  console.error(e.message || e);
  process.exit(1);
}
