# Security policy

## Public-demo boundary

This repository is a standalone Articraft integration demo built against the
public Pascal Plugin API. Do not commit Pascal project data, private application
source, non-public deployment configuration or URLs, access tokens, API keys,
worker bearer tokens, service-role credentials, or populated environment files.

The browser package must never receive provider, worker, or storage credentials.
All credentialed operations belong behind authenticated same-origin host routes;
the example variable names in `.env.example` and `server/.env.example` must stay
empty.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or exposed
secret. Use the repository's **Security** tab to submit a private vulnerability
report. If a credential may have been exposed, revoke or rotate it immediately;
removing it from the latest commit is not sufficient because Git history and CI
logs may retain earlier values.

Public, non-sensitive defects can be reported through GitHub Issues.
