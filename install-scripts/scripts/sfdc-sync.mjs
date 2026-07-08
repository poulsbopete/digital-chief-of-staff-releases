#!/usr/bin/env node
/** CLI wrapper — incremental CRM → Elasticsearch sync. */
import { applyDcosEnv } from "../lib/load-dcos-env.mjs";
import { syncSalesforceToElasticsearch } from "../lib/sfdc-sync.mjs";

applyDcosEnv();

const opts = { lookbackDays: 30, fullSnapshot: false, openPipelineOnly: false };
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === "--full-snapshot") opts.fullSnapshot = true;
  else if (arg === "--open-only") opts.openPipelineOnly = true;
  else if (arg === "--lookback-days" && process.argv[i + 1]) {
    opts.lookbackDays = Number(process.argv[++i]);
  }
}

syncSalesforceToElasticsearch(opts)
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
