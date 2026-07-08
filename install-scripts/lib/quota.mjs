/**
 * SA / AVP quota tracking from ~/.config/dcos/quota.yaml + live BigQuery CRM.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDcosInstallDir } from "./load-dcos-env.mjs";
import { isBigQueryConfigured, tableRef, usesCertifiedPipelineTable, bqQuery } from "./bq-crm.mjs";

function quotaConfigPath(installDir = getDcosInstallDir()) {
  return process.env.DCOS_QUOTA_CONFIG || join(installDir, "quota.yaml");
}

function parseQuotaYaml(content) {
  const out = { period: {}, targets: [], territory_total: null };
  let section = null;
  let current = null;

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === "period:") {
      section = "period";
      continue;
    }
    if (line === "targets:") {
      section = "targets";
      continue;
    }

    const listRep = line.match(/^-\s*rep:\s*(.+)$/);
    if (listRep && section === "targets") {
      if (current) out.targets.push(current);
      current = { rep: listRep[1].trim().replace(/^["']|["']$/g, ""), quota: 0 };
      continue;
    }

    const kv = line.match(/^([a-z_]+):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim().replace(/^["']|["']$/g, "");

    if (key === "territory_total") {
      out.territory_total = Number(val.replace(/,/g, "")) || null;
      continue;
    }

    if (section === "period") {
      out.period[key] = val;
    } else if (current && key === "quota" && section === "targets") {
      current.quota = Number(val.replace(/,/g, "")) || 0;
    } else if (key === "rep" && section === "targets") {
      if (current) out.targets.push(current);
      current = { rep: val, quota: 0 };
    }
  }
  if (current) out.targets.push(current);
  return out;
}

export function loadQuotaConfig(installDir = getDcosInstallDir()) {
  const path = quotaConfigPath(installDir);
  if (!existsSync(path)) {
    return { configured: false, path, config: null };
  }
  const config = parseQuotaYaml(readFileSync(path, "utf8"));
  const configured = Boolean(
    config.period?.start &&
      config.period?.end &&
      config.targets?.length &&
      config.targets.every((t) => t.rep && t.quota > 0)
  );
  return { configured, path, config };
}

function closedWonSql() {
  if (usesCertifiedPipelineTable()) {
    return "(stage_name LIKE '%Closed Won%' OR stage_name LIKE '%Booked%')";
  }
  return "(StageName LIKE '%Closed Won%' OR stage_name LIKE '%Closed Won%')";
}

function openPipelineSql() {
  if (usesCertifiedPipelineTable()) {
    return `NOT (${closedWonSql()} OR stage_name LIKE '%Dead%' OR stage_name LIKE '%Lost%')`;
  }
  return "IsClosed = FALSE OR is_closed = FALSE";
}

function ownerColumn() {
  return usesCertifiedPipelineTable() ? "opportunity_owner_name" : "Owner_Name";
}

function closeDateColumn() {
  return usesCertifiedPipelineTable() ? "opportunity_close_date" : "CloseDate";
}

function amountColumn() {
  return usesCertifiedPipelineTable() ? "acv" : "Amount";
}

function certifiedWhere() {
  return usesCertifiedPipelineTable() ? " AND latest_day = TRUE" : "";
}

async function sumByOwner({ repNames, start, end, mode }) {
  if (!isBigQueryConfigured()) return [];
  const t = tableRef("Opportunity");
  const owner = ownerColumn();
  const closeCol = closeDateColumn();
  const amount = amountColumn();
  const whereMode =
    mode === "closed"
      ? closedWonSql()
      : openPipelineSql();
  const sql = `
    SELECT ${owner} AS rep_name,
           SUM(COALESCE(${amount}, 0)) AS total_acv,
           COUNT(*) AS deal_count
    FROM ${t}
    WHERE ${whereMode}
      AND ${closeCol} >= @start
      AND ${closeCol} <= @end
      ${certifiedWhere()}
      AND ${owner} IN UNNEST(@reps)
    GROUP BY ${owner}
  `;
  return bqQuery(sql, { start, end, reps: repNames });
}

function fmtMoney(n) {
  return Math.round(Number(n) || 0);
}

function pct(closed, quota) {
  if (!quota) return 0;
  return Math.round((closed / quota) * 1000) / 10;
}

export async function getQuotaProgress(installDir = getDcosInstallDir()) {
  const loaded = loadQuotaConfig(installDir);
  if (!loaded.configured) {
    return {
      configured: false,
      path: loaded.path,
      setup_hint:
        "Copy config/quota.yaml.example to ~/.config/dcos/quota.yaml and set rep quotas + period dates.",
    };
  }

  const { period, targets, territory_total } = loaded.config;
  const repNames = targets.map((t) => t.rep);
  let closedRows = [];
  let openRows = [];
  let crm_source = "config_only";

  if (isBigQueryConfigured()) {
    crm_source = "bigquery";
    [closedRows, openRows] = await Promise.all([
      sumByOwner({ repNames, start: period.start, end: period.end, mode: "closed" }),
      sumByOwner({ repNames, start: period.start, end: period.end, mode: "open" }),
    ]);
  }

  const closedByRep = Object.fromEntries(
    closedRows.map((r) => [r.rep_name, { acv: fmtMoney(r.total_acv), deals: Number(r.deal_count) || 0 }])
  );
  const openByRep = Object.fromEntries(
    openRows.map((r) => [r.rep_name, { acv: fmtMoney(r.total_acv), deals: Number(r.deal_count) || 0 }])
  );

  const reps = targets.map(({ rep, quota }) => {
    const closed = closedByRep[rep]?.acv ?? 0;
    const gap = Math.max(quota - closed, 0);
    const openPipeline = openByRep[rep]?.acv ?? 0;
    const attainment = pct(closed, quota);
    return {
      rep,
      quota,
      closed,
      attainment_pct: attainment,
      gap,
      open_pipeline_in_period: openPipeline,
      deals_closed: closedByRep[rep]?.deals ?? 0,
      open_deals_in_period: openByRep[rep]?.deals ?? 0,
      alert: attainment < 50 ? "below_50_pct_mid_quarter" : null,
    };
  });

  const territoryClosed = reps.reduce((s, r) => s + r.closed, 0);
  const territoryQuota =
    territory_total || reps.reduce((s, r) => s + r.quota, 0);
  const territoryOpen = reps.reduce((s, r) => s + r.open_pipeline_in_period, 0);

  return {
    configured: true,
    path: loaded.path,
    crm_source,
    period,
    reps,
    territory: {
      quota: territoryQuota,
      closed: territoryClosed,
      attainment_pct: pct(territoryClosed, territoryQuota),
      gap: Math.max(territoryQuota - territoryClosed, 0),
      open_pipeline_in_period: territoryOpen,
    },
    as_of: new Date().toISOString(),
  };
}
