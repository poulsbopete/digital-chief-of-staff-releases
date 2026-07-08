/**
 * Pluggable connector registry for internal Elastic tools.
 * Config: config/connectors.yaml (copy from connectors.yaml.example)
 */
import { existsSync, readFileSync } from "node:fs";
import { configCandidates } from "./paths.mjs";

const CONFIG_CANDIDATES = [
  ...configCandidates("connectors.yaml"),
  ...configCandidates("connectors.yml"),
];

function loadYamlLike(text) {
  // Minimal YAML subset parser — enough for our connector config shape.
  // For production, users can use a YAML parser; we avoid extra deps here.
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to line-based parser */
  }

  const connectors = {};
  let current = null;
  let currentAction = null;
  let inActions = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.match(/^(\s*)/)[1].length;
    if (indent === 0 && /^connectors:\s*$/.test(trimmed)) continue;

    const connMatch = trimmed.match(/^([a-z0-9_-]+):\s*$/i);
    if (connMatch && indent === 2) {
      current = connMatch[1];
      connectors[current] = { actions: {} };
      inActions = false;
      currentAction = null;
      continue;
    }

    if (!current) continue;

    const kv = trimmed.match(/^([a-z_]+):\s*(.*)$/i);

    if (connMatch && indent === 6 && inActions) {
      currentAction = connMatch[1];
      connectors[current].actions[currentAction] = {};
      continue;
    }

    if (currentAction && kv && indent >= 8) {
      connectors[current].actions[currentAction][kv[1]] = kv[2].replace(/^["']|["']$/g, "");
      continue;
    }

    if (kv && indent === 4) {
      const [, key, val] = kv;
      const unquoted = val.replace(/^["']|["']$/g, "");
      if (key === "actions") {
        inActions = true;
        currentAction = null;
      } else {
        inActions = false;
        currentAction = null;
        connectors[current][key] = unquoted;
      }
    }
  }
  return { connectors };
}

export function loadConnectorConfig() {
  for (const path of CONFIG_CANDIDATES) {
    if (path && existsSync(path)) {
      const text = readFileSync(path, "utf8");
      return { path, config: loadYamlLike(text) };
    }
  }
  return { path: null, config: { connectors: {} } };
}

function resolveEnv(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] || "");
}

export function listConnectors() {
  const { path, config } = loadConnectorConfig();
  const out = [];
  for (const [id, def] of Object.entries(config.connectors || {})) {
    out.push({
      id,
      type: def.type || "rest",
      description: def.description || "",
      actions: Object.keys(def.actions || {}),
      configured: !!(resolveEnv(def.base_url) || def.type === "slack"),
    });
  }
  return { config_path: path, connectors: out };
}

async function callRestConnector(def, actionDef, params) {
  const base = resolveEnv(def.base_url)?.replace(/\/$/, "");
  if (!base) throw new Error(`Connector ${def.id || "unknown"} missing base_url or env var`);

  let path = actionDef.path || "/";
  for (const [k, v] of Object.entries(params || {})) {
    path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
  }

  const method = (actionDef.method || "GET").toUpperCase();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = { Accept: "application/json" };
  const authHeader = resolveEnv(def.auth_header);
  const authToken = resolveEnv(def.auth_token || def.token_env && process.env[def.token_env]);
  if (authHeader && authToken) headers.Authorization = `${authHeader} ${authToken}`.trim();
  else if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD" && actionDef.body_template) {
    init.headers["Content-Type"] = "application/json";
    let bodyStr = actionDef.body_template;
    for (const [k, v] of Object.entries(params || {})) {
      bodyStr = bodyStr.replace(new RegExp(`\\{${k}\\}`, "g"), JSON.stringify(v).replace(/^"|"$/g, ""));
    }
    init.body = bodyStr;
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text.slice(0, 8000) };
  }
  if (!res.ok) {
    throw new Error(`Connector HTTP ${res.status}: ${text.slice(0, 600)}`);
  }
  return json;
}

async function callSlackConnector(def, actionDef, params) {
  const token = resolveEnv(def.bot_token) || process.env.SLACK_BOT_TOKEN || process.env.DCOS_SLACK_BOT_TOKEN;
  if (!token) throw new Error("Slack connector requires bot_token in config or SLACK_BOT_TOKEN env");

  const method = (actionDef.method || "GET").toUpperCase();
  const url = `https://slack.com/api/${actionDef.api_method}`;

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  let body;
  if (method === "GET") {
    const qs = new URLSearchParams(params || {}).toString();
    const res = await fetch(`${url}?${qs}`, { headers });
    const json = await res.json();
    if (!json.ok) throw new Error(`Slack API error: ${json.error}`);
    return json;
  }

  headers["Content-Type"] = "application/json; charset=utf-8";
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(params || {}) });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack API error: ${json.error}`);
  return json;
}

export async function callConnector(connectorId, action, params = {}) {
  const { config } = loadConnectorConfig();
  const def = config.connectors?.[connectorId];
  if (!def) throw new Error(`Unknown connector: ${connectorId}. Run dcos_connector_list.`);

  const actionDef = def.actions?.[action];
  if (!actionDef) {
    throw new Error(`Unknown action "${action}" on connector "${connectorId}". Available: ${Object.keys(def.actions || {}).join(", ")}`);
  }

  const type = (def.type || "rest").toLowerCase();
  if (type === "slack") return callSlackConnector(def, actionDef, params);
  return callRestConnector({ ...def, id: connectorId }, actionDef, params);
}
