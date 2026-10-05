package handler

import (
	"testing"
	"time"

	"github.com/Devaretanmay/inkway/server/internal/ink"
)

func TestValidateInkSnapshot(t *testing.T) {
	version := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	outcomes := int64(2)
	base := ink.Snapshot{Status:"connected", Sites:[]ink.SiteHealth{{
		Name:"coding_agent.recovery_action", Version:version, Status:"OBSERVE", Observations:3,
		VerifiedOutcomes:2, FastServed:0, Coverage:0, FalseServes:0, ModelCallsAvoided:&outcomes,
		SavingsBasis:"declared_and_validated_fixed_call_count", LastMaintenance:ptrTime(time.Now().UTC()),
	}}}
	if !validateInkSnapshot(&base) { t.Fatal("valid SDK-derived snapshot rejected") }
	for name, mutate := range map[string]func(*ink.Snapshot){
		"unknown site": func(s *ink.Snapshot) { s.Sites[0].Name="other.site" },
		"invalid hash": func(s *ink.Snapshot) { s.Sites[0].Version="not-a-contract-hash" },
		"invalid lifecycle": func(s *ink.Snapshot) { s.Sites[0].Status="ACTIVE-ish" },
		"fake savings basis": func(s *ink.Snapshot) { s.Sites[0].SavingsBasis="guessed" },
		"impossible outcomes": func(s *ink.Snapshot) { s.Sites[0].VerifiedOutcomes=4 },
	} {
		t.Run(name, func(t *testing.T) { snapshot:=base; snapshot.Sites=append([]ink.SiteHealth(nil),base.Sites...); mutate(&snapshot); if validateInkSnapshot(&snapshot) { t.Fatal("invalid snapshot accepted") } })
	}
}

func ptrTime(value time.Time) *time.Time { return &value }
