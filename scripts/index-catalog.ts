/**
 * §3 — Provision & shape the catalog.
 *
 * Downloads Algolia's public 10k ecommerce demo dataset (a curated Best Buy
 * subset) and indexes it with the algoliasearch v5 client. Sets searchable
 * attributes and facets so the agent's `algolia_search_index` tool can do
 * faceted, conversational retrieval.
 *
 * Run: npm run index
 * Requires: ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY, ALGOLIA_INDEX_NAME
 *
 * The Admin key is used ONLY here, in this one-off script — never in the server
 * or the browser.
 */
import "dotenv/config";
import { algoliasearch } from "algoliasearch";

const RECORDS_URL =
  "https://raw.githubusercontent.com/algolia/datasets/master/ecommerce/records.json";

const APP_ID = requireEnv("ALGOLIA_APP_ID");
const ADMIN_KEY = requireEnv("ALGOLIA_ADMIN_KEY");
const INDEX_NAME = process.env.ALGOLIA_INDEX_NAME ?? "products";

/** A single record in the Algolia ecommerce demo dataset. */
interface ProductRecord {
  objectID: string;
  name: string;
  description?: string;
  brand?: string;
  categories?: string[];
  hierarchicalCategories?: Record<string, string>;
  price?: number;
  image?: string;
  url?: string;
  free_shipping?: boolean;
  popularity?: number;
  rating?: number;
  [key: string]: unknown;
}

async function main() {
  const client = algoliasearch(APP_ID, ADMIN_KEY);

  console.log(`↓ Fetching demo catalog from ${RECORDS_URL}`);
  const res = await fetch(RECORDS_URL);
  if (!res.ok) {
    throw new Error(`Failed to download dataset: ${res.status} ${res.statusText}`);
  }
  const records = (await res.json()) as ProductRecord[];
  console.log(`  ${records.length} records loaded`);

  // Shape the index so retrieval matches how shoppers actually ask:
  // full-text over name/description/brand, facets over the structured fields.
  console.log(`⚙ Configuring index settings for "${INDEX_NAME}"`);
  await client.setSettings({
    indexName: INDEX_NAME,
    indexSettings: {
      searchableAttributes: [
        "name",
        "description",
        "brand",
        "categories",
      ],
      attributesForFaceting: [
        "searchable(brand)",
        // searchable() so the agent's facet-value lookup (algolia_search_for_facet_values)
        // works — otherwise it errors and the agent gives up on the whole query.
        "searchable(categories)",
        "free_shipping",
        "filterOnly(price)",
        // Cumulative "fits under $X" tiers. The agent selects ONE value
        // ("under $300") and every product tagged with it matches. This avoids
        // the multi-select-AND problem: Agent Studio ANDs selected facet values,
        // so disjoint price buckets ("$0–100" AND "$100–200" AND …) match nothing.
        // searchable() so the agent's facet-value lookup works (see categories above).
        "searchable(budget_fits)",
      ],
      customRanking: ["desc(popularity)", "desc(rating)"],
      // Collapse color/finish variants of the same product into one result, so a
      // camera search returns different cameras, not one camera in six colors.
      attributeForDistinct: "model",
      distinct: true,
      // Return only what the assistant needs to render/verify a product.
      attributesToRetrieve: [
        "objectID",
        "name",
        "brand",
        "categories",
        "price",
        "image",
        "url",
        "rating",
      ],
    },
  });

  // Tag each product with every "under $X" tier it satisfies, so the agent can
  // filter to a budget by selecting a single facet value.
  const enriched = records.map((r) => ({
    ...r,
    budget_fits: budgetFits(r.price),
    model: modelOf(r.name),
  }));

  console.log(`↑ Indexing ${records.length} records…`);
  await client.saveObjects({
    indexName: INDEX_NAME,
    objects: enriched as unknown as Record<string, unknown>[],
    waitForTasks: true,
  });

  console.log(
    `✓ Done. Indexed ${records.length} products into "${INDEX_NAME}". ` +
      `Check them in the Algolia dashboard → Search → Index.`,
  );
}

/** The product model, used to dedupe variants: drop the trailing "- Color" from
 *  "Brand - Product - Color" names, but leave two-part names ("Brand - Product") whole. */
function modelOf(name?: string): string | undefined {
  if (!name) return undefined;
  const parts = name.split(" - ");
  return parts.length >= 3 ? parts.slice(0, -1).join(" - ") : name;
}

/** Every "under $X" budget tier a price satisfies (a $79 item fits under 100..5000). */
function budgetFits(price?: number): string[] {
  if (typeof price !== "number" || Number.isNaN(price)) return [];
  return [100, 200, 300, 500, 1000, 2000, 5000]
    .filter((tier) => price < tier)
    .map((tier) => `under $${tier}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("Your")) {
    console.error(
      `Missing env var ${name}. Copy .env.example to .env and fill it in.`,
    );
    process.exit(1);
  }
  return value;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
