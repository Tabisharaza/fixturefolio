/** Pure, deterministic JSON processing. No persistence, logging, or network calls. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type ChangeType = "added" | "removed" | "changed" | "type-changed";
export interface Change {
  type: ChangeType;
  /** RFC 6901 JSON Pointer; an empty string means the document root. */
  path: string;
}
export interface Redaction {
  path: string;
  reasons: string[];
}
export interface FixtureManifest {
  schemaVersion: 1;
  provider: string;
  scenario: string;
  ruleVersion: string;
  redactions: { before: Redaction[]; after: Redaction[] };
  /** Describes the original comparison without storing original values. */
  changes: Change[];
}
export interface FixtureBundle {
  before: JsonValue;
  after: JsonValue;
  manifest: FixtureManifest;
}

export const MAX_INPUT_BYTES = 256 * 1024;
/** Maximum path depth, with the document root at depth zero. */
export const MAX_DEPTH = 40;
/** Maximum structural values per document, including the root; keys are not nodes. */
export const MAX_NODES = 10_000;
export const RULE_VERSION = "1.0.0";
export const REDACTION_MARKER = "[REDACTED]";
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Exact normalized key matches; camelCase, underscores, hyphens and spaces normalize alike. */
export const SENSITIVE_KEY_RULES = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "auth",
  "cookie",
  "cookies",
  "setcookie",
  "session",
  "sessionid",
  "sessiontoken",
  "privatekey",
  "clientsecret",
  "signingsecret",
  "webhooksecret",
  "credential",
  "credentials",
  "card",
  "creditcard",
  "cardnumber",
  "creditcardnumber",
  "cvv",
  "cvc",
  "securitycode",
  "ssn",
  "socialsecuritynumber",
  "email",
  "emailaddress",
] as const;
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(SENSITIVE_KEY_RULES);
const EMAIL_LOCAL_PUNCTUATION = ".!#$%&'*+/=?^_`{|}~-";
const MAX_DOMAIN_LABEL_LENGTH = 63;

function isAsciiAlphanumeric(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

/**
 * Conservative email-substring detection with bounded work for each @.
 * An adjacent valid local-part character suffices because the candidate may be
 * anywhere inside a larger string. Inspect at most 63 characters of the first
 * domain label, then require a dot and an alphanumeric second-label character.
 * This recognizes the same ordinary ASCII email substrings as the old regex,
 * while refusing an overlong first DNS label. It does not validate mailboxes.
 * Crucially, no unanchored greedy local-part regex retries over long strings.
 */
function hasEmailAddress(value: string): boolean {
  let at = value.indexOf("@");
  while (at !== -1) {
    const previous = value[at - 1];
    if (
      previous !== undefined &&
      (isAsciiAlphanumeric(previous.charCodeAt(0)) ||
        EMAIL_LOCAL_PUNCTUATION.includes(previous))
    ) {
      const first = at + 1;
      if (isAsciiAlphanumeric(value.charCodeAt(first))) {
        let cursor = first;
        while (cursor - first < MAX_DOMAIN_LABEL_LENGTH) {
          const code = value.charCodeAt(cursor);
          if (!isAsciiAlphanumeric(code) && code !== 45) break;
          cursor++;
        }
        if (
          value[cursor] === "." &&
          isAsciiAlphanumeric(value.charCodeAt(cursor - 1)) &&
          isAsciiAlphanumeric(value.charCodeAt(cursor + 1))
        ) {
          return true;
        }
      }
    }
    at = value.indexOf("@", at + 1);
  }
  return false;
}
const STRIPE_SECRET =
  /\b(?:(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]{8,}|whsec_[A-Za-z0-9_]{8,}|(?:pi|seti|cs|in)_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+)/;
const GITHUB_TOKEN =
  /\b(?:gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/;
const BEARER_TOKEN = /\bbearer\s+[A-Za-z0-9._~+/-]+=*/i;

export class FixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureError";
  }
}

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
export function joinPointer(path: string, segment: string | number): string {
  return `${path}/${escapePointerSegment(String(segment))}`;
}

/** URI fragment pointers (#/...) and malformed ~ escapes are intentionally rejected. */
export function parsePointer(pointer: string): string[] {
  if (typeof pointer !== "string")
    throw new FixtureError(
      "A custom redaction path must be a JSON Pointer string.",
    );
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new FixtureError(
      "A custom redaction path must start with / (or be empty for the document root).",
    );
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => {
      if (/~(?![01])/u.test(segment)) {
        throw new FixtureError(
          "Invalid JSON Pointer escape. Use ~0 for a tilde and ~1 for a slash.",
        );
      }
      return segment.replace(/~1/g, "/").replace(/~0/g, "~");
    });
}

function validateJson(value: unknown): asserts value is JsonValue {
  // One shared budget per document, not a fresh budget for each array or branch.
  let nodes = 0;
  function visit(current: unknown, depth: number): void {
    nodes++;
    if (nodes > MAX_NODES)
      throw new FixtureError(
        "JSON exceeds the maximum of 10,000 nodes (including the root). Use a smaller payload.",
      );
    if (depth > MAX_DEPTH)
      throw new FixtureError(
        `JSON exceeds the maximum depth of ${MAX_DEPTH}. Flatten deeply nested input.`,
      );
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    )
      return;
    if (typeof current === "number") {
      if (!Number.isFinite(current))
        throw new FixtureError(
          "JSON contains a number outside the finite JavaScript range. Encode it as a string.",
        );
      if (Number.isInteger(current) && !Number.isSafeInteger(current)) {
        throw new FixtureError(
          "JSON contains an integer outside the safe JavaScript range. Encode large IDs as strings.",
        );
      }
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }
    if (typeof current !== "object" || current === undefined) {
      throw new FixtureError("Only JSON values are supported.");
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null)
      throw new FixtureError("Only plain JSON objects are supported.");
    for (const key of Object.keys(current)) {
      if (FORBIDDEN_KEYS.has(key))
        throw new FixtureError(
          `Unsafe property "${key}" is not allowed anywhere in a fixture.`,
        );
      visit((current as Record<string, unknown>)[key], depth + 1);
    }
  }
  visit(value, 0);
}

/** Bounded UTF-8 input and structural checks, with errors that never echo payload values. */
export function parseJson(input: string): JsonValue {
  if (
    input.length > MAX_INPUT_BYTES ||
    new TextEncoder().encode(input).byteLength > MAX_INPUT_BYTES
  ) {
    throw new FixtureError(
      "JSON exceeds the 256 KiB UTF-8 input limit. Use a smaller payload.",
    );
  }
  if (!input.trim())
    throw new FixtureError("Paste a JSON payload to continue.");
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch (error) {
    // Engine error text can include secrets from the input, so expose only a numeric position.
    const position =
      error instanceof Error
        ? error.message.match(/position (\d+)/)?.[1]
        : undefined;
    throw new FixtureError(
      `Invalid JSON${position ? ` near character ${position}` : ""}. Check quotation marks, commas, and brackets.`,
    );
  }
  validateJson(value);
  return value;
}

function jsonType(value: JsonValue): string {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}

/** Objects compare by sorted keys; arrays compare by index (not LCS or identity). */
export function compareJson(before: JsonValue, after: JsonValue): Change[] {
  validateJson(before);
  validateJson(after);
  const changes: Change[] = [];
  function visit(left: JsonValue, right: JsonValue, path: string) {
    if (jsonType(left) !== jsonType(right)) {
      changes.push({ type: "type-changed", path });
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      for (
        let index = 0;
        index < Math.max(left.length, right.length);
        index++
      ) {
        const childPath = joinPointer(path, index);
        if (index >= left.length)
          changes.push({ type: "added", path: childPath });
        else if (index >= right.length)
          changes.push({ type: "removed", path: childPath });
        else visit(left[index], right[index], childPath);
      }
      return;
    }
    if (
      left !== null &&
      right !== null &&
      typeof left === "object" &&
      typeof right === "object"
    ) {
      const leftObject = left as Record<string, JsonValue>;
      const rightObject = right as Record<string, JsonValue>;
      const keys = [
        ...new Set([...Object.keys(leftObject), ...Object.keys(rightObject)]),
      ].sort();
      for (const key of keys) {
        const childPath = joinPointer(path, key);
        if (!Object.prototype.hasOwnProperty.call(leftObject, key))
          changes.push({ type: "added", path: childPath });
        else if (!Object.prototype.hasOwnProperty.call(rightObject, key))
          changes.push({ type: "removed", path: childPath });
        else visit(leftObject[key], rightObject[key], childPath);
      }
      return;
    }
    if (left !== right) changes.push({ type: "changed", path });
  }
  visit(before, after, "");
  return changes;
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

/** Returns a new value. Sensitive containers are replaced as a whole and reported once. */
export function redactJson(
  value: JsonValue,
  customPaths: string[] = [],
): { value: JsonValue; redactions: Redaction[] } {
  validateJson(value);
  // Validate every path even if another custom path redacts an ancestor first.
  const paths = new Set(
    customPaths.map((path) => {
      const segments = parsePointer(path);
      return segments.length === 0
        ? ""
        : `/${segments.map(escapePointerSegment).join("/")}`;
    }),
  );
  const redactions: Redaction[] = [];
  function visit(current: JsonValue, path: string, key?: string): JsonValue {
    const reasons: string[] = [];
    if (paths.has(path)) reasons.push("Custom JSON Pointer");
    if (key !== undefined && SENSITIVE_KEYS.has(normalizedKey(key)))
      reasons.push("Sensitive key");
    if (typeof current === "string") {
      if (hasEmailAddress(current)) reasons.push("Email address");
      if (STRIPE_SECRET.test(current)) reasons.push("Stripe secret pattern");
      if (GITHUB_TOKEN.test(current)) reasons.push("GitHub token pattern");
      if (BEARER_TOKEN.test(current)) reasons.push("Bearer token pattern");
    }
    if (reasons.length > 0) {
      redactions.push({ path, reasons });
      return REDACTION_MARKER;
    }
    if (Array.isArray(current))
      return current.map((item, index) =>
        visit(item, joinPointer(path, index)),
      );
    if (current !== null && typeof current === "object") {
      const result: Record<string, JsonValue> = {};
      for (const property of Object.keys(current).sort()) {
        result[property] = visit(
          current[property],
          joinPointer(path, property),
          property,
        );
      }
      return result;
    }
    return current;
  }
  return { value: visit(value, ""), redactions };
}

export function createBundle(
  before: JsonValue,
  after: JsonValue,
  provider: string,
  scenario: string,
  customPaths: string[] = [],
): FixtureBundle {
  const cleanBefore = redactJson(before, customPaths);
  const cleanAfter = redactJson(after, customPaths);
  return {
    before: cleanBefore.value,
    after: cleanAfter.value,
    manifest: {
      schemaVersion: 1,
      provider,
      scenario,
      ruleVersion: RULE_VERSION,
      redactions: {
        before: cleanBefore.redactions,
        after: cleanAfter.redactions,
      },
      changes: compareJson(before, after),
    },
  };
}
