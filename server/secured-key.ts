/**
 * §5 — Mint a secured, search-only, scoped API key on the server.
 *
 * `generateSecuredApiKey` derives a restricted key from a PARENT search-only key
 * (never the Admin key) via HMAC-SHA256. It requires at least one restriction —
 * here we scope it to the products index, give it a short lifetime, and tag it
 * with a per-conversation userToken so usage is attributable and rate-limitable.
 *
 * Because the HMAC is computed server-side, the parent key is never exposed. In
 * this project the secured key also stays server-side: the proxy uses it to call
 * the Agent Studio /completions endpoint, so no Algolia key ever reaches the
 * browser.
 *
 * Docs: https://www.algolia.com/doc/libraries/sdk/methods/search/generate-secured-api-key
 */
import { algoliasearch, type GenerateSecuredApiKeyOptions } from "algoliasearch";

const APP_ID = requireEnv("ALGOLIA_APP_ID");
const SEARCH_KEY = requireEnv("ALGOLIA_SEARCH_KEY");
const INDEX_NAME = process.env.ALGOLIA_INDEX_NAME ?? "products";
const KEY_TTL_SECONDS = 60 * 60; // 1 hour

// A client built from the parent SEARCH-only key. generateSecuredApiKey is a
// pure local HMAC over this parent key — no network call. It's a Node-only
// helper; the umbrella client's browser-facing type omits it, so we widen the
// type to include it (it's present at runtime in the Node build).
const client = algoliasearch(APP_ID, SEARCH_KEY) as ReturnType<typeof algoliasearch> & {
  generateSecuredApiKey: (opts: GenerateSecuredApiKeyOptions) => string;
};

export interface SecuredKey {
  key: string;
  validUntil: number;
}

/**
 * Derive a scoped, expiring, search-only key for one conversation.
 * @param userToken stable id for the conversation/user (for analytics + rate limits)
 */
export function mintSecuredKey(userToken: string): SecuredKey {
  const validUntil = Math.floor(Date.now() / 1000) + KEY_TTL_SECONDS;
  const key = client.generateSecuredApiKey({
    parentApiKey: SEARCH_KEY,
    restrictions: {
      restrictIndices: [INDEX_NAME],
      validUntil,
      userToken,
    },
  });
  return { key, validUntil };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("Your")) {
    throw new Error(
      `Missing env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}
