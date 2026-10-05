package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/Devaretanmay/inkway/server/internal/nativeagent"
	"github.com/spf13/cobra"
)

type testProviderSecretStore map[string][]byte

func (s testProviderSecretStore) Set(_ context.Context, k string, v []byte) error {
	s[k] = append([]byte(nil), v...)
	return nil
}
func (s testProviderSecretStore) Get(_ context.Context, k string) ([]byte, error) {
	v, ok := s[k]
	if !ok {
		return nil, nativeagent.ErrSecretNotFound
	}
	return append([]byte(nil), v...), nil
}
func (s testProviderSecretStore) Delete(_ context.Context, k string) error { delete(s, k); return nil }

func TestRuntimeProviderCredentialSetStoresSecretWithoutPrinting(t *testing.T) {
	old := providerCredentialStore
	store := testProviderSecretStore{}
	providerCredentialStore = store
	t.Cleanup(func() { providerCredentialStore = old })
	cmd := &cobra.Command{}
	cmd.Flags().Bool("stdin", false, "")
	_ = cmd.Flags().Set("stdin", "true")
	const secret = "gsk-test-value"
	cmd.SetIn(strings.NewReader(secret))
	var stdout, stderr bytes.Buffer
	cmd.SetOut(&stdout)
	cmd.SetErr(&stderr)
	if err := runRuntimeCredentialSet(cmd, []string{"c0ae9ba0-7077-4d5d-a659-7e04b4732473", "groq"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stdout.String()+stderr.String(), secret) {
		t.Fatal("credential was printed")
	}
	got, err := store.Get(context.Background(), "c0ae9ba0-7077-4d5d-a659-7e04b4732473/groq")
	if err != nil || string(got) != secret {
		t.Fatalf("stored value=%q err=%v", got, err)
	}
}
func TestRuntimeProviderCredentialValidation(t *testing.T) {
	if _, err := credentialKey("not-a-runtime", "openai"); err == nil {
		t.Fatal("invalid runtime accepted")
	}
	if _, err := credentialKey("c0ae9ba0-7077-4d5d-a659-7e04b4732473", "gemini"); err == nil {
		t.Fatal("unsupported provider accepted")
	}
}

func TestRuntimeProviderCredentialStatusDoesNotPrintEnvironmentSecret(t *testing.T) {
	t.Setenv("GROQ_API_KEY", "secret-value")
	old := providerCredentialStore
	providerCredentialStore = testProviderSecretStore{}
	t.Cleanup(func() { providerCredentialStore = old })
	cmd := &cobra.Command{}
	var stdout, stderr bytes.Buffer
	cmd.SetOut(&stdout)
	cmd.SetErr(&stderr)
	if err := runRuntimeCredentialStatus(cmd, []string{"c0ae9ba0-7077-4d5d-a659-7e04b4732473", "groq"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stdout.String()+stderr.String(), "secret-value") || !strings.Contains(stdout.String(), "Environment credential available") {
		t.Fatalf("status leaked or missed source: %q %q", stdout.String(), stderr.String())
	}
}

func TestRuntimeProviderCredentialStatusJSONIsPresenceOnly(t *testing.T) {
	t.Setenv("GROQ_API_KEY", "")
	old := providerCredentialStore
	store := testProviderSecretStore{}
	providerCredentialStore = store
	t.Cleanup(func() { providerCredentialStore = old })
	for _, present := range []bool{false, true} {
		if present {
			store["c0ae9ba0-7077-4d5d-a659-7e04b4732473/groq"] = []byte("do-not-expose-this-value")
		}
		cmd := &cobra.Command{}
		cmd.Flags().Bool("json", true, "")
		var stdout bytes.Buffer
		cmd.SetOut(&stdout)
		if err := runRuntimeCredentialStatus(cmd, []string{"c0ae9ba0-7077-4d5d-a659-7e04b4732473", "groq"}); err != nil {
			t.Fatal(err)
		}
		want := "{\"present\":false}\n"
		if present {
			want = "{\"present\":true}\n"
		}
		if stdout.String() != want {
			t.Fatalf("status must expose only presence: %q", stdout.String())
		}
	}
}
