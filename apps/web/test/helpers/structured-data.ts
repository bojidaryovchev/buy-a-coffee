import { SCHEMA_PROPERTIES } from "./schema-vocabulary";

/**
 * An offline check of the JSON-LD a page publishes: what the Rich Results Test
 * and the Schema Markup Validator would complain about, without either.
 *
 * Two layers:
 *
 *  - **The vocabulary.** Every node's `@type` is one this storefront emits and
 *    schema.org defines, and every property on it is one schema.org allows on
 *    that type (`schema-vocabulary.ts`, generated from schema.org). A typo, a
 *    property on the wrong type, or a new type nobody added here fails.
 *  - **Google's requirements** for the rich results the shop can earn — a
 *    product's offer, a breadcrumb trail, an article, the organisation — and
 *    the mistakes this repository has actually shipped: a plain-string
 *    `weight`, a URL nested inside another (`https://site/https://blob/…`), an
 *    `@id` reference to a node that is not on the page.
 *
 * Used by the unit tests on the builders and by the browser suite on the
 * blocks a production build sends (`e2e/structured-data.spec.ts`).
 */

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ENUMERATED = new Set([
  "availability",
  "itemCondition",
  "returnPolicyCategory",
  "returnFees",
  "returnMethod",
  "dayOfWeek",
]);
const URL_KEYS = new Set(["url", "item", "image", "logo", "sameAs", "urlTemplate"]);
const ABSOLUTE = /^https?:\/\/[^/\s]+/;
const NESTED_URL = /^https?:\/\/[^/]+\/+https?:/i;

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** Every problem found in a page's JSON-LD blocks; empty when there is none. */
export function checkStructuredData(blocks: readonly unknown[]): string[] {
  const problems: string[] = [];
  const defined = new Set<string>();
  const referenced: Array<{ id: string; at: string }> = [];

  const visit = (node: Node, at: string) => {
    const type = node["@type"];
    const id = typeof node["@id"] === "string" ? node["@id"] : null;
    const keys = Object.keys(node).filter((key) => !key.startsWith("@"));

    if (type === undefined) {
      // A bare `{ "@id": … }` is a reference; anything else needs a type.
      if (id && keys.length === 0) {
        if (id.includes("#")) referenced.push({ id, at });
      } else problems.push(`${at}: a node with no @type`);
    } else if (typeof type !== "string") {
      problems.push(`${at}: @type must be one type, got ${JSON.stringify(type)}`);
    } else {
      const allowed = SCHEMA_PROPERTIES[type];
      if (!allowed) problems.push(`${at}: @type ${type} is not one this shop emits`);
      else {
        for (const key of keys) {
          // `query-input` annotates an Action's `query`: valid where `query` is.
          const property = key.replace(/-(input|output)$/, "");
          if (!allowed.includes(property)) problems.push(`${at}: ${type} has no property "${key}"`);
        }
      }
      if (id) {
        // A typed node with nothing but a name and its id is a reference too.
        // `#organization`, `#website`: ids minted for a node, which must be on
        // the page. An id that is a page's own address names that page.
        if (keys.every((key) => key === "name")) {
          if (id.includes("#")) referenced.push({ id, at });
        } else defined.add(id);
      }
      problems.push(...requirements(type, node, at));
    }

    if (id && !ABSOLUTE.test(id)) problems.push(`${at}: @id ${id} is not an absolute URL`);

    for (const key of keys) {
      const value = node[key];
      const path = `${at}.${key}`;
      if (value === undefined || value === null || value === "") {
        problems.push(`${path}: empty`);
        continue;
      }
      if (Array.isArray(value) && value.length === 0) problems.push(`${path}: an empty list`);
      for (const [index, entry] of asList(value).entries()) {
        const where = Array.isArray(value) ? `${path}[${index}]` : path;
        if (isNode(entry)) visit(entry, where);
        else if (typeof entry === "string") {
          if (URL_KEYS.has(key) && !ABSOLUTE.test(entry))
            problems.push(`${where}: ${entry} is not an absolute URL`);
          if (NESTED_URL.test(entry)) problems.push(`${where}: a URL inside a URL: ${entry}`);
          if (ENUMERATED.has(key) && !entry.startsWith("https://schema.org/"))
            problems.push(`${where}: ${entry} is not a schema.org enumeration member`);
        }
      }
    }
  };

  blocks.forEach((block, index) => {
    const at = `block ${index}`;
    if (!isNode(block)) {
      problems.push(`${at}: not an object`);
      return;
    }
    if (block["@context"] !== "https://schema.org")
      problems.push(`${at}: @context is ${JSON.stringify(block["@context"])}`);
    visit(block, at);
  });

  for (const { id, at } of referenced) {
    if (!defined.has(id))
      problems.push(`${at}: refers to ${id}, which no block on the page defines`);
  }
  return problems;
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** Google's required properties, per rich result, and the shapes it rejects. */
function requirements(type: string, node: Node, at: string): string[] {
  const problems: string[] = [];
  const need = (key: string, ok: (value: unknown) => boolean = (value) => value !== undefined) => {
    if (!ok(node[key])) problems.push(`${at}: ${type} needs a valid "${key}"`);
  };

  switch (type) {
    case "Product":
      need("name", text);
      // Google's product snippet needs one of offers, review or aggregateRating;
      // this shop has no reviews, so it is the offer or nothing — and a page
      // with no price publishes no offer, so it is not a candidate either.
      if ("weight" in node && !isNode(node.weight))
        problems.push(`${at}: Product.weight must be a QuantitativeValue, not text`);
      if ("gtin" in node && !/^(\d{8}|\d{12,14})$/.test(String(node.gtin)))
        problems.push(`${at}: Product.gtin ${String(node.gtin)} is not 8, 12, 13 or 14 digits`);
      break;
    case "Offer":
      need("price", (value) => typeof value === "string" && /^\d+(\.\d+)?$/.test(value));
      need("priceCurrency", (value) => typeof value === "string" && /^[A-Z]{3}$/.test(value));
      need("availability", text);
      break;
    case "QuantitativeValue":
      if ("value" in node) need("value", (value) => typeof value === "number" && value > 0);
      if (!("value" in node) && !("minValue" in node))
        problems.push(`${at}: QuantitativeValue with no value`);
      need("unitCode", text);
      break;
    case "BreadcrumbList":
    case "ItemList": {
      const items = asList(node.itemListElement).filter(isNode);
      if (items.length === 0) problems.push(`${at}: ${type} lists nothing`);
      items.forEach((item, index) => {
        if (item.position !== index + 1)
          problems.push(`${at}: item ${index} has position ${String(item.position)}`);
        if (!text(item.name) && type === "BreadcrumbList")
          problems.push(`${at}: breadcrumb ${index} has no name`);
        if (type === "BreadcrumbList" && !text(item.item))
          problems.push(`${at}: breadcrumb ${index} has no item URL`);
        if (type === "ItemList" && !text(item.url) && !isNode(item.item))
          problems.push(`${at}: list item ${index} has no url`);
      });
      break;
    }
    case "Organization":
      need("name", text);
      if (at.startsWith("block") && !at.includes(".")) {
        // The organisation itself, not a reference to it.
        need("url", text);
        need("logo", (value) => isNode(value) || text(value));
      }
      break;
    case "Article":
      need("headline", (value) => text(value) && value.length <= 110);
      need("image");
      need("datePublished", (value) => text(value) && !Number.isNaN(Date.parse(value)));
      break;
    case "WebSite":
      need("name", text);
      need("url", text);
      break;
    default:
      break;
  }
  return problems;
}
