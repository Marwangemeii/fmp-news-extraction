/**
 * JSON Schemas for structured outputs (D35): the API guarantees the reply parses and matches these.
 * API rules: every object has additionalProperties: false and lists all its keys in `required`,
 * and a schema may have at most 16 union-typed fields (anyOf, or a type list like ['string', 'null']).
 * So the extract schema has NO nulls: a value that isn't stated is left out of the list, an unknown enum
 * is "unknown"/"none". src/blocks/label-llm.js maps those back to null.
 */

const str = { type: 'string' };
const enumOf = (values) => ({ type: 'string', enum: values });
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const ticker = object({ ticker: str, exchange: { type: ['string', 'null'] }, evidence: str });

export const CLASSIFY_SCHEMA = object({
  labels: { type: 'array', items: object({ label: enumOf(['earnings', 'dividends', 'splits', 'ipos']), evidence: str }) },
  symbol: { anyOf: [ticker, { type: 'null' }] },
  relatedSymbols: { type: 'array', items: ticker },
});

/**
 * Every value field the extractor can return, by event type. The extractor returns a flat list
 * of { field, raw, evidence } and simply leaves out what the article doesn't state. A flat list keeps
 * the schema small (the API rejects a large compiled grammar) and needs no nulls.
 */
export const VALUE_FIELDS = {
  earnings: ['period', 'fiscalYear', 'fiscalDateEnding', 'date', 'time'],
  dividends: ['dividend', 'declarationDate', 'exDividendDate', 'recordDate', 'paymentDate'],
  splits: ['ratio', 'effectiveDate'],
  ipos: ['company', 'exchange', 'firstTradingDate', 'shares', 'priceRange', 'pricePerShare', 'marketCap'],
};
const FIELD_NAMES = Object.entries(VALUE_FIELDS).flatMap(([label, fields]) => fields.map((f) => `${label}.${f}`));

const figure = object({
  metric: enumOf(['eps', 'revenue']),
  period: str, // the period this figure belongs to, as written ("fourth quarter", "fiscal 2026"), or ""
  raw: str,
  evidence: str,
  basis: enumOf(['GAAP', 'IFRS', 'adjusted', 'unknown']),
  kind: enumOf(['actual', 'estimate', 'previous']),
  perShare: enumOf(['diluted', 'basic', 'unknown']),
});

export const EXTRACT_SCHEMA = object({
  values: { type: 'array', items: object({ field: enumOf(FIELD_NAMES), raw: str, evidence: str }) },
  figures: { type: 'array', items: figure },
  ipoAction: object({ value: enumOf(['filed', 'expected', 'priced', 'postponed', 'withdrawn', 'none']), evidence: str }),
});

/** Union-typed fields in a schema (the API allows at most 16). Used by a test. */
export function countUnions(schema) {
  if (!schema || typeof schema !== 'object') return 0;
  const here = (Array.isArray(schema.type) ? 1 : 0) + (schema.anyOf ? 1 : 0);
  return here + Object.values(schema).reduce((n, v) => n + (Array.isArray(v) ? v.reduce((m, x) => m + countUnions(x), 0) : countUnions(v)), 0);
}
