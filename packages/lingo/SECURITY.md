# Security policy

## Supported versions

Only the latest published version of `@pascal-app/lingo` receives security
fixes.

## Reporting a vulnerability

lingo is a zero-dependency parsing library with no network or filesystem
access, but parser bugs can still have security impact (e.g. pathological
inputs causing denial of service, or `/ai` tool-boundary bypasses that let
malformed LLM output through validation).

Please report vulnerabilities privately to **security@pascal.app** — do not
open a public issue. Include the input that triggers the problem and the
version you tested. You can expect an acknowledgement within a week; fixes
ship as a patch release with credit unless you prefer otherwise.
