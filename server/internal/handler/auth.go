package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	db "github.com/Devaretanmay/inkway/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var supportedLanguages = map[string]struct{}{
	"en": {}, "zh-Hans": {}, "ko": {}, "ja": {}, "fr": {},
}

type UserResponse struct {
	ID                      string          `json:"id"`
	Name                    string          `json:"name"`
	Email                   string          `json:"email"`
	AvatarURL               *string         `json:"avatar_url"`
	Language                *string         `json:"language"`
	Timezone                *string         `json:"timezone"`
	OnboardedAt             *string         `json:"onboarded_at"`
	OnboardingQuestionnaire json.RawMessage `json:"onboarding_questionnaire"`
	StarterContentState     *string         `json:"starter_content_state"`
	ProfileDescription      string          `json:"profile_description"`
	CreatedAt               string          `json:"created_at"`
	UpdatedAt               string          `json:"updated_at"`
}

const MaxProfileDescriptionLen = 2000

func (h *Handler) userToResponse(u db.User) UserResponse {
	questionnaire := u.OnboardingQuestionnaire
	if len(questionnaire) == 0 {
		questionnaire = []byte("{}")
	}
	return UserResponse{
		ID: uuidToString(u.ID), Name: u.Name, Email: u.Email,
		AvatarURL: h.resolveAvatarURLPtr(textToPtr(u.AvatarUrl)),
		Language:  textToPtr(u.Language), Timezone: textToPtr(u.Timezone),
		OnboardedAt:             timestampToPtr(u.OnboardedAt),
		OnboardingQuestionnaire: json.RawMessage(questionnaire),
		StarterContentState:     textToPtr(u.StarterContentState),
		ProfileDescription:      u.ProfileDescription,
		CreatedAt:               timestampToString(u.CreatedAt), UpdatedAt: timestampToString(u.UpdatedAt),
	}
}

func (h *Handler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	user, err := h.Queries.GetUser(r.Context(), parseUUID(userID))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "local owner not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load local owner")
		return
	}
	writeJSON(w, http.StatusOK, h.userToResponse(user))
}

type UpdateMeRequest struct {
	Name               *string `json:"name"`
	AvatarURL          *string `json:"avatar_url"`
	Language           *string `json:"language"`
	ProfileDescription *string `json:"profile_description"`
	Timezone           *string `json:"timezone"`
}

func (h *Handler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	var req UpdateMeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	currentUser, err := h.Queries.GetUser(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusNotFound, "local owner not found")
		return
	}
	name := currentUser.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}
	}
	params := db.UpdateUserParams{ID: currentUser.ID, Name: name}
	if req.AvatarURL != nil {
		avatarURL, valid := h.acceptAvatarURL(w, r, *req.AvatarURL, currentUser.AvatarUrl.String)
		if !valid {
			return
		}
		params.AvatarUrl = pgtype.Text{String: avatarURL, Valid: true}
	}
	if req.Language != nil {
		language := strings.TrimSpace(*req.Language)
		if _, valid := supportedLanguages[language]; !valid {
			writeError(w, http.StatusBadRequest, "unsupported language")
			return
		}
		params.Language = pgtype.Text{String: language, Valid: true}
	}
	if req.ProfileDescription != nil {
		description := strings.TrimSpace(*req.ProfileDescription)
		if utf8.RuneCountInString(description) > MaxProfileDescriptionLen {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("profile_description exceeds %d characters", MaxProfileDescriptionLen))
			return
		}
		params.ProfileDescription = pgtype.Text{String: description, Valid: true}
	}
	if req.Timezone != nil {
		timezone := strings.TrimSpace(*req.Timezone)
		if timezone != "" {
			if location, err := time.LoadLocation(timezone); err != nil || location == nil {
				writeError(w, http.StatusBadRequest, "invalid timezone")
				return
			}
		}
		params.Timezone = pgtype.Text{String: timezone, Valid: true}
	}
	updated, err := h.Queries.UpdateUser(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update local owner")
		return
	}
	writeJSON(w, http.StatusOK, h.userToResponse(updated))
}
