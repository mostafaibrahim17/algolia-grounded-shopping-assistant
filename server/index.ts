/**
 * §5 — The proxy server.
 *
 * Two jobs, both about keeping the conversation grounded and the keys safe:
 *
 *   POST /api/chat    Streams the conversation to the Agent Studio /completions
 *                     endpoint. Mints a secured, search-only, per-conversation
 *                     key server-side and sends it in the Algolia identity
 *                     headers — so no Algolia key ever reaches the browser. The
 *                     InstantSearch `chat` widget points its custom transport
 *                     here (see web/src/chatTransport.ts).
 *
 *   POST /api/verify  Backs the `verify_product_exists` client-side tool. The
 *                     browser calls it (no key needed there); the server does the
 *                     index lookup and returns whether the product is real.
 *
 * Run: npm run dev:server
 */
import "dotenv/config";
import { Readable } from "node:stream";
import express from "express";
import { mintSecuredKey } from "./secured-key.js";
import { verifyProductExists } from "./tools/verify-product.js";

const APP_ID = requireEnv("ALGOLIA_APP_ID");
const AGENT_ID = requireEnv("ALGOLIA_AGENT_ID");
const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";

// Host defaults to the standard {APP_ID}.algolia.net. It's overridable via
// ALGOLIA_API_HOST only for unusual networks/resolvers (e.g. a machine whose
// resolver can't follow the {app}.algolia.net CNAME); most setups leave it unset.
const ALGOLIA_HOST = process.env.ALGOLIA_API_HOST || `${APP_ID}.algolia.net`;
const COMPLETIONS_URL =
  `https://${ALGOLIA_HOST}/agent-studio/1/agents/${AGENT_ID}` +
  `/completions?stream=true&compatibilityMode=ai-sdk-5`;

const app = express();
app.use(express.json({ limit: "1mb" }));

// Minimal CORS for the local web dev server.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, x-conversation-id",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * Streaming proxy → Agent Studio /completions.
 * The widget's AI-SDK-v5 request body is forwarded verbatim; we only add the
 * Algolia identity headers with a freshly minted secured key.
 */
app.post("/api/chat", async (req, res) => {
  const conversationId = String(req.header("x-conversation-id") ?? "anonymous");
  try {
    const { key } = mintSecuredKey(conversationId);

    const upstream = await fetch(COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "x-algolia-application-id": APP_ID,
        "x-algolia-api-key": key, // secured, search-only, scoped, never sent to the browser
        "content-type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      console.error(`completions ${upstream.status}: ${text}`);
      return res.status(upstream.status || 502).json({ error: "completions_failed" });
    }

    // Pass the AI-SDK data stream straight through to the widget's transport.
    res.setHeader(
      "content-type",
      upstream.headers.get("content-type") ?? "text/event-stream",
    );
    const nodeStream = Readable.fromWeb(upstream.body as any);
    nodeStream.on("error", (err) => {
      console.error("stream error:", err);
      res.destroy(err as Error);
    });
    nodeStream.pipe(res);
  } catch (err) {
    // A network/DNS failure to the completions host must not crash the server.
    console.error("/api/chat failed:", err);
    if (!res.headersSent) res.status(502).json({ error: "proxy_failed", detail: String(err) });
  }
});

/**
 * The out-of-index guard, exposed to the browser's onToolCall handler.
 * Returns { objectID, exists, product? }.
 */
app.post("/api/verify", async (req, res) => {
  const objectID = String(req.body?.objectID ?? "").trim();
  if (!objectID) return res.status(400).json({ error: "objectID required" });
  res.json(await verifyProductExists(objectID));
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Proxy listening on http://localhost:${PORT}`);
  console.log(`  → /api/chat proxies ${COMPLETIONS_URL}`);
  console.log(`  → /api/verify backs the verify_product_exists grounding tool`);
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("Your")) {
    console.error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}
