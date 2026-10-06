import { useEffect, useMemo, useRef, useState } from "react";
import type { Change, FixtureBundle, JsonValue, Redaction } from "./core";
import {
  createBundle,
  MAX_INPUT_BYTES,
  parseJson,
  parsePointer,
  redactJson,
  RULE_VERSION,
  SENSITIVE_KEY_RULES,
} from "./core";
import { examples } from "./data/examples";

type IconName =
  | "plus"
  | "arrow"
  | "download"
  | "check"
  | "shield"
  | "code"
  | "copy"
  | "upload"
  | "edit"
  | "close"
  | "book"
  | "chevron"
  | "layers"
  | "warning"
  | "terminal";
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    plus: "M12 5v14M5 12h14",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    download: "M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5",
    check: "m5 12 4 4L19 6",
    shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zm-4 9 3 3 5-6",
    code: "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18",
    copy: "M9 9h12v12H9zM15 9V3H3v12h6",
    upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
    edit: "m16 3 5 5-12 12-6 1 1-6L16 3zm-12 12 5 5m5-15 5 5",
    close: "m6 6 12 12M6 18 18 6",
    book: "M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3V4zm9 2v16",
    chevron: "m9 5 7 7-7 7",
    layers: "m12 3 10 5-10 5L2 8l10-5zm-10 9 10 5 10-5M2 16l10 5 10-5",
    warning: "m12 3 10 18H2L12 3zm0 6v5m0 3v1",
    terminal: "m5 7 5 5-5 5m8 0h6",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const sizeLabel = (input: string) =>
  `${(new TextEncoder().encode(input).length / 1024).toFixed(1)} KB`;
const displayPath = (path: string) => (path === "" ? "(document root)" : path);
const typeLabels = {
  added: "Added",
  removed: "Removed",
  changed: "Changed",
  "type-changed": "Type changed",
};

function CodeView({
  value,
  label,
  compact = false,
}: {
  value: string;
  label: string;
  compact?: boolean;
}) {
  const lines = value.split("\n");
  const [page, setPage] = useState(0);
  const pageSize = 200;
  const totalPages = Math.ceil(lines.length / pageSize);
  const currentPage = Math.min(page, totalPages - 1);
  useEffect(() => {
    setPage(0);
  }, [value]);
  return (
    <div className="code-frame">
      <div
        className={`code-view ${compact ? "compact" : ""}`}
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        <pre>
          {lines
            .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
            .map((line, i) => (
              <span
                className={`code-line ${line.includes("[REDACTED]") ? "redacted-line" : ""}`}
                key={i}
              >
                <span className="line-number" aria-hidden="true">
                  {currentPage * pageSize + i + 1}
                </span>
                <code>
                  {line
                    .split(
                      /("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?\b)/g,
                    )
                    .map((token, j) => {
                      const tokenClass = token.includes("[REDACTED]")
                        ? "token-redacted"
                        : /"\s*:$/.test(token)
                          ? "token-key"
                          : token.startsWith('"')
                            ? "token-string"
                            : /^(?:true|false|null)$/.test(token)
                              ? "token-literal"
                              : /^-?\d/.test(token)
                                ? "token-number"
                                : "";
                      return (
                        <span className={tokenClass} key={j}>
                          {token}
                        </span>
                      );
                    })}
                </code>
              </span>
            ))}
        </pre>
      </div>
      {totalPages > 1 && (
        <div className="code-pagination">
          <button
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
            aria-label={`${label} previous page`}
          >
            ← Previous
          </button>
          <span>
            Lines {currentPage * pageSize + 1}–
            {Math.min((currentPage + 1) * pageSize, lines.length)} of{" "}
            {lines.length}
          </span>
          <button
            disabled={currentPage === totalPages - 1}
            onClick={() => setPage(currentPage + 1)}
            aria-label={`${label} next page`}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

function PayloadCard({
  side,
  source,
  preview,
  error,
  editing,
  loading,
  onChange,
  onEdit,
  onUpload,
  onCopy,
}: {
  side: "before" | "after";
  source: string;
  preview: JsonValue | undefined;
  error: string | null;
  editing: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  onEdit: () => void;
  onUpload: (file: File) => void;
  onCopy: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const title = side === "before" ? "Before" : "After";
  return (
    <section className={`payload-card ${side}`} aria-label={`${title} payload`}>
      <div className="payload-top">
        <div className="payload-title">
          <span className={`side-indicator ${side}`} />
          {title}
          <span className="subtle">
            {side === "before" ? "baseline" : "candidate"}
          </span>
        </div>
        <span className="file-size">{sizeLabel(source)}</span>
      </div>
      <div className="editor-toolbar">
        <span>
          <Icon name="code" size={14} />
          {side}.json
        </span>
        <div>
          <button
            className={`icon-button ${editing ? "active" : ""}`}
            aria-label={
              editing ? `Preview sanitized ${side}` : `Edit ${side} original`
            }
            title={editing ? "Preview sanitized JSON" : "Edit original JSON"}
            onClick={onEdit}
          >
            <Icon name={editing ? "check" : "edit"} size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`Upload ${side} JSON`}
            title="Upload a JSON file"
            disabled={loading}
            onClick={() => input.current?.click()}
          >
            <Icon name="upload" size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={`Copy sanitized ${side}`}
            title="Copy sanitized JSON"
            disabled={preview === undefined || !!error || editing}
            onClick={onCopy}
          >
            <Icon name="copy" size={15} />
          </button>
          <input
            ref={input}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            aria-label={`${title} JSON file`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      {loading ? (
        <div className="editor-empty" role="status">
          Reading your file…
        </div>
      ) : editing ? (
        <>
          <div className="original-notice">
            <Icon name="warning" size={13} />
            Editing original values · stays in this tab
          </div>
          <textarea
            className="json-input"
            aria-label={`${title} original JSON`}
            value={source}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
            placeholder={'{\n  "event": "your.webhook"\n}'}
          />
        </>
      ) : error ? (
        <div className="editor-empty">
          <Icon name="code" size={30} />
          <strong>
            {source.trim()
              ? "Let’s fix this payload"
              : "A blank page for your next edge case"}
          </strong>
          <p>{error}</p>
          <button className="button light small" onClick={onEdit}>
            Paste JSON <Icon name="arrow" size={14} />
          </button>
        </div>
      ) : (
        <CodeView value={pretty(preview)} label={`${title} sanitized JSON`} />
      )}
      <div className={`editor-status ${error ? "has-error" : ""}`}>
        <span>
          {error ? (
            <>
              <Icon name="warning" size={13} />
              {source.trim() ? "Invalid JSON" : "Waiting for JSON"}
            </>
          ) : (
            <>
              <span className="status-dot" />
              {editing ? "Original JSON" : "Sanitized preview"}
            </>
          )}
        </span>
        <span>UTF-8 · JSON</span>
      </div>
      {error && editing && (
        <p className="input-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ChangeList({
  changes,
  filter,
}: {
  changes: Change[];
  filter: string;
}) {
  const visible = changes.filter(
    (change) => filter === "all" || change.type === filter,
  );
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(visible.length / 100));
  const currentPage = Math.min(page, pages - 1);
  useEffect(() => {
    setPage(0);
  }, [changes, filter]);
  return (
    <div className="changes-list">
      <div className="list-heading">
        <span>JSON POINTER</span>
        <span>CHANGE</span>
      </div>
      {visible.length === 0 ? (
        <div className="empty-panel">
          <Icon name="check" size={28} />
          <h3>
            {changes.length
              ? "No changes of this type"
              : "Same shape. Same values."}
          </h3>
          <p>
            {changes.length
              ? "Choose another filter to see the rest."
              : "Object-key order does not create a difference."}
          </p>
        </div>
      ) : (
        visible
          .slice(currentPage * 100, (currentPage + 1) * 100)
          .map((change) => (
            <div className="change-row" key={change.path}>
              <span className={`change-symbol ${change.type}`}>
                {change.type === "added"
                  ? "+"
                  : change.type === "removed"
                    ? "−"
                    : change.type === "type-changed"
                      ? "↔"
                      : "~"}
              </span>
              <code>{displayPath(change.path)}</code>
              <span className={`change-tag ${change.type}`}>
                {typeLabels[change.type]}
              </span>
            </div>
          ))
      )}
      {pages > 1 && (
        <div className="list-pagination">
          <button
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous changes
          </button>
          <span>
            Page {currentPage + 1} of {pages}
          </span>
          <button
            disabled={currentPage === pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next changes
          </button>
        </div>
      )}
    </div>
  );
}

function App() {
  const first = examples[0];
  const [selected, setSelected] = useState(first.id);
  const [before, setBefore] = useState(pretty(first.before));
  const [after, setAfter] = useState(pretty(first.after));
  const [provider, setProvider] = useState(first.provider);
  const [scenario, setScenario] = useState(first.name);
  const [tab, setTab] = useState<"payloads" | "changes" | "export">("payloads");
  const [editing, setEditing] = useState({ before: false, after: false });
  const [loading, setLoading] = useState({ before: false, after: false });
  const [pointers, setPointers] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [redactionPage, setRedactionPage] = useState(0);
  const help = useRef<HTMLDialogElement>(null);
  const uploadVersion = useRef({ before: 0, after: 0 });

  const analysis = useMemo(() => {
    let left: JsonValue | undefined;
    let right: JsonValue | undefined;
    let beforeError: string | null = null;
    let afterError: string | null = null;
    let ruleError: string | null = null;
    try {
      left = parseJson(before);
    } catch (error) {
      beforeError = (error as Error).message;
    }
    try {
      right = parseJson(after);
    } catch (error) {
      afterError = (error as Error).message;
    }
    const customPaths = pointers.split("\n").filter((path) => path.length > 0);
    try {
      customPaths.forEach(parsePointer);
    } catch (error) {
      ruleError = (error as Error).message;
    }
    let bundle: FixtureBundle | undefined;
    let safeBefore: JsonValue | undefined;
    let safeAfter: JsonValue | undefined;
    if (!ruleError) {
      try {
        if (left !== undefined)
          safeBefore = redactJson(left, customPaths).value;
        if (right !== undefined)
          safeAfter = redactJson(right, customPaths).value;
      } catch (error) {
        ruleError = (error as Error).message;
      }
    }
    if (left !== undefined && right !== undefined && !ruleError) {
      try {
        bundle = createBundle(left, right, provider, scenario, customPaths);
      } catch (error) {
        ruleError = (error as Error).message;
      }
    }
    return {
      bundle,
      safeBefore,
      safeAfter,
      beforeError,
      afterError,
      ruleError,
      customPaths,
    };
  }, [before, after, pointers, provider, scenario]);
  const bundle = analysis.bundle;
  const changes = bundle?.manifest.changes ?? [];
  const redactions = useMemo(() => {
    const paths = new Map<
      string,
      { path: string; reasons: string[]; sides: string[] }
    >();
    for (const side of ["before", "after"] as const) {
      for (const item of bundle?.manifest.redactions[side] ?? []) {
        const existing = paths.get(item.path);
        if (existing) {
          existing.sides.push(side);
          existing.reasons = [
            ...new Set([...existing.reasons, ...item.reasons]),
          ];
        } else paths.set(item.path, { ...item, sides: [side] });
      }
    }
    return [...paths.values()];
  }, [bundle]);
  const counts = {
    added: changes.filter((c) => c.type === "added").length,
    removed: changes.filter((c) => c.type === "removed").length,
    changed: changes.filter((c) => c.type === "changed").length,
    type: changes.filter((c) => c.type === "type-changed").length,
  };
  const totalRedactions =
    (bundle?.manifest.redactions.before.length ?? 0) +
    (bundle?.manifest.redactions.after.length ?? 0);
  const canExport =
    !!bundle &&
    reviewed &&
    !!provider.trim() &&
    !!scenario.trim() &&
    !loading.before &&
    !loading.after;

  function resetReview() {
    setReviewed(false);
    setRedactionPage(0);
    setNotice("");
  }
  function updateSource(side: "before" | "after", value: string) {
    uploadVersion.current[side]++;
    setLoading((current) => ({ ...current, [side]: false }));
    if (side === "before") setBefore(value);
    else setAfter(value);
    resetReview();
  }
  function loadExample(id: string) {
    const example = examples.find((item) => item.id === id);
    if (!example) return;
    uploadVersion.current.before++;
    uploadVersion.current.after++;
    setLoading({ before: false, after: false });
    setSelected(id);
    setBefore(pretty(example.before));
    setAfter(pretty(example.after));
    setProvider(example.provider);
    setScenario(example.name);
    setPointers("");
    setEditing({ before: false, after: false });
    setTab("payloads");
    setFilter("all");
    resetReview();
  }
  function newFixture() {
    uploadVersion.current.before++;
    uploadVersion.current.after++;
    setLoading({ before: false, after: false });
    setSelected("custom");
    setBefore("");
    setAfter("");
    setProvider("Custom");
    setScenario("Untitled fixture");
    setPointers("");
    setEditing({ before: true, after: true });
    setTab("payloads");
    setFilter("all");
    resetReview();
  }
  async function upload(side: "before" | "after", file: File) {
    if (file.size > MAX_INPUT_BYTES) {
      setNotice(
        "That file is larger than 256 KiB. Choose a smaller JSON payload.",
      );
      return;
    }
    const version = ++uploadVersion.current[side];
    resetReview();
    setLoading((current) => ({ ...current, [side]: true }));
    try {
      const value = await file.text();
      if (version !== uploadVersion.current[side]) return;
      if (side === "before") setBefore(value);
      else setAfter(value);
      setEditing((current) => ({ ...current, [side]: false }));
      setNotice(
        `${side === "before" ? "Before" : "After"} file loaded. Review the refreshed result.`,
      );
    } catch {
      if (version === uploadVersion.current[side])
        setNotice("This file could not be read. Try again or paste its JSON.");
    } finally {
      if (version === uploadVersion.current[side])
        setLoading((current) => ({ ...current, [side]: false }));
    }
  }
  async function copy(
    value: JsonValue | FixtureBundle | undefined,
    what: string,
  ) {
    if (value === undefined) return;
    try {
      await navigator.clipboard.writeText(pretty(value));
      setNotice(`${what} copied. Review it before sharing.`);
    } catch {
      setNotice(
        "Clipboard access is unavailable. Use the download button after reviewing instead.",
      );
    }
  }
  function download(
    part: "bundle" | "before" | "after" | "manifest" = "bundle",
  ) {
    if (!bundle || !canExport) return;
    const value =
      part === "bundle"
        ? bundle
        : part === "manifest"
          ? bundle.manifest
          : bundle[part];
    const blob = new Blob([pretty(value) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const slug =
      scenario
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 70) || "fixture";
    anchor.href = url;
    anchor.download = `fixturefolio-${slug}${part === "bundle" ? "" : `-${part}`}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      `${part === "bundle" ? "Fixture bundle" : `${part}.json`} downloaded. Only the sanitized result is included. Review it before sharing.`,
    );
  }
  function pathReason(item: Redaction) {
    return item.reasons
      .map((reason) =>
        reason
          .replace(/^sensitive-key:/, "Sensitive key: ")
          .replace(/^custom-pointer$/, "Your custom path"),
      )
      .join(" · ");
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workbench">
        Skip to workbench
      </a>
      <aside className="sidebar" aria-label="Fixture navigation">
        <a
          className="brand"
          href="#"
          aria-label="FixtureFolio home"
          onClick={(event) => {
            event.preventDefault();
            loadExample(first.id);
          }}
        >
          <span className="brand-mark">
            f<span />
          </span>
          <span>
            FixtureFolio
            <span className="brand-caption">
              SMALL FIXTURES. BIG CONFIDENCE.
            </span>
          </span>
        </a>
        <div className="sidebar-section">
          <div className="section-label">
            YOUR WORKBENCH <span>01</span>
          </div>
          <button
            className="nav-main selected"
            onClick={() => setTab("payloads")}
          >
            <Icon name="layers" />
            <span>Fixture studio</span>
            <span className="live-dot" />
          </button>
        </div>
        <div className="sidebar-section examples-section">
          <div className="section-label">START WITH AN EXAMPLE</div>
          <div className="example-list">
            {examples.map((example) => (
              <button
                key={example.id}
                aria-label={`${example.provider} ${example.name}`}
                onClick={() => loadExample(example.id)}
                className={`example-button ${selected === example.id ? "selected" : ""}`}
                aria-pressed={selected === example.id}
              >
                <span
                  className={`provider-icon ${example.provider.toLowerCase()}`}
                >
                  {example.provider === "Stripe" ? (
                    "S"
                  ) : (
                    <Icon name="code" size={16} />
                  )}
                </span>
                <span>
                  <strong>{example.provider}</strong>
                  <small>{example.name}</small>
                </span>
                {selected === example.id && <Icon name="chevron" size={14} />}
              </button>
            ))}
          </div>
          <p className="synthetic-note">Handmade examples. No real data.</p>
        </div>
        <button className="new-fixture" onClick={newFixture}>
          <Icon name="plus" size={16} />
          New blank fixture
        </button>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-icon">
              <Icon name="shield" size={20} />
            </span>
            <strong>Your payloads stay here.</strong>
            <p>Processed in this browser tab. No uploads. No saved history.</p>
            <span className="local-label">
              <span className="status-dot" /> LOCAL-FIRST
            </span>
          </div>
          <button
            className="guide-link"
            onClick={() => help.current?.showModal()}
          >
            <Icon name="book" size={16} />
            Guide &amp; redaction rules
            <Icon name="arrow" size={15} />
          </button>
          <div className="version">
            OPEN SOURCE <span>v0.1.0</span>
          </div>
        </div>
      </aside>
      <main className="main-content" id="workbench">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <Icon name="chevron" size={12} />
            <strong>Fixture studio</strong>
          </div>
          <div className="topbar-actions">
            <span className="session-status">
              <span className="status-dot" />
              All processing on-device
            </span>
            <button
              className="topbar-guide icon-button"
              aria-label="Open guide"
              title="Guide & redaction rules"
              onClick={() => help.current?.showModal()}
            >
              <Icon name="book" size={16} />
            </button>
          </div>
        </header>
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> THE WEBHOOK FIXTURE WORKBENCH
            </div>
            <h1>Keep the edge cases.</h1>
            <p className="headline-secondary">Leave the sensitive bits.</p>
            <p className="intro-copy">
              Compare payloads, review redactions, and bring better fixtures to
              your tests.
            </p>
          </div>
          <div className="intro-actions">
            <span className="step-caption">FROM PAYLOAD TO PULL REQUEST</span>
            <button
              className="button primary"
              onClick={() => download()}
              disabled={!canExport}
            >
              <Icon name="download" size={17} />
              Export fixture<span className="button-key">.json</span>
            </button>
            <span className="export-hint">
              {canExport
                ? "Sanitized pair + review manifest"
                : "Review the result to enable export"}
            </span>
          </div>
        </section>
        <div className="workflow" aria-label="Workflow">
          <span className="workflow-step complete">
            <span className="step-circle">01</span>Load payloads
          </span>
          <span className="workflow-line" />
          <span className={`workflow-step ${bundle ? "complete" : ""}`}>
            <span className="step-circle">02</span>Compare &amp; redact
          </span>
          <span className="workflow-line" />
          <span className={`workflow-step ${reviewed ? "complete" : ""}`}>
            <span className="step-circle">03</span>Review &amp; export
          </span>
          <span className="workflow-note">
            A little care. A reusable test case.
          </span>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span className="summary-icon">
              <Icon name="layers" />
            </span>
            <div>
              <span className="summary-label">Semantic changes</span>
              <strong>
                {bundle ? changes.length : "—"}
                <span>across the payload pair</span>
              </strong>
            </div>
            <div className="mini-change">
              <span className="add">+{counts.added}</span>
              <span className="remove">−{counts.removed}</span>
              <span className="modified">~{counts.changed + counts.type}</span>
            </div>
          </div>
          <div className="summary-card">
            <span className="summary-icon redaction-icon">
              <Icon name="shield" />
            </span>
            <div>
              <span className="summary-label">Values redacted</span>
              <strong>
                {bundle ? totalRedactions : "—"}
                <span>at {redactions.length} unique paths</span>
              </strong>
            </div>
            <span className="rule-badge">Rules v{RULE_VERSION}</span>
          </div>
          <div className="summary-card small-summary">
            <span className="summary-icon">
              <Icon name="code" />
            </span>
            <div>
              <span className="summary-label">Comparison mode</span>
              <strong className="text-metric">
                Structure-aware
                <span>Object order ignored · arrays positional</span>
              </strong>
            </div>
          </div>
        </div>
        <div className="studio-layout">
          <section className="workspace-panel" aria-label="Fixture workspace">
            <div className="workspace-heading">
              <div
                className="workspace-tabs"
                role="tablist"
                aria-label="Workbench view"
              >
                {(["payloads", "changes", "export"] as const).map((view) => (
                  <button
                    role="tab"
                    tabIndex={tab === view ? 0 : -1}
                    onKeyDown={(event) => {
                      const views = ["payloads", "changes", "export"] as const;
                      const index = views.indexOf(view);
                      const next =
                        event.key === "ArrowRight"
                          ? (index + 1) % 3
                          : event.key === "ArrowLeft"
                            ? (index + 2) % 3
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? 2
                                : -1;
                      if (next >= 0) {
                        event.preventDefault();
                        setTab(views[next]);
                        (
                          event.currentTarget.parentElement?.children[
                            next
                          ] as HTMLButtonElement
                        )?.focus();
                      }
                    }}
                    aria-selected={tab === view}
                    aria-controls={`panel-${view}`}
                    id={`tab-${view}`}
                    key={view}
                    onClick={() => setTab(view)}
                    className={tab === view ? "active" : ""}
                  >
                    {view === "payloads"
                      ? "Payloads"
                      : view === "changes"
                        ? "Changes"
                        : "Export preview"}
                    {view === "changes" && bundle && (
                      <span>{changes.length}</span>
                    )}
                  </button>
                ))}
              </div>
              <span className="preview-tag">
                <Icon name="shield" size={12} />
                Sanitized view
              </span>
            </div>
            <div
              role="tabpanel"
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
            >
              {tab === "payloads" && (
                <>
                  <div className="panel-caption">
                    <span>
                      <strong>{scenario || "Untitled fixture"}</strong>
                      <span className="dot-divider">·</span>
                      {provider || "Custom"}
                      {selected !== "custom" && " example"}
                    </span>
                    <span>JSON ↔ JSON</span>
                  </div>
                  <div className="payload-grid">
                    <PayloadCard
                      side="before"
                      source={before}
                      preview={analysis.safeBefore}
                      error={analysis.beforeError || analysis.ruleError}
                      editing={editing.before}
                      loading={loading.before}
                      onChange={(value) => updateSource("before", value)}
                      onEdit={() =>
                        setEditing((current) => ({
                          ...current,
                          before: !current.before,
                        }))
                      }
                      onUpload={(file) => void upload("before", file)}
                      onCopy={() =>
                        void copy(analysis.safeBefore, "Sanitized before JSON")
                      }
                    />
                    <PayloadCard
                      side="after"
                      source={after}
                      preview={analysis.safeAfter}
                      error={analysis.afterError || analysis.ruleError}
                      editing={editing.after}
                      loading={loading.after}
                      onChange={(value) => updateSource("after", value)}
                      onEdit={() =>
                        setEditing((current) => ({
                          ...current,
                          after: !current.after,
                        }))
                      }
                      onUpload={(file) => void upload("after", file)}
                      onCopy={() =>
                        void copy(analysis.safeAfter, "Sanitized after JSON")
                      }
                    />
                  </div>
                  <div className="under-editor">
                    <span>
                      <span className="redaction-swatch" />
                      Highlighted values were replaced with [REDACTED]
                    </span>
                    <button onClick={() => setTab("changes")}>
                      Inspect changes <Icon name="arrow" size={13} />
                    </button>
                  </div>
                </>
              )}
              {tab === "changes" && (
                <div className="changes-panel">
                  <div className="panel-caption">
                    <span>Meaningful differences, one path at a time.</span>
                    <label className="filter-label">
                      Show
                      <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        aria-label="Filter change type"
                      >
                        <option value="all">All changes</option>
                        <option value="added">Added</option>
                        <option value="removed">Removed</option>
                        <option value="changed">Changed</option>
                        <option value="type-changed">Type changed</option>
                      </select>
                    </label>
                  </div>
                  {bundle ? (
                    <ChangeList changes={changes} filter={filter} />
                  ) : (
                    <div className="empty-panel">
                      <Icon name="warning" size={28} />
                      <h3>Two valid payloads needed</h3>
                      <p>Fix the input or custom-path errors to compare.</p>
                      <button
                        className="button light small"
                        onClick={() => setTab("payloads")}
                      >
                        Back to payloads
                      </button>
                    </div>
                  )}
                  <p className="panel-footnote">
                    Compared before redaction. Hidden value changes still appear
                    here. Added or removed objects appear at their parent path.
                  </p>
                </div>
              )}
              {tab === "export" && (
                <div className="export-panel">
                  <div className="export-intro">
                    <div className="export-illustration">
                      <Icon name="terminal" size={28} />
                    </div>
                    <div>
                      <h2>A clean handoff to your test suite.</h2>
                      <p>
                        Two sanitized payloads. One transparent record of what
                        changed.
                      </p>
                    </div>
                  </div>
                  <div className="metadata-fields">
                    <label>
                      Provider
                      <input
                        value={provider}
                        maxLength={80}
                        onChange={(event) => {
                          setProvider(event.target.value);
                          resetReview();
                        }}
                        placeholder="e.g. Stripe"
                      />
                    </label>
                    <label>
                      Scenario
                      <input
                        value={scenario}
                        maxLength={120}
                        onChange={(event) => {
                          setScenario(event.target.value);
                          resetReview();
                        }}
                        placeholder="e.g. Payment with missing metadata"
                      />
                    </label>
                  </div>
                  {(!provider.trim() || !scenario.trim()) && (
                    <p className="input-error">
                      Give your export a provider and scenario name.
                    </p>
                  )}
                  <p className="metadata-help">
                    These labels and field paths are included in the export.
                    Keep them free of private information.
                  </p>
                  <div className="export-files">
                    {(["before", "after", "manifest"] as const).map((part) => (
                      <button
                        key={part}
                        onClick={() => download(part)}
                        disabled={!canExport}
                      >
                        <Icon
                          name={part === "manifest" ? "book" : "code"}
                          size={17}
                        />
                        <span>
                          {part}.json
                          <small>
                            {part === "manifest"
                              ? "Rules, paths & comparison metadata"
                              : `Sanitized ${part === "before" ? "baseline" : "candidate"} payload`}
                          </small>
                        </span>
                        <Icon name="download" size={16} />
                      </button>
                    ))}
                  </div>
                  <div className="manifest-heading">
                    <h3>Manifest preview</h3>
                    <span>No original values</span>
                  </div>
                  {bundle ? (
                    <div className="manifest-code">
                      <CodeView
                        value={pretty(bundle.manifest)}
                        label="Export manifest"
                        compact
                      />
                    </div>
                  ) : (
                    <div className="empty-panel">
                      Add two valid JSON payloads to preview the manifest.
                    </div>
                  )}
                  <div className="export-footer">
                    <button
                      className="button light small"
                      disabled={!canExport}
                      onClick={() => void copy(bundle, "Fixture bundle")}
                    >
                      <Icon name="copy" size={14} />
                      Copy bundle
                    </button>
                    <button
                      className="button primary small"
                      disabled={!canExport}
                      onClick={() => download()}
                    >
                      <Icon name="download" size={14} />
                      Download bundle
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
          <aside className="review-panel" aria-label="Redaction review">
            <div className="review-title">
              <span className="review-icon">
                <Icon name="shield" size={20} />
              </span>
              <div>
                <h2>The review desk</h2>
                <span>Transparency, built in.</span>
              </div>
            </div>
            <div className="review-summary">
              <div>
                <strong>{redactions.length}</strong>
                <span>paths to review</span>
                <span className="review-status">
                  {reviewed ? "Reviewed" : "Needs a human"}
                </span>
              </div>
              <p>
                Rules catch common patterns. You decide what’s safe to share.
              </p>
            </div>
            <div className="redactions-heading">
              REDACTED PATHS <span>{totalRedactions} values</span>
            </div>
            <div className="redactions-list">
              {redactions.length ? (
                redactions
                  .slice(redactionPage * 50, (redactionPage + 1) * 50)
                  .map((item) => (
                    <div className="redaction-item" key={item.path}>
                      <span className="path-dot" />
                      <div>
                        <code>{displayPath(item.path)}</code>
                        <p>{pathReason(item)}</p>
                        <span className="side-pill">
                          {item.sides.length === 2
                            ? "before + after"
                            : item.sides[0]}
                        </span>
                      </div>
                    </div>
                  ))
              ) : (
                <p className="no-redactions">
                  {bundle
                    ? "No built-in rules matched. Review every field, or add a custom path below."
                    : "Load two valid payloads to see matching paths."}
                </p>
              )}
            </div>
            {redactions.length > 50 && (
              <div className="list-pagination">
                <button
                  aria-label="Previous redacted paths"
                  disabled={redactionPage === 0}
                  onClick={() => setRedactionPage(redactionPage - 1)}
                >
                  ←
                </button>
                <span>
                  {redactionPage * 50 + 1}–
                  {Math.min((redactionPage + 1) * 50, redactions.length)} of{" "}
                  {redactions.length}
                </span>
                <button
                  aria-label="Next redacted paths"
                  disabled={(redactionPage + 1) * 50 >= redactions.length}
                  onClick={() => setRedactionPage(redactionPage + 1)}
                >
                  →
                </button>
              </div>
            )}
            <button
              className="rules-toggle"
              aria-expanded={rulesOpen}
              onClick={() => setRulesOpen(!rulesOpen)}
            >
              <Icon name="plus" size={15} />
              Your redaction paths
              <Icon name="chevron" size={13} />
            </button>
            {rulesOpen && (
              <div className="custom-rules">
                <label htmlFor="custom-paths">One JSON Pointer per line</label>
                <textarea
                  id="custom-paths"
                  value={pointers}
                  onChange={(event) => {
                    setPointers(event.target.value);
                    resetReview();
                  }}
                  placeholder="/data/object/customer\n/metadata/internal_note"
                  spellCheck={false}
                />
                <p>
                  Use ~1 for / and ~0 for ~ in a key. Paths that don’t exist are
                  skipped.
                </p>
              </div>
            )}
            {!rulesOpen && pointers && (
              <p className="custom-count">
                {analysis.customPaths.length} custom path(s) active
              </p>
            )}
            {analysis.ruleError && (
              <p className="input-error" role="alert">
                {analysis.ruleError}
              </p>
            )}
            <div className="review-caution">
              <Icon name="warning" size={15} />
              <p>
                Rule-based redaction can miss sensitive data. Review values,
                field names, paths, and labels before sharing.
              </p>
            </div>
            <label className={`review-check ${reviewed ? "checked" : ""}`}>
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!bundle || loading.before || loading.after}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              <span>
                I’ve reviewed the sanitized payloads and export metadata.
              </span>
            </label>
            <p className="signature-note">
              Modified payloads cannot verify the original webhook signature.
            </p>
          </aside>
        </div>
        <footer className="workspace-footer">
          <span>Made for the messy, real-world edges.</span>
          <span>
            <Icon name="shield" size={13} />
            No payload uploads. No replay. No telemetry.
          </span>
        </footer>
      </main>
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      <dialog className="help-dialog" ref={help} aria-labelledby="guide-title">
        <div className="dialog-top">
          <span className="eyebrow">A LITTLE FIELD GUIDE</span>
          <button
            className="icon-button"
            onClick={() => help.current?.close()}
            aria-label="Close guide"
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="guide-title">Good fixtures start with a review.</h2>
        <p>
          FixtureFolio runs entirely in this tab. Paste or load two JSON values,
          inspect semantic differences, review redactions, then export the
          sanitized pair and manifest. Reloading clears your work.
        </p>
        <h3>What the comparison means</h3>
        <p>
          Object-key order is ignored. Arrays are compared by position, so
          inserting or reordering items can create several changes. JSON
          Pointers identify fields; an empty pointer means the document root.
        </p>
        <h3>What gets redacted</h3>
        <p>
          Exact normalized sensitive keys, email-like strings, and recognizable
          Stripe, GitHub, and Bearer tokens. A matching string or sensitive-key
          value is replaced entirely with [REDACTED]. Add explicit field paths
          for information the rules miss.
        </p>
        <details>
          <summary>
            Inspect the sensitive-key list (rules v{RULE_VERSION})
          </summary>
          <p className="key-rule-list">{SENSITIVE_KEY_RULES.join(", ")}</p>
        </details>
        <h3>Important boundaries</h3>
        <p>
          Redaction is heuristic, not a security guarantee. Names, addresses,
          unusual secrets, private field names, and custom data may remain.
          Metadata paths contain original field names. Review them along with
          your payloads and labels.
        </p>
        <p>
          Inputs are limited to 256 KiB, 10,000 JSON values, and depth 40 each.
          Large previews and review lists are paginated; exports include all
          values. Prototype-related keys, non-finite numbers, and unsafe
          integers are rejected. Encode large numeric identifiers as strings.
        </p>
        <p>
          These synthetic examples illustrate the workflow. Altered payloads
          cannot pass original signature verification. There is no network
          replay, API access, telemetry, or automatic persistence.
        </p>
        <button
          className="button primary"
          onClick={() => help.current?.close()}
        >
          Back to the workbench <Icon name="arrow" size={16} />
        </button>
      </dialog>
    </div>
  );
}
export default App;
