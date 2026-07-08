#!/usr/bin/env node
/**
 * Index a Granola meeting summary into DCOS notes for SFDC update prep.
 *
 *   node scripts/index-granola-note.mjs \
 *     --account Microsoft --opportunity "Expansion Search" \
 *     --title "Granola — ADME scoping" --file summary.txt
 *
 *   cat summary.txt | node scripts/index-granola-note.mjs --account Cisco --stdin
 */
import { readFileSync } from "node:fs";
import { createEsClient, getIndexNames } from "../lib/elasticsearch.mjs";
import { applyDcosEnv } from "../lib/load-dcos-env.mjs";

applyDcosEnv();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : "";
}

const account = arg("account");
const opportunity = arg("opportunity");
const opportunityId = arg("opportunity-id");
const title = arg("title") || `Granola — ${account || "meeting"}`;
const meetingDate = arg("meeting-date") || new Date().toISOString().slice(0, 10);
const suggested = arg("sfdc-updates");
const docId = arg("doc-id");
const useStdin = process.argv.includes("--stdin");
const file = arg("file");

let content = "";
if (useStdin) {
  content = readFileSync(0, "utf8");
} else if (file) {
  content = readFileSync(file, "utf8");
} else {
  console.error("Provide --file path or --stdin");
  process.exit(1);
}

if (!content.trim()) {
  console.error("Empty content");
  process.exit(1);
}

const body = {
  content: content.trim(),
  title,
  account: account || undefined,
  opportunity: opportunity || undefined,
  opportunity_id: opportunityId || undefined,
  meeting_date: meetingDate,
  suggested_sfdc_updates: suggested || undefined,
  source: "granola",
  persona: process.env.DCOS_PERSONA || "sa",
  note_date: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

const es = createEsClient();
const { notes } = getIndexNames();
const path = docId
  ? `/${notes}/_doc/${encodeURIComponent(docId)}?refresh=wait_for`
  : `/${notes}/_doc?refresh=wait_for`;

const res = await es.esFetch(path, { method: docId ? "PUT" : "POST", body });
console.log(JSON.stringify({ ok: true, _id: res._id, index: notes, title, account, opportunity }, null, 2));
