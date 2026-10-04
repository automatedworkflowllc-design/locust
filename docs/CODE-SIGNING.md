# Code signing policy

**Status (2026-10-04): Locust's Windows installer is not signed yet.** Windows
shows its "unknown publisher" warning when you install it, because the
installer carries no trusted signature, not because anything in it is
unsafe. This page is the policy Locust follows to get it signed, and will
follow once it is.

## Why

Locust runs AI coding agents on your own machine with the permissions you
give them. A signature on the installer lets Windows, and you, check that
the file you downloaded is the one this project built, byte for byte, and
that nobody changed it on the way.

## What is signed

Inside the Windows build, three files carry a signature: the application
executable (`Locust.exe`), its uninstaller, and the installer itself
(`Locust-<version>-setup.exe`). The macOS build is not covered by this
policy; it is unsigned until a Mac developer account exists.

## The certificate

Locust applies to [SignPath Foundation](https://signpath.org), which signs
open-source projects at no cost. The signing key lives on the foundation's
hardware security module and never leaves it; Locust's maintainers never
hold the key. The publisher shown by Windows is the foundation's, and the
certificate names this project.

Once signing is in place, this page and the project's homepage carry the
foundation's attribution: "Free code signing provided by SignPath.io,
certificate by SignPath Foundation." Until then nothing here is signed.

## How a release is built and signed

1. A release is a commit on `main` of the public repository,
   `automatedworkflowllc-design/locust-app`, exported from the private
   development repository at that release.
2. GitHub Actions builds the installer from that commit on a clean
   `windows-latest` runner (`.github/workflows/ci.yml`). The build uses no
   secrets and signs into no provider.
3. The build submits the installer to SignPath. Nothing is signed that was
   not built by that workflow from that commit.
4. A maintainer approves the signing request by hand, for every release.
   There is no automatic approval.
5. The signed installer, its block map and `latest.yml` are what the
   release publishes, so the app's updater installs the signed file.

Until SignPath accepts the project, step 3 and 4 do not run and the
workflow produces an unsigned build.

## Roles

| Role | Who |
| --- | --- |
| Committers and reviewers | Colin McCarthy |
| Approvers | Colin McCarthy |

A solo project at present: the reviewer and the approver are the same
person. Every member of the project uses two-factor authentication on
GitHub and on SignPath.

## Privacy

Locust does not collect or transmit information about you. On launch it
asks GitHub whether a newer version exists. Your messages to AI agents go to
the provider you signed in with, through that provider's own command-line
tool, only when you send them. Nothing else leaves your machine unless you
ask for it. See [SECURITY.md](../SECURITY.md).

## Reporting a tampered or suspicious binary

If an installer or executable claiming to be Locust fails its signature
check, or was not downloaded from this project's GitHub releases, report it
through the channel in [SECURITY.md](../SECURITY.md). Do not run it.
