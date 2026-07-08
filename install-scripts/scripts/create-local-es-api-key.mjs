#!/usr/bin/env node
/**
 * Create Elasticsearch API key and write ~/.config/dcos/env.sh
 * Usage: node create-local-es-api-key.mjs [--password PASS]
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ES_URL = (process.env.ELASTICSEARCH_URL || "http://localhost:9200").replace(/\/$/, "");
const INSTALL_DIR = process.env.DCOS_INSTALL_DIR || join(homedir(), ".config", "dcos");
const ENV_FILE = join(INSTALL_DIR, "env.sh");
const ENV_PS1 = join(INSTALL_DIR, "env.ps1");
const PASSWORD_FILE = join(INSTALL_DIR, "elasticsearch", "elastic.password");
let PASSWORD = process.argv.includes("--password")
  ? process.argv[process.argv.indexOf("--password") + 1]
  : process.env.DCOS_ELASTIC_PASSWORD || "changeme";
if ((!PASSWORD || PASSWORD === "changeme") && existsSync(PASSWORD_FILE)) {
  PASSWORD = readFileSync(PASSWORD_FILE, "utf8").trim();
}

function basicAuthHeaders() {
  if (!PASSWORD || PASSWORD === "changeme") return {};
  return { Authorization: `Basic ${Buffer.from(`elastic:${PASSWORD}`).toString("base64")}` };
}

function securityEnabledFromXpack(json) {
  return json?.features?.security?.enabled === true;
}

async function fetchXpack() {
  const headers = basicAuthHeaders();
  const res = await fetch(`${ES_URL}/`, { headers });
  if (res.status === 401 && !headers.Authorization) {
    return { securityEnabled: true };
  }
  if (!res.ok) throw new Error(`Elasticsearch not reachable at ${ES_URL} (HTTP ${res.status})`);
  const resX = await fetch(`${ES_URL}/_xpack`, { headers });
  if (!resX.ok) return { securityEnabled: true };
  const json = await resX.json();
  return { securityEnabled: securityEnabledFromXpack(json) };
}

async function waitForCluster(maxAttempts = 60) {
  const auth = basicAuthHeaders();
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${ES_URL}/_cluster/health?wait_for_status=yellow&timeout=5s`, { headers: auth });
      if (res.ok) {
        const health = await res.json();
        if (health.status === "green" || health.status === "yellow") return health;
      }
    } catch {
      /* retry */
    }
    if (!auth.Authorization) {
      try {
        const res = await fetch(`${ES_URL}/_cluster/health?wait_for_status=yellow&timeout=5s`);
        if (res.ok) {
          const health = await res.json();
          if (health.status === "green" || health.status === "yellow") return health;
        }
      } catch {
        /* retry */
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Elasticsearch not ready at ${ES_URL} after ${maxAttempts * 2}s`);
}

async function createApiKey() {
  const body = {
    name: "dcos-local",
    expiration: "365d",
    role_descriptors: {
      dcos: {
        cluster: ["monitor", "manage_index_templates", "manage_ilm"],
        index: [{ names: ["dcos_*", "*"], privileges: ["all"] }],
      },
    },
  };
  const res = await fetch(`${ES_URL}/_security/api_key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`elastic:${PASSWORD}`).toString("base64")}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`API key creation failed HTTP ${res.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text);
  const encoded = Buffer.from(`${json.id}:${json.api_key}`).toString("base64");
  return { id: json.id, encoded, name: json.name || "dcos-local" };
}

function upsertEnv(url, apiKey, { insecure = false } = {}) {
  mkdirSync(INSTALL_DIR, { recursive: true });
  let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";

  const setOrAppend = (key, value) => {
    const line = `export ${key}="${value.replace(/"/g, '\\"')}"`;
    const re = new RegExp(`^export ${key}=.*$`, "m");
    if (re.test(content)) content = content.replace(re, line);
    else content += (content.endsWith("\n") || content === "" ? "" : "\n") + line + "\n";
  };

  setOrAppend("ELASTICSEARCH_URL", url);
  if (apiKey) setOrAppend("ELASTICSEARCH_API_KEY", apiKey);
  else {
    const re = /^export ELASTICSEARCH_API_KEY=.*$/m;
    if (re.test(content)) content = content.replace(re, "# export ELASTICSEARCH_API_KEY=  # not required (local security off)\n");
  }
  if (PASSWORD && PASSWORD !== "changeme") {
    setOrAppend("DCOS_ELASTIC_PASSWORD", PASSWORD);
  }
  if (insecure) {
    setOrAppend("DCOS_LOCAL_ELASTICSEARCH_INSECURE", "1");
  }

  if (!content.includes("DCOS_LOCAL_ELASTICSEARCH")) {
    content += "\n# Local Elasticsearch (setup-local-elasticsearch.sh)\nexport DCOS_LOCAL_ELASTICSEARCH=1\n";
  }

  writeFileSync(ENV_FILE, content);

  const ps1Lines = [];
  const pushPs1 = (key, value) => {
    ps1Lines.push(`$env:${key} = "${String(value).replace(/"/g, '`"')}"`);
  };
  pushPs1("ELASTICSEARCH_URL", url);
  if (apiKey) pushPs1("ELASTICSEARCH_API_KEY", apiKey);
  if (PASSWORD && PASSWORD !== "changeme") pushPs1("DCOS_ELASTIC_PASSWORD", PASSWORD);
  if (insecure) pushPs1("DCOS_LOCAL_ELASTICSEARCH_INSECURE", "1");
  pushPs1("DCOS_LOCAL_ELASTICSEARCH", "1");
  writeFileSync(ENV_PS1, `${ps1Lines.join("\n")}\n`);

  return ENV_FILE;
}

function saveKeychain(encoded) {
  if (process.platform !== "darwin") return;
  try {
    execSync(
      `security add-generic-password -a dcos -s dcos.elasticsearch.api_key -w ${JSON.stringify(encoded)} -U`,
      { stdio: "ignore" }
    );
  } catch {
    /* optional */
  }
}

const health = await waitForCluster();
const { securityEnabled } = await fetchXpack();

let encoded = "";
let id = "";

if (securityEnabled) {
  ({ encoded, id } = await createApiKey());
} else {
  id = "none";
}

const envPath = upsertEnv(ES_URL, encoded, { insecure: !securityEnabled });
if (encoded) saveKeychain(encoded);

console.log(
  JSON.stringify(
    {
      ok: true,
      elasticsearch_url: ES_URL,
      security_enabled: securityEnabled,
      api_key_id: id,
      env_file: envPath,
      cluster_status: health.status,
      claude_extension: {
        elasticsearch_url: ES_URL,
        elasticsearch_api_key: encoded,
        note: securityEnabled
          ? undefined
          : "Security is off — paste URL only; leave API key blank in Claude extension settings.",
      },
    },
    null,
    2
  )
);
