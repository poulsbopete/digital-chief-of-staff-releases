#!/usr/bin/env node
/**
 * SA Strat daily brief runner — Peter Simkins / generic SA profile.
 * Gathers SFDC sync, ES deltas, Slack rep signals; posts brief to Slack DM.
 *
 * Usage:
 *   source ~/.config/dcos/env.sh
 *   node scripts/sa-strat-daily-brief.mjs           # preflight + gather JSON
 *   node scripts/sa-strat-daily-brief.mjs --post    # post brief from stdin or --file
 *   node scripts/sa-strat-daily-brief.mjs --file /tmp/sa-brief.md --post
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { applyDcosEnv } from "../lib/load-dcos-env.mjs";
import { getAppRoot } from "../lib/paths.mjs";
import { listConnectors, callConnector } from "../lib/connectors.mjs";
import { createEsClient, getIndexNames, requireElasticsearchUrl } from "../lib/elasticsearch.mjs";
import { syncSalesforceToElasticsearch } from "../lib/sfdc-sync.mjs";
import { getSessionFromSfCli } from "../lib/sf-cli-session.mjs";

applyDcosEnv();

const SLACK_USER = process.env.DCOS_SA_BRIEF_SLACK_USER || "U07Q824JMJB";
const TERRITORY_FILE =
  process.env.DCOS_TERRITORY_YAML || join(getAppRoot(), "config", "territory-peter-simkins.yaml");

const SLACK_QUERIES = [
  "Aaron Byers Cisco renewal signed",
  "John Robinson ADME Microsoft closed",
  "GitHub Vlad deal update",
  "T-Mobile OTel",
];

const ES_DELTA_QUERY =
  "territory pipeline MEDDPIC delta blocker champion stage change";
const ACCOUNT_FILTERS = [
  "Cisco",
  "Microsoft",
  "T-Mobile",
  "Activision Blizzard",
  "PayPal",
  "ADME",
  "GitHub",
];

function parseArgs(argv) {
  const args = { post: false, file: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--post") args.post = true;
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--file" && argv[i + 1]) args.file = argv[++i];
    else if (argv[i] === "--help") {
      console.log(`Usage: node scripts/sa-strat-daily-brief.mjs [--post] [--file brief.md] [--json]`);
      process.exit(0);
    }
  }
  return args;
}

function loadTerritoryPipeline() {
  if (!existsSync(TERRITORY_FILE)) return { path: TERRITORY_FILE, pipeline: [] };
  const text = readFileSync(TERRITORY_FILE, "utf8");
  const pipeline = [];
  let current = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s{4}([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    const val = raw.replace(/^["']|["']$/g, "");
    if (key === "rep" && Object.keys(current).length) {
      pipeline.push(current);
      current = {};
    }
    if (val === "null" || val === "") current[key] = null;
    else if (/^\d+$/.test(val)) current[key] = Number(val);
    else current[key] = val;
  }
  if (Object.keys(current).length) pipeline.push(current);
  return { path: TERRITORY_FILE, pipeline };
}

async function trySfdcSync() {
  try {
    const session = await getSessionFromSfCli();
    if (!session?.accessToken) {
      return { ok: false, error: "WAITING ON IT — Salesforce not connected (OAUTH_APP_ACCESS_DENIED or run salesforce-login.sh)" };
    }
    const result = await syncSalesforceToElasticsearch({ lookbackDays: 1 });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function tryEsSearch(query, { accountFilter, sourceFilter, limit = 15 } = {}) {
  try {
    const es = createEsClient(requireElasticsearchUrl());
    const indices = getIndexNames();
    const must = [{ multi_match: { query, fields: ["content^2", "title", "opportunity", "account", "wing", "room"] } }];
    if (accountFilter) must.push({ term: { "account.keyword": accountFilter } });
    if (sourceFilter) must.push({ term: { "source.keyword": sourceFilter } });
    const body = {
      size: limit,
      query: { bool: { must } },
      sort: [{ _score: "desc" }, { "@timestamp": "desc" }],
    };
    const res = await es.search(`${indices.notes},${indices.opportunities},${indices.signals}`, body);
    return {
      ok: true,
      total: res.hits?.total?.value ?? res.hits?.hits?.length ?? 0,
      hits: (res.hits?.hits || []).map((h) => ({
        account: h._source?.account,
        opportunity: h._source?.opportunity,
        title: h._source?.title,
        source: h._source?.source,
        content: (h._source?.content || "").slice(0, 800),
      })),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function trySlackSearch() {
  const token = process.env.DCOS_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "Slack not configured — set DCOS_SLACK_BOT_TOKEN in ~/.config/dcos/env.sh" };
  }
  const results = {};
  for (const q of SLACK_QUERIES) {
    try {
      const r = await callConnector("slack", "search_messages", { query: q, count: 5 });
      results[q] = (r.messages?.matches || []).map((m) => ({
        user: m.username || m.user,
        channel: m.channel?.name || m.channel?.id,
        text: (m.text || "").slice(0, 200),
        ts: m.ts,
      }));
    } catch (e) {
      results[q] = { error: e.message };
    }
  }
  return { ok: true, results };
}

async function postToSlack(text) {
  const token = process.env.DCOS_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("DCOS_SLACK_BOT_TOKEN not set");
  const dm = await callConnector("slack", "open_dm", { users: SLACK_USER });
  const channel = dm.channel?.id;
  if (!channel) throw new Error("conversations.open did not return channel.id");
  return callConnector("slack", "post_message", { channel, text, mrkdwn: true });
}

async function gather() {
  const territory = loadTerritoryPipeline();
  const connectors = listConnectors();
  const sfdc = await trySfdcSync();
  const deltaSearch = await tryEsSearch(ES_DELTA_QUERY, { limit: 25 });
  const priorBrief = await tryEsSearch("avp_brief daily brief", { sourceFilter: "avp_brief", limit: 5 });
  const accountSearches = {};
  for (const account of ACCOUNT_FILTERS) {
    accountSearches[account] = await tryEsSearch(`${account} MEDDPIC blocker stage`, {
      accountFilter: account,
      limit: 10,
    });
  }
  const slack = await trySlackSearch();

  const q1 = territory.pipeline.filter((d) => d.quarter === "Q1-FY27" && d.status !== "DEAD");
  const q2 = territory.pipeline.filter((d) => d.quarter === "Q2-FY27" && d.status !== "DEAD");
  const sum = (rows) => rows.reduce((s, r) => s + (r.acv || 0), 0);

  return {
    updated: new Date().toISOString(),
    territory_file: territory.path,
    connectors,
    sfdc,
    elasticsearch: { deltaSearch, priorBrief, accountSearches },
    slack,
    pipeline_summary: {
      q1_fy27_acv: sum(q1),
      q2_fy27_acv: sum(q2),
      q1_deals: q1.length,
      q2_deals: q2.length,
    },
    sources_not_configured: {
      gmail: !(process.env.DCOS_GMAIL_PROXY_URL),
      google_drive: !(process.env.DCOS_GDRIVE_PROXY_URL || process.env.DCOS_MEETING_NOTES_URL),
      zoom: !(process.env.DCOS_ZOOM_PROXY_URL),
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.post) {
    const text = args.file
      ? readFileSync(args.file, "utf8")
      : await new Promise((resolve) => {
          let buf = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (c) => (buf += c));
          process.stdin.on("end", () => resolve(buf));
          if (process.stdin.isTTY) resolve("");
        });
    if (!text.trim()) {
      console.error("No brief text — pass --file or pipe markdown on stdin");
      process.exit(1);
    }
    const posted = await postToSlack(text);
    console.log(JSON.stringify({ ok: true, channel: posted.channel, ts: posted.ts }, null, 2));
    return;
  }

  const report = await gather();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
