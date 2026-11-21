package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

var protocolVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"}

type toolResult struct {
	IsError bool
	Content []struct {
		Type string
		Text *string
	}
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      *int   `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type rpcReply struct {
	JSONRPC string
	ID      json.RawMessage
	Result  json.RawMessage
	Error   *struct{ Message string }
}

type statusError struct {
	code   int
	detail string
}

func (e statusError) Error() string {
	if e.detail != "" {
		return fmt.Sprintf("MCP HTTP %d: %s", e.code, e.detail)
	}
	return fmt.Sprintf("MCP HTTP %d", e.code)
}

type desktop struct {
	client     *http.Client
	endpoint   *url.URL
	token      string
	session    string
	protocol   string
	context    context.Context
	cancel     context.CancelFunc
	toolLimit  time.Duration
	dispatched bool
}

func desktopClient(endpoint *url.URL, token string, attachment bool) *desktop {
	total, toolLimit := 15*time.Second, 10*time.Second
	if attachment {
		total, toolLimit = 45*time.Second, 40*time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), total)
	return &desktop{
		client: &http.Client{
			Transport: &http.Transport{MaxIdleConns: 1, MaxIdleConnsPerHost: 1},
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		endpoint: endpoint, token: token, context: ctx, cancel: cancel, toolLimit: toolLimit,
	}
}

func (d *desktop) request(method string, message *rpcRequest, timeout time.Duration) (*http.Response, context.CancelFunc, error) {
	ctx, cancel := context.WithTimeout(d.context, timeout)
	var body io.Reader
	if message != nil {
		message.JSONRPC = "2.0"
		raw, err := json.Marshal(message)
		if err != nil {
			cancel()
			return nil, nil, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.endpoint.String(), body)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	// Tool requests are dispatched once. The caller handles uncertain send receipts.
	req.GetBody = nil
	req.Header.Set("Authorization", "Bearer "+d.token)
	req.Header.Set("Accept", "application/json, text/event-stream")
	if message != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if d.session != "" {
		req.Header.Set("Mcp-Session-Id", d.session)
	}
	if d.protocol != "" {
		req.Header.Set("MCP-Protocol-Version", d.protocol)
	}
	res, err := d.client.Do(req)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var response struct{ Error json.RawMessage }
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		res.Body.Close()
		cancel()
		var detail string
		if json.Unmarshal(raw, &response) == nil {
			if err := json.Unmarshal(response.Error, &detail); err != nil {
				var nested struct{ Message string }
				if json.Unmarshal(response.Error, &nested) == nil {
					detail = nested.Message
				}
			}
		}
		return nil, nil, statusError{res.StatusCode, detail}
	}
	return res, cancel, nil
}

func (d *desktop) call(version, tool string, input map[string]json.RawMessage) (toolResult, error) {
	var result toolResult
	initID, toolID := 0, 1
	var init struct{ ProtocolVersion string }
	if err := d.rpc(rpcRequest{ID: &initID, Method: "initialize", Params: map[string]any{
		"protocolVersion": protocolVersions[0],
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]string{"name": "paper-reed-cli", "version": version},
	}}, 10*time.Second, &init); err != nil {
		return result, err
	}
	if !slices.Contains(protocolVersions, init.ProtocolVersion) {
		return result, invalidResponse()
	}
	d.protocol = init.ProtocolVersion
	notice := rpcRequest{Method: "notifications/initialized"}
	if err := d.noReply(http.MethodPost, &notice, 10*time.Second); err != nil {
		return result, err
	}
	d.dispatched = true
	err := d.rpc(rpcRequest{ID: &toolID, Method: "tools/call", Params: map[string]any{
		"name": tool, "arguments": input,
	}}, d.toolLimit, &result)
	return result, err
}

func (d *desktop) rpc(message rpcRequest, timeout time.Duration, result any) error {
	res, cancel, err := d.request(http.MethodPost, &message, timeout)
	if err != nil {
		return err
	}
	defer cancel()
	defer res.Body.Close()
	if message.Method == "initialize" {
		d.session = res.Header.Get("Mcp-Session-Id")
	}
	return readRPC(res.Body, res.Header.Get("Content-Type"), *message.ID, result)
}

func (d *desktop) noReply(method string, message *rpcRequest, timeout time.Duration) error {
	res, cancel, err := d.request(method, message, timeout)
	if err != nil {
		return err
	}
	defer cancel()
	defer res.Body.Close()
	_, err = io.Copy(io.Discard, res.Body)
	return err
}

func (d *desktop) close() {
	if d.session != "" {
		_ = d.noReply(http.MethodDelete, nil, time.Second)
	}
	d.cancel()
	d.client.CloseIdleConnections()
}

func readRPC(body io.Reader, contentType string, id int, result any) error {
	// Streamable HTTP POSTs from the desktop finish after their matching reply.
	raw, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	if !strings.EqualFold(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]), "text/event-stream") {
		seen, err := selectReply(raw, id, result)
		if !seen && err == nil {
			return invalidResponse()
		}
		return err
	}

	if bytes.Contains(raw, []byte("\r")) {
		raw = bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
		raw = bytes.ReplaceAll(raw, []byte("\r"), []byte("\n"))
	}
	var frame bytes.Buffer
	for _, event := range bytes.Split(raw, []byte("\n\n")) {
		for _, line := range bytes.Split(event, []byte("\n")) {
			if data, ok := bytes.CutPrefix(line, []byte("data:")); ok {
				frame.Write(bytes.TrimPrefix(data, []byte(" ")))
				frame.WriteByte('\n')
			}
		}
		if data := bytes.TrimSpace(frame.Bytes()); len(data) > 0 {
			seen, err := selectReply(data, id, result)
			if seen || err != nil {
				return err
			}
		}
		frame.Reset()
	}
	return invalidResponse()
}

func selectReply(raw []byte, id int, result any) (bool, error) {
	raw = bytes.TrimSpace(raw)
	var replies []rpcReply
	if len(raw) > 0 && raw[0] == '[' {
		if json.Unmarshal(raw, &replies) != nil {
			return false, invalidResponse()
		}
	} else {
		var reply rpcReply
		if json.Unmarshal(raw, &reply) != nil {
			return false, invalidResponse()
		}
		replies = []rpcReply{reply}
	}
	expectedID := strconv.Itoa(id)
	for _, reply := range replies {
		if reply.JSONRPC != "2.0" || string(reply.ID) != expectedID {
			continue
		}
		if reply.Error != nil {
			msg := reply.Error.Message
			if msg == "" {
				msg = "MCP request failed."
			}
			return true, errors.New(msg)
		}
		if len(reply.Result) == 0 || reply.Result[0] != '{' || json.Unmarshal(reply.Result, result) != nil {
			return true, invalidResponse()
		}
		return true, nil
	}
	return false, nil
}

func connectionError(err error, command, recovery string) error {
	msg := strings.ToLower(err.Error())
	var status statusError
	hasStatus := errors.As(err, &status)
	if (hasStatus && status.code == http.StatusUnauthorized) || (!hasStatus && strings.Contains(msg, "unauthorized")) {
		return fail("authentication-failed", "The connection token was rejected.", "Click Update connection in Paper Reed → Settings → Agent, then retry doctor.")
	}
	if hasStatus {
		return err
	}
	var network net.Error
	if errors.As(err, &network) || errors.Is(err, io.ErrUnexpectedEOF) ||
		errors.Is(err, context.DeadlineExceeded) || strings.Contains(msg, "timeout") || strings.Contains(msg, "timed out") {
		hint := "Keep Paper Reed running, enable Agent access, and update the CLI connection if the port changed."
		if command == "draft-send" {
			hint = "Send outcome may be unknown. " + recovery
		}
		return fail("connection-unavailable", "Cannot reach Paper Reed.", hint)
	}
	return err
}
