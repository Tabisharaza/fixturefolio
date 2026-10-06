import { describe, expect, it } from "vitest";
import {
  compareJson,
  createBundle,
  escapePointerSegment,
  FixtureError,
  joinPointer,
  MAX_DEPTH,
  MAX_INPUT_BYTES,
  MAX_NODES,
  parseJson,
  parsePointer,
  redactJson,
  REDACTION_MARKER,
  RULE_VERSION,
} from "./index";
import type { JsonValue } from "./index";
import { examples, githubExample, stripeExample } from "../data/examples";

function nested(depth: number): JsonValue {
  let value: JsonValue = "leaf";
  for (let index = 0; index < depth; index++) value = { child: value };
  return value;
}

describe("bounded safe JSON parsing", () => {
  it.each([
    ["null", null],
    ["false", false],
    ["0", 0],
    ['"hello"', "hello"],
    ["[1,true,null]", [1, true, null]],
    ['{"count":1}', { count: 1 }],
  ])("parses the JSON value %s", (source, expected) => {
    expect(parseJson(source as string)).toEqual(expected);
  });

  it("rejects blank and malformed input with useful errors", () => {
    expect(() => parseJson("  \n ")).toThrow("Paste a JSON payload");
    expect(() => parseJson('{"ok":}')).toThrow("Invalid JSON");
    expect(() => parseJson('{"ok":1,}')).toThrow(FixtureError);
    expect(() => parseJson("undefined")).toThrow("Invalid JSON");
  });

  it("does not echo secret values in syntax error text", () => {
    try {
      parseJson("SECRET_never_echo_this is not json");
      throw new Error("Expected parser rejection");
    } catch (error) {
      expect((error as Error).message).not.toContain("SECRET_never_echo_this");
    }
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects %s recursively",
    (key) => {
      expect(() =>
        parseJson(`{"safe":[{"${key}":{"polluted":true}}]}`),
      ).toThrow("Unsafe property");
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    },
  );

  it("rejects escaped unsafe keys after decoding", () => {
    expect(() => parseJson('{"\\u005f_proto__":true}')).toThrow(
      "Unsafe property",
    );
    expect(() => parseJson('{"constr\\u0075ctor":true}')).toThrow(
      "Unsafe property",
    );
  });

  it("allows exactly the byte limit but rejects one byte more", () => {
    expect(parseJson(`"${"a".repeat(MAX_INPUT_BYTES - 2)}"`)).toHaveLength(
      MAX_INPUT_BYTES - 2,
    );
    expect(() => parseJson(`"${"a".repeat(MAX_INPUT_BYTES - 1)}"`)).toThrow(
      "256 KiB",
    );
  });

  it("measures UTF-8 bytes rather than JavaScript string length", () => {
    const source = `"${"😀".repeat(70_000)}"`;
    expect(source.length).toBeLessThan(MAX_INPUT_BYTES);
    expect(() => parseJson(source)).toThrow("256 KiB");
  });

  it("accepts the maximum path depth and rejects the next depth", () => {
    expect(parseJson(JSON.stringify(nested(MAX_DEPTH)))).toEqual(
      nested(MAX_DEPTH),
    );
    expect(() => parseJson(JSON.stringify(nested(MAX_DEPTH + 1)))).toThrow(
      "maximum depth",
    );
  });

  it("allows exactly 10,000 nodes including root and rejects the next value below the byte limit", () => {
    const atLimit = Array(MAX_NODES - 1).fill(0) as JsonValue[];
    const overLimit = [...atLimit, 0];
    expect(
      new TextEncoder().encode(JSON.stringify(overLimit)).byteLength,
    ).toBeLessThan(MAX_INPUT_BYTES);
    expect(parseJson(JSON.stringify(atLimit))).toEqual(atLimit);
    expect(() => parseJson(JSON.stringify(overLimit))).toThrow(
      "maximum of 10,000 nodes",
    );
  });

  it("shares the node budget across nested arrays and sibling branches", () => {
    // Root + two nested arrays + 4,999 values + 4,998 values = 10,000.
    const atLimit = [
      Array(4_999).fill(null),
      Array(4_998).fill(false),
    ] as JsonValue[];
    expect(parseJson(JSON.stringify(atLimit))).toEqual(atLimit);
    (atLimit[1] as JsonValue[]).push(false);
    expect(() => parseJson(JSON.stringify(atLimit))).toThrow("10,000 nodes");
  });

  it("counts object values but not property names as structural nodes", () => {
    const atLimit = Object.fromEntries(
      Array.from({ length: MAX_NODES - 1 }, (_, index) => [`k${index}`, null]),
    );
    expect(
      new TextEncoder().encode(JSON.stringify(atLimit)).byteLength,
    ).toBeLessThan(MAX_INPUT_BYTES);
    expect(parseJson(JSON.stringify(atLimit))).toEqual(atLimit);
    expect(() =>
      parseJson(JSON.stringify({ ...atLimit, extra: null })),
    ).toThrow("10,000 nodes");
  });

  it("rejects numeric overflow and unsafe integers", () => {
    expect(() => parseJson("1e309")).toThrow("finite JavaScript range");
    expect(() => parseJson("9007199254740993")).toThrow(
      "safe JavaScript range",
    );
    expect(parseJson("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseJson('"9007199254740993"')).toBe("9007199254740993");
    expect(parseJson("0.25")).toBe(0.25);
  });
});

describe("semantic JSON comparison", () => {
  it("ignores object key order recursively", () => {
    expect(
      compareJson({ b: { y: 2, x: 1 }, a: 1 }, { a: 1, b: { x: 1, y: 2 } }),
    ).toEqual([]);
  });

  it("reports all four change types in stable key order", () => {
    expect(compareJson({ d: 1, b: 2, c: "1" }, { a: 1, b: 3, c: 1 })).toEqual([
      { type: "added", path: "/a" },
      { type: "changed", path: "/b" },
      { type: "type-changed", path: "/c" },
      { type: "removed", path: "/d" },
    ]);
  });

  it("represents whole added and removed subtrees by their root path", () => {
    expect(
      compareJson({ removed: { nested: [1, 2] } }, { added: { nested: true } }),
    ).toEqual([
      { type: "added", path: "/added" },
      { type: "removed", path: "/removed" },
    ]);
  });

  it("compares arrays by position, preserving significant order", () => {
    expect(compareJson(["a", "b"], ["b", "a", "c"])).toEqual([
      { type: "changed", path: "/0" },
      { type: "changed", path: "/1" },
      { type: "added", path: "/2" },
    ]);
    expect(compareJson([1, 2, 3], [1])).toEqual([
      { type: "removed", path: "/1" },
      { type: "removed", path: "/2" },
    ]);
  });

  it("distinguishes null, arrays, objects, numbers, and strings", () => {
    expect(compareJson(null, {})).toEqual([{ type: "type-changed", path: "" }]);
    expect(compareJson([], {})).toEqual([{ type: "type-changed", path: "" }]);
    expect(compareJson(1, "1")).toEqual([{ type: "type-changed", path: "" }]);
    expect(compareJson(null, null)).toEqual([]);
    expect(compareJson(0, -0)).toEqual([]);
    expect(compareJson("before", "after")).toEqual([
      { type: "changed", path: "" },
    ]);
  });

  it("escapes slashes and tildes in paths", () => {
    expect(
      compareJson({ "a/b": { "~key": true } }, { "a/b": { "~key": false } }),
    ).toEqual([{ type: "changed", path: "/a~1b/~0key" }]);
  });

  it("does not mutate inputs", () => {
    const before = Object.freeze({
      a: Object.freeze([1, 2]),
    }) as unknown as JsonValue;
    const after = Object.freeze({
      a: Object.freeze([2, 3]),
    }) as unknown as JsonValue;
    expect(compareJson(before, after)).toHaveLength(2);
  });

  it("revalidates programmatic inputs to reject unsafe keys and excessive depth", () => {
    expect(() => compareJson(JSON.parse('{"__proto__":1}'), {})).toThrow(
      "Unsafe property",
    );
    expect(() => compareJson({}, nested(MAX_DEPTH + 1))).toThrow(
      "maximum depth",
    );
  });
});

describe("RFC 6901 pointers", () => {
  it("supports root, empty property names, slashes and tildes", () => {
    expect(parsePointer("")).toEqual([]);
    expect(parsePointer("/")).toEqual([""]);
    expect(parsePointer("/a~1b/~0key/~01")).toEqual(["a/b", "~key", "~1"]);
    expect(escapePointerSegment("a~/b")).toBe("a~0~1b");
    expect(joinPointer("/a", "b/c")).toBe("/a/b~1c");
  });

  it.each(["field", "#/field", "/a~2b", "/a~", "/~x", "/a~~0"])(
    "rejects malformed pointer %s",
    (path) => {
      expect(() => parsePointer(path)).toThrow(FixtureError);
    },
  );

  it("does not URI-decode percent sequences", () => {
    expect(parsePointer("/a%2Fb")).toEqual(["a%2Fb"]);
  });
});

describe("transparent redaction", () => {
  it("redacts normalized sensitive key names regardless of value type", () => {
    const source = {
      api_key: "demo",
      clientSecret: "demo",
      "Access-Token": 42,
      PASSWORD: false,
      private_key: null,
      card: { number: "123" },
    };
    const result = redactJson(source);
    expect(Object.values(result.value as Record<string, JsonValue>)).toEqual(
      Array(6).fill(REDACTION_MARKER),
    );
    expect(result.redactions).toHaveLength(6);
    expect(
      result.redactions.every((item) => item.reasons.includes("Sensitive key")),
    ).toBe(true);
    expect(
      result.redactions.find((item) => item.path === "/card"),
    ).toBeDefined();
    expect(
      result.redactions.find((item) => item.path === "/card/number"),
    ).toBeUndefined();
  });

  it("redacts emails embedded anywhere in strings and in arrays", () => {
    const result = redactJson({
      note: "Contact alex+test@example.test by Friday",
      members: ["safe", "a@example.test"],
    });
    expect(result.value).toEqual({
      members: ["safe", REDACTION_MARKER],
      note: REDACTION_MARKER,
    });
    expect(result.redactions).toEqual([
      { path: "/members/1", reasons: ["Email address"] },
      { path: "/note", reasons: ["Email address"] },
    ]);
  });

  it.each([
    ["sk_test_abcdefghijklmnop", "Stripe secret pattern"],
    ["rk_live_abcdefghijklmnop", "Stripe secret pattern"],
    ["whsec_abcdefghijklmnop", "Stripe secret pattern"],
    ["pi_demo_secret_abcdef", "Stripe secret pattern"],
    ["ghp_1234567890abcdefghijklmnop", "GitHub token pattern"],
    ["github_pat_11ABCDEFGH_abcdefghijklmnop", "GitHub token pattern"],
    ["Header: Bearer abc.def-ghi", "Bearer token pattern"],
    ["bearer abcdef=", "Bearer token pattern"],
  ])("redacts token pattern %s", (token, reason) => {
    const result = redactJson({ note: `prefix ${token} suffix` });
    expect(result.value).toEqual({ note: REDACTION_MARKER });
    expect(result.redactions).toEqual([{ path: "/note", reasons: [reason] }]);
  });

  it.each([
    "a".repeat(200_000),
    `${"a".repeat(200_000)}@`,
    `${"a".repeat(200_000)}@invalid`,
    `a@${"b".repeat(200_000)}.test`,
    "@".repeat(200_000),
    "a@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".repeat(
      3_000,
    ),
  ])(
    "processes large non-email strings within a generous linear-time budget",
    (message) => {
      const start = performance.now();
      expect(redactJson({ message }).redactions).toEqual([]);
      expect(performance.now() - start).toBeLessThan(1_000);
    },
  );

  it("keeps email detection conservative for long surrounding text and DNS labels", () => {
    expect(
      redactJson({ message: `${"x".repeat(200_000)}a@example.test` })
        .redactions,
    ).toHaveLength(1);
    expect(
      redactJson({ message: `a@${"b".repeat(63)}.test` }).redactions,
    ).toHaveLength(1);
    expect(
      redactJson({ message: `a@${"b".repeat(64)}.test` }).redactions,
    ).toHaveLength(0);
    expect(redactJson({ message: "a@invalid-.test" }).redactions).toHaveLength(
      0,
    );
    expect(redactJson({ message: "a@-invalid.test" }).redactions).toHaveLength(
      0,
    );
    expect(
      redactJson({ message: "a@valid-domain.test" }).redactions,
    ).toHaveLength(1);
  });

  it.each([
    `pi_${"a".repeat(200_000)}`,
    `pi_${"a_secret".repeat(25_000)}_`,
    `ghp_${"a".repeat(200_000)}_`,
    `github_pat_${"_".repeat(200_000)}`,
    `Bearer ${" ".repeat(200_000)}!`,
  ])(
    "processes long token-pattern candidates within a generous linear-time budget",
    (message) => {
      const start = performance.now();
      redactJson({ message });
      expect(performance.now() - start).toBeLessThan(1_000);
    },
  );

  it("reports multiple reasons without exposing the matching value", () => {
    const result = redactJson({ token: "Bearer abcdef user@example.test" }, [
      "/token",
    ]);
    expect(result.redactions).toEqual([
      {
        path: "/token",
        reasons: [
          "Custom JSON Pointer",
          "Sensitive key",
          "Email address",
          "Bearer token pattern",
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("abcdef");
    expect(JSON.stringify(result)).not.toContain("user@example.test");
  });

  it("uses exact normalized key rules instead of broad substring matching", () => {
    const source = {
      token_count: 3,
      secretive: false,
      public_key: "pk_test_public",
      session_count: 2,
      description: "safe text",
      enabled: true,
    };
    expect(redactJson(source)).toEqual({ value: source, redactions: [] });
  });

  it("matches custom paths through escaped property names and arrays", () => {
    const result = redactJson(
      { "a/b": { "~key": ["safe", "private"] }, "": "hidden" },
      ["/a~1b/~0key/1", "/"],
    );
    expect(result.value).toEqual({
      "": REDACTION_MARKER,
      "a/b": { "~key": ["safe", REDACTION_MARKER] },
    });
    expect(result.redactions.map((item) => item.path)).toEqual([
      "/",
      "/a~1b/~0key/1",
    ]);
  });

  it("supports explicit redaction of the whole document root", () => {
    expect(redactJson({ note: "private" }, [""])).toEqual({
      value: REDACTION_MARKER,
      redactions: [{ path: "", reasons: ["Custom JSON Pointer"] }],
    });
  });

  it("does not match nonexistent pointers, noncanonical array indices, or array append syntax", () => {
    expect(redactJson(["first"], ["/missing", "/00", "/-"]).redactions).toEqual(
      [],
    );
    expect(redactJson({ "00": "private" }, ["/00"]).redactions).toHaveLength(1);
  });

  it("validates all supplied pointers before redacting an ancestor", () => {
    expect(() => redactJson({ note: "private" }, ["", "/bad~9"])).toThrow(
      "Invalid JSON Pointer",
    );
  });

  it("deduplicates repeated rules and ignores descendants of replaced containers", () => {
    const result = redactJson({ outer: { inner: "private" } }, [
      "/outer",
      "/outer",
      "/outer/inner",
    ]);
    expect(result.redactions).toEqual([
      { path: "/outer", reasons: ["Custom JSON Pointer"] },
    ]);
  });

  it("clones nested data and never mutates the originals", () => {
    const source = { object: { password: "old" }, list: [1, { note: "keep" }] };
    const snapshot = JSON.stringify(source);
    const result = redactJson(source);
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(result.value).not.toBe(source);
    expect((result.value as Record<string, JsonValue>).list).not.toBe(
      source.list,
    );
  });

  it("rejects prototype pollution even when invoked without the parser", () => {
    expect(() => redactJson(JSON.parse('{"constructor":{}}'))).toThrow(
      "Unsafe property",
    );
  });
});

describe("reviewable bundles", () => {
  it("includes only sanitized fixtures, metadata, paths, reasons and change types", () => {
    const before = {
      password: "SOURCE_SECRET_OLD",
      note: "private@example.test",
      enabled: false,
    };
    const after = {
      password: "SOURCE_SECRET_NEW",
      note: "private@example.test",
      enabled: true,
    };
    const bundle = createBundle(before, after, "Example", "state change");
    expect(bundle.manifest).toMatchObject({
      schemaVersion: 1,
      provider: "Example",
      scenario: "state change",
      ruleVersion: RULE_VERSION,
    });
    expect(bundle.manifest.changes).toEqual([
      { type: "changed", path: "/enabled" },
      { type: "changed", path: "/password" },
    ]);
    expect(bundle.before).toEqual({
      enabled: false,
      note: REDACTION_MARKER,
      password: REDACTION_MARKER,
    });
    expect(bundle.after).toEqual({
      enabled: true,
      note: REDACTION_MARKER,
      password: REDACTION_MARKER,
    });
    const encoded = JSON.stringify(bundle);
    expect(encoded).not.toContain("SOURCE_SECRET");
    expect(encoded).not.toContain("private@example.test");
    for (const change of bundle.manifest.changes)
      expect(Object.keys(change).sort()).toEqual(["path", "type"]);
  });

  it("compares original values so a redacted change still appears in the manifest", () => {
    const bundle = createBundle(
      { secret: "one" },
      { secret: "two" },
      "Test",
      "secret rotation",
    );
    expect(bundle.before).toEqual(bundle.after);
    expect(bundle.manifest.changes).toEqual([
      { type: "changed", path: "/secret" },
    ]);
  });

  it("applies pointers that exist on only one side", () => {
    const bundle = createBundle({}, { custom: "private" }, "Test", "addition", [
      "/custom",
    ]);
    expect(bundle.manifest.redactions.before).toEqual([]);
    expect(bundle.manifest.redactions.after).toHaveLength(1);
    expect(bundle.after).toEqual({ custom: REDACTION_MARKER });
  });

  it("is deterministic across repeated runs and object key order", () => {
    const first = createBundle(
      { b: 2, a: 1 },
      { d: 4, c: 3 },
      "Test",
      "stable",
    );
    const second = createBundle(
      { a: 1, b: 2 },
      { c: 3, d: 4 },
      "Test",
      "stable",
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("enforces the same per-document node limit in all public JSON-processing entrypoints", () => {
    const atLimit = Array(MAX_NODES - 1).fill(0) as JsonValue[];
    const overLimit = [...atLimit, 0];
    expect(() => redactJson(overLimit)).toThrow("10,000 nodes");
    expect(() => redactJson(overLimit, [""])).toThrow("10,000 nodes");
    expect(() => compareJson(overLimit, {})).toThrow("10,000 nodes");
    expect(() => compareJson({}, overLimit)).toThrow("10,000 nodes");
    expect(() => createBundle(overLimit, {}, "Test", "wide")).toThrow(
      "10,000 nodes",
    );
    expect(() => createBundle({}, overLimit, "Test", "wide")).toThrow(
      "10,000 nodes",
    );
    expect(redactJson(atLimit).redactions).toEqual([]);
    // Each side receives its own budget: 10,000 nodes per document, not per pair.
    expect(compareJson(atLimit, [...atLimit])).toEqual([]);
    expect(
      createBundle(atLimit, [...atLimit], "Test", "limit").manifest.changes,
    ).toEqual([]);
  });

  it("provides valid synthetic Stripe and GitHub examples with genuine semantic differences", () => {
    expect(examples).toEqual([stripeExample, githubExample]);
    for (const example of examples) {
      const before = parseJson(JSON.stringify(example.before));
      const after = parseJson(JSON.stringify(example.after));
      const bundle = createBundle(
        before,
        after,
        example.provider,
        example.name,
      );
      expect(bundle.manifest.changes.length).toBeGreaterThan(0);
      expect(bundle.manifest.redactions.before.length).toBeGreaterThan(0);
      expect(JSON.stringify(bundle)).not.toMatch(/[a-z]+@example\.test/);
    }
  });
});
