---
name: check
description: Run every check CI runs (API typecheck, unit and e2e tests; dashboard typecheck and build; parent app analyze and tests) and report what passed or failed. Use before committing or pushing, or when asked to verify the project is green.
---

# Run the full check

Run these from the repo root, in order, and stop at the first failure to diagnose it. Show the command and the relevant error lines; don't paste the whole log.

1. **API**
   ```bash
   cd apps/api
   npx prisma generate
   npx tsc --noEmit -p .
   npm test
   npm run test:e2e
   ```
   - The e2e suite empties the database named in `TEST_DATABASE_URL`, which must end in `_test`. Its default is `postgresql://school:school@localhost:5432/school_test`.
   - If that database doesn't exist, say so and give the `CREATE DATABASE` line from `docs/TESTING.md` section 4. Never point the tests at a database that doesn't end in `_test`.
2. **Dashboard**
   ```bash
   cd apps/web
   npx tsc --noEmit -p .
   npm run build
   ```
   - `next build` overwrites `.next`, which can break a running `next dev`. If one is running, say so and suggest restarting it afterwards.
3. **Parent app** (skip with a note if Flutter isn't installed)
   ```bash
   cd apps/parent
   flutter analyze
   flutter test
   ```
4. **Firmware:** only if `firmware/` changed and PlatformIO is installed, run `cd firmware/gateway && pio run`.

## Report

End with one line per part (API / Dashboard / Parent app / Firmware): passed, failed (with the failing test or error), or skipped (and why).

If a test fails only at certain hours, treat it as a time-of-day bug to fix, not a flake. CLAUDE.md explains this rule.
