package nativeagent

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

type fakeSecrets map[string][]byte

func (f fakeSecrets) Set(_ context.Context, k string, v []byte) error {
	f[k] = append([]byte(nil), v...)
	return nil
}
func (f fakeSecrets) Get(_ context.Context, k string) ([]byte, error) {
	v, ok := f[k]
	if !ok {
		return nil, ErrSecretNotFound
	}
	return append([]byte(nil), v...), nil
}
func (f fakeSecrets) Delete(_ context.Context, k string) error { delete(f, k); return nil }
func TestCredentialSourceUsesEnvironmentWithoutPersisting(t *testing.T) {
	calls := 0
	source := CredentialSource{Store: fakeSecrets{}, LookupEnv: func(k string) (string, bool) {
		if k == "GROQ_API_KEY" {
			return "dev-secret", true
		}
		return "", false
	}}
	value, kind, err := source.Get(context.Background(), "groq", "runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if string(value) != "dev-secret" || kind != "environment" {
		t.Fatalf("credential=%q source=%q", value, kind)
	}
	if calls != 0 {
		t.Fatal("unexpected writes")
	}
}
func TestCredentialSourceUsesRuntimeScopedOSStore(t *testing.T) {
	store := fakeSecrets{"runtime-1/openai": []byte("stored")}
	source := CredentialSource{Store: store, LookupEnv: func(string) (string, bool) { return "", false }}
	value, kind, err := source.Get(context.Background(), "openai", "Runtime-1")
	if err != nil {
		t.Fatal(err)
	}
	if string(value) != "stored" || kind != "os_keyring" {
		t.Fatalf("value=%q source=%q", value, kind)
	}
}
func TestProviderBaseURLAllowsOnlyProviderOrigin(t *testing.T) {
	for _, tc := range []struct {
		provider, url string
		wantErr       bool
	}{{"openai", "https://api.openai.com/v1", false}, {"groq", "https://api.groq.com/openai/v1", false}, {"anthropic", "https://api.anthropic.com", false}, {"groq", "https://attacker.example/v1", true}, {"openai", "http://api.openai.com/v1", true}, {"openai", "https://user:pass@api.openai.com/v1", true}} {
		err := validateProviderURL(tc.provider, tc.url)
		if (err != nil) != tc.wantErr {
			t.Fatalf("validate %s %s err=%v", tc.provider, tc.url, err)
		}
	}
}
func TestCredentialSourceDoesNotFallbackToPlaintext(t *testing.T) {
	source := CredentialSource{LookupEnv: func(string) (string, bool) { return "", false }}
	_, _, err := source.Get(context.Background(), "anthropic", "runtime")
	if err == nil || !strings.Contains(err.Error(), "ANTHROPIC_API_KEY") {
		t.Fatalf("err=%v", err)
	}
	if !errors.Is(ErrSecretNotFound, ErrSecretNotFound) {
		t.Fatal("unexpected sentinel")
	}
}

func TestLegacyKeyringCredentialMigratesAndVerifiesWithoutRemovingSource(t *testing.T) {
	items := map[string]string{
		"Multica Provider Credentials/runtime-1/groq": "secret-not-for-logs",
	}
	get := func(service, account string) (string, error) {
		value, ok := items[service+"/"+account]
		if !ok {
			return "", keyring.ErrNotFound
		}
		return value, nil
	}
	set := func(service, account, value string) error {
		items[service+"/"+account] = value
		return nil
	}

	value, err := getLegacyCredential("runtime-1/groq", get, set)
	if err != nil {
		t.Fatal(err)
	}
	if string(value) != "secret-not-for-logs" {
		t.Fatal("migrated keychain value did not verify")
	}
	if items["Multica Provider Credentials/runtime-1/groq"] == "" {
		t.Fatal("migration removed the legacy item before explicit disconnect")
	}
	if items[keyringService+"/runtime-1/groq"] != "secret-not-for-logs" {
		t.Fatal("new keychain namespace was not written")
	}
}

func TestLegacyKeyringMigrationFailsClosedWhenVerificationDiffers(t *testing.T) {
	items := map[string]string{"Issuway Provider Credentials/account": "legacy"}
	get := func(service, account string) (string, error) {
		value, ok := items[service+"/"+account]
		if !ok {
			return "", keyring.ErrNotFound
		}
		return value, nil
	}
	set := func(service, account, _ string) error {
		items[service+"/"+account] = "different"
		return nil
	}
	if _, err := getLegacyCredential("account", get, set); err == nil {
		t.Fatal("mismatched migrated credential was returned")
	}
}
