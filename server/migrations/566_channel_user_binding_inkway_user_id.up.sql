-- Keep the internal identity column aligned with Inkway's current product
-- name while preserving every existing binding row and index.
ALTER TABLE channel_user_binding
    RENAME COLUMN multica_user_id TO inkway_user_id;
