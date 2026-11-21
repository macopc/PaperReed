// Paper Reed's native CLI calls the desktop's authenticated loopback MCP service.
package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

//go:embed catalog.json
var catalogJSON []byte

type command struct {
	Tool, Required, Action, Help string
	NoInput, Remove              bool
}

type catalog struct {
	Version, Help, SendRecoveryHint string
	Commands                        map[string]command
}

const repairHint = "Run paper-reed doctor or check Agent permissions in Paper Reed."
const updateHint = "Update Paper Reed and its CLI together."

type cliError struct {
	Code    string `json:"code"`
	Message string `json:"error"`
	Hint    string `json:"hint"`
}

func (e *cliError) Error() string { return e.Message }

func fail(code, message, hint string) error {
	return &cliError{code, message, hint}
}

func invalidResponse() error {
	return fail("invalid-response", "No structured response received.", updateHint)
}

func writeJSON(w io.Writer, value any) error {
	e := json.NewEncoder(w)
	e.SetEscapeHTML(false)
	return e.Encode(value)
}

func main() {
	var c catalog
	if err := json.Unmarshal(catalogJSON, &c); err != nil {
		_ = writeJSON(os.Stderr, &cliError{"cli-error", err.Error(), repairHint})
		os.Exit(1)
	}
	status, err := run(c, os.Args[1:], os.Stdin, os.Stdout, connectionEnv(os.Args[0]))
	if err != nil {
		var failure *cliError
		if !errors.As(err, &failure) {
			failure = &cliError{"cli-error", err.Error(), repairHint}
		}
		_ = writeJSON(os.Stderr, failure)
		os.Exit(1)
	}
	os.Exit(status)
}

func run(c catalog, args []string, stdin *os.File, stdout io.Writer, getenv func(string) string) (int, error) {
	if len(args) == 0 || args[0] == "" || args[0] == "--help" || args[0] == "help" {
		// The original CLI's console.log adds a newline after the help block.
		_, err := fmt.Fprintln(stdout, c.Help)
		return 0, err
	}
	name, args := args[0], args[1:]
	if name == "--version" {
		_, err := fmt.Fprintln(stdout, c.Version)
		return 0, err
	}
	cmd, ok := c.Commands[name]
	if name == "doctor" {
		cmd, ok = command{Tool: "list_accounts", Help: c.Help, NoInput: true}, true
	}
	if !ok {
		return 1, fail("unknown-command", "Unknown command: "+name, "Run paper-reed --help.")
	}
	if len(args) == 1 && args[0] == "--help" {
		_, err := fmt.Fprintln(stdout, cmd.Help)
		return 0, err
	}
	input, err := commandInput(name, cmd, args, stdin)
	if err != nil {
		return 1, err
	}
	endpoint, token, err := connection(getenv)
	if err != nil {
		return 1, err
	}
	client := desktopClient(endpoint, token, name == "attachment-get")
	defer client.close()
	result, err := client.call(c.Version, cmd.Tool, input)
	if err != nil {
		err = connectionError(err, name, c.SendRecoveryHint)
	} else {
		status, printErr := printResult(stdout, c.Version, name, endpoint, result)
		if printErr == nil {
			return status, nil
		}
		err = printErr
	}
	if name == "draft-send" && client.dispatched {
		hint := "Send outcome may be unknown. " + c.SendRecoveryHint
		var failure *cliError
		var httpFailure statusError
		if errors.As(err, &failure) && failure.Code == "invalid-response" {
			err = fail(failure.Code, failure.Message, hint)
		} else if errors.As(err, &httpFailure) && httpFailure.code >= 500 {
			err = fail("cli-error", err.Error(), hint)
		}
	}
	return 1, err
}

func commandInput(name string, cmd command, args []string, stdin *os.File) (map[string]json.RawMessage, error) {
	input := make(map[string]json.RawMessage)
	if cmd.NoInput {
		if len(args) > 0 {
			return nil, fail("invalid-arguments", "This command takes no arguments.", "Run paper-reed --help.")
		}
		return input, nil
	}
	var raw []byte
	switch {
	case len(args) == 2 && args[0] == "--input":
		raw = []byte(args[1])
	case len(args) == 0 && !terminal(stdin):
		var err error
		raw, err = io.ReadAll(stdin)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fail("input-required", "Pass JSON with --input or stdin.", "Run paper-reed "+name+" --help.")
	}

	if !json.Valid(raw) {
		return nil, fail("invalid-json", "Input is not valid JSON.", "Run paper-reed "+name+" --help for an example.")
	}
	if err := json.Unmarshal(raw, &input); err != nil || input == nil {
		return nil, fail("invalid-input", "Input must be a JSON object.", "Run paper-reed "+name+" --help.")
	}
	if cmd.Required != "" {
		var value string
		if json.Unmarshal(input[cmd.Required], &value) != nil || strings.TrimSpace(value) == "" {
			return nil, fail("invalid-input", cmd.Required+" is required.", "Run paper-reed "+name+" --help.")
		}
	}
	if cmd.Action != "" {
		input["action"], _ = json.Marshal(cmd.Action)
	}
	if cmd.Remove {
		input["remove"] = json.RawMessage("true")
	}
	return input, nil
}

// A managed launcher links to the executable beside its private connection file.
func connectionEnv(argv0 string) func(string) string {
	if !strings.ContainsRune(argv0, os.PathSeparator) {
		var err error
		argv0, err = exec.LookPath(argv0)
		if err != nil {
			return os.Getenv
		}
	}
	// Use the link chain rather than os.Executable, which resolves the bundle path
	// on some platforms and discards the private profile link.
	for hops := 0; hops < 40; hops++ {
		target, err := os.Readlink(argv0)
		if err != nil {
			break
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(argv0), target)
		}
		dir := filepath.Dir(target)
		if filepath.Base(target) == "paper-reed-cli" && filepath.Base(dir) == "paper-reed-cli" {
			profile := filepath.Join(dir, "connection.json")
			return func(name string) string {
				if name == "PAPER_REED_CLI_PROFILE" {
					return profile
				}
				return ""
			}
		}
		argv0 = target
	}
	return os.Getenv
}

func connection(getenv func(string) string) (*url.URL, string, error) {
	var profile struct{ Endpoint, Token string }
	var endpoint *url.URL
	if file := getenv("PAPER_REED_TOKEN_FILE"); file != "" {
		profile.Endpoint = getenv("PAPER_REED_MCP_URL")
		if profile.Endpoint == "" {
			profile.Endpoint = "http://127.0.0.1:2587/mcp"
		}
		var err error
		endpoint, err = endpointURL(profile.Endpoint)
		if err != nil {
			return nil, "", err
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, "", err
		}
		profile.Token = strings.TrimSpace(string(data))
	} else {
		file := getenv("PAPER_REED_CLI_PROFILE")
		info, err := os.Lstat(file)
		if file == "" || errors.Is(err, os.ErrNotExist) {
			return nil, "", fail("not-connected", "CLI connection is missing.", "Open Paper Reed → Settings → Agent → Install CLI / Update connection.")
		}
		if err != nil {
			return nil, "", err
		}
		insecure := fail("insecure-profile", "Connection file must be a private regular file (0600).", "Update the CLI connection in Paper Reed settings.")
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return nil, "", insecure
		}
		f, err := os.Open(file)
		if err != nil {
			return nil, "", err
		}
		defer f.Close()
		opened, err := f.Stat()
		if err != nil {
			return nil, "", err
		}
		if !os.SameFile(info, opened) || !opened.Mode().IsRegular() || opened.Mode().Perm()&0o077 != 0 {
			return nil, "", insecure
		}
		raw, err := io.ReadAll(f)
		if err != nil {
			return nil, "", err
		}
		var fields map[string]json.RawMessage
		if !json.Valid(raw) || json.Unmarshal(raw, &fields) != nil || fields == nil {
			return nil, "", fail("invalid-profile", "Connection file is invalid.", "Update the CLI connection in Paper Reed settings.")
		}
		_ = json.Unmarshal(fields["endpoint"], &profile.Endpoint)
		_ = json.Unmarshal(fields["token"], &profile.Token)
		endpoint, err = endpointURL(profile.Endpoint)
		if err != nil {
			return nil, "", err
		}
	}
	if strings.TrimSpace(profile.Token) == "" {
		return nil, "", fail("not-connected", "Connection token is empty.", "Update the CLI connection in Paper Reed settings.")
	}
	return endpoint, profile.Token, nil
}

func endpointURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" && u.Scheme == "" {
		return nil, fail("invalid-endpoint", "Invalid connection address.", "Reinstall/update CLI connection in Paper Reed settings.")
	}
	if port := u.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return nil, fail("invalid-endpoint", "Invalid connection address.", "Reinstall/update CLI connection in Paper Reed settings.")
		}
	}
	if u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.EscapedPath() != "/mcp" ||
		u.User != nil || u.ForceQuery || u.RawQuery != "" || strings.Contains(raw, "#") {
		return nil, fail("invalid-endpoint", "Only http://127.0.0.1:<port>/mcp is supported.", "Use the local connection from Paper Reed settings.")
	}
	if u.Port() == "80" || strings.HasSuffix(u.Host, ":") {
		u.Host = u.Hostname()
	}
	return u, nil
}

func printResult(w io.Writer, version, name string, endpoint *url.URL, result toolResult) (int, error) {
	var text *string
	for _, item := range result.Content {
		if item.Type == "text" {
			text = item.Text
			break
		}
	}
	if text == nil {
		return 1, invalidResponse()
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, []byte(*text)); err != nil {
		if !result.IsError {
			return 1, fail("invalid-response", "Invalid JSON response.", updateHint)
		}
		return 1, writeJSON(w, struct {
			Error string `json:"error"`
		}{*text})
	}
	if result.IsError {
		_, err := fmt.Fprintln(w, compact.String())
		return 1, err
	}
	if name == "doctor" {
		var accounts []json.RawMessage
		if json.Unmarshal(compact.Bytes(), &accounts) != nil || accounts == nil {
			return 1, invalidResponse()
		}
		next := "Allow an account in Paper Reed → Settings → Agent."
		if len(accounts) > 0 {
			next = "Run paper-reed accounts."
		}
		return 0, writeJSON(w, struct {
			OK                 bool   `json:"ok"`
			Version            string `json:"version"`
			Endpoint           string `json:"endpoint"`
			AuthorizedAccounts int    `json:"authorizedAccounts"`
			Next               string `json:"next"`
		}{true, version, endpoint.String(), len(accounts), next})
	}
	if name == "draft-send" {
		var admission struct{ OperationID, State string }
		if json.Unmarshal(compact.Bytes(), &admission) != nil ||
			strings.TrimSpace(admission.OperationID) == "" || strings.TrimSpace(admission.State) == "" {
			return 1, invalidResponse()
		}
	}
	status := 0
	var receipt struct{ Items []struct{ Status string } }
	if json.Unmarshal(compact.Bytes(), &receipt) == nil {
		for _, item := range receipt.Items {
			if item.Status == "rejected" || item.Status == "failed" {
				status = 1
				break
			}
		}
	}
	_, err := fmt.Fprintln(w, compact.String())
	return status, err
}
