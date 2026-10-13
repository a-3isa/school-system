-- Modules that are not built yet are switched off for every school. Only the
-- switches change; nothing is deleted, and the owner can still see the plan
-- definitions in the code.
UPDATE "SchoolModule" SET "enabled" = false
WHERE "key" IN ('transport', 'canteen', 'payments', 'homework', 'admissions', 'reports');
