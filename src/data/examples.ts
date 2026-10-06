import type { JsonValue } from "../core";

export interface FixtureExample {
  id: string;
  name: string;
  provider: string;
  description: string;
  before: JsonValue;
  after: JsonValue;
}

/** Entirely synthetic examples. Not captured production events or API contracts. */
export const stripeExample: FixtureExample = {
  id: "stripe-payment",
  name: "Payment succeeded",
  provider: "Stripe",
  description:
    "A payment event gains a field, changes an amount, and moves metadata from a string to an object.",
  before: {
    id: "evt_fixture_001",
    object: "event",
    type: "payment_intent.succeeded",
    api_version: "2024-06-20",
    livemode: false,
    data: {
      object: {
        id: "pi_fixture_001",
        object: "payment_intent",
        amount: 2400,
        currency: "usd",
        status: "succeeded",
        receipt_email: "alex@example.test",
        client_secret: "pi_fixture_001_secret_synthetic_NOT_REAL",
        payment_method_types: ["card"],
        metadata: { order_id: "order_demo_042", campaign: "autumn" },
      },
    },
  },
  after: {
    id: "evt_fixture_002",
    object: "event",
    type: "payment_intent.succeeded",
    api_version: "2024-06-20",
    livemode: false,
    data: {
      object: {
        id: "pi_fixture_001",
        object: "payment_intent",
        amount: 2900,
        currency: "usd",
        status: "succeeded",
        receipt_email: "alex@example.test",
        client_secret: "pi_fixture_001_secret_synthetic_NOT_REAL",
        payment_method_types: ["card", "link"],
        metadata: {
          order_id: "order_demo_042",
          campaign: { name: "autumn", source: "newsletter" },
        },
        amount_received: 2900,
      },
    },
  },
};

export const githubExample: FixtureExample = {
  id: "github-pull-request",
  name: "Pull request updated",
  provider: "GitHub",
  description:
    "A synthetic pull request webhook changes state, adds a label, and removes a draft-only field.",
  before: {
    action: "opened",
    number: 42,
    repository: {
      id: 101,
      name: "demo-checkout",
      full_name: "fixture-labs/demo-checkout",
      private: false,
    },
    pull_request: {
      number: 42,
      title: "Handle updated payment events",
      state: "open",
      draft: true,
      merged: false,
      labels: [{ name: "webhooks", color: "14b8a6" }],
      user: { login: "fixture-dev", email: "developer@example.test" },
      body: "Follow up with developer@example.test before merging.",
      review_note: "Draft review requested",
    },
    sender: { login: "fixture-dev", id: 9001 },
  },
  after: {
    action: "closed",
    number: 42,
    repository: {
      id: 101,
      name: "demo-checkout",
      full_name: "fixture-labs/demo-checkout",
      private: false,
    },
    pull_request: {
      number: 42,
      title: "Handle updated payment events",
      state: "closed",
      draft: false,
      merged: true,
      labels: [
        { name: "webhooks", color: "14b8a6" },
        { name: "ready", color: "22c55e" },
      ],
      user: { login: "fixture-dev", email: "developer@example.test" },
      body: "Reviewed. Questions: developer@example.test.",
      merged_at: "2026-10-01T12:00:00Z",
    },
    sender: { login: "fixture-dev", id: 9001 },
  },
};

export const examples: FixtureExample[] = [stripeExample, githubExample];
export default examples;
