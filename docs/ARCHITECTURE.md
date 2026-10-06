# Architecture and behavior

FixtureFolio is a static React/TypeScript application. The browser owns the
working session. There is no payload-processing server or provider API client.

## The boundaries

- `src/data/examples.ts`: typed, invented before/after scenarios.
- `src/core/index.ts`: pure parsing, JSON Pointer handling, diffing, redaction,
  and bundle construction. No React, persistence, logging, or network calls.
- The React UI: input state, file reads, presentation, review acknowledgement,
  clipboard actions, and downloads.
- Vite: local development and a static production build.

Keep new provider samples in the data layer and reusable processing rules in the
core. Adding a provider sample should not require a network request or credentials.

## Processing model

`parseJson(text)` accepts JSON values, including primitive roots. It bounds UTF-8
input size to 262,144 bytes, nesting depth to 40, and structural values to 10,000
per document. The root is at depth zero and counts as one value. Each child value
in an object or array also counts, including containers; keys do not count
separately. For example, `{"items": [1, 2]}` has four values. The budget covers the
whole document, not each branch independently.

It rejects non-finite numbers, integers outside JavaScript's safe range, and
`__proto__`, `prototype`, or `constructor` object keys. JSON still uses JavaScript
number semantics; encode large IDs or exact decimal values as strings.

`compareJson(before, after)` returns a deterministic list of `Change` records:
`added`, `removed`, `changed`, or `type-changed`. Each has a JSON Pointer `path`.
Object keys are compared in sorted order and arrays by index. Adding or removing
an entire container produces a change at that container's path; it does not
expand into a separate record for every child.

`redactJson(value, customPaths)` creates a new value and a list of `Redaction`
records. A match replaces the whole value with `[REDACTED]`, including a matching
container. The review records the matching path and reasons, without the original
value. Children of a replaced container are not visited or individually reported.

`createBundle(before, after, provider, scenario, customPaths)` returns redacted
`before`/`after` values and a schema-versioned manifest. It records changed paths
from the original inputs without recording their values. Provider and scenario
are user-supplied labels, not inferred or validated provider schemas.

## Bounded presentation

The UI displays code previews in pages of 200 lines, change lists in pages of
100 records, and redaction lists in pages of 50 unique paths. Pagination bounds
the number of rendered rows; it does not truncate the analysis or export. Copy
and download actions use the complete sanitized values and manifest. Review all
pages before acknowledging an export. The checkbox records a human decision;
it does not prove that every page was read or that all sensitive data was found.

## Pointer semantics

Pointers use RFC 6901's string representation. `/a~1b/~0tag` selects the key `~tag`
inside the key `a/b`. URI-fragment pointers such as `#/a` are not supported.

- Core functions accept `''` for the document root. `/` selects an empty-string key.
- UI custom rules use one non-empty pointer per line; a blank line is ignored.
  Whole-document redaction is therefore a core-only capability.
- Invalid syntax fails the operation. A valid unmatched path makes no change.
- Paths match exactly. There are no wildcards or JSONPath expressions.
- A rule that replaces a parent also covers its children; only the parent match
  appears in the review.

## Export contract

`FixtureBundle` holds the two redacted values plus `FixtureManifest`:

```ts
{
  schemaVersion: 1;
  provider: string;
  scenario: string;
  ruleVersion: string;
  redactions: {
    before: { path: string; reasons: string[] }[];
    after: { path: string; reasons: string[] }[];
  };
  changes: { type: 'added' | 'removed' | 'changed' | 'type-changed'; path: string }[];
}
```

The manifest records matches, not a security certificate or a full provider
schema. It does not include original field values. Object keys can be sensitive,
so a path-only manifest can still need manual cleanup. Provider/scenario labels
must also be reviewed before sharing.

## Intentional tradeoffs

- Positional arrays are predictable, but an insertion near the beginning can
  produce several changes. Identity-aware or sequence-aware diffing would need
  explicit semantics and tests.
- Whole-value redaction is easy to inspect, but may change types and remove a
  meaningful assertion target. The person writing the test makes that decision.
- The browser keeps the working state in memory. Refreshing starts a new session;
  explicit copies and downloads leave the app's memory boundary.
- Exported JSON is reserialized and may be redacted. Original raw-body signature
  tests belong at a separate boundary with synthetic data and test-only secrets.

Keep these limits visible when extending the app. A broader rule set is not a
guarantee of anonymity.
