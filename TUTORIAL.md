<p align="center">
  <img src="https://raw.githubusercontent.com/mostafaibrahim17/algolia-grounded-shopping-assistant/main/assets/banner.png" alt="Building a Grounded Shopping Assistant on Algolia Agent Studio" width="100%" />
</p>

# Building a Grounded Shopping Assistant on Algolia Agent Studio

Shoppers have mostly stopped typing keywords. They write out a full sentence now, like "a
lightweight camera under $300 for travel." Bolt a plain language model onto your store to answer
that and you get one of two failures: it invents a product you do not carry at a price you never
set, or it searches so literally that a shopper who asks for a camera is handed a camera bag.
Both sound right. Both are wrong. This tutorial builds the opposite: a shopping assistant on
Algolia Agent Studio that talks in full sentences and still stays inside your real catalog,
because every fact comes from a lookup and every product is checked before the assistant can
mention it.

We index a real catalog, define the agent as version-controlled configuration, wire up the
search tool and a guard that turns away any product the catalog does not have, create a secured
key on the server, and stream the conversation into a React chat page. The full project, with
setup and run steps, is in [this repository](https://github.com/mostafaibrahim17/algolia-grounded-shopping-assistant).
It is built and verified against Node 22,
`algoliasearch` 5.56, and `react-instantsearch` 7.39, driving Agent Studio through
`compatibilityMode=ai-sdk-5`, and those pins matter, because Agent Studio and the `chat` widget
are both still in beta and their shapes move between minor releases.

Turning grounding on is the easy part. The last third of this piece is the harder problem it
does not solve on its own, which is relevance.

## 1. Why LLM shopping assistants break on real catalogs

Site search is where buying intent concentrates, at a scale that is easy to underestimate:
over one Black Friday to Cyber Monday weekend, Algolia alone served
[33.5 billion searches at over 99.999% availability](https://www.algolia.com/about/news/algolia-powers-33-5-billion-searches-during-cyber-weekend-2025).
Serving that many queries reliably is one problem; understanding them is another. Two things
go wrong when a store bolts a language model onto its search. A request written as
a sentence does not map cleanly onto keyword filters. A phrase like "under $120 for
wide feet" is an intention the system has to read and turn into a query with the right
filters, not three checkboxes. The worse problem is that a model with no link to your data
will fill any gap by inventing something, so if you ask about a product you do not stock it
will describe one anyway, with a believable code and a price that looks right. Ask a bare model
whether the store carries a Rolex Submariner and it happily makes one up:

```
Ungrounded model (no catalog access):
  "Yes, we carry the Rolex Submariner Date (ref. 126610LN),
   currently $13,499.00 and in stock. Would you like to add it to your cart?"
```

Every detail is fabricated: the reference number, the price, the availability. Nothing was
looked up, so nothing is real, yet it reads exactly like a genuine listing. A bigger model does
not fix this. It just lies more convincingly. What fixes it is retrieval and grounding, where
the assistant never relies on its training, looks the catalog up on every question, and has no
way to answer once that lookup comes back empty.

## 2. Agent Studio as the discovery layer

The agent does not know the catalog, it retrieves it. Agent Studio runs a language model you choose, hands it a set of tools, and tracks
the conversation across turns, all on top of Algolia's search. The model supplies the language
understanding while Algolia supplies the facts.

Bring your own model means you pick which one runs the agent, whether that is Anthropic,
OpenAI, Azure OpenAI, Google Gemini, or any OpenAI-compatible endpoint, and here we use
OpenAI's GPT-4. The tools are what make grounding work, and there are three kinds. The
built-in Algolia search tool, `algolia_search_index`, queries your indices. Client-side tools
are your own functions, described with an OpenAI-style schema and run by your app. MCP tools
reach external services over the Model Context Protocol.

The assistant works with three kinds of data, which are structured product records, facets and
filters, and conversation state. That makes it a discovery layer rather than
a chat box on a product page: a shopper's message becomes an answer drawn only from the catalog.

<p align="center">
  <img src="https://raw.githubusercontent.com/mostafaibrahim17/algolia-grounded-shopping-assistant/main/assets/diagram-architecture.png" width="70%" alt="Architecture: a shopper's full-sentence query goes to the React chat UI, then through the proxy server (which creates a scoped, search-only key) to the Agent Studio agent running GPT-4, which calls algolia_search_index and verify_product_exists against the Algolia index of 10k products." />
</p>

## 3. Setting up Algolia and shaping a catalog

Everything here runs on Algolia's free Build plan, which needs no credit card. For data we
use Algolia's public ecommerce demo dataset, roughly 10,000 Best Buy products that already
have names, brands, categories, prices, and images, so it is ready to index right away. If
you want a larger set with a clear license, the Best Buy Open Data Set has about 51,000
products under CC0, and DummyJSON has 194 for a quick start. We use the 10,000 record set
because it is realistic without straining the free tier.

Each record is a structured product with a name, brand, price, categories, and an image,
which is what the assistant will retrieve and show a shopper:

```json
{
  "objectID": "5887061",
  "name": "GoPro - 3-Way Mount - Black",
  "brand": "GoPro",
  "categories": ["Cameras & Camcorders", "Camcorder Accessories",
                 "Action Camcorder Mounts", "Tripod Mounts"],
  "price": 69.99,
  "image": "https://cdn-demo.algolia.com/bestbuy/5887061_rb.jpg"
}
```

Those fields are what the assistant renders as product cards:

<p align="center">
  <img src="https://cdn-demo.algolia.com/bestbuy/5887061_rb.jpg" width="120" alt="GoPro 3-Way Mount" />
  <img src="https://cdn-demo.algolia.com/bestbuy/8637087_sb.jpg" width="120" alt="Bose SoundTrue In-Ear Headphones" />
  <img src="https://cdn-demo.algolia.com/bestbuy/8509817_sb.jpg" width="120" alt="Fitbit Accessory Band" />
  <img src="https://cdn-demo.algolia.com/bestbuy/8038064_sb.jpg" width="120" alt="JBL Coaxial Car Speakers" />
  <img src="https://cdn-demo.algolia.com/bestbuy/8795075_sb.jpg" width="120" alt="Canon Glossy Photo Paper" />
</p>

<p align="center"><sub>Real records from Algolia's ecommerce demo catalog.</sub></p>

Indexing uses the `algoliasearch` version 5 client. Two details matter here: version 5
removed `initIndex`, so every method takes an `indexName`, and you shape the index so that
retrieval matches how people phrase things, with full-text search across `name`,
`description`, `brand`, and `categories`, and facets over the structured fields:

```ts
// scripts/index-catalog.ts
const client = algoliasearch(APP_ID, ADMIN_KEY);

await client.setSettings({
  indexName: INDEX_NAME,
  indexSettings: {
    searchableAttributes: ["name", "description", "brand", "categories"],
    attributesForFaceting: [
      "searchable(brand)",
      "searchable(categories)",
      "free_shipping",
      "filterOnly(price)",
      // cumulative "fits under $X" tiers: the agent selects one value
      // ("under $300") and every cheaper product matches
      "searchable(budget_fits)",
    ],
    customRanking: ["desc(popularity)", "desc(rating)"],
    // collapse color/finish variants so a camera search returns
    // different cameras, not one camera in six colors
    attributeForDistinct: "model",
    distinct: true,
  },
});

// tag each record before indexing: the budget tiers it fits, and a
// variant-collapsing "model" key derived from the name
const enriched = records.map((r) => ({
  ...r,
  budget_fits: budgetFits(r.price), // $79 → ["under $100", "under $200", …]
  model: modelOf(r.name),           // "Brand - Cam - Black" → "Brand - Cam"
}));

await client.saveObjects({
  indexName: INDEX_NAME,
  objects: enriched,       // the 10k demo records, enriched
  waitForTasks: true,
});
```

`budget_fits` and `model` are the two fields the relevance work later leans on, and
the helpers that compute them are small. Why they matter is the whole of "The hard
part" below.

```ts
// every "under $X" tier a price satisfies (a $79 item fits under 100, 200, …)
function budgetFits(price?: number): string[] {
  if (typeof price !== "number") return [];
  return [100, 200, 300, 500, 1000, 2000, 5000]
    .filter((tier) => price < tier)
    .map((tier) => `under $${tier}`);
}

// drop the trailing "- Color" so variants collapse to one product
function modelOf(name?: string): string | undefined {
  const parts = (name ?? "").split(" - ");
  return parts.length >= 3 ? parts.slice(0, -1).join(" - ") : name;
}
```

The last dashboard step is adding an OpenAI provider profile under the Agent Studio LLM
providers, which lets the agent use GPT-4 as its model. Run `npm run index` and you have a
catalog you can search.

## 4. Defining the agent and wiring its tools

Instead of clicking an agent together in the dashboard, we define it as configuration so it
lives in version control. The agent is a JSON object with a model, a set of instructions, and
a list of tools, shipped through the Agent Studio REST API. Algolia publishes an official
sample CLI too, but the REST API is the supported path.

The instructions spell out the grounding rules in plain English, and the tools back it up:

```jsonc
// agent/agent.config.json (excerpt)
{
  "name": "Grounded Shopping Assistant",
  "model": "gpt-4",
  "instructions": "You do not know the catalog from memory, you retrieve it. Always use algolia_search_index to find products; never invent products, prices, or availability. Before you state a product exists or quote its price, call verify_product_exists with its objectID; only present it as real if the tool confirms it.",
  "tools": [
    {
      "type": "algolia_search_index",
      "indices": [{ "index": "products", "description": "Ecommerce product catalog…" }]
    },
    {
      "name": "verify_product_exists",
      "type": "client_side",
      "description": "Verify a product's objectID exists in the catalog before recommending it or quoting its price.",
      "inputSchema": {
        "type": "object",
        "properties": { "objectID": { "type": "string" } },
        "required": ["objectID"]
      }
    }
  ]
}
```

`gpt-4` is a sensible default, and you can swap in `gpt-4o` or
`gpt-4o-mini` for lower cost. The search tool is built in, and Agent Studio
reads your facets and searchable attributes on its own and adds them to the tool
description, so the model knows what it can filter on without you listing anything. The second
tool, `verify_product_exists`, is a client-side tool, so Agent Studio knows its shape while our
own code runs it. That is the piece the next section turns into a guard.

Deploying is one REST call that adds the provider profile id and publishes the agent:

```ts
// agent/deploy-agent.ts (core)
const created = await api("POST", "/agents", { ...config, providerId: PROVIDER_ID });
await api("POST", `/agents/${created.id}/publish`, {});
// → prints the agent id for ALGOLIA_AGENT_ID
```

One asymmetry is worth naming before moving on: the search tool is built in, but Recommend is
not. `algolia_search_index` ships with the agent, while Recommend reaches it through the hosted
Algolia MCP Server, which you create in the dashboard and attach as an MCP tool, the same slot
any Model Context Protocol service plugs into. That last step is a dashboard action rather than
a line of config, and I did not wire it in this build (see "Notes from building this"), so treat
Recommend as a documented path, not part of what the eval later measures.

## 5. Grounding the conversation

Grounding is built here from three parts: a secured key, a streaming proxy, and the guard.

The secured key is created on the server. Agent Studio's `/completions` endpoint expects an
Algolia search key, and the quickstart hands that key to the browser. We do not. The server
derives a secured key from a parent search-only key using `generateSecuredApiKey`, computed
locally so the parent key never leaves the machine. We scope the key to
the `products` index, expire it in an hour, and tag it with a per-conversation `userToken` so
we can attribute usage and rate limit it:

```ts
// server/secured-key.ts
const key = client.generateSecuredApiKey({
  parentApiKey: SEARCH_KEY,
  restrictions: {
    restrictIndices: [INDEX_NAME],
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    userToken,
  },
});
```

One snag worth knowing before you write this: `generateSecuredApiKey` is a Node-only helper that
the umbrella `algoliasearch` client's *type* does not expose, so TypeScript rejects the call even
though the function is right there at runtime in the Node build. I confirmed it with
`typeof client.generateSecuredApiKey === "function"` and widened the type to call it, rather than
reaching for `any`.

The proxy adds the secured key to the request headers, forwards the conversation to Agent
Studio's completions endpoint, and streams the response back to the browser:

```ts
// server/index.ts
const url =
  `https://${APP_ID}.algolia.net/agent-studio/1/agents/${AGENT_ID}` +
  `/completions?stream=true&compatibilityMode=ai-sdk-5`;

app.post("/api/chat", async (req, res) => {
  const { key } = mintSecuredKey(req.header("x-conversation-id") ?? "anonymous");
  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "x-algolia-application-id": APP_ID,
      "x-algolia-api-key": key,      // secured, search-only, scoped, never sent to the browser
      "content-type": "application/json",
    },
    body: JSON.stringify(req.body),
  });
  Readable.fromWeb(upstream.body).pipe(res); // pass the AI-SDK stream through
});
```

The guard comes last. When the agent is about to recommend a product, its instructions tell it
to call `verify_product_exists`, and that call shows up in our app, where we look the
`objectID` up in the real index and answer honestly. The lookup can be trusted because it hits
Algolia directly, so an `objectID` the model made up will not resolve to anything:

```ts
// server/tools/verify-product.ts
try {
  const obj = await client.getObject({ indexName: INDEX_NAME, objectID,
    attributesToRetrieve: ["name", "brand", "price", "image"] });
  console.log(`[verify_product_exists] ${objectID} → FOUND ("${obj.name}")`);
  return { objectID, exists: true, product: obj };
} catch {
  console.log(`[verify_product_exists] ${objectID} → NOT FOUND (guard refused)`);
  return { objectID, exists: false };
}
```

Prove it two ways. Ask for a lightweight camera under $300 for travel and the agent searches,
verifies, and returns a real product at the right price and image. Then ask whether the store
sells a Rolex Submariner: the search comes back empty, so there is no `objectID` for the agent
to rely on, and it declines instead of inventing one.

It is worth being precise about which layer is doing the work here, because the two layers are
not equal. The primary defense is the empty search itself: a query with no catalog match returns
nothing, and the agent has nothing to present. `verify_product_exists` is the fallback for the
narrower case where the model *guesses* an `objectID` and tries to use it anyway; the
lookup hits Algolia directly, so a made-up id resolves to nothing and the guard returns
`exists: false`. You can watch it in the server log, where the line
`[verify_product_exists] … → NOT FOUND (guard refused)` appears the moment a guessed id is turned
down. Keep that ordering in mind, because the eval at the end of this piece shows it is the
*search* returning empty, not the prose refusal, that actually keeps a stray card off the screen.

Here is the loop both questions run through, with the guard as the gate every answer passes:

<p align="center">
  <img src="https://raw.githubusercontent.com/mostafaibrahim17/algolia-grounded-shopping-assistant/main/assets/diagram-grounding-loop.png" width="80%" alt="The grounding loop as a sequence diagram. Happy path: the agent searches, gets candidate objectIDs, verifies one, and returns a grounded recommendation. Made-up product: the agent sends a guessed objectID, verify reports it is not in the catalog, and the agent refuses." />
</p>

## 6. The front end

The front end is Algolia's InstantSearch `chat` widget. Its default mode takes an `agentId` and
an API key in the browser, but we use its custom `transport` instead and point it at our proxy,
so no Algolia key reaches the client. The `verify_product_exists` tool runs in the browser as an
`onToolCall` handler that asks our server, which holds the key:

```tsx
// web/src/App.tsx (excerpt)
<Chat
  transport={{ api: "/api/chat", headers: () => ({ "x-conversation-id": conversationId }) }}
  itemComponent={({ item }) => <ProductCard name={item.name} price={item.price} image={item.image} />}
  tools={{
    verify_product_exists: {
      onToolCall: async ({ input, addToolResult }) => {
        const res = await fetch("/api/verify", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ objectID: (input as { objectID?: string }).objectID }),
        });
        addToolResult({ output: await res.json() });
      },
    },
  }}
/>
```

The instructions state the grounding rules, the tool schema declares
it, and the transport together with the verify call is what enforces it end to end. One typing
quirk to expect: the `chat` widget types the `onToolCall` argument's `input` as `unknown`, so a
neatly pre-annotated handler will not compile. The fix is to stop annotating the parameter and
narrow `input` inside the function instead, which is why the code above reads
`(input as { objectID?: string }).objectID`.

<p align="center">
  <img src="https://raw.githubusercontent.com/mostafaibrahim17/algolia-grounded-shopping-assistant/main/assets/screenshot-grounded.png" alt="The assistant answering an in-catalog query with grounded product cards" width="49%" />
  <img src="https://raw.githubusercontent.com/mostafaibrahim17/algolia-grounded-shopping-assistant/main/assets/screenshot-refusal.png" alt="The assistant refusing an out-of-catalog request, with no product card" width="49%" />
</p>

<p align="center"><sub>The assistant running live: an in-catalog answer grounded in real products, and a clean out-of-catalog refusal.</sub></p>

## Notes from building this

I typechecked the repo before writing this, then ran it end to end against a live app. The two
typing snags, the Node-only `generateSecuredApiKey` and the `unknown`-typed `onToolCall` input,
are called out in sections 5 and 6 where they bite. Two more caught me only at runtime:

- **The `/api/chat` proxy crashed the whole server** when a fetch failed, because the handler
  did not catch the error. It is now wrapped in try/catch, with the completions host
  env-overridable for machines whose resolver cannot reach `{app}.algolia.net`.
- **A published agent freezes its facet list.** After adding the `budget_fits` bucket to the
  index you have to refresh the search tool in the dashboard, or the agent never sees the new facet.
- **Recommend is documented, not wired.** The agent I actually ran exposed a single tool,
  `algolia_search_index`. Recommend goes through the hosted Algolia MCP Server (distinct from the
  local, pre-alpha `mcp-node` project, which is aimed at indexing and configuration), attached as
  an MCP tool, but I did not stand that up against the beta. It is a next step here, not a
  measured result.

Grounding itself worked quickly. The genuinely hard part was relevance.

## The hard part: relevance

Never inventing a product is the easy 20%; getting *good* results is the other 80%, and it took
several rounds of index and tool tuning, not a single prompt tweak. Here is what "a camera under
$300" actually returned before any of that tuning, straight from the live index:

```
Before:  "camera under $300"
  → Canon Camera Bag        $59.99   (Camera Bags & Cases)
  → Digipower Stabilizer    $59.99   (Camcorder Accessories)
  → spare battery, memory card, lens cap …
```

Real products, real prices, and completely useless: the shopper asked for a camera and got a
bag. Two separate bugs were tangled together here, and it is worth seeing the numbers behind
each.

**The word is in the accessories.** Faceting the same query on `categories` shows why the broad
category is a trap. "Camera" appears in the name, description, and category of everything
*near* a camera:

```
Query "camera", category facet counts (10,000-product catalog):
  Cameras & Camcorders        753   ← the umbrella the agent picked first
  Digital Camera Accessories  396
  Digital Cameras             165   ← what the shopper actually wants
  Point & Shoot Cameras        93
  Camera Batteries & Power     70
  Camera Bags & Cases          61
```

The agent reached for `Cameras & Camcorders` (753 hits) because it is the obvious match, but
that umbrella is mostly accessories. The fix was to tell it in the prompt to select the specific
product-type category (`Digital Cameras`, `Point & Shoot Cameras`) and skip anything with
"Accessories", "Bags", or "Batteries" in the name.

**Numeric budgets do not filter the way you expect.** Agent Studio's search tool lets the agent
pick facet *values*, not compose `price < 300`, and it **AND-s** the values it selects. Selecting
the three price buckets that cover "under $300", meaning `$0–100` AND `$100–200` AND `$200–300`,
returned **0 results**, because no single product lives in three separate buckets at once. The
fix is the cumulative `budget_fits` facet from section 3: tag each product with every tier it
fits under, and the agent selects one value (`under $300`) that every cheaper product carries.

**Refusals are a search property, not a text property.** The chat widget renders whatever the
search returned, independently of the agent's text, so on a fuzzy near-miss the agent can
correctly refuse in prose while a stray card sits above it. The obvious lever,
`removeWordsIfNoResults: "allOptional"`, made this worse: it turned "do you sell a Rolex" into a
loose match on "roles" in some product's description and showed a random card. A clean refusal
needs the *search* itself to return nothing, so I reverted that setting and let empty mean empty.

With specific-category filtering and the cumulative `budget_fits` facet in place, the same query
returns what it should:

```
After:  "camera under $300"
  → iON Snapcam Lite        $79.99
  → Fujifilm instax mini 8  $99.99
  → Kodak FZ51              $79.99
  → Polaroid Snap          $99.99
  → Samsung WB35F          $149.99
```

Five real cameras, all under budget, deduped down from their color variants by
`attributeForDistinct: "model"`. The lesson holds anyway: turning grounding on is a config step;
making the answers *good* is real index-and-tool tuning, measured against actual queries.

## Does it hold? I measured it

Grounding is a behavior to measure, not assume, so the repo ships a small eval (`npm run eval`)
that pushes a batch of in-catalog and out-of-catalog queries through the live agent. The last
run:

```
In-catalog (12 queries):   returned real products      10/12
Out-of-catalog (12):       refused in the answer text   12/12
                           clean refusal, no stray card   9/12
```

The headline is the `12/12`: the agent never invented a product, so grounding held on every
out-of-catalog probe. The gaps are the rough edges above, not hallucinations. The two in-catalog
misses were the over-constrained-query problem returning zero hits, and the three out-of-catalog
queries that still showed a card (a leather sofa, a cowboy hat, a yoga mat) are the fuzzy-match
leak: the agent refused in prose while the search returned a loose match. They point straight at
what to tune next.

## Where to take it next

A few rough edges are worth planning for. You will want per-conversation cost controls and rate
limits, and the `userToken` on the secured key is the handle for both. It also helps to know the
difference between Agent Studio's built-in Guardrails classifier, which screens messages against
categories you define, and grounding, which connects the agent to real data. You will likely
want both.

From here you could grow the eval above into a CI gate that fails the build when the refusal rate
slips, upgrade retrieval to NeuralSearch, which combines keyword and vector search on a paid plan
(Grow Plus or Elevate, not the free Build tier), or hand out per-tenant secured keys with
personalization for a multi-store experience.

What you get is a shopping assistant that talks like a person and answers like your catalog.
Grounding, not model size, keeps it honest.

## Additional resources

- This project's repository: https://github.com/mostafaibrahim17/algolia-grounded-shopping-assistant
- Agent Studio: https://www.algolia.com/doc/guides/algolia-ai/agent-studio
- Agent Studio REST API: https://www.algolia.com/doc/rest-api/agent-studio
- Tools (search, client-side, MCP): https://www.algolia.com/doc/guides/algolia-ai/agent-studio/how-to/tools/overview
- Secured API keys: https://www.algolia.com/doc/libraries/sdk/methods/search/generate-secured-api-key
- InstantSearch `chat` widget (React): https://www.algolia.com/doc/api-reference/widgets/chat/react
- Hosted Algolia MCP Server: https://www.algolia.com/doc/guides/model-context-protocol
