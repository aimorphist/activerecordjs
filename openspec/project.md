# Project context

This file is conventions. It is not a requirements store. Requirements live
in `openspec/specs/` (what is built) and `openspec/changes/` (what should
change).

## Where work lands

| Kind of work | Lands in |
|---|---|
| New or changed behavior | `openspec/changes/<verb-led-id>/` |
| Restore intended behavior, typo, pin, comment, test for existing spec | Direct fix. No change. |
| Hard-won fact | `docs/LEARNINGS.md` |
| Work-graph state | beads (`bd`) |
