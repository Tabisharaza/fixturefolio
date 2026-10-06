# Contributing to FixtureFolio

A useful contribution can be a five-line regression test, a clearer explanation,
an accessibility fix, or a well-chosen synthetic scenario. You do not need to add
a provider integration to help.

## Get a working checkout

Use Node.js 24 LTS, version 24.15 or newer in the 24.x line. The supported
Node.js range is `^24.15.0 || >=26.0.0`.

```sh
npm ci
npm run dev
npm run check
```

For browser tests, install Playwright's Chromium once, then run the suite:

```sh
npx playwright install chromium
npm run test:e2e
```

Some Linux environments also need Playwright's documented system dependencies.
The browser-test configuration starts the development server automatically.
`npm run check` covers lint, type checking, core and UI interaction tests, and
the production build; it does not include browser tests or formatting. Use
`npm run format:check` to check formatting and `npm run format` to apply it.

## Pick a small change

Open an issue first for a large feature, a new dependency, changes to the export
format, or any networking/persistence proposal. For a focused bug fix, a pull
request with a failing test and the fix is a good starting point.

Describe the problem, the changed behavior, and the checks you actually ran.
Include a screenshot for visible UI changes. Avoid unrelated formatting changes
and do not report a check as passed if it was skipped or blocked.

## Add a provider or scenario

The sample registry is `src/data/examples.ts`. Each entry implements
`FixtureExample`, with a stable `id`, a readable `name`, `provider`, `description`,
and typed `before`/`after` values (`JsonValue`). Add the entry to `examples`.

- Invent all values. Use reserved example domains and clearly synthetic IDs.
  Never copy a customer event or a live credential into a sample.
- Link the relevant official provider documentation in the PR. Explain any
  deliberate simplification or invalid shape used to exercise a regression.
- Make the scenario teach one clear behavior: an added field, a type change,
  a nested removal, or an array-position change.
- Add tests for the paths and redactions you expect, including at least one
  value that should remain unchanged.
- Keep samples small enough to read. A provider name does not imply schema
  validation, an API connection, or endorsement.

## Change a redaction rule

Pure processing lives in `src/core/index.ts`. The public types include
`JsonValue`, `Redaction`, `Change`, `FixtureManifest`, and `FixtureBundle`.
`SENSITIVE_KEY_RULES` contains normalized exact field-name matches; string pattern
checks live in `redactJson`.

For a new detector:

1. State the specific pattern it detects and its known blind spots.
2. Give matches a clear reason in the `Redaction.reasons` list.
3. Test matching values, nearby non-matches, mixed casing where relevant, nested
   values, and arrays. Include a false-positive regression case.
4. Check that redaction does not mutate the input, and that neither the manifest
   nor an error message includes original sensitive values.
5. Keep the rule deterministic and local. Review pathological inputs before
   adding complex regular expressions.
6. Update `RULE_VERSION` when detection behavior changes and document any output
   compatibility impact.

An explicit JSON Pointer is often a better fit for a project-specific field than
a broad built-in rule. Detector proposals should improve a concrete use case
without silently removing unrelated test data.

## Change parsing, diffing, or export

Preserve the documented distinction between an absent property and a property
whose value is `null`. Object key order is irrelevant; arrays are positional.
JSON Pointer escaping must round-trip keys containing `/` and `~`.

Cover root values, empty containers, nested type changes, invalid JSON, size/depth
and structural-value limits, unsafe keys, and numeric limits when relevant. The
10,000-value budget applies to each complete document, including its root; it
must not reset for sibling arrays or objects. For paginated UI changes, test
page navigation and review-state resets when inputs or rules change. For exports,
test the manifest as well as the redacted values. A breaking manifest change needs an
explicit schema-version decision and updated documentation.

See [the architecture notes](docs/ARCHITECTURE.md) for boundaries and tradeoffs.

## Keep the project safe to review

Never include real customer data, secrets, private URLs, or identifying payloads
in issues, tests, screenshots, or pull requests. Use [SECURITY.md](SECURITY.md) for
sensitive reports. Be kind and specific in review: explain the behavior and the
tradeoff, and help the next contributor reproduce it.

By contributing, you agree that your contribution is provided under the project's
[MIT license](LICENSE). Only submit work you have the right to contribute.
