package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/Devaretanmay/inkway/server/internal/migrations"
)

// TestPhase5RepresentativeUpgrade exercises the supported upgrade boundary:
// the latest schema before the Ink runtime migration (563), populated
// with real workspace/issue/agent/runtime/run rows, upgraded through 564.
// It is enabled explicitly because it creates a temporary database.
func TestPhase5RepresentativeUpgrade(t *testing.T) {
	if os.Getenv("INK_MIGRATION_UPGRADE_TEST") != "1" {
		t.Skip("set INK_MIGRATION_UPGRADE_TEST=1 to run the disposable upgrade fixture")
	}
	sourceURL := os.Getenv("DATABASE_URL")
	if sourceURL == "" {
		t.Fatal("DATABASE_URL is required for the disposable migration upgrade fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	adminURL, err := url.Parse(sourceURL)
	if err != nil {
		t.Fatal(err)
	}
	adminURL.Path = "/postgres"
	adminURL.RawPath = ""
	admin, err := pgx.Connect(ctx, adminURL.String())
	if err != nil {
		t.Fatalf("connect to database server: %v", err)
	}
	defer admin.Close(context.Background())
	databaseName := fmt.Sprintf("ink_upgrade_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, `CREATE DATABASE "`+databaseName+`"`); err != nil {
		t.Fatalf("create disposable database: %v", err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), `DROP DATABASE IF EXISTS "`+databaseName+`" WITH (FORCE)`)
	})
	targetURL, err := url.Parse(sourceURL)
	if err != nil {
		t.Fatal(err)
	}
	targetURL.Path = "/" + databaseName
	targetURL.RawPath = ""
	pool, err := pgxpool.New(ctx, targetURL.String())
	if err != nil {
		t.Fatalf("connect to disposable database: %v", err)
	}
	defer pool.Close()

	all, err := migrations.Files("up")
	if err != nil || len(all) < 2 {
		t.Fatalf("load migrations: count=%d err=%v", len(all), err)
	}
	preInk := all[:len(all)-1]
	latest := all[len(all)-1:]
	if !strings.HasPrefix(migrations.ExtractVersion(preInk[len(preInk)-1]), "563_") ||
		!strings.HasPrefix(migrations.ExtractVersion(latest[0]), "564_") {
		t.Fatalf("upgrade boundary changed: previous=%s latest=%s", migrations.ExtractVersion(preInk[len(preInk)-1]), migrations.ExtractVersion(latest[0]))
	}
	if err := runMigrations(ctx, pool, runOptions{
		Direction: "up", Files: preInk, Hooks: hooksForDirection("up"), Conditions: conditionsForDirection("up"),
	}); err != nil {
		t.Fatalf("apply historical schema through 563: %v", err)
	}

	var userID, workspaceID, runtimeID, agentID, issueID string
	if err := pool.QueryRow(ctx, `INSERT INTO "user" (name,email) VALUES ('Phase 5 upgrade fixture','phase5-upgrade@example.test') RETURNING id`).Scan(&userID); err != nil {
		t.Fatalf("seed historical user: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO workspace (name,slug,description,issue_prefix) VALUES ('Upgrade fixture','phase5-upgrade','fixture data','UPG') RETURNING id`).Scan(&workspaceID); err != nil {
		t.Fatalf("seed historical workspace: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO member (workspace_id,user_id,role) VALUES ($1,$2,'owner')`, workspaceID, userID); err != nil {
		t.Fatalf("seed historical workspace member: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO agent_runtime (workspace_id,name,runtime_mode,provider,status,device_info,metadata,owner_id,last_seen_at) VALUES ($1,'Upgrade fixture Codex','local','codex','online','Historical local runtime','{}'::jsonb,$2,now()) RETURNING id`, workspaceID, userID).Scan(&runtimeID); err != nil {
		t.Fatalf("seed historical runtime: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO agent (workspace_id,name,description,runtime_mode,runtime_config,runtime_id,visibility,max_concurrent_tasks,owner_id,instructions,custom_env,custom_args) VALUES ($1,'Upgrade fixture agent','fixture CLI agent','local','{}'::jsonb,$2,'workspace',1,$3,'','{}'::jsonb,'[]'::jsonb) RETURNING id`, workspaceID, runtimeID, userID).Scan(&agentID); err != nil {
		t.Fatalf("seed historical agent: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO issue (workspace_id,title,status,priority,creator_type,creator_id,number) VALUES ($1,'Upgrade fixture issue','todo','low','member',$2,1) RETURNING id`, workspaceID, userID).Scan(&issueID); err != nil {
		t.Fatalf("seed historical issue: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO agent_task_queue (agent_id,issue_id,status,priority,context,runtime_id) VALUES ($1,$2,'queued',2,'{}'::jsonb,$3)`, agentID, issueID, runtimeID); err != nil {
		t.Fatalf("seed historical run: %v", err)
	}
	if err := runMigrations(ctx, pool, runOptions{
		Direction: "up", Files: latest, Hooks: hooksForDirection("up"), Conditions: conditionsForDirection("up"),
	}); err != nil {
		t.Fatalf("upgrade historical schema through latest: %v", err)
	}
	var got struct {
		WorkspaceSlug, IssueTitle, AgentName, RuntimeName, RunStatus string
	}
	if err := pool.QueryRow(ctx, `SELECT w.slug,i.title,a.name,r.name,q.status FROM workspace w JOIN issue i ON i.workspace_id=w.id JOIN agent a ON a.workspace_id=w.id JOIN agent_runtime r ON r.id=a.runtime_id JOIN agent_task_queue q ON q.agent_id=a.id AND q.issue_id=i.id WHERE w.id=$1`, workspaceID).Scan(&got.WorkspaceSlug, &got.IssueTitle, &got.AgentName, &got.RuntimeName, &got.RunStatus); err != nil {
		t.Fatalf("application query could not read upgraded records: %v", err)
	}
	if got.WorkspaceSlug != "phase5-upgrade" || got.IssueTitle != "Upgrade fixture issue" || got.AgentName != "Upgrade fixture agent" || got.RuntimeName != "Upgrade fixture Codex" || got.RunStatus != "queued" {
		t.Fatalf("historical records changed after upgrade: %+v", got)
	}
}
