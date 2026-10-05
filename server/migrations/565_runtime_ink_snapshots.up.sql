-- Migration 564 was already applied in some local installs; rename the live
-- runtime snapshot tables without rewriting that migration or losing state.
ALTER TABLE runtime_microloop_health RENAME TO runtime_ink_health;
ALTER TABLE runtime_microloop_sites RENAME TO runtime_ink_sites;
