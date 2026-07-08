#!/usr/bin/env node
/** Print DCOS_SF_* exports from active Salesforce CLI org. */
import { execSync } from "node:child_process";

try {
  const raw = execSync("sf org display --json", { encoding: "utf8" });
  const { result } = JSON.parse(raw);
  const instance = (result.instanceUrl || "").replace(/\/$/, "");
  const token = result.accessToken;
  if (!instance || !token) throw new Error("Missing instanceUrl or accessToken in sf org display");
  console.log(`export DCOS_SF_INSTANCE_URL="${instance}"`);
  console.log(`export DCOS_SF_ACCESS_TOKEN="${token}"`);
} catch (e) {
  console.error("Run: sf org login web");
  console.error(e.message || e);
  process.exit(1);
}
