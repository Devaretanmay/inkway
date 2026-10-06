package handler

import (
	"net/http"
	"os"
	"strings"

	"github.com/Devaretanmay/inkway/server/internal/featureflags"
)

type AppConfig struct {
	CdnDomain string `json:"cdn_domain"`
	// CdnSigned tells clients that the CDN domain above serves PRIVATE
	// content through time-bounded signed URLs (CloudFront signing is
	// enabled). When true, a raw storage URL on the CDN domain is NOT
	// publicly fetchable — renderers must not pick it as a native
	// <img>/<video> source and should fall back to the per-attachment
	// API endpoint or a freshly signed download_url instead (MUL-3254).
	// Omitted when false so older clients see the previous shape.
	CdnSigned bool `json:"cdn_signed,omitempty"`
	// WorkspaceCreationDisabled mirrors the server-side
	// DISABLE_WORKSPACE_CREATION env var so the UI can hide every
	// "Create workspace" affordance on self-hosted instances. Omitted
	// from the JSON when false to keep responses identical to the
	// previous shape for the common managed-cloud case (#3433).
	WorkspaceCreationDisabled bool `json:"workspace_creation_disabled,omitempty"`
	// Public daemon setup config consumed by the web app at runtime so
	// self-hosted instances can show `inkway setup self-host` commands
	// with the operator's own domains instead of Inkway Cloud defaults.
	DaemonServerURL string `json:"daemon_server_url,omitempty"`
	DaemonAppURL    string `json:"daemon_app_url,omitempty"`

	// VCSIntegrationAvailable mirrors the INKWAY_VCS_INTEGRATION_ENABLED
	// deployment switch so the Settings UI can hide the whole self-hosted Git
	// provider section on deployments where it is off (the managed cloud),
	// instead of rendering it and surfacing an operator-only "missing
	// INKWAY_VCS_SECRET_KEY" hint a cloud user cannot resolve. Omitted when
	// false so the managed-cloud response keeps its previous shape; the UI
	// defaults absent to false (hidden).
	VCSIntegrationAvailable bool `json:"vcs_integration_available,omitempty"`

	// FeatureFlags exposes only frontend-safe boolean decisions. Do not dump
	// raw rules here: /api/config is public and may be called anonymously.
	FeatureFlags map[string]bool `json:"feature_flags,omitempty"`

	// LocalWorktreeSupported tells clients this server understands
	// local_directory `execution_mode` and enforces the worktree capability
	// gate when a resource is saved.
	//
	// Load-bearing for CLIENTS, not for this server. Releases before v0.4.25
	// unmarshalled the ref into a struct without the field and re-marshalled
	// it, so `execution_mode: "worktree"` was silently DROPPED and answered
	// 201 — the resource then ran in_place, editing the working copy the user
	// asked to isolate, with no gate anywhere to catch it. A new client cannot
	// tell that from success, so it has to ask first, and absent has to read as
	// "cannot honour it": every release that drops the field also omits this
	// one. Releases between that fix and this signal do gate the save but say
	// nothing, so they are treated the same way — the client cannot distinguish
	// them, and only one of the two guesses is safe.
	LocalWorktreeSupported bool `json:"local_worktree_supported"`

	// AgentConversationStartersSupported tells independently deployed clients
	// that agent create/update persists conversation_starters. Older handlers
	// ignored the unknown JSON field and still returned success, so clients
	// must fail closed when this declaration is absent.
	AgentConversationStartersSupported bool `json:"agent_conversation_starters_supported"`

	// IssueCreatePropertiesSupported tells independently deployed clients that
	// POST /api/issues validates and persists the optional properties bag.
	// Older handlers silently ignore unknown fields, so clients with values must
	// fail closed when this declaration is absent.
	IssueCreatePropertiesSupported bool `json:"issue_create_properties_supported"`

	// CommentDeleteKeepRepliesSupported tells clients that deleting a comment
	// removes only that comment and keeps its replies (#8296), and that
	// DELETE /api/comments/{id}/keep-replies exists. Older servers deleted the
	// replies too and omit this, so clients must promise nothing about
	// replies unless it is declared.
	CommentDeleteKeepRepliesSupported bool `json:"comment_delete_keep_replies_supported"`

	// ServerVersion is the running API build version, so self-hosted
	// operators can confirm what's deployed and include it in bug reports.
	// Only emitted on self-hosted deployments — omitted on the managed cloud,
	// which is continuously deployed so its users can't act on the version —
	// and empty for dev builds that aren't stamped via -X main.version.
	ServerVersion string `json:"server_version,omitempty"`
}

// GetConfig is mounted on the public (unauthenticated) route group because
// the web app calls it before login to decide whether to render the Google
// sign-in button and signup UI. Only add fields here that are safe to expose
// to anonymous callers — never user- or tenant-scoped data.
func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	config := AppConfig{
		// A property of this build, not of the deployment: if this code is
		// running, the save gate is running with it.
		LocalWorktreeSupported:             true,
		AgentConversationStartersSupported: true,
		IssueCreatePropertiesSupported:     true,
		CommentDeleteKeepRepliesSupported:  true,
		WorkspaceCreationDisabled:          os.Getenv("DISABLE_WORKSPACE_CREATION") == "true",
	}
	if h.Storage != nil {
		config.CdnDomain = h.Storage.CdnDomain()
	}
	config.CdnSigned = h.CFSigner != nil
	config.DaemonServerURL, config.DaemonAppURL = daemonSetupURLsFromEnv()
	config.VCSIntegrationAvailable = h.cfg.VCSIntegrationEnabled
	config.FeatureFlags = featureflags.EvaluateFrontendPublicFlags(r.Context(), h.FeatureFlags)
	config.ServerVersion = h.cfg.ServerVersion

	// Re-read from env on every request so operators can rotate keys via
	// secret refresh without a server restart.
	if v := os.Getenv("ANALYTICS_DISABLED"); v != "true" && v != "1" {
	}

	writeJSON(w, http.StatusOK, config)
}

func daemonSetupURLsFromEnv() (string, string) {
	serverURL := normalizePublicURL(os.Getenv("INKWAY_DAEMON_SERVER_URL"))
	if serverURL == "" {
		serverURL = normalizePublicURL(os.Getenv("INKWAY_PUBLIC_URL"))
	}
	appURL := resolveFrontendAppURL()
	if appURL == "" {
		return "", ""
	}

	if serverURL == "" {
		serverURL = appURL
	}
	return serverURL, appURL
}

// resolveFrontendAppURL returns the operator-configured frontend origin
// (INKWAY_APP_URL, falling back to FRONTEND_ORIGIN), normalized. Shared by
// the daemon-setup URLs and the managed-cloud detection so both read the same
// signal.
func resolveFrontendAppURL() string {
	appURL := normalizePublicURL(os.Getenv("INKWAY_APP_URL"))
	if appURL == "" {
		appURL = normalizePublicURL(os.Getenv("FRONTEND_ORIGIN"))
	}
	return appURL
}

func normalizePublicURL(raw string) string {
	return strings.TrimRight(strings.TrimSpace(raw), "/")
}
