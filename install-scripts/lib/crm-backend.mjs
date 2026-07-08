/**
 * Unified CRM backend — BigQuery (elastic-edm-prod) or Salesforce CLI.
 * Set DCOS_CRM_SOURCE=bigquery|salesforce (auto-detects BigQuery when configured).
 */
import { isBigQueryConfigured, getCrmConnection as bqConnection, crmQuery as bqCrmQuery, getRecordById as bqGetRecord, listOpenOpportunities as bqListOpps, fetchModifiedRecords as bqFetchModified, fetchCertifiedPipelineSnapshot as bqFetchSnapshot } from "./bq-crm.mjs";
import { getSalesforceSession, soqlQuery, sfdcGetRecord } from "./sfdc-auth.mjs";
import { OPPORTUNITY_FIELDS, ACCOUNT_FIELDS } from "./sfdc-objects.mjs";

export function getCrmSource() {
  const explicit = process.env.DCOS_CRM_SOURCE?.trim().toLowerCase();
  if (explicit === "bigquery" || explicit === "bq") return "bigquery";
  if (explicit === "salesforce" || explicit === "sfdc") return "salesforce";
  if (isBigQueryConfigured()) return "bigquery";
  return "salesforce";
}

export function usesBigQuery() {
  return getCrmSource() === "bigquery";
}

export async function getCrmConnection() {
  if (usesBigQuery()) return bqConnection();
  const session = await getSalesforceSession();
  return {
    connected: true,
    source: session.source || "salesforce",
    instance_url: session.instance_url,
    username: session.username || null,
    org_alias: session.org_alias || process.env.DCOS_SF_ORG_ALIAS || "default",
  };
}

export async function crmQuery(sqlOrSoql) {
  if (usesBigQuery()) return bqCrmQuery(sqlOrSoql);
  const session = await getSalesforceSession();
  return soqlQuery(session.instance_url, session.access_token, sqlOrSoql);
}

export async function getOpportunityById(opportunityId) {
  if (usesBigQuery()) return bqGetRecord("Opportunity", opportunityId);
  const session = await getSalesforceSession();
  const fields = OPPORTUNITY_FIELDS.split(", ");
  return sfdcGetRecord(session.instance_url, session.access_token, "Opportunity", opportunityId, fields);
}

export async function getAccountById(accountId) {
  if (usesBigQuery()) return bqGetRecord("Account", accountId);
  const session = await getSalesforceSession();
  const fields = ACCOUNT_FIELDS.split(", ");
  return sfdcGetRecord(session.instance_url, session.access_token, "Account", accountId, fields);
}

export async function listOpenOpportunities(opts) {
  if (usesBigQuery()) return bqListOpps(opts);
  const session = await getSalesforceSession();
  const { owner_name, account_name, limit = 50 } = opts || {};
  const where = ["IsClosed = false"];
  if (owner_name) where.push(`Owner.Name LIKE '%${owner_name.replace(/'/g, "\\'")}%'`);
  if (account_name) where.push(`Account.Name LIKE '%${account_name.replace(/'/g, "\\'")}%'`);
  const soql = `SELECT ${OPPORTUNITY_FIELDS} FROM Opportunity WHERE ${where.join(" AND ")} ORDER BY CloseDate ASC LIMIT ${limit}`;
  return soqlQuery(session.instance_url, session.access_token, soql);
}

export async function fetchModifiedRecords(objectType, sinceIso) {
  if (usesBigQuery()) return bqFetchModified(objectType, sinceIso);
  const session = await getSalesforceSession();
  const { SYNC_OBJECTS } = await import("./sfdc-objects.mjs");
  const cfg = SYNC_OBJECTS[objectType];
  if (!cfg) return [];
  const soql = `SELECT ${cfg.fields} FROM ${objectType} WHERE LastModifiedDate > ${sinceIso} ORDER BY LastModifiedDate ASC`;
  return soqlQuery(session.instance_url, session.access_token, soql);
}

export async function fetchPipelineSnapshot(opts) {
  if (!usesBigQuery()) {
    throw new Error("Full pipeline snapshot sync is only supported for BigQuery certified tables");
  }
  return bqFetchSnapshot(opts);
}
