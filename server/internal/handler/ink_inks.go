package handler

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type InkRuntimeHealth struct {
	RuntimeID string  `json:"runtime_id"`
	Status    string  `json:"status"`
	UpdatedAt *string `json:"updated_at,omitempty"`
}

type InkFastPathSite struct {
	RuntimeID         string  `json:"runtime_id"`
	SiteName          string  `json:"site_name"`
	SiteVersion       string  `json:"site_version"`
	Status            string  `json:"status"`
	Observations      int64   `json:"observations"`
	VerifiedOutcomes  int64   `json:"verified_outcomes"`
	FastServed        int64   `json:"fast_served"`
	Coverage          float64 `json:"coverage"`
	FalseServes       int64   `json:"false_serves"`
	LastMaintenance   *string `json:"last_maintenance,omitempty"`
	ModelCallsAvoided *int64  `json:"model_calls_avoided,omitempty"`
	SavingsBasis      string  `json:"savings_basis,omitempty"`
	UpdatedAt         string  `json:"updated_at"`
}

type InkFastPathsResponse struct {
	Runtimes []InkRuntimeHealth `json:"runtimes"`
	Sites    []InkFastPathSite  `json:"sites"`
}

func (h *Handler) ListWorkspaceInkFastPaths(w http.ResponseWriter, r *http.Request) {
	if h.DB == nil {
		writeError(w, http.StatusInternalServerError, "database unavailable")
		return
	}
	workspaceID, ok := parseUUIDOrBadRequest(w, h.resolveWorkspaceID(r), "workspace_id")
	if !ok {
		return
	}
	out := InkFastPathsResponse{Runtimes: []InkRuntimeHealth{}, Sites: []InkFastPathSite{}}
	runtimeRows, err := h.DB.Query(r.Context(), `SELECT rt.id::text, COALESCE(mh.status,'unavailable'), mh.updated_at
		FROM agent_runtime rt LEFT JOIN runtime_ink_health mh ON mh.runtime_id=rt.id
		WHERE rt.workspace_id=$1 ORDER BY rt.id`, workspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read Ink runtime health")
		return
	}
	for runtimeRows.Next() {
		var item InkRuntimeHealth
		var updated pgtype.Timestamptz
		if err := runtimeRows.Scan(&item.RuntimeID, &item.Status, &updated); err != nil {
			runtimeRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to read Ink runtime health")
			return
		}
		if updated.Valid {
			value := updated.Time.UTC().Format(time.RFC3339Nano)
			item.UpdatedAt = &value
		}
		out.Runtimes = append(out.Runtimes, item)
	}
	if err := runtimeRows.Err(); err != nil {
		runtimeRows.Close()
		writeError(w, http.StatusInternalServerError, "failed to read Ink runtime health")
		return
	}
	runtimeRows.Close()
	siteRows, err := h.DB.Query(r.Context(), `SELECT DISTINCT ON (s.runtime_id,s.site_name)
		s.runtime_id::text,s.site_name,s.site_version,s.status,s.observations,s.verified_outcomes,s.fast_served,s.coverage,s.false_serves,
		s.last_maintenance,s.model_calls_avoided,COALESCE(s.savings_basis,''),s.updated_at
		FROM runtime_ink_sites s JOIN agent_runtime rt ON rt.id=s.runtime_id
		WHERE rt.workspace_id=$1 ORDER BY s.runtime_id,s.site_name,s.updated_at DESC`, workspaceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read FastPath snapshots")
		return
	}
	for siteRows.Next() {
		var item InkFastPathSite
		var last pgtype.Timestamptz
		var avoided pgtype.Int8
		var updated pgtype.Timestamptz
		if err := siteRows.Scan(&item.RuntimeID, &item.SiteName, &item.SiteVersion, &item.Status, &item.Observations, &item.VerifiedOutcomes, &item.FastServed, &item.Coverage, &item.FalseServes, &last, &avoided, &item.SavingsBasis, &updated); err != nil {
			siteRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to read FastPath snapshots")
			return
		}
		if last.Valid {
			value := last.Time.UTC().Format(time.RFC3339Nano)
			item.LastMaintenance = &value
		}
		if avoided.Valid && item.SavingsBasis == "declared_and_validated_fixed_call_count" {
			value := avoided.Int64
			item.ModelCallsAvoided = &value
		}
		item.UpdatedAt = updated.Time.UTC().Format(time.RFC3339Nano)
		out.Sites = append(out.Sites, item)
	}
	if err := siteRows.Err(); err != nil {
		siteRows.Close()
		writeError(w, http.StatusInternalServerError, "failed to read FastPath snapshots")
		return
	}
	siteRows.Close()
	writeJSON(w, http.StatusOK, out)
}
