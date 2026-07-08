#!/usr/bin/env node
/** Verify quota.yaml and live BigQuery attainment. */
import { applyDcosEnv } from "../lib/load-dcos-env.mjs";
import { getQuotaProgress, loadQuotaConfig } from "../lib/quota.mjs";

applyDcosEnv();

const loaded = loadQuotaConfig();
console.log("Quota config:", loaded);

try {
  const progress = await getQuotaProgress();
  console.log(JSON.stringify(progress, null, 2));
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
