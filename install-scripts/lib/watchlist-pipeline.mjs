/**
 * Live CRM pipeline for account watchlist — always query BigQuery/SF, never stale ES notes.
 */
import { loadUserProfile } from "./dcos-profile.mjs";
import { getCrmSource, listOpenOpportunities } from "./crm-backend.mjs";
import { tableRef, usesCertifiedPipelineTable, bqQuery } from "./bq-crm.mjs";

const DEFAULT_ACCOUNTS = [
  "Cisco",
  "Microsoft",
  "T-Mobile",
  "Activision",
  "PayPal",
  "ADME",
  "GitHub",
];

function accountMatchSql(alias = "account_name") {
  return (accounts) => {
    const parts = accounts.map((_, i) => `${alias} LIKE @acct${i}`);
    const params = {};
    accounts.forEach((a, i) => {
      params[`acct${i}`] = `%${a}%`;
    });
    return { clause: `(${parts.join(" OR ")})`, params };
  };
}

export async function getLiveWatchlistPipeline({
  accounts,
  open_only = true,
  limit = 100,
} = {}) {
  const profile = loadUserProfile();
  const accountList = (accounts?.length ? accounts : profile.account_names)?.filter(Boolean);
  const searchAccounts = accountList?.length ? accountList : DEFAULT_ACCOUNTS;
  const source = getCrmSource();

  if (source !== "bigquery") {
    const all = [];
    for (const acct of searchAccounts) {
      const rows = await listOpenOpportunities({ account_name: acct, limit: 30 });
      all.push(...rows);
    }
    return {
      crm_source: source,
      live: true,
      as_of: new Date().toISOString(),
      accounts: searchAccounts,
      count: all.length,
      opportunities: all.slice(0, limit).map(normalizeOpp),
      authority:
        "LIVE CRM — use these ACV/stage/close_date values. Ignore dollar amounts in brief prompts, avp_brief notes, and dcos_search for pipeline fields.",
    };
  }

  const t = tableRef("Opportunity");
  const certified = usesCertifiedPipelineTable();
  const { clause, params } = accountMatchSql(certified ? "account_name" : "Account_Name")(
    searchAccounts
  );
  const openFilter = open_only
    ? certified
      ? `NOT (stage_name LIKE '%Closed Won%' OR stage_name LIKE '%Dead%' OR stage_name LIKE '%Lost%')`
      : `(IsClosed = FALSE OR is_closed = FALSE)`
    : "TRUE";
  const extra = certified ? " AND latest_day = TRUE" : "";
  const sql = `
    SELECT
      opportunity_id,
      account_name,
      opportunity_name,
      acv,
      stage_name,
      opportunity_close_date,
      opportunity_owner_name,
      opportunity_last_modified_date
    FROM ${t}
    WHERE ${clause}
      AND ${openFilter}
      ${extra}
    ORDER BY acv DESC NULLS LAST
    LIMIT @limit
  `;

  const rows = await bqQuery(sql, { ...params, limit });
  return {
    crm_source: source,
    live: true,
    as_of: new Date().toISOString(),
    accounts: searchAccounts,
    count: rows.length,
    opportunities: rows.map(normalizeBqRow),
    authority:
      "LIVE BigQuery — use these ACV/stage/close_date values. Ignore dollar amounts in brief prompts, avp_brief notes, and dcos_search for pipeline fields.",
  };
}

function normalizeBqRow(row) {
  const close =
    row.opportunity_close_date?.value || row.opportunity_close_date || row.CloseDate || null;
  return {
    id: row.opportunity_id || row.Id,
    account: row.account_name || row.Account_Name,
    name: row.opportunity_name || row.Name,
    acv: row.acv ?? row.Amount ?? null,
    stage: row.stage_name || row.StageName,
    close_date: close,
    owner: row.opportunity_owner_name || row.Owner_Name,
    last_modified: row.opportunity_last_modified_date?.value || row.opportunity_last_modified_date,
  };
}

function normalizeOpp(row) {
  return {
    id: row.Id,
    account: row.Account?.Name || null,
    name: row.Name,
    acv: row.Amount,
    stage: row.StageName,
    close_date: row.CloseDate,
    owner: row.Owner?.Name || null,
    last_modified: row.LastModifiedDate,
  };
}
