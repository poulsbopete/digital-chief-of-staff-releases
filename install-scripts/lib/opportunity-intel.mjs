/**
 * Merge live CRM opportunity data with indexed DCOS notes (Granola, briefs, coaching).
 */
import { createEsClient, getIndexNames } from "./elasticsearch.mjs";
import { requireElasticsearch } from "./ensure-local-elasticsearch.mjs";
import { getOpportunityById, listOpenOpportunities } from "./crm-backend.mjs";

export async function searchNotesForOpportunity({ account, opportunity, limit = 25 } = {}) {
  await requireElasticsearch();
  const es = createEsClient();
  const { notes } = getIndexNames();
  const filter = [];
  if (account) filter.push({ term: { account } });
  const should = [];
  if (opportunity) {
    should.push({ match: { opportunity: { query: opportunity, boost: 2 } } });
    should.push({ match: { content: { query: opportunity } } });
  }
  const body = {
    size: limit,
    sort: [{ note_date: { order: "desc" } }, { created_at: { order: "desc" } }],
    query: {
      bool: {
        must: should.length ? [{ bool: { should, minimum_should_match: 1 } }] : [{ match_all: {} }],
        filter,
      },
    },
  };
  try {
    const res = await es.esFetch(`/${notes}/_search`, { method: "POST", body });
    return (res.hits?.hits || []).map((h) => ({ id: h._id, ...h._source }));
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

export async function getOpportunityIntel({ opportunity_id, account, opportunity_name } = {}) {
  let crm = null;
  if (opportunity_id) {
    crm = await getOpportunityById(opportunity_id);
  } else if (account || opportunity_name) {
    const opps = await listOpenOpportunities({
      account_name: account,
      owner_name: null,
      limit: 20,
    });
    const needle = (opportunity_name || "").toLowerCase();
    crm =
      opps.find((o) => o.Name?.toLowerCase().includes(needle)) ||
      opps.find((o) => o.Account?.Name?.toLowerCase() === (account || "").toLowerCase()) ||
      opps[0] ||
      null;
  }

  const acct = account || crm?.Account?.Name || null;
  const oppName = opportunity_name || crm?.Name || null;
  const notes = await searchNotesForOpportunity({
    account: acct,
    opportunity: oppName,
    limit: 30,
  });

  const granolaNotes = notes.filter((n) => n.source === "granola" || n.source === "granola_meeting");
  const otherNotes = notes.filter((n) => !granolaNotes.includes(n));

  const suggestedUpdates = notes
    .flatMap((n) => {
      if (n.suggested_sfdc_updates) return [{ note_id: n.id, source: n.source, updates: n.suggested_sfdc_updates }];
      return [];
    })
    .slice(0, 10);

  return {
    crm: crm
      ? {
          id: crm.Id,
          name: crm.Name,
          account: crm.Account?.Name || null,
          stage: crm.StageName,
          amount: crm.Amount,
          close_date: crm.CloseDate,
          next_step: crm.NextStep || null,
          description: crm.Description || null,
          owner: crm.Owner?.Name || null,
        }
      : null,
    notes: {
      total: notes.length,
      granola: granolaNotes.length,
      recent: notes.slice(0, 10).map((n) => ({
        id: n.id,
        source: n.source,
        title: n.title,
        note_date: n.note_date,
        meddpic_letters: n.meddpic_letters,
        blocker_tags: n.blocker_tags,
        has_sfdc_updates: Boolean(n.suggested_sfdc_updates),
        preview: String(n.content || "").slice(0, 280),
      })),
    },
    suggested_sfdc_updates: suggestedUpdates,
    workflow_hint:
      "DCOS does not write to Salesforce. Use suggested_sfdc_updates + CRM fields above when updating SFDC manually. Index new Granola summaries with dcos_add_note (source: granola).",
  };
}
