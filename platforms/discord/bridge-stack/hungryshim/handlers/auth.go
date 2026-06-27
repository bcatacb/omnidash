package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
)

// TokenPair is the registration as_token / hs_token pair for one account.
// The orchestrator writes a json file with all known pairs to disk; we
// re-read it on demand.
type TokenPair struct {
	AccountID string `json:"account_id"`
	ASToken   string `json:"as_token"`
	HSToken   string `json:"hs_token"`
}

type TokenSet struct {
	mu      sync.RWMutex
	byAs    map[string]TokenPair
	byHs    map[string]TokenPair
	srcFile string
}

func NewTokenSet() *TokenSet {
	return &TokenSet{byAs: map[string]TokenPair{}, byHs: map[string]TokenPair{}}
}

func LoadTokens(file string) (*TokenSet, error) {
	ts := NewTokenSet()
	ts.srcFile = file
	if err := ts.Reload(); err != nil {
		return ts, err
	}
	return ts, nil
}

func (t *TokenSet) Reload() error {
	if t.srcFile == "" {
		return errors.New("no token file configured")
	}
	b, err := os.ReadFile(t.srcFile)
	if err != nil {
		return err
	}
	var payload struct {
		Tokens []TokenPair `json:"tokens"`
	}
	if err := json.Unmarshal(b, &payload); err != nil {
		return err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.byAs = map[string]TokenPair{}
	t.byHs = map[string]TokenPair{}
	for _, p := range payload.Tokens {
		t.byAs[p.ASToken] = p
		t.byHs[p.HSToken] = p
	}
	return nil
}

// LookupByAS validates an as_token (from appservice -> homeserver direction).
func (t *TokenSet) LookupByAS(tok string) (TokenPair, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	p, ok := t.byAs[tok]
	return p, ok
}

// LookupByHS validates an hs_token (from homeserver -> appservice direction).
func (t *TokenSet) LookupByHS(tok string) (TokenPair, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	p, ok := t.byHs[tok]
	return p, ok
}

// extractBearer pulls the token out of either Authorization: Bearer or
// the legacy ?access_token=… query param.
func extractBearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("access_token")
}

// authAS validates the request bears a known as_token. Returns the
// matched pair, or writes an M_FORBIDDEN error response and returns false.
// On a brand-new install (orchestrator hasn't written tokens yet) we
// fail-open with a warning logged elsewhere.
func (api *API) authAS(w http.ResponseWriter, r *http.Request) (TokenPair, bool) {
	tok := extractBearer(r)
	if tok == "" {
		// Reload once in case the orchestrator wrote the file after boot.
		_ = api.tokens.Reload()
		writeError(w, http.StatusUnauthorized, "M_MISSING_TOKEN", "no access_token provided")
		return TokenPair{}, false
	}
	if p, ok := api.tokens.LookupByAS(tok); ok {
		return p, true
	}
	// Best-effort reload, in case the orchestrator just provisioned a new
	// account and we haven't seen the token yet.
	_ = api.tokens.Reload()
	if p, ok := api.tokens.LookupByAS(tok); ok {
		return p, true
	}
	writeError(w, http.StatusForbidden, "M_UNKNOWN_TOKEN", "unknown as_token")
	return TokenPair{}, false
}
