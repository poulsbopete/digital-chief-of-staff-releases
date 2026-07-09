/**
 * Elasticsearch client for Digital Chief of Staff indices.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dockerDir } from "./paths.mjs";

export function requireElasticsearchUrl() {
  const raw = (process.env.ELASTICSEARCH_URL || "").trim().replace(/\/$/, "");
  if (!raw) {
    throw new Error(
      "ELASTICSEARCH_URL is required (Elastic Serverless Search/Elasticsearch project HTTPS, or http://localhost:9200 for local DCOS)."
    );
  }
  return raw;
}

export function getIndexNames() {
  return {
    notes: process.env.DCOS_INDEX_NOTES || "dcos_notes",
    opportunities: process.env.DCOS_INDEX_OPPORTUNITIES || "dcos_opportunities",
    signals: process.env.DCOS_INDEX_SIGNALS || "dcos_signals",
    activities: process.env.DCOS_INDEX_ACTIVITIES || "dcos_activities",
  };
}

export function esAuthHeaders() {
  const headers = {};
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  const basic = process.env.ELASTICSEARCH_BASIC_AUTH;
  if (apiKey) headers.Authorization = `ApiKey ${apiKey}`;
  else if (basic) headers.Authorization = `Basic ${basic}`;
  return headers;
}

export function createEsClient(esUrl = requireElasticsearchUrl()) {
  async function esFetch(path, { method = "GET", body } = {}) {
    const url = `${esUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const init = {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", ...esAuthHeaders() },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { _raw: text };
    }
    if (!res.ok) {
      const err = new Error(`Elasticsearch HTTP ${res.status} ${method} ${path}: ${text.slice(0, 800)}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  async function indexExists(index) {
    const res = await fetch(`${esUrl}/${index}`, { method: "HEAD", headers: { ...esAuthHeaders() } });
    return res.ok;
  }

  async function ensureIndex(index, mappingFile) {
    if (await indexExists(index)) return { created: false, index };
    const path = join(dockerDir(), mappingFile);
    if (!existsSync(path)) throw new Error(`Missing mapping file: ${path}`);
    const settings = JSON.parse(readFileSync(path, "utf8"));
    await esFetch(`/${index}`, { method: "PUT", body: settings });
    return { created: true, index };
  }

  async function ensureAllIndices() {
    const names = getIndexNames();
    const results = [];
    results.push(await ensureIndex(names.notes, "dcos-notes-index.json"));
    results.push(await ensureIndex(names.opportunities, "dcos-opportunities-index.json"));
    results.push(await ensureIndex(names.signals, "dcos-signals-index.json"));
    results.push(await ensureIndex(names.activities, "dcos-activities-index.json"));
    return results;
  }

  async function bulkUpsert(index, docs, { idField = "doc_id" } = {}) {
    const lines = [];
    const now = new Date().toISOString();
    for (const doc of docs) {
      const id = doc[idField];
      if (!id) throw new Error(`bulkUpsert requires ${idField} on each document`);
      lines.push(JSON.stringify({ index: { _index: index, _id: id } }));
      lines.push(JSON.stringify({ ...doc, indexed_at: now }));
    }
    const ndjson = lines.join("\n") + "\n";
    const res = await fetch(`${esUrl}/_bulk?refresh=wait_for`, {
      method: "POST",
      headers: { "Content-Type": "application/x-ndjson", ...esAuthHeaders() },
      body: ndjson,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`Bulk failed HTTP ${res.status}: ${text.slice(0, 400)}`);
    return json;
  }

  return { esUrl, esFetch, indexExists, ensureIndex, ensureAllIndices, bulkUpsert };
}
