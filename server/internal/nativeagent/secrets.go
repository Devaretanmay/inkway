package nativeagent

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/zalando/go-keyring"
)

const keyringService = "Inkway Provider Credentials"
var legacyKeyringServices = []string{
	"Multica Provider Credentials",
	"Issuway Provider Credentials",
	"Microloop Provider Credentials",
}

var ErrSecretNotFound = errors.New("provider credential not found")

type SecretStore interface {
	Set(context.Context, string, []byte) error
	Get(context.Context, string) ([]byte, error)
	Delete(context.Context, string) error
}

type OSSecretStore struct{}

func (OSSecretStore) Set(ctx context.Context, key string, value []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if strings.TrimSpace(key) == "" || len(value) == 0 {
		return fmt.Errorf("secret key and value are required")
	}
	return keyring.Set(keyringService, key, string(value))
}
func (OSSecretStore) Get(ctx context.Context, key string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	v, err := keyring.Get(keyringService, key)
	if errors.Is(err, keyring.ErrNotFound) {
		return getLegacyCredential(key, keyring.Get, keyring.Set)
	}
	if err != nil {
		return nil, fmt.Errorf("read OS credential store: %w", err)
	}
	return []byte(v), nil
}
func (OSSecretStore) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	for _, service := range append([]string{keyringService}, legacyKeyringServices...) {
		err := keyring.Delete(service, key)
		if err != nil && !errors.Is(err, keyring.ErrNotFound) {
			return fmt.Errorf("delete OS credential: %w", err)
		}
	}
	return nil
}

func getLegacyCredential(
	key string,
	get func(string, string) (string, error),
	set func(string, string, string) error,
) ([]byte, error) {
	for _, service := range legacyKeyringServices {
		value, err := get(service, key)
		if errors.Is(err, keyring.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read legacy OS credential: %w", err)
		}
		if err := set(keyringService, key, value); err != nil {
			return nil, fmt.Errorf("migrate OS credential: %w", err)
		}
		verified, err := get(keyringService, key)
		if err != nil || verified != value {
			return nil, fmt.Errorf("verify migrated OS credential")
		}
		return []byte(verified), nil
	}
	return nil, ErrSecretNotFound
}

// CredentialSource keeps development/CI environment credentials ephemeral and
// clearly labeled. It never copies them into the OS keyring.
type CredentialSource struct {
	Store     SecretStore
	LookupEnv func(string) (string, bool)
}

func (s CredentialSource) Get(ctx context.Context, provider, runtimeID string) ([]byte, string, error) {
	lookup := s.LookupEnv
	if lookup == nil {
		lookup = os.LookupEnv
	}
	envName := map[string]string{"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "groq": "GROQ_API_KEY"}[strings.ToLower(provider)]
	if envName == "" {
		return nil, "", fmt.Errorf("unsupported provider %q", provider)
	}
	if value, ok := lookup(envName); ok && strings.TrimSpace(value) != "" {
		return []byte(value), "environment", nil
	}
	if s.Store == nil {
		return nil, "", fmt.Errorf("%s credential unavailable: configure %s or an OS credential store", provider, envName)
	}
	key := strings.ToLower(strings.TrimSpace(runtimeID)) + "/" + strings.ToLower(provider)
	value, err := s.Store.Get(ctx, key)
	if err != nil {
		return nil, "", fmt.Errorf("%s credential unavailable: %w", provider, err)
	}
	return value, "os_keyring", nil
}
