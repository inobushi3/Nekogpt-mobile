# Connection page lock

The connection/home page is intentionally frozen at the visual state from commit `a1d100fb8658b1b6ed0149b6a3afa03cf6922dcb` (2026-09-12).

Do not change the connection page while working on the companion/chat page.

Protected surface:

- `src/components/ConnectionGate.tsx`
- `src/connection-background.ts`
- `src/background-static.css`
- `src/connection-gate-polish.css`
- `src/connection-code-strip.css`
- `src/connection-status-hide.css`
- `src/connection-settings-round.css`
- `src/connection-options-panel.css`
- `src/connection-card-transparent.css`
- the connection-page CSS section in `src/styles.css`

Rules for future work:

1. Changes for the companion/chat page must stay scoped under `.companion-screen` (or its descendants).
2. Do not add generic `button`, `input`, `select`, `label`, `section`, `main`, `body`, or `#root` rules in new page-specific stylesheets.
3. Do not move connection CSS imports below/around unrelated page CSS without explicitly testing the connection page.
4. If a connection-page change is intentional, update the lock only after manual visual verification.
5. Recovery snapshot branch: `locked/connection-page-perfect-20260912`.

This file exists to make the boundary explicit so edits to the other page do not accidentally regress the connection screen.
