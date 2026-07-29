/**
 * §5 — The chat front end.
 *
 * A React InstantSearch app with the `chat` widget wired to our proxy via a
 * custom transport. The `verify_product_exists` client-side tool runs here in
 * the browser: when the agent calls it, we ask our server (which owns the key)
 * whether the product is really in the index, and hand the answer back to the
 * agent. That's the out-of-index guard, closing the loop the agent instructions
 * opened.
 *
 * Note: the `chat` widget is beta — its API may change in minor versions.
 */
import { InstantSearch, Chat, ChatTrigger } from "react-instantsearch";
import "instantsearch.css/components/chat.css";
import { chatTransport } from "./chatTransport";

// The chat flow never searches from the browser (results arrive through the
// agent's tool calls in the completions stream), so InstantSearch doesn't need
// a real, key-bearing search client here. This stub satisfies the API while
// keeping every Algolia credential server-side. If you add classic widgets
// (a results grid, facets), fetch a secured key from a /api/secured-key route
// and build a real client instead.
const searchClient = {
  search: () =>
    Promise.resolve({
      results: [{ hits: [], nbHits: 0, page: 0, nbPages: 0, processingTimeMS: 0 }],
    }),
} as unknown as Parameters<typeof InstantSearch>[0]["searchClient"];

interface ProductHit {
  objectID: string;
  name?: string;
  brand?: string;
  price?: number;
  image?: string;
}

export function App() {
  return (
    <InstantSearch searchClient={searchClient} indexName="products">
      <header style={{ padding: "1rem 1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Grounded Shopping Assistant</h1>
        <p style={{ margin: "0.25rem 0 0", color: "#666" }}>
          Ask in full sentences — e.g. "a lightweight camera under $300 for travel".
        </p>
      </header>

      <Chat
        transport={chatTransport}
        // Render each product the search tool returns, from the real index fields.
        itemComponent={({ item }: { item: ProductHit }) => (
          <div className="product-card">
            {item.image && <img src={item.image} alt={item.name} width={64} height={64} />}
            <div>
              <strong>{item.name}</strong>
              {item.brand && <div style={{ color: "#666" }}>{item.brand}</div>}
              {typeof item.price === "number" && <div>${item.price}</div>}
            </div>
          </div>
        )}
        // The out-of-index guard. The agent calls this before committing to a
        // product; we verify server-side and return the result.
        tools={{
          verify_product_exists: {
            onToolCall: async ({ input, addToolResult }) => {
              const objectID = (input as { objectID?: string })?.objectID ?? "";
              const res = await fetch("/api/verify", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ objectID }),
              });
              addToolResult({ output: await res.json() });
            },
          },
        }}
      />
      <ChatTrigger />
    </InstantSearch>
  );
}
