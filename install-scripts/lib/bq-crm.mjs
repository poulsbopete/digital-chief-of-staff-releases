/**
 * CRM data via Google BigQuery (Salesforce tables replicated by the customer).
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mcpNodeModules } from "./paths.mjs";

let _client = null;
let _clientExpiresAt = 0;
let _BigQuery = null;

async function getBigQueryClass() {
  if (_BigQuery) return _BigQuery;
  const pkg = join(mcpNodeModules(), "@google-cloud/bigquery", "build", "src", "index.js");
  const mod = await import(pathToFileURL(pkg).href);
  _BigQuery = mod.BigQuery;
  return _BigQuery;
}

export function isBigQueryConfigured() {
  return Boolean(process.env.DCOS_BQ_PROJECT_ID?.trim() && process.env.DCOS_BQ_DATASET?.trim());
}

export function getBqConfig() {
  const projectId = process.env.DCOS_BQ_PROJECT_ID?.trim();
  const dataset = process.env.DCOS_BQ_DATASET?.trim();
  const credentialsPath = (
    process.env.DCOS_BQ_CREDENTIALS_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    ""
  ).trim();
  if (!projectId || !dataset) {
    throw new Error(
      "BigQuery CRM not configured. Set DCOS_BQ_PROJECT_ID and DCOS_BQ_DATASET in ~/.config/dcos/env.sh (run scripts/setup-bigquery-crm.sh)."
    );
  }
  if (credentialsPath && !existsSync(resolve(credentialsPath))) {
    console.error(
      `[dcos-bq] Credentials file not found (${credentialsPath}) — using gcloud Application Default Credentials`
    );
  }
  return {
    projectId,
    dataset,
    credentialsPath:
      credentialsPath && existsSync(resolve(credentialsPath)) ? credentialsPath : null,
    location: process.env.DCOS_BQ_LOCATION?.trim() || "US",
  };
}

export function tableRef(objectType) {
  const cfg = getBqConfig();
  const envKey = `DCOS_BQ_TABLE_${String(objectType).toUpperCase()}`;
  const table = process.env[envKey]?.trim();
  if (!table) {
    throw new Error(
      `BigQuery table not configured for ${objectType}. Set ${envKey} in ~/.config/dcos/env.sh`
    );
  }
  return qualifyTableRef(table, cfg.projectId, cfg.dataset);
}

/** Supports `table`, `dataset.table`, or `project.dataset.table`. */
export function qualifyTableRef(table, projectId, defaultDataset) {
  const parts = table.split(".").filter(Boolean);
  if (parts.length === 3) return `\`${parts[0]}.${parts[1]}.${parts[2]}\``;
  if (parts.length === 2) return `\`${projectId}.${parts[0]}.${parts[1]}\``;
  return `\`${projectId}.${defaultDataset}.${parts[0]}\``;
}

export function isTableConfigured(objectType) {
  const envKey = `DCOS_BQ_TABLE_${String(objectType).toUpperCase()}`;
  return Boolean(process.env[envKey]?.trim());
}

async function getOAuth2ClientClass() {
  const pkg = join(mcpNodeModules(), "google-auth-library", "build", "src", "index.js");
  const mod = await import(pathToFileURL(pkg).href);
  return mod.OAuth2Client || mod.default?.OAuth2Client;
}

const CLI_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  join(homedir(), "google-cloud-sdk", "bin"),
];

function cliEnv() {
  const base = process.env.PATH || "/usr/bin:/bin";
  const prefix = CLI_BIN_DIRS.filter((d) => existsSync(d)).join(":");
  return { ...process.env, PATH: prefix ? `${prefix}:${base}` : base };
}

function resolveCliBin(name) {
  for (const dir of CLI_BIN_DIRS) {
    const full = join(dir, name);
    if (existsSync(full)) return full;
  }
  return name;
}

function fetchGcloudAccessToken() {
  const gcloud = resolveCliBin("gcloud");
  return execSync(`${JSON.stringify(gcloud)} auth application-default print-access-token`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: cliEnv(),
  }).trim();
}

function inferBqParamType(value) {
  if (typeof value === "number" && Number.isInteger(value)) return "INT64";
  if (typeof value === "boolean") return "BOOL";
  if (typeof value === "number") return "FLOAT64";
  return "STRING";
}

function preferBqCli() {
  if (process.env.DCOS_BQ_USE_CLI === "1") return true;
  if (process.env.DCOS_BQ_USE_CLI === "0") return false;
  return process.platform === "darwin";
}

function bqQueryViaCli(sql, params = {}) {
  const cfg = getBqConfig();
  const bq = resolveCliBin("bq");
  const args = [
    "query",
    "--use_legacy_sql=false",
    "--format=json",
    `--project_id=${cfg.projectId}`,
    `--location=${cfg.location}`,
    "--max_rows=100000",
  ];
  for (const [name, value] of Object.entries(params)) {
    args.push(`--parameter=${name}:${inferBqParamType(value)}:${value}`);
  }
  args.push(sql.trim());

  const result = spawnSync(bq, args, {
    env: cliEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`bq CLI spawn failed: ${result.error.message}`);
  }
  const stderr = (result.stderr || "").trim();
  if (result.status !== 0) {
    throw new Error(stderr || `bq query exited ${result.status}`);
  }
  const stdout = (result.stdout || "").trim();
  if (!stdout) return [];
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`bq CLI returned non-JSON: ${stdout.slice(0, 400)}`);
  }
}

async function getClientAsync() {
  const now = Date.now();
  if (_client && now < _clientExpiresAt) return _client;

  const BigQuery = await getBigQueryClass();
  const cfg = getBqConfig();
  const opts = { projectId: cfg.projectId, location: cfg.location };

  if (cfg.credentialsPath) {
    opts.keyFilename = resolve(cfg.credentialsPath);
    _client = new BigQuery(opts);
    _clientExpiresAt = now + 3600_000;
    return _client;
  }

  // macOS: gcloud ADC refresh is more reliable than Node google-auth-library (oauth2 Premature close).
  const useGcloudToken =
    process.env.DCOS_BQ_USE_GCLOUD_TOKEN !== "0" && process.platform === "darwin";

  if (useGcloudToken) {
    try {
      const token = fetchGcloudAccessToken();
      const OAuth2Client = await getOAuth2ClientClass();
      if (OAuth2Client) {
        const auth = new OAuth2Client();
        auth.setCredentials({ access_token: token });
        opts.authClient = auth;
        _client = new BigQuery(opts);
        _clientExpiresAt = now + 50 * 60 * 1000;
        return _client;
      }
    } catch (e) {
      console.error(`[dcos-bq] gcloud token fallback failed: ${e.message}`);
      _client = null;
      _clientExpiresAt = 0;
    }
  }

  _client = new BigQuery(opts);
  _clientExpiresAt = now + 3600_000;
  return _client;
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      const val = row[key];
      if (val && typeof val === "object" && "value" in val) return val.value;
      return val;
    }
  }
  return null;
}

function nestedName(row) {
  return (
    pick(row, "Account_Name", "account_name", "AccountName", "account_name__c", "edm_parent_name", "customer_name") ||
    pick(row, "Account", "account") ||
    null
  );
}

function nestedOwner(row) {
  return (
    pick(row, "Owner_Name", "owner_name", "OwnerName", "ae_name", "opportunity_owner_name", "account_owner_name", "sales_rep_name", "rep_name") ||
    pick(row, "Owner", "owner") ||
    null
  );
}

export function usesCertifiedPipelineTable() {
  const oppTable = process.env.DCOS_BQ_TABLE_OPPORTUNITY?.trim() || "";
  return /business_certified|revops_rpt|certified_open/i.test(oppTable);
}

function openPipelineSqlCondition() {
  const custom = process.env.DCOS_BQ_OPEN_PIPELINE_WHERE?.trim();
  if (custom) return custom;
  const oppTable = process.env.DCOS_BQ_TABLE_OPPORTUNITY?.trim() || "";
  if (/business_certified|revops_rpt|certified_open/i.test(oppTable)) {
    return "(pipeline_reporting_disposition = 'Open Pipeline' AND latest_day = TRUE)";
  }
  return "(IsClosed = FALSE OR is_closed = FALSE OR IsClosed IS NULL OR is_closed IS NULL)";
}

export function normalizeOpportunityRow(row) {
  const accountName = nestedName(row);
  const ownerName = nestedOwner(row);
  return {
    Id: pick(row, "Id", "id", "opportunity_id"),
    Name: pick(row, "Name", "name", "opportunity_name"),
    AccountId: pick(row, "AccountId", "account_id"),
    Account: accountName != null ? { Name: accountName } : undefined,
    StageName: pick(row, "StageName", "stage_name", "sales_stage", "opportunity_stage"),
    Amount: pick(row, "Amount", "amount", "acv", "opportunity_acv", "rep_quoted_acv", "total_acv"),
    CloseDate: pick(row, "CloseDate", "close_date", "opportunity_close_date"),
    Probability: pick(row, "Probability", "probability"),
    NextStep: pick(row, "NextStep", "next_step"),
    Description: pick(row, "Description", "description"),
    LastModifiedDate: pick(row, "LastModifiedDate", "last_modified_date", "last_modified_timestamp"),
    OwnerId: pick(row, "OwnerId", "owner_id", "ae_id"),
    Owner: ownerName != null ? { Name: ownerName } : undefined,
    Type: pick(row, "Type", "type", "opportunity_type"),
    LeadSource: pick(row, "LeadSource", "lead_source"),
    ForecastCategoryName: pick(row, "ForecastCategoryName", "forecast_category_name", "forecast_category"),
    IsClosed: pick(row, "IsClosed", "is_closed", "opportunity_is_booked"),
    PipelineDisposition: pick(row, "pipeline_reporting_disposition"),
  };
}

export function normalizeAccountRow(row) {
  const ownerName = nestedOwner(row);
  return {
    Id: pick(row, "Id", "id", "account_id"),
    Name: pick(row, "Name", "name", "account_name", "edm_parent_name", "customer_name"),
    Type: pick(row, "Type", "type"),
    Industry: pick(row, "Industry", "industry"),
    Website: pick(row, "Website", "website"),
    BillingCity: pick(row, "BillingCity", "billing_city"),
    BillingState: pick(row, "BillingState", "billing_state"),
    BillingCountry: pick(row, "BillingCountry", "billing_country"),
    Description: pick(row, "Description", "description"),
    LastModifiedDate: pick(row, "LastModifiedDate", "last_modified_date"),
    OwnerId: pick(row, "OwnerId", "owner_id"),
    Owner: ownerName != null ? { Name: ownerName } : undefined,
    NumberOfEmployees: pick(row, "NumberOfEmployees", "number_of_employees"),
    AnnualRevenue: pick(row, "AnnualRevenue", "annual_revenue"),
  };
}

export function normalizeActivityRow(row, type) {
  const accountName = nestedName(row);
  const ownerName = nestedOwner(row);
  const whatType = pick(row, "What_Type", "what_type", "WhatType");
  const whatName = pick(row, "What_Name", "what_name", "WhatName");
  return {
    Id: pick(row, "Id", "id"),
    Subject: pick(row, "Subject", "subject"),
    Description: pick(row, "Description", "description"),
    Status: pick(row, "Status", "status"),
    Priority: pick(row, "Priority", "priority"),
    ActivityDate: pick(row, "ActivityDate", "activity_date"),
    StartDateTime: pick(row, "StartDateTime", "start_date_time"),
    EndDateTime: pick(row, "EndDateTime", "end_date_time"),
    LastModifiedDate: pick(row, "LastModifiedDate", "last_modified_date"),
    AccountId: pick(row, "AccountId", "account_id"),
    Account: accountName != null ? { Name: accountName } : undefined,
    WhatId: pick(row, "WhatId", "what_id"),
    What: whatType || whatName ? { Type: whatType, Name: whatName } : undefined,
    OwnerId: pick(row, "OwnerId", "owner_id"),
    Owner: ownerName != null ? { Name: ownerName } : undefined,
    object_type: type,
  };
}

const NORMALIZERS = {
  Opportunity: normalizeOpportunityRow,
  Account: normalizeAccountRow,
  Task: (r) => normalizeActivityRow(r, "Task"),
  Event: (r) => normalizeActivityRow(r, "Event"),
};

function lastModifiedColumn(objectType) {
  const envCol = process.env.DCOS_BQ_COL_LAST_MODIFIED?.trim();
  if (envCol) return envCol;
  if (objectType === "Opportunity" && usesCertifiedPipelineTable()) {
    return "opportunity_last_modified_date";
  }
  return "LastModifiedDate";
}

function accountTableSupportsIncremental() {
  const t = process.env.DCOS_BQ_TABLE_ACCOUNT?.trim() || "";
  return !/dim_account|csg_mart__dim_account/i.test(t);
}

function certifiedPipelineExtraWhere() {
  if (!usesCertifiedPipelineTable()) return "";
  return " AND latest_day = TRUE";
}

export async function bqQuery(sql, params = {}) {
  const cfg = getBqConfig();
  const useCli = preferBqCli();

  if (useCli) {
    try {
      return bqQueryViaCli(sql, params);
    } catch (cliErr) {
      console.error(`[dcos-bq] bq CLI query failed: ${cliErr.message}`);
      if (process.env.DCOS_BQ_USE_CLI === "1") throw cliErr;
    }
  }

  try {
    const [rows] = await (await getClientAsync()).query({
      query: sql,
      params,
      location: cfg.location,
    });
    return rows;
  } catch (nodeErr) {
    if (!useCli) {
      try {
        return bqQueryViaCli(sql, params);
      } catch (cliErr) {
        console.error(`[dcos-bq] bq CLI fallback failed: ${cliErr.message}`);
      }
    }
    throw nodeErr;
  }
}

export async function getCrmConnection() {
  const cfg = getBqConfig();
  await bqQuery("SELECT 1 AS ok");
  const tables = {};
  for (const obj of ["Opportunity", "Account", "Task", "Event"]) {
    if (isTableConfigured(obj)) tables[obj] = process.env[`DCOS_BQ_TABLE_${obj.toUpperCase()}`];
  }
  return {
    connected: true,
    source: "bigquery",
    project_id: cfg.projectId,
    dataset: cfg.dataset,
    location: cfg.location,
    tables,
  };
}

export async function crmQuery(sql) {
  const cfg = getBqConfig();
  let trimmed = sql.replace(/\s+/g, " ").trim();
  if (usesCertifiedPipelineTable()) {
    trimmed = normalizeCertifiedSql(trimmed);
  }
  const expanded = trimmed.replace(
    /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi,
    (_, table) => {
      const key = table.charAt(0).toUpperCase() + table.slice(1);
      if (isTableConfigured(key) || isTableConfigured(table)) {
        const obj = isTableConfigured(key) ? key : table;
        return `FROM ${tableRef(obj)}`;
      }
      return `FROM \`${cfg.projectId}.${cfg.dataset}.${table}\``;
    }
  );
  return bqQuery(expanded);
}

/** RevOps certified opportunity columns (elastic-edm-prod). Use in dcos_sfdc_query — not SOQL names. */
export const CERTIFIED_OPPORTUNITY_SCHEMA = [
  "opportunity_id",
  "opportunity_name",
  "account_name",
  "acv",
  "stage_name",
  "opportunity_close_date",
  "opportunity_owner_name",
  "opportunity_last_modified_date",
  "latest_day",
  "pipeline_reporting_disposition",
].join(", ");

/** Rewrite common SOQL/Salesforce column names → RevOps certified BQ columns. */
function normalizeCertifiedSql(sql) {
  let s = sql;
  const replacements = [
    [/\bAccount\.Name\b/gi, "account_name"],
    [/\bOwner\.Name\b/gi, "opportunity_owner_name"],
    [/\bLastModifiedDate\b/gi, "opportunity_last_modified_date"],
    [/\bCloseDate\b/gi, "opportunity_close_date"],
    [/\bStageName\b/gi, "stage_name"],
    [/\bAmount\b/gi, "acv"],
    [/\bIsClosed\s*=\s*false\b/gi, "pipeline_reporting_disposition = 'Open Pipeline'"],
    [/\bIsClosed\s*=\s*true\b/gi, "pipeline_reporting_disposition != 'Open Pipeline'"],
  ];
  for (const [re, col] of replacements) {
    s = s.replace(re, col);
  }
  // Opportunity.Name / bare Name in WHERE (not account_name already)
  s = s.replace(/\bOpportunity\.Name\b/gi, "opportunity_name");
  s = s.replace(/\bFROM Opportunity\b/gi, "FROM opportunity");
  s = s.replace(/\bName\b/g, "opportunity_name");
  if (!/\blatest_day\b/i.test(s) && /\bFROM\b/i.test(s)) {
    s = s.replace(/\bWHERE\b/i, "WHERE latest_day = TRUE AND");
  }
  return s;
}

export async function lookupOpportunities({ account_name, opportunity_name, limit = 10 } = {}) {
  const opps = await listOpenOpportunities({ account_name, limit: 100 });
  if (!opportunity_name?.trim()) return opps.slice(0, limit);
  const needle = opportunity_name.trim().toLowerCase();
  return opps.filter((o) => o.Name?.toLowerCase().includes(needle)).slice(0, limit);
}

export async function getRecordById(objectType, recordId) {
  const normalizer = NORMALIZERS[objectType];
  if (!normalizer) throw new Error(`Unsupported object type: ${objectType}`);
  const sql = `SELECT * FROM ${tableRef(objectType)} WHERE Id = @id OR id = @id OR opportunity_id = @id OR account_id = @id LIMIT 1`;
  const rows = await bqQuery(sql, { id: recordId });
  if (!rows.length) throw new Error(`${objectType} not found: ${recordId}`);
  return normalizer(rows[0]);
}

export async function listOpenOpportunities({ owner_name, account_name, limit = 50 } = {}) {
  const t = tableRef("Opportunity");
  const certified = usesCertifiedPipelineTable();
  const conditions = [openPipelineSqlCondition()];
  const params = { limit };
  if (owner_name) {
    if (certified) {
      conditions.push("(opportunity_owner_name LIKE @owner OR account_owner_name LIKE @owner)");
    } else {
      conditions.push(`(
        Owner_Name LIKE @owner OR owner_name LIKE @owner OR OwnerName LIKE @owner
        OR ae_name LIKE @owner OR opportunity_owner_name LIKE @owner OR account_owner_name LIKE @owner
        OR sales_rep_name LIKE @owner OR rep_name LIKE @owner
      )`);
    }
    params.owner = `%${owner_name}%`;
  }
  if (account_name) {
    if (certified) {
      conditions.push("(account_name LIKE @account)");
    } else {
      conditions.push(`(
        Account_Name LIKE @account OR account_name LIKE @account OR AccountName LIKE @account
        OR edm_parent_name LIKE @account OR customer_name LIKE @account OR name LIKE @account
      )`);
    }
    params.account = `%${account_name}%`;
  }
  const orderBy = certified
    ? "opportunity_close_date ASC"
    : "CloseDate ASC, close_date ASC, opportunity_close_date ASC";
  const sql = `SELECT * FROM ${t} WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy} LIMIT @limit`;
  const rows = await bqQuery(sql, params);
  return rows.map(normalizeOpportunityRow);
}

export async function fetchModifiedRecords(objectType, sinceIso) {
  if (!isTableConfigured(objectType)) return [];
  const normalizer = NORMALIZERS[objectType];
  if (!normalizer) throw new Error(`Unsupported object type: ${objectType}`);
  if (objectType === "Account" && !accountTableSupportsIncremental()) {
    return [];
  }
  const col = lastModifiedColumn(objectType);
  const snake = col.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`).replace(/^_/, "");
  const extra = objectType === "Opportunity" ? certifiedPipelineExtraWhere() : "";
  const sql = `
    SELECT * FROM ${tableRef(objectType)}
    WHERE (${col} > @since OR ${snake} > @since)${extra}
    ORDER BY ${col} ASC, ${snake} ASC
  `;
  const rows = await bqQuery(sql, { since: sinceIso });
  return rows.map(normalizer);
}

/** All opportunities on the latest certified snapshot (no modified-date window). */
export async function fetchCertifiedPipelineSnapshot({ openOnly = false } = {}) {
  if (!isTableConfigured("Opportunity")) return [];
  if (!usesCertifiedPipelineTable()) {
    throw new Error("Full snapshot sync requires RevOps certified pipeline table");
  }
  const conditions = ["latest_day = TRUE"];
  if (openOnly) conditions.push("pipeline_reporting_disposition = 'Open Pipeline'");
  const sql = `
    SELECT * FROM ${tableRef("Opportunity")}
    WHERE ${conditions.join(" AND ")}
    ORDER BY opportunity_last_modified_date ASC
  `;
  const rows = await bqQuery(sql);
  return rows.map(normalizeOpportunityRow);
}
