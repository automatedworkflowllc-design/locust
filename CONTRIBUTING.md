# Contributing

This project is early and intentionally local-first. Contributions should preserve the product's trust boundaries: explicit runtime/model/provider identity, narrow permissions, durable action receipts, and checkpointed fallback.

## Development setup

Requirements: Node.js 22.22+ and pnpm 11.

```powershell
pnpm install
pnpm dev
```

Before opening a pull request, run:

```powershell
pnpm check
```

## Change guidelines

- Read `AGENTS.md`, `PROJECT.md`, and `docs/CROSS_TASK_CONTEXT.md` before substantial work.
- Keep runtime orchestration outside Electron's renderer.
- Never read, copy, log, pool, or export users' CLI credentials.
- Do not add permission-bypass flags to normal runtime paths.
- Use fake runners for automated adapter tests; CI must not require a personal AI account.
- Add or update tests for routing, approvals, cancellation, checkpoints, and side effects.
- Update the cross-task handoff when behavior or a durable architecture decision changes.

Small, focused pull requests are easiest to review. Describe the user-visible outcome, validation performed, and any security or data-boundary implications.
