# Security

## Reporting a vulnerability

Report security issues privately by email to support@locust.lol, with
"Security" in the subject. Please do not open a public issue for a security
report.

## Code signing

The Windows installer is not signed yet. The policy for signing it, and how
to report a binary that fails its signature check, is in
[docs/CODE-SIGNING.md](docs/CODE-SIGNING.md).

## What this software is

Locust is a local-first desktop application. It sends no telemetry, it
creates no account, and it runs no server on the internet. Its only
listeners are on this computer (`127.0.0.1`): one that Claude Code asks
before a connector call, and, only if you turn it on in Settings, one that
lets your other AI apps ask your teammates. Runtimes and models run through
the tools and accounts already on your machine. Everything Locust itself
sends over the network is listed in [docs/NETWORK.md](docs/NETWORK.md).
