package nativeagent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const maxFileBytes = 1 << 20
const maxToolOutputBytes = 32 << 10

func ToolDefinitions() []Tool {
	obj := func(props map[string]any, required ...string) map[string]any {
		return map[string]any{"type": "object", "properties": props, "required": required, "additionalProperties": false}
	}
	return []Tool{
		{Name: "list_files", Description: "List files below the repository root or a relative directory.", Parameters: obj(map[string]any{"path": map[string]any{"type": "string"}}, "path")},
		{Name: "read_file", Description: "Read a UTF-8 text file inside the repository, up to 1 MiB.", Parameters: obj(map[string]any{"path": map[string]any{"type": "string"}}, "path")},
		{Name: "search_text", Description: "Search repository text files for a literal string.", Parameters: obj(map[string]any{"query": map[string]any{"type": "string"}, "path": map[string]any{"type": "string"}}, "query")},
		{Name: "write_file", Description: "Create or replace a UTF-8 text file inside the repository, up to 1 MiB.", Parameters: obj(map[string]any{"path": map[string]any{"type": "string"}, "content": map[string]any{"type": "string"}}, "path", "content")},
		{Name: "apply_patch", Description: "Replace one exact unique text fragment in a repository file.", Parameters: obj(map[string]any{"path": map[string]any{"type": "string"}, "old": map[string]any{"type": "string"}, "new": map[string]any{"type": "string"}}, "path", "old", "new")},
		{Name: "run_command", Description: "Run an allowlisted repository command without a shell. The first argument must be an approved executable.", Parameters: obj(map[string]any{"argv": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "minItems": 1, "maxItems": 64}}, "argv")},
		{Name: "git_diff", Description: "Show bounded git diff for the repository working tree.", Parameters: obj(map[string]any{})},
	}
}

type toolExecutor struct {
	root       string
	taskCLIEnv map[string]string
}

func newToolExecutor(root string) (*toolExecutor, error) {
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("resolve repository root: %w", err)
	}
	st, err := os.Stat(real)
	if err != nil {
		return nil, err
	}
	if !st.IsDir() {
		return nil, fmt.Errorf("repository root is not a directory")
	}
	return &toolExecutor{root: real}, nil
}
func (e *toolExecutor) resolve(rel string) (string, error) {
	if strings.TrimSpace(rel) == "" {
		rel = "."
	}
	if filepath.IsAbs(rel) {
		return "", fmt.Errorf("absolute paths are not allowed")
	}
	clean := filepath.Clean(rel)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes repository root")
	}
	candidate := filepath.Join(e.root, clean)
	parent := candidate
	if _, err := os.Lstat(candidate); err != nil && !os.IsNotExist(err) {
		return "", err
	}
	for {
		if _, err := os.Lstat(parent); err == nil {
			resolved, er := filepath.EvalSymlinks(parent)
			if er != nil {
				return "", er
			}
			if !within(e.root, resolved) {
				return "", fmt.Errorf("path escapes repository root through symlink")
			}
			break
		}
		next := filepath.Dir(parent)
		if next == parent {
			break
		}
		parent = next
	}
	return candidate, nil
}
func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
func sensitivePath(rel string) bool {
	clean := strings.ToLower(filepath.ToSlash(filepath.Clean(rel)))
	if clean == ".config/gcloud" || strings.HasPrefix(clean, ".config/gcloud/") || strings.Contains(clean, "/.config/gcloud/") {
		return true
	}
	for _, part := range strings.Split(clean, "/") {
		if strings.HasPrefix(part, ".env") || part == ".ssh" || part == ".aws" || part == ".azure" || part == ".npmrc" || part == ".netrc" || part == ".pypirc" || part == "credentials" || part == "secrets" || part == "id_rsa" || part == "id_ed25519" || strings.HasSuffix(part, ".pem") || strings.HasSuffix(part, ".key") || strings.HasSuffix(part, ".p12") || strings.HasSuffix(part, ".pfx") {
			return true
		}
	}
	return false
}
func (e *toolExecutor) execute(ctx context.Context, name string, args json.RawMessage) (string, error) {
	switch name {
	case "list_files":
		var in struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		p, err := e.resolve(in.Path)
		if err != nil {
			return "", err
		}
		entries, err := os.ReadDir(p)
		if err != nil {
			return "", err
		}
		var b strings.Builder
		for i, v := range entries {
			if i >= 500 {
				b.WriteString("\n… truncated at 500 entries")
				break
			}
			if v.IsDir() {
				b.WriteString(v.Name() + "/\n")
			} else {
				b.WriteString(v.Name() + "\n")
			}
		}
		return bounded(b.String()), nil
	case "read_file":
		var in struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		p, err := e.resolve(in.Path)
		if err != nil {
			return "", err
		}
		if sensitivePath(in.Path) {
			return "", fmt.Errorf("sensitive repository paths are not available to the model")
		}
		f, err := os.Open(p)
		if err != nil {
			return "", err
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, maxFileBytes+1))
		if err != nil {
			return "", err
		}
		if len(data) > maxFileBytes {
			return "", fmt.Errorf("file exceeds 1 MiB limit")
		}
		return bounded(string(data)), nil
	case "search_text":
		var in struct {
			Query string `json:"query"`
			Path  string `json:"path"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		if in.Query == "" || len(in.Query) > 4096 {
			return "", fmt.Errorf("query must contain 1–4096 bytes")
		}
		start, err := e.resolve(in.Path)
		if err != nil {
			return "", err
		}
		var b strings.Builder
		matches := 0
		err = filepath.WalkDir(start, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if entry.IsDir() {
				if path != start && (entry.Name() == ".git" || entry.Name() == "node_modules" || entry.Name() == "vendor" || strings.HasPrefix(entry.Name(), ".")) {
					return filepath.SkipDir
				}
				return nil
			}
			info, err := entry.Info()
			if err != nil || info.Size() > maxFileBytes {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil || strings.IndexByte(string(data), 0) >= 0 {
				return nil
			}
			rel, _ := filepath.Rel(e.root, path)
			if sensitivePath(rel) {
				return nil
			}
			for lineNo, line := range strings.Split(string(data), "\n") {
				if strings.Contains(line, in.Query) {
					fmt.Fprintf(&b, "%s:%d:%s\n", rel, lineNo+1, line)
					matches++
					if matches >= 200 {
						b.WriteString("[search stopped at 200 matches]\n")
						return filepath.SkipAll
					}
				}
			}
			return nil
		})
		if err != nil && err != filepath.SkipAll {
			return "", err
		}
		return bounded(b.String()), nil
	case "write_file":
		var in struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		if len(in.Content) > maxFileBytes {
			return "", fmt.Errorf("content exceeds 1 MiB limit")
		}
		p, err := e.resolve(in.Path)
		if err != nil {
			return "", err
		}
		if sensitivePath(in.Path) {
			return "", fmt.Errorf("sensitive repository paths are not available to the model")
		}
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			return "", err
		}
		if err := os.WriteFile(p, []byte(in.Content), 0644); err != nil {
			return "", err
		}
		return "file written", nil
	case "apply_patch":
		var in struct {
			Path string `json:"path"`
			Old  string `json:"old"`
			New  string `json:"new"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		if in.Old == "" || len(in.Old) > maxFileBytes || len(in.New) > maxFileBytes {
			return "", fmt.Errorf("patch fragments must be non-empty and at most 1 MiB")
		}
		p, err := e.resolve(in.Path)
		if err != nil {
			return "", err
		}
		if sensitivePath(in.Path) {
			return "", fmt.Errorf("sensitive repository paths are not available to the model")
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return "", err
		}
		if len(data) > maxFileBytes {
			return "", fmt.Errorf("file exceeds 1 MiB limit")
		}
		if !strings.Contains(string(data), in.Old) {
			return "", fmt.Errorf("patch target not found")
		}
		if strings.Count(string(data), in.Old) != 1 {
			return "", fmt.Errorf("patch target is ambiguous; exact text must match once")
		}
		updated := strings.Replace(string(data), in.Old, in.New, 1)
		if len(updated) > maxFileBytes {
			return "", fmt.Errorf("patched file exceeds 1 MiB limit")
		}
		if err := os.WriteFile(p, []byte(updated), 0644); err != nil {
			return "", err
		}
		return "patch applied", nil
	case "git_diff":
		out, err := e.execute(ctx, "run_command", json.RawMessage(mustJSON(map[string]any{"argv": []string{"git", "diff", "--no-ext-diff", "--unified=3", "--", ".", ":(exclude)**/.env*", ":(exclude)**/*.pem", ":(exclude)**/*.key", ":(exclude)**/*.p12", ":(exclude)**/*.pfx"}})))
		if err != nil {
			return out, err
		}
		return bounded(out), nil
	case "run_command":
		var in struct {
			Argv []string `json:"argv"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		if len(in.Argv) == 0 || len(in.Argv) > 64 {
			return "", fmt.Errorf("command must contain 1–64 arguments")
		}
		allowed := map[string]bool{"git": true, "go": true, "make": true, "npm": true, "pnpm": true, "node": true, "python": true, "python3": true, "pytest": true, "cargo": true, "rustc": true, "inkway": true}
		bin := filepath.Base(in.Argv[0])
		if bin != in.Argv[0] || !allowed[bin] {
			return "", fmt.Errorf("command %q is not allowed", bin)
		}
		if bin == "git" {
			if len(in.Argv) < 2 || (in.Argv[1] != "status" && in.Argv[1] != "diff" && in.Argv[1] != "branch" && in.Argv[1] != "rev-parse") {
				return "", fmt.Errorf("git subcommand is not allowed")
			}
			if in.Argv[1] == "diff" {
				args := append([]string(nil), in.Argv[2:]...)
				for _, flag := range []string{"--no-ext-diff", "--no-textconv"} {
					if !containsArg(args, flag) {
						args = append([]string{flag}, args...)
					}
				}
				excludes := []string{":(exclude).env*", ":(exclude)**/.env*", ":(exclude)**/*.pem", ":(exclude)**/*.key", ":(exclude)**/*.p12", ":(exclude)**/*.pfx", ":(exclude)**/.ssh/**", ":(exclude)**/.aws/**", ":(exclude)**/.config/gcloud/**", ":(exclude)**/credentials/**"}
				separator := len(args)
				for i, arg := range args {
					if arg == "--" {
						separator = i
						break
					}
				}
				if separator == len(args) {
					args = append(args, "--")
				}
				args = append(args[:separator+1], append(excludes, args[separator+1:]...)...)
				in.Argv = append([]string{"git", "diff"}, args...)
			}
		}
		for _, a := range in.Argv {
			if len(a) > 4096 || strings.ContainsRune(a, 0) {
				return "", fmt.Errorf("invalid command argument")
			}
		}
		cmdCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(cmdCtx, in.Argv[0], in.Argv[1:]...)
		cmd.Dir = e.root
		cmd.Env = safeCommandEnv(bin, e.taskCLIEnv)
		var out bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &out
		err := cmd.Run()
		result := bounded(out.String())
		if err != nil {
			return result, fmt.Errorf("command failed: %w", err)
		}
		return result, nil
	default:
		return "", fmt.Errorf("unknown tool %q", name)
	}
}
func containsArg(args []string, target string) bool {
	for _, arg := range args {
		if arg == target {
			return true
		}
	}
	return false
}
func bounded(s string) string {
	if len(s) > maxToolOutputBytes {
		return s[:maxToolOutputBytes] + "\n[output truncated]"
	}
	return s
}

func safeCommandEnv(command string, taskCLIEnv map[string]string) []string {
	allowed := map[string]bool{"PATH": true, "HOME": true, "TMPDIR": true, "TMP": true, "TEMP": true, "GOPATH": true, "GOCACHE": true, "GOMODCACHE": true, "GOPROXY": true, "CARGO_HOME": true, "RUSTUP_HOME": true, "NPM_CONFIG_CACHE": true, "CI": true, "SystemRoot": true, "USERPROFILE": true, "COMSPEC": true}
	if runtime.GOOS == "windows" {
		allowed["Path"] = true
	}
	out := make([]string, 0, 16)
	for _, item := range os.Environ() {
		key, _, ok := strings.Cut(item, "=")
		if ok && allowed[key] {
			out = append(out, item)
		}
	}
	if filepath.Base(command) == "inkway" {
		for _, key := range []string{"INKWAY_SERVER_URL", "INKWAY_WORKSPACE_ID", "INKWAY_TOKEN"} {
			if value := taskCLIEnv[key]; value != "" {
				out = append(out, key+"="+value)
			}
		}
	}
	return out
}
