/**
 * Salesforce object → Elasticsearch document mappers for DCOS sync.
 */

export const OPPORTUNITY_FIELDS =
  "Id, Name, AccountId, Account.Name, StageName, Amount, CloseDate, Probability, NextStep, Description, LastModifiedDate, OwnerId, Owner.Name, Type, LeadSource, ForecastCategoryName";

export const ACCOUNT_FIELDS =
  "Id, Name, Type, Industry, Website, BillingCity, BillingState, BillingCountry, Description, LastModifiedDate, OwnerId, Owner.Name, NumberOfEmployees, AnnualRevenue";

export const TASK_FIELDS =
  "Id, Subject, Description, Status, Priority, ActivityDate, LastModifiedDate, AccountId, Account.Name, WhatId, What.Name, What.Type, OwnerId, Owner.Name";

export const EVENT_FIELDS =
  "Id, Subject, Description, StartDateTime, EndDateTime, LastModifiedDate, AccountId, Account.Name, WhatId, What.Name, What.Type, OwnerId, Owner.Name";

export function opportunityToEs(row) {
  const parts = [row.Description, row.NextStep].map((s) => s?.trim()).filter(Boolean);
  return {
    doc_id: `sfdc:Opportunity:${row.Id}`,
    sfdc_id: row.Id,
    object_type: "Opportunity",
    account: row.Account?.Name || null,
    account_id: row.AccountId || null,
    opportunity: row.Name?.trim() || null,
    stage: row.StageName || null,
    amount: row.Amount ?? null,
    close_date: row.CloseDate || null,
    probability: row.Probability ?? null,
    owner: row.Owner?.Name || null,
    owner_id: row.OwnerId || null,
    title: row.Name?.trim() || "Opportunity",
    content: (parts.length ? parts.join("\n\n") : row.Name || "").slice(0, 100_000),
    source: "sfdc_opportunity",
    note_date: row.LastModifiedDate,
    created_at: row.LastModifiedDate,
  };
}

export function accountToEs(row) {
  const parts = [row.Description, row.Industry, row.Website].map((s) => s?.trim()).filter(Boolean);
  return {
    doc_id: `sfdc:Account:${row.Id}`,
    sfdc_id: row.Id,
    object_type: "Account",
    account: row.Name?.trim() || null,
    owner: row.Owner?.Name || null,
    owner_id: row.OwnerId || null,
    title: row.Name?.trim() || "Account",
    content: parts.join(" | ").slice(0, 50_000),
    source: "sfdc_account",
    note_date: row.LastModifiedDate,
    created_at: row.LastModifiedDate,
  };
}

export function activityToEs(row, type) {
  const account = row.Account?.Name;
  const whatType = row.What?.Type || "";
  const whatName = row.What?.Name || "";
  const opportunity = whatType === "Opportunity" ? whatName : undefined;
  const title = row.Subject?.trim() || type;
  const desc = row.Description?.trim();
  const content = (desc && desc.length ? desc : title).slice(0, 100_000);
  const doc = {
    doc_id: `sfdc:${type}:${row.Id}`,
    sfdc_id: row.Id,
    object_type: type,
    title,
    content,
    owner: row.Owner?.Name || null,
    source: `sfdc_${type.toLowerCase()}`,
    note_date: row.LastModifiedDate,
    created_at: row.LastModifiedDate,
  };
  if (account) doc.account = account;
  if (opportunity) doc.opportunity = opportunity;
  if (row.Status) doc.status = row.Status;
  return doc;
}

export const SYNC_OBJECTS = {
  Opportunity: { fields: OPPORTUNITY_FIELDS, toEs: opportunityToEs, index: "opportunities" },
  Account: { fields: ACCOUNT_FIELDS, toEs: accountToEs, index: "notes" },
  Task: { fields: TASK_FIELDS, toEs: (r) => activityToEs(r, "Task"), index: "activities" },
  Event: { fields: EVENT_FIELDS, toEs: (r) => activityToEs(r, "Event"), index: "activities" },
};
