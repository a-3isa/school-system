---
name: run-local
description: Start the whole system locally (API, demo school, staff dashboard, parent app) so a change can be seen in the browser. Use when asked to run, start or demo the app, or to look at a screen.
---

# Run the system locally

`docs/TESTING.md` is the full guide; this is the short version.

## Before starting

- `apps/api/.env` must exist (copied from `.env.example`). It needs `DATABASE_URL` pointing at a development database (e.g. `school_dev`) and a `JWT_SECRET`. If it's missing, stop and tell Ahmed what to put in it.
- Run `npx prisma migrate dev` in `apps/api` to apply new migrations. **Never run `migrate reset` without asking**: it deletes Ahmed's local data.

## Start (each in its own background shell)

1. **API:** `cd apps/api && npm run start:dev`, which serves http://localhost:3000/api. Wait until it answers: `curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/auth/me` returns 401.
2. **Demo school**, only if there is none yet:
   - Ask Ahmed for the owner email and password he seeded with.
   - Run `cd apps/api && OWNER_EMAIL=… OWNER_PASSWORD=… npx ts-node scripts/demo.ts`.
   - On Sunday to Thursday this also plays the school day so far. On Friday and Saturday it says so; that is expected.
3. **Dashboard:** `cd apps/web && npm run dev`, which serves http://localhost:3001.
4. **Parent app:** `cd apps/parent && flutter run -d chrome --dart-define=API_URL=http://localhost:3000/api`.

## Demo accounts

| Who | Email | Password |
|---|---|---|
| Student Affairs (admin) | admin@demo.school (Ms. Samia Adel) | demo-admin-1 |
| Teacher | hana@demo.school (Ms. Hana Nabil) | demo-teacher-1 |
| Parents | parent1@demo.school … parent23@demo.school | demo-parent-1 |

Sign-up and password codes are printed in the API's log until `SMTP_URL` and `WHATSAPP_*` are set.

## When done

Tell Ahmed which URLs are running. Leave them running unless he asks you to stop them.
