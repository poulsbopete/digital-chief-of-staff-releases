#!/usr/bin/env node
/** Ensure Elasticsearch is up; optionally start local cluster. Exit 0 when healthy. */
import { applyDcosEnv } from "../lib/load-dcos-env.mjs";
import { ensureLocalElasticsearch } from "../lib/ensure-local-elasticsearch.mjs";

applyDcosEnv();

const args = new Set(process.argv.slice(2));
const repair = args.has("--repair") || args.has("--start");
const jsonOut = args.has("--json");

const result = await ensureLocalElasticsearch({ repair });

if (jsonOut) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
  console.log(`Elasticsearch ${result.status} @ ${result.url}${result.started ? " (started)" : ""}`);
} else {
  console.error(`Elasticsearch unavailable @ ${result.url}: ${result.error}`);
  if (result.fix_steps?.length) {
    for (const step of result.fix_steps) console.error(`  • ${step}`);
  }
}

process.exit(result.ok ? 0 : 1);
