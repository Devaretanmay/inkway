-- Rollback is intentionally blocked when a local owner has a NULL email.
-- Preserve local product data instead of inventing an account address.
ALTER TABLE "user" ALTER COLUMN email SET NOT NULL;
