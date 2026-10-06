package localidentity

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ownerID     = "00000000-0000-4000-8000-000000000001"
	workspaceID = "00000000-0000-4000-8000-000000000002"
)

// Ensure creates the stable internal owner, workspace, and owner membership.
// These records are local storage identity only; they do not represent a
// registered account and intentionally have no email address.
func Ensure(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("local identity requires a database pool")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin local identity transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		INSERT INTO "user" (id, name, email, onboarded_at)
		VALUES ($1::uuid, 'Local owner', NULL, now())
		ON CONFLICT (id) DO UPDATE SET
			email = NULL,
			onboarded_at = COALESCE("user".onboarded_at, now())`, ownerID); err != nil {
		return fmt.Errorf("ensure local owner: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO workspace (id, name, slug, description)
		VALUES ($1::uuid, 'Inkway', 'inkway-local', 'Local Inkway workspace')
		ON CONFLICT (id) DO NOTHING`, workspaceID); err != nil {
		return fmt.Errorf("ensure local workspace: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO member (workspace_id, user_id, role)
		VALUES ($1::uuid, $2::uuid, 'owner')
		ON CONFLICT (workspace_id, user_id) DO NOTHING`, workspaceID, ownerID); err != nil {
		return fmt.Errorf("ensure local owner membership: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit local identity: %w", err)
	}
	return nil
}

func IDs() (userID, workspaceIDValue string) {
	return ownerID, workspaceID
}
