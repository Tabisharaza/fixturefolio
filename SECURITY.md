# Security and sensitive data

FixtureFolio helps you review JSON before using it as test data. Its rule-based
redaction can miss sensitive content. A clean review list is not proof that a
payload is safe to share.

## Before using or sharing a fixture

- Prefer synthetic input. Never put real customer data, credentials, signing
  secrets, access tokens, or private payloads into a public issue or pull request.
- Review the entire exported JSON, metadata, filenames, and test assertions.
  Personal data can appear in free text, object keys, identifiers, or unexpected
  fields. Add explicit path rules where needed.
- Treat source input, the browser tab, the clipboard, and downloaded files as
  sensitive until you have checked them. Local processing does not protect
  against browser extensions, screen sharing, or a compromised device.
- Redaction and JSON serialization change bytes. An edited export cannot retain
  the validity of an original webhook signature. Keep signature verification
  tests separate and use synthetic data with test-only secrets.

The application is designed to process payloads in the browser without a payload
backend, telemetry, or automatic persistence. Loading the app or installing its
dependencies still involves network requests. Your hosting provider and local
browser environment have their own behavior and policies.

## Reporting a vulnerability

Use GitHub's private **Report a vulnerability** option if it is available in this
repository's Security tab. If private reporting is unavailable, open an issue
asking for a private reporting channel without publishing the vulnerability or
sensitive data. Do not attach credentials, production payloads, exploit details,
or customer information to that public request.

A helpful private report includes the affected commit, reproduction steps using
synthetic input, expected and observed behavior, and potential impact. This is an
early-stage community project; no response SLA or independent security audit is
claimed.

For an accidentally exposed credential, revoke or rotate it at its issuer.
Deleting a public issue or commit does not reliably remove all copies.
