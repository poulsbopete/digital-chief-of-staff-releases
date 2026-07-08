#!/usr/bin/env node
import { applyDcosEnv } from "../lib/load-dcos-env.mjs";
import { getCrmConnection, listOpenOpportunities } from "../lib/bq-crm.mjs";

applyDcosEnv();

try {
  const conn = await getCrmConnection();
  console.log("BigQuery CRM connected:", conn);
  const opps = await listOpenOpportunities({ limit: 3 });
  console.log(`Sample open opportunities: ${opps.length}`);
  for (const o of opps) {
    console.log(`  - ${o.Name} | ${o.Account?.Name || "?"} | ${o.StageName} | ${o.Amount}`);
  }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
