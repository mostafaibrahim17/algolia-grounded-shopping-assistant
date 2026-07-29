/**
 * A small grounding eval. Runs a batch of in-catalog and out-of-catalog queries
 * through the live agent and measures:
 *   - in-catalog:  did it return real products? (grounded)
 *   - out-of-catalog: did the agent's TEXT refuse? (grounding held)
 *                     did the SEARCH return zero hits? (clean refusal, no stray card)
 *
 * It calls the completions endpoint directly with stream=false for clean parsing;
 * the agent's behavior is identical to what the proxy/UI drives.
 *
 * Run: npm run eval   (requires the same .env as the server)
 */
import "dotenv/config";

const APP_ID = requireEnv("ALGOLIA_APP_ID");
const KEY = requireEnv("ALGOLIA_SEARCH_KEY");
const AGENT_ID = requireEnv("ALGOLIA_AGENT_ID");
const HOST = process.env.ALGOLIA_API_HOST || `${APP_ID}.algolia.net`;
const URL =
  `https://${HOST}/agent-studio/1/agents/${AGENT_ID}` +
  `/completions?stream=false&compatibilityMode=ai-sdk-5`;

const IN_CATALOG = [
  "a lightweight camera under $300 for travel",
  "wireless headphones under $200",
  "a laptop for a student",
  "a 4K TV under $800",
  "a bluetooth speaker under $100",
  "a smartwatch",
  "a gaming keyboard",
  "noise cancelling headphones",
  "a tablet under $400",
  "a portable charger",
  "a fitness tracker",
  "a webcam for video calls",
];

const OUT_OF_CATALOG = [
  "do you sell a trumpet?",
  "a Rolex Submariner watch",
  "fresh strawberries",
  "a golden retriever puppy",
  "a wedding dress",
  "a mountain bike",
  "a garden hose",
  "a diamond engagement ring",
  "a live goldfish",
  "a leather sofa",
  "a cowboy hat",
  "a yoga mat",
];

// Heuristic: did the agent decline / say it's not available?
const REFUSAL_RE =
  /\b(sorry|couldn't|could not|do(?:esn'?t| not)?\s+(?:have|carry|sell|offer)|don'?t\s+(?:have|carry|sell)|is\s?n'?t\s+(?:in|available)|not\s+(?:in\s+(?:our|the)\s+catalog|available|carried|part of|something we))\b/i;

interface Result {
  q: string;
  hits: number;
  text: string;
}

async function ask(text: string): Promise<Result> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          "x-algolia-application-id": APP_ID,
          "x-algolia-api-key": KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "eval",
          trigger: "submit-user-message",
          messages: [{ id: "m", role: "user", parts: [{ type: "text", text }] }],
        }),
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data: any = await res.json();
      let hits = 0;
      let out = "";
      for (const p of data.parts ?? []) {
        if (typeof p.type === "string" && p.type.startsWith("tool-") && p.output) {
          if (Array.isArray(p.output.hits)) hits += p.output.hits.length;
          else if (Array.isArray(p.output.results))
            for (const r of p.output.results) hits += (r.hits ?? []).length;
        }
        if (p.type === "text" && typeof p.text === "string") out += p.text;
      }
      return { q: text, hits, text: out };
    } catch (err) {
      if (attempt === 2) return { q: text, hits: -1, text: `[error: ${err}]` };
      await sleep(2000);
    }
  }
  return { q: text, hits: -1, text: "[error]" };
}

async function main() {
  console.log(`Grounding eval → ${IN_CATALOG.length} in-catalog, ${OUT_OF_CATALOG.length} out-of-catalog\n`);

  const inRes: Result[] = [];
  for (const q of IN_CATALOG) {
    const r = await ask(q);
    inRes.push(r);
    console.log(`  in   | ${r.hits >= 0 ? String(r.hits).padStart(3) : "err"} hits | ${q}`);
    await sleep(600);
  }
  const outRes: Result[] = [];
  for (const q of OUT_OF_CATALOG) {
    const r = await ask(q);
    outRes.push(r);
    const refused = REFUSAL_RE.test(r.text);
    console.log(
      `  out  | ${r.hits >= 0 ? String(r.hits).padStart(3) : "err"} hits | ` +
        `${refused ? "refused " : "PRESENTED"} | ${q}`,
    );
    await sleep(600);
  }

  // Tallies
  const grounded = inRes.filter((r) => r.hits > 0).length;
  const inErr = inRes.filter((r) => r.hits < 0).length;
  const refusedText = outRes.filter((r) => REFUSAL_RE.test(r.text)).length;
  const cleanZero = outRes.filter((r) => r.hits === 0).length;
  const leaked = outRes.filter((r) => r.hits > 0);
  const outErr = outRes.filter((r) => r.hits < 0).length;

  console.log("\n================= GROUNDING EVAL RESULTS =================");
  console.log(`In-catalog (${IN_CATALOG.length} queries)`);
  console.log(`  returned real products (grounded):  ${grounded}/${IN_CATALOG.length - inErr}`);
  console.log(`\nOut-of-catalog (${OUT_OF_CATALOG.length} queries)`);
  console.log(`  refused in text (grounding held):   ${refusedText}/${OUT_OF_CATALOG.length - outErr}`);
  console.log(`  zero search hits (clean, no card):  ${cleanZero}/${OUT_OF_CATALOG.length - outErr}`);
  console.log(`  fuzzy leaks (stray card shown):     ${leaked.length}`);
  if (leaked.length) {
    console.log(`\n  leaks (agent still refused in text, but search surfaced a card):`);
    for (const r of leaked) console.log(`    - "${r.q}" → ${r.hits} hit(s)`);
  }
  console.log("=========================================================");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("Your")) {
    console.error(`Missing env var ${name}. Fill in .env.`);
    process.exit(1);
  }
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
