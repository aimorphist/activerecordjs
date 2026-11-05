# OpenSpec-lite

Instructions for agents working with the Intention plugin.

## Before any task

- [ ] Living truth is `openspec/specs/<capability>/spec.md`, not a SHALL in
      `changes/` or `docs/`.
- [ ] `changes/` is not a mandate. Read the disposition banner. PENDING is
      a draft. PARKED is not work. Archived means folded — do not implement it.
- [ ] Restore-only, typo, pin, comment, test-for-existing-spec: fix directly.
      Do not scaffold a change.
- [ ] New behavior: verb-led `change-id`, `proposal.md` + `tasks.md` + deltas.
      `design.md` only when cross-cutting.
- [ ] Do not start write work on PENDING or PARKED. Wait for ACTIVE BUILD.

## Deltas, not rewrites

```
## ADDED Requirements
### Requirement: <name>
The system SHALL …
#### Scenario: <name>
- GIVEN …
- WHEN …
- THEN …
```

`MODIFIED` pastes the entire living requirement, then edits, and stamps
a base blob with `fold_base.py`. `REMOVED` names the requirement and
stamps the same way. `fold` refuses a stale base and applies nothing.
A missing base is diffed by hand once, not a hard fail. `fold` applies
deltas to `specs/` and moves the
change to `changes/archive/YYYY-MM-DD-<id>/`.
