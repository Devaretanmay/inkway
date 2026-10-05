package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/Devaretanmay/inkway/server/internal/nativeagent"
)

var providerCredentialStore nativeagent.SecretStore = nativeagent.OSSecretStore{}

var runtimeCredentialsCmd = &cobra.Command{Use: "credentials", Short: "Manage runtime-local provider credentials"}
var runtimeCredentialSetCmd = &cobra.Command{Use: "set <runtime-id> <provider>", Short: "Store an API key in the OS credential store", Args: exactArgs(2), RunE: runRuntimeCredentialSet}
var runtimeCredentialDeleteCmd = &cobra.Command{Use: "delete <runtime-id> <provider>", Short: "Delete an API key from the OS credential store", Args: exactArgs(2), RunE: runRuntimeCredentialDelete}
var runtimeCredentialStatusCmd = &cobra.Command{Use: "status <runtime-id> <provider>", Short: "Check whether a runtime-local API key exists", Args: exactArgs(2), RunE: runRuntimeCredentialStatus}
var runtimeCredentialValidateCmd = &cobra.Command{Use: "validate <runtime-id> <provider> <model>", Short: "Send one minimal request to validate a runtime credential", Args: exactArgs(3), RunE: runRuntimeCredentialValidate}

func init() {
	runtimeCmd.AddCommand(runtimeCredentialsCmd)
	runtimeCredentialsCmd.AddCommand(runtimeCredentialSetCmd, runtimeCredentialDeleteCmd, runtimeCredentialStatusCmd, runtimeCredentialValidateCmd)
	runtimeCredentialSetCmd.Flags().Bool("stdin", false, "Read the API key from stdin instead of a hidden terminal prompt")
	runtimeCredentialStatusCmd.Flags().Bool("json", false, "Return credential presence only as JSON")
}

func credentialKey(runtimeID, provider string) (string, error) {
	if _, err := uuid.Parse(runtimeID); err != nil {
		return "", fmt.Errorf("invalid runtime ID")
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	switch provider {
	case "openai", "anthropic", "groq":
	default:
		return "", fmt.Errorf("provider must be openai, anthropic, or groq")
	}
	return strings.ToLower(runtimeID) + "/" + provider, nil
}

func runRuntimeCredentialSet(cmd *cobra.Command, args []string) error {
	key, err := credentialKey(args[0], args[1])
	if err != nil {
		return err
	}
	fromStdin, _ := cmd.Flags().GetBool("stdin")
	var value []byte
	if fromStdin {
		value, err = io.ReadAll(io.LimitReader(cmd.InOrStdin(), 16*1024+1))
		if err != nil {
			return err
		}
		value = []byte(strings.TrimSpace(string(value)))
	} else {
		fd := int(os.Stdin.Fd())
		if !term.IsTerminal(fd) {
			return fmt.Errorf("API key requires a terminal prompt or --stdin")
		}
		_, _ = fmt.Fprint(cmd.ErrOrStderr(), "API key (input hidden): ")
		value, err = term.ReadPassword(fd)
		_, _ = fmt.Fprintln(cmd.ErrOrStderr())
		if err != nil {
			return fmt.Errorf("read API key: %w", err)
		}
	}
	defer clear(value)
	if len(value) == 0 || len(value) > 16*1024 {
		return fmt.Errorf("API key is empty or exceeds 16 KiB")
	}
	if err := providerCredentialAction(context.Background(), providerCredentialStore, "set", key, value); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Credential stored in the OS credential store for %s.\n", key)
	return nil
}
func runRuntimeCredentialDelete(cmd *cobra.Command, args []string) error {
	key, err := credentialKey(args[0], args[1])
	if err != nil {
		return err
	}
	if err := providerCredentialAction(context.Background(), providerCredentialStore, "delete", key, nil); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Credential deleted from the OS credential store for %s.\n", key)
	return nil
}
func runRuntimeCredentialStatus(cmd *cobra.Command, args []string) error {
	key, err := credentialKey(args[0], args[1])
	if err != nil {
		return err
	}
	asJSON, _ := cmd.Flags().GetBool("json")
	if env := map[string]string{"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "groq": "GROQ_API_KEY"}[strings.ToLower(args[1])]; env != "" {
		if value, ok := os.LookupEnv(env); ok && strings.TrimSpace(value) != "" {
			if asJSON {
				return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]bool{"present": true})
			}
			_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Environment credential available for %s on this runtime.\n", strings.ToLower(args[1]))
			return nil
		}
	}
	present, err := providerCredentialPresent(context.Background(), providerCredentialStore, key)
	if err != nil {
		return err
	}
	if asJSON {
		return json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]bool{"present": present})
	}
	if present {
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "OS credential present for %s.\n", key)
	} else {
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "No OS credential stored for %s.\n", key)
	}
	return nil
}

func runRuntimeCredentialValidate(cmd *cobra.Command, args []string) error {
	if _, err := credentialKey(args[0], args[1]); err != nil {
		return err
	}
	provider, err := nativeagent.NewConfiguredProvider(context.Background(), nativeagent.ProviderConfig{Provider: args[1], Model: args[2], RuntimeID: args[0]}, nativeagent.CredentialSource{Store: providerCredentialStore})
	if err != nil {
		return err
	}
	response, err := provider.Provider.Generate(cmd.Context(), nativeagent.ModelRequest{Model: args[2], Messages: []nativeagent.Message{{Role: "user", Content: "Reply with OK."}}})
	if err != nil {
		return fmt.Errorf("provider validation failed: %w", err)
	}
	_, _ = fmt.Fprintf(cmd.OutOrStdout(), "%s credential validated for model %s (%d input, %d output tokens reported).\n", provider.Provider.Name(), args[2], response.Usage.InputTokens, response.Usage.OutputTokens)
	return nil
}

func providerCredentialAction(ctx context.Context, store nativeagent.SecretStore, action, key string, value []byte) error {
	switch action {
	case "set":
		if store == nil {
			return fmt.Errorf("OS credential store unavailable; use an environment variable for development")
		}
		return store.Set(ctx, key, value)
	case "delete":
		if store == nil {
			return fmt.Errorf("OS credential store unavailable")
		}
		return store.Delete(ctx, key)
	default:
		return fmt.Errorf("unsupported credential action")
	}
}
func providerCredentialPresent(ctx context.Context, store nativeagent.SecretStore, key string) (bool, error) {
	if store == nil {
		return false, fmt.Errorf("OS credential store unavailable")
	}
	value, err := store.Get(ctx, key)
	if err != nil {
		if err == nativeagent.ErrSecretNotFound {
			return false, nil
		}
		return false, err
	}
	clear(value)
	return len(value) > 0, nil
}
