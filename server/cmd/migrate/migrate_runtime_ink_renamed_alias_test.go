package main

import (
	"context"
	"fmt"
	"math/rand/v2"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestRuntimeInkRenamedMigrationSkipsEquivalentLegacySchema(t *testing.T) {
	t.Parallel()
	admin := openTestPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	schema := fmt.Sprintf("migrate_runtime_ink_alias_%d_%d", time.Now().UnixNano(), rand.Uint32())
	ident := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+ident); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := admin.Exec(cleanupCtx, "DROP SCHEMA IF EXISTS "+ident+" CASCADE"); err != nil {
			t.Errorf("drop schema: %v", err)
		}
	})
	pool := openTestPoolWithSearchPath(t, schema)
	if _, err := pool.Exec(ctx, `CREATE TABLE agent_runtime (id UUID PRIMARY KEY);
		CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	files := realMigrationFiles(t, []string{"564_runtime_ink_snapshots"}, "up")
	if _, err := pool.Exec(ctx, "INSERT INTO agent_runtime (id) VALUES ('00000000-0000-0000-0000-000000000001')"); err != nil {
		t.Fatal(err)
	}
	// Historical installations applied the same DDL while it still carried
	// the old product name. Preserve its recorded version and existing data.
	sql, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(sql)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO runtime_microloop_health (runtime_id, status)
		VALUES ('00000000-0000-0000-0000-000000000001', 'connected')`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ('564_runtime_microloop_snapshots')"); err != nil {
		t.Fatal(err)
	}
	options := runOptions{
		Direction: "up", Files: files, SchemaMigrationsTable: schema + ".schema_migrations",
		AdvisoryLockKey: int64(rand.Uint64()&0x7fffffffffffffff) | 1,
	}
	if err := runMigrations(ctx, pool, options); err != nil {
		t.Fatalf("apply renamed migration: %v", err)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM runtime_microloop_health").Scan(&count); err != nil || count != 1 {
		t.Fatalf("preserved runtime health rows = %d, error = %v", count, err)
	}
	for _, version := range []string{"564_runtime_microloop_snapshots", "564_runtime_ink_snapshots"} {
		var recorded bool
		if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)", version).Scan(&recorded); err != nil || !recorded {
			t.Fatalf("migration %q recorded = %t, error = %v", version, recorded, err)
		}
	}
}
