// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const exportButton = () =>
  screen.getByRole("button", { name: /Export fixture/ });
const review = () => screen.getByRole("checkbox", { name: /I’ve reviewed/ });
function edit(side: "before" | "after", value: string) {
  const title = side === "before" ? "Before" : "After";
  const existing = screen.queryByRole("textbox", {
    name: `${title} original JSON`,
  });
  if (!existing)
    fireEvent.click(
      screen.getByRole("button", { name: `Edit ${side} original` }),
    );
  fireEvent.change(
    screen.getByRole("textbox", { name: `${title} original JSON` }),
    { target: { value } },
  );
}

describe("FixtureFolio workbench", () => {
  it("loads a real synthetic example and requires a human review before export", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Keep the edge cases." }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Before sanitized JSON" }),
    ).toHaveTextContent("[REDACTED]");
    expect(screen.queryByText("alex@example.test")).not.toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    fireEvent.click(review());
    expect(exportButton()).toBeEnabled();
  });

  it.each(["before", "after"] as const)(
    "keeps the opposite preview alive when %s becomes invalid",
    (side) => {
      render(<App />);
      fireEvent.click(review());
      edit(side, '{"broken":');
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid JSON");
      const other = side === "before" ? "After" : "Before";
      expect(
        screen.getByRole("region", { name: `${other} sanitized JSON` }),
      ).toBeVisible();
      expect(exportButton()).toBeDisabled();
      expect(review()).not.toBeChecked();
      edit(side, '{"event":"recovered"}');
      fireEvent.click(
        screen.getByRole("button", { name: `Preview sanitized ${side}` }),
      );
      expect(
        screen.getByRole("region", {
          name: `${side === "before" ? "Before" : "After"} sanitized JSON`,
        }),
      ).toHaveTextContent("recovered");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("handles blank sessions, invalid pairs, null roots, and repeated example switches", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New blank fixture" }));
    expect(review()).toBeDisabled();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    edit("before", "null");
    edit("after", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview sanitized before" }),
    );
    expect(
      screen.getByRole("region", { name: "Before sanitized JSON" }),
    ).toHaveTextContent("null");
    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));
    expect(screen.getByText("(document root)")).toBeVisible();
    expect(
      screen.getByText("Type changed", { selector: "span" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /GitHub Pull request updated/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Stripe Payment succeeded/ }),
    );
    expect(
      screen.getByRole("region", { name: "After sanitized JSON" }),
    ).toHaveTextContent("2900");
    expect(review()).not.toBeChecked();
  });

  it("preserves spaces in exact JSON Pointer rules and rejects malformed paths", () => {
    render(<App />);
    edit("before", '{"private note ":"hidden","private note":"public"}');
    edit("after", '{"private note ":"hidden","private note":"public"}');
    fireEvent.click(
      screen.getByRole("button", { name: "Your redaction paths" }),
    );
    fireEvent.change(screen.getByLabelText("One JSON Pointer per line"), {
      target: { value: "/private note " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview sanitized before" }),
    );
    const preview = screen.getByRole("region", {
      name: "Before sanitized JSON",
    });
    expect(preview).toHaveTextContent("[REDACTED]");
    expect(preview).toHaveTextContent("public");
    expect(preview).not.toHaveTextContent("hidden");
    fireEvent.change(screen.getByLabelText("One JSON Pointer per line"), {
      target: { value: "/bad~3" },
    });
    expect(
      screen.getAllByText(/Invalid JSON Pointer escape/).length,
    ).toBeGreaterThan(0);
    expect(exportButton()).toBeDisabled();
  });

  it("shows redacted-only changes without leaking source values to the change list", () => {
    render(<App />);
    edit("before", '{"password":"first-private-value"}');
    edit("after", '{"password":"second-private-value"}');
    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));
    expect(
      screen.getByText("/password", { selector: ".change-row code" }),
    ).toBeVisible();
    expect(screen.queryByText("first-private-value")).not.toBeInTheDocument();
    expect(screen.queryByText("second-private-value")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter change type"), {
      target: { value: "added" },
    });
    expect(screen.getByText("No changes of this type")).toBeVisible();
  });

  it("resets review when export metadata or redaction rules change", () => {
    render(<App />);
    fireEvent.click(review());
    expect(exportButton()).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: "Export preview" }));
    fireEvent.change(screen.getByLabelText("Scenario"), {
      target: { value: "Updated case" },
    });
    expect(review()).not.toBeChecked();
    expect(exportButton()).toBeDisabled();
    fireEvent.click(review());
    expect(exportButton()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "" },
    });
    fireEvent.click(review());
    expect(exportButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "Custom" },
    });
    fireEvent.click(review());
    fireEvent.click(
      screen.getByRole("button", { name: "Your redaction paths" }),
    );
    fireEvent.change(screen.getByLabelText("One JSON Pointer per line"), {
      target: { value: "/id" },
    });
    expect(review()).not.toBeChecked();
  });

  it("copies only sanitized JSON and handles denied clipboard access", async () => {
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy sanitized before" }),
    );
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalled(),
    );
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(copied).toContain("[REDACTED]");
    expect(copied).not.toContain("alex@example.test");
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("Denied"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Copy sanitized after" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Clipboard access is unavailable",
      ),
    );
  });

  it("reads uploaded JSON, rejects oversized files, and handles read failure", async () => {
    render(<App />);
    const file = new File(["{}"], "test.json", { type: "application/json" });
    Object.assign(file, {
      text: async () => '{"message":"upload example@example.test"}',
    });
    fireEvent.change(screen.getByLabelText("Before JSON file"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Before sanitized JSON" }),
      ).toHaveTextContent("[REDACTED]"),
    );
    const large = new File([new Uint8Array(262145)], "large.json");
    fireEvent.change(screen.getByLabelText("Before JSON file"), {
      target: { files: [large] },
    });
    expect(screen.getByRole("status")).toHaveTextContent("larger than 256 KiB");
    const failed = new File(["{}"], "failed.json");
    Object.assign(failed, {
      text: async () => {
        throw new Error("Failed");
      },
    });
    fireEvent.change(screen.getByLabelText("After JSON file"), {
      target: { files: [failed] },
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("could not be read"),
    );
  });

  it("does not let a stale upload overwrite a newer scenario", async () => {
    render(<App />);
    let resolve: (value: string) => void = () => undefined;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    const file = new File(["{}"], "slow.json");
    Object.assign(file, { text: () => pending });
    fireEvent.change(screen.getByLabelText("Before JSON file"), {
      target: { files: [file] },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /GitHub Pull request updated/ }),
    );
    await act(async () => {
      resolve('{"stale":true}');
      await pending;
    });
    expect(
      screen.getByRole("region", { name: "Before sanitized JSON" }),
    ).toHaveTextContent("pull_request");
    expect(
      screen.getByRole("region", { name: "Before sanitized JSON" }),
    ).not.toHaveTextContent("stale");
  });

  it("supports keyboard tabs and a named, dismissible guide", () => {
    render(<App />);
    const payloadTab = screen.getByRole("tab", { name: "Payloads" });
    payloadTab.focus();
    fireEvent.keyDown(payloadTab, { key: "ArrowRight" });
    const changeTab = screen.getByRole("tab", { name: /Changes/ });
    expect(changeTab).toHaveFocus();
    expect(changeTab).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(changeTab, { key: "End" });
    expect(screen.getByRole("tab", { name: "Export preview" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Open guide" }));
    expect(
      screen.getByRole("dialog", {
        name: "Good fixtures start with a review.",
      }),
    ).toBeVisible();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close guide",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a named JSON download only after acknowledgement", () => {
    render(<App />);
    const create = vi.fn(() => "blob:fixture-test");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    fireEvent.click(exportButton());
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(review());
    fireEvent.click(exportButton());
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      "fixturefolio-payment-succeeded.json",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Only the sanitized result is included",
    );
  });

  it("paginates large previews and changes without creating an unbounded DOM", () => {
    render(<App />);
    edit("before", JSON.stringify(Array.from({ length: 650 }, () => 0)));
    edit("after", "[]");
    fireEvent.click(
      screen.getByRole("button", { name: "Preview sanitized before" }),
    );
    const region = screen.getByRole("region", {
      name: "Before sanitized JSON",
    });
    expect(region.querySelectorAll(".code-line")).toHaveLength(200);
    fireEvent.click(
      screen.getByRole("button", { name: "Before sanitized JSON next page" }),
    );
    expect(screen.getByText("Lines 201–400 of 652")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: /Changes/ }));
    expect(document.querySelectorAll(".change-row")).toHaveLength(100);
    fireEvent.click(screen.getByRole("button", { name: "Next changes" }));
    expect(screen.getByText("Page 2 of 7")).toBeVisible();
  });

  it("paginates all redacted paths so every result remains reviewable", () => {
    render(<App />);
    edit(
      "before",
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [
            `contact_${String(i).padStart(2, "0")}`,
            "demo@example.test",
          ]),
        ),
      ),
    );
    edit("after", "{}");
    expect(document.querySelectorAll(".redaction-item")).toHaveLength(50);
    fireEvent.click(
      screen.getByRole("button", { name: "Next redacted paths" }),
    );
    expect(document.querySelectorAll(".redaction-item")).toHaveLength(15);
    expect(
      screen.getByText("/contact_64", { selector: ".redaction-item code" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Next redacted paths" }),
    ).toBeDisabled();
  });
});
