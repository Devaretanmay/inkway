package nativeagent

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
)

type ProviderConfig struct {
	Provider  string
	Model     string
	RuntimeID string
	BaseURL   string
}
type ConfiguredProvider struct {
	Provider         Provider
	CredentialSource string
}

func NewConfiguredProvider(ctx context.Context, cfg ProviderConfig, source CredentialSource) (ConfiguredProvider, error) {
	name := strings.ToLower(strings.TrimSpace(cfg.Provider))
	if name != "openai" && name != "anthropic" && name != "groq" {
		return ConfiguredProvider{}, fmt.Errorf("unsupported native provider %q", cfg.Provider)
	}
	key, sourceName, err := source.Get(ctx, name, cfg.RuntimeID)
	if err != nil {
		return ConfiguredProvider{}, err
	}
	base := strings.TrimSpace(cfg.BaseURL)
	if base == "" {
		envName := map[string]string{"openai": "OPENAI_BASE_URL", "groq": "GROQ_BASE_URL", "anthropic": "ANTHROPIC_BASE_URL"}[name]
		base = os.Getenv(envName)
	}
	if base != "" {
		if err := validateProviderURL(name, base); err != nil {
			return ConfiguredProvider{}, err
		}
	}
	var p Provider
	switch name {
	case "openai":
		p = NewOpenAI(base, string(key), cfg.Model)
	case "groq":
		if base == "" {
			base = "https://api.groq.com/openai/v1"
		}
		p = &OpenAICompatible{BaseURL: base, APIKey: string(key), Model: cfg.Model, MaxOutputTokens: 1024, name: "groq"}
	case "anthropic":
		p = NewAnthropic(string(key), cfg.Model)
		if base != "" {
			p.(*Anthropic).BaseURL = base
		}
	}
	return ConfiguredProvider{Provider: p, CredentialSource: sourceName}, nil
}
func validateProviderURL(provider, raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("%s base URL must be an HTTPS origin/path without user info, query or fragment", provider)
	}
	host := strings.ToLower(u.Hostname())
	allowed := map[string]map[string]bool{"openai": {"api.openai.com": true}, "groq": {"api.groq.com": true}, "anthropic": {"api.anthropic.com": true}}
	if !allowed[provider][host] {
		return fmt.Errorf("base URL host is not approved for %s", provider)
	}
	return nil
}
