-- The local owner has no account email. Account creation is not part of the
-- desktop product; the legacy field remains nullable for upgrade compatibility.
ALTER TABLE "user" ALTER COLUMN email DROP NOT NULL;
