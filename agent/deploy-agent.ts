/**
 * §4 — Define the agent as version-controlled config and deploy it.
 *
 * Reads agent/agent.config.json, injects the BYO-LLM provider profile id from
 * the environment, and creates (then publishes) the agent through the Agent
 * Studio REST API. Prints the resulting agent id — copy it into ALGOLIA_AGENT_ID.
 *
 * Run: npm run agent:deploy
 * Requires: ALGOLIA_APP_ID, an admin/agent-capable ALGOLIA_ADMIN_KEY, and a
 * provider profile created once in the Agent Studio dashboard (OpenAI).
 *
 * Docs: https://www.algolia.com/doc/rest-api/agent-studio
 *
 * The REST API is the supported path. An unofficial sample CLI also exists
 * (github.com/algolia-samples/algolia-agent-cli) if you prefer a CLI wrapper.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APP_ID = requireEnv("ALGOLIA_APP_ID");
const API_KEY = requireEnv("ALGOLIA_ADMIN_KEY");
// The provider profile you added in the dashboard (Settings → Agent Studio →
// LLM providers) for OpenAI. Its id is passed as `providerId`.
const PROVIDER_ID = requireEnv("ALGOLIA_PROVIDER_ID");

const BASE = `https://${APP_ID}.algolia.net/agent-studio/1`;
const HEADERS = {
  "x-algolia-application-id": APP_ID,
  "x-algolia-api-key": API_KEY,
  "content-type": "application/json",
  accept: "application/json",
};

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const config = JSON.parse(await readFile(join(here, "agent.config.json"), "utf8"));

  // Inject the provider profile at deploy time so the committed config stays
  // free of environment-specific ids.
  const body = { ...config, providerId: PROVIDER_ID };

  console.log(`→ Creating agent "${config.name}"…`);
  const created = await api("POST", "/agents", body);
  const agentId = created.id ?? created.agentId ?? created.objectID;
  if (!agentId) {
    throw new Error(`Create response had no id: ${JSON.stringify(created)}`);
  }
  console.log(`  agent id: ${agentId}`);

  // Publish so the /completions endpoint can serve it.
  console.log(`→ Publishing agent…`);
  await api("POST", `/agents/${agentId}/publish`, {});

  console.log(
    `\n✓ Deployed and published.\n` +
      `  Set ALGOLIA_AGENT_ID=${agentId} in your .env\n\n` +
      `  Optional next step: add Recommend through the hosted Algolia MCP Server\n` +
      `  (dashboard → MCP), then attach it to this agent as an MCP tool. See the\n` +
      `  tutorial, section 4, for the asymmetry between built-in search and MCP.`,
  );
}

async function api(method: string, path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status} ${res.statusText}\n${text}`);
  }
  return res.status === 204 ? {} : res.json();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("Your")) {
    console.error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
