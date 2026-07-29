/**
 * §5 — The out-of-index guard.
 *
 * `verify_product_exists` is a client-side tool declared on the agent. When the
 * assistant is about to commit to a product, it calls this tool with an objectID;
 * we look the object up in the index (server-side, with the search-only key) and
 * return whether it really exists plus its canonical fields. The agent is
 * instructed to refuse any product this tool can't confirm — so an answer is
 * grounded in the catalog or it doesn't happen.
 *
 * The lookup is authoritative because it hits the real index: a hallucinated
 * objectID simply won't resolve.
 */
import { algoliasearch } from "algoliasearch";

const APP_ID = requireEnv("ALGOLIA_APP_ID");
const SEARCH_KEY = requireEnv("ALGOLIA_SEARCH_KEY");
const INDEX_NAME = process.env.ALGOLIA_INDEX_NAME ?? "products";

const client = algoliasearch(APP_ID, SEARCH_KEY);

export interface VerifyResult {
  objectID: string;
  exists: boolean;
  product?: {
    name?: string;
    brand?: string;
    price?: number;
    image?: string;
  };
}

/** Look an objectID up in the catalog. Returns exists:false if it isn't there. */
export async function verifyProductExists(objectID: string): Promise<VerifyResult> {
  try {
    const obj = (await client.getObject({
      indexName: INDEX_NAME,
      objectID,
      attributesToRetrieve: ["name", "brand", "price", "image"],
    })) as Record<string, unknown>;

    // Make the guard observable: log every confirmation so a reader can see it fire.
    console.log(`[verify_product_exists] ${objectID} → FOUND ("${obj.name}")`);
    return {
      objectID,
      exists: true,
      product: {
        name: obj.name as string | undefined,
        brand: obj.brand as string | undefined,
        price: obj.price as number | undefined,
        image: obj.image as string | undefined,
      },
    };
  } catch (err: unknown) {
    // A missing object throws (404). Treat any lookup failure as "not in catalog".
    console.log(`[verify_product_exists] ${objectID} → NOT FOUND (guard refused)`);
    return { objectID, exists: false };
  }
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
