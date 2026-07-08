#!/usr/bin/env node
/** Verify Salesforce session after browser login. */
import { getSalesforceSession, soqlQuery } from "../lib/sfdc-auth.mjs";

try {
  const s = await getSalesforceSession();
  const rows = await soqlQuery(
    s.instance_url,
    s.access_token,
    "SELECT Id, Name FROM Organization LIMIT 1"
  );
  console.log(
    JSON.stringify({
      ok: true,
      org: rows[0]?.Name || "Unknown",
      username: s.username || null,
      source: s.source,
    })
  );
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: e.message || String(e) }));
  process.exit(1);
}
