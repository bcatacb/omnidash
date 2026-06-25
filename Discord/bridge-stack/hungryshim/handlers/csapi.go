package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/discord-account-manager/hungryshim/store"
)

type API struct {
	st     *store.Store
	tokens *TokenSet
	domain string
}

func New(st *store.Store, tokens *TokenSet, domain string) *API {
	return &API{st: st, tokens: tokens, domain: domain}
}

// ----- helpers -----------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, code int, errcode, msg string) {
	writeJSON(w, code, map[string]any{"errcode": errcode, "error": msg})
}

// genID makes a Matrix-style server-suffixed id like `$abc:domain` or `!xyz:domain`.
func (api *API) genID(prefix string) string {
	return fmt.Sprintf("%s%d:%s", prefix, time.Now().UnixNano(), api.domain)
}

// ----- handlers ----------------------------------------------------------------

func (api *API) Versions(w http.ResponseWriter, _ *http.Request) {
	// bridgev2 checks this BEFORE sending a token, so we do NOT require auth here.
	writeJSON(w, 200, map[string]any{
		"versions": []string{"v1.1", "v1.2", "v1.3", "v1.4", "v1.5", "v1.6"},
		"unstable_features": map[string]bool{
			"org.matrix.msc2409": true, // ephemeral events over appservice
			"org.matrix.msc3202": true, // appservice device masquerading
			"fi.mau.msc2659":     true, // application service ping
		},
	})
}

func (api *API) FederationVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{"server": map[string]string{"name": "hungryshim", "version": "0.1"}})
}

func (api *API) Whoami(w http.ResponseWriter, r *http.Request) {
	_, ok := api.authAS(w, r)
	if !ok {
		return
	}
	// We don't track the actual bot user here. Return the appservice bot
	// MXID by convention — mautrix-discord uses `@discordbot:<domain>`.
	writeJSON(w, 200, map[string]any{
		"user_id":  "@discordbot:" + api.domain,
		"device_id": "BRIDGEBOT",
	})
}

// Sync — long-poll up to the requested timeout, return an empty timeline.
// bridgev2 calls this in non-websocket mode; in websocket mode the
// transport in AppserviceWS replaces it.
func (api *API) Sync(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.authAS(w, r); !ok {
		return
	}
	timeoutMs := 30000
	if t := r.URL.Query().Get("timeout"); t != "" {
		fmt.Sscanf(t, "%d", &timeoutMs)
	}
	if timeoutMs > 30000 {
		timeoutMs = 30000
	}
	select {
	case <-time.After(time.Duration(timeoutMs) * time.Millisecond):
	case <-r.Context().Done():
		return
	}
	since := r.URL.Query().Get("since")
	if since == "" {
		since = "0"
	}
	writeJSON(w, 200, map[string]any{
		"next_batch":  since + "_",
		"rooms":       map[string]any{"join": map[string]any{}, "invite": map[string]any{}, "leave": map[string]any{}},
		"presence":    map[string]any{"events": []any{}},
		"account_data": map[string]any{"events": []any{}},
	})
}

type createRoomReq struct {
	Visibility    string         `json:"visibility"`
	RoomAliasName string         `json:"room_alias_name"`
	Name          string         `json:"name"`
	Topic         string         `json:"topic"`
	Invite        []string       `json:"invite"`
	IsDirect      bool           `json:"is_direct"`
	Preset        string         `json:"preset"`
	CreationContent map[string]any `json:"creation_content"`
	InitialState  []map[string]any `json:"initial_state"`
}

func (api *API) CreateRoom(w http.ResponseWriter, r *http.Request) {
	pair, ok := api.authAS(w, r)
	if !ok {
		return
	}
	var body createRoomReq
	_ = json.NewDecoder(r.Body).Decode(&body)
	roomID := api.genID("!")
	if err := api.st.CreateRoom(r.Context(), pair.AccountID, roomID, body.Name, body.Topic, body.IsDirect); err != nil {
		writeError(w, 500, "M_UNKNOWN", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"room_id": roomID})
}

func (api *API) RoomSend(w http.ResponseWriter, r *http.Request) {
	pair, ok := api.authAS(w, r)
	if !ok {
		return
	}
	vars := mux.Vars(r)
	roomID := vars["roomId"]
	eventType := vars["eventType"]
	txnID := vars["txnId"]

	body, _ := readAllJSON(r)
	eventID := api.genID("$")
	if err := api.st.InsertEvent(r.Context(), pair.AccountID, roomID, eventID, eventType, txnID, body); err != nil {
		writeError(w, 500, "M_UNKNOWN", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"event_id": eventID})
}

func (api *API) Register(w http.ResponseWriter, r *http.Request) {
	pair, ok := api.authAS(w, r)
	if !ok {
		return
	}
	var body struct {
		Username string `json:"username"`
		Type     string `json:"type"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	// Appservice puppet registration: just acknowledge and return an MXID.
	mxid := "@" + body.Username + ":" + api.domain
	_ = api.st.UpsertProfile(r.Context(), pair.AccountID, mxid, "", "")
	writeJSON(w, 200, map[string]any{
		"user_id":      mxid,
		"home_server":  api.domain,
		"access_token": pair.ASToken,
		"device_id":    "BRIDGEPUPPET",
	})
}

func (api *API) GetProfile(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.authAS(w, r); !ok {
		return
	}
	vars := mux.Vars(r)
	prof, err := api.st.GetProfile(r.Context(), vars["userId"])
	if err != nil {
		// Matrix expects a 200 with empty body for unknown profiles in some
		// flows, but bridges generally tolerate 404 with M_NOT_FOUND.
		writeError(w, 404, "M_NOT_FOUND", "profile not found")
		return
	}
	writeJSON(w, 200, map[string]any{
		"displayname": prof.DisplayName,
		"avatar_url":  prof.AvatarURL,
	})
}

func (api *API) SetDisplayName(w http.ResponseWriter, r *http.Request) {
	pair, ok := api.authAS(w, r)
	if !ok {
		return
	}
	vars := mux.Vars(r)
	var body struct {
		DisplayName string `json:"displayname"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := api.st.UpsertProfile(r.Context(), pair.AccountID, vars["userId"], body.DisplayName, ""); err != nil {
		writeError(w, 500, "M_UNKNOWN", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{})
}

func (api *API) SetAvatarURL(w http.ResponseWriter, r *http.Request) {
	pair, ok := api.authAS(w, r)
	if !ok {
		return
	}
	vars := mux.Vars(r)
	var body struct {
		AvatarURL string `json:"avatar_url"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := api.st.UpsertProfile(r.Context(), pair.AccountID, vars["userId"], "", body.AvatarURL); err != nil {
		writeError(w, 500, "M_UNKNOWN", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{})
}

func (api *API) RoomJoin(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.authAS(w, r); !ok {
		return
	}
	vars := mux.Vars(r)
	writeJSON(w, 200, map[string]any{"room_id": vars["roomId"]})
}

func (api *API) RoomLeave(w http.ResponseWriter, r *http.Request) {
	if _, ok := api.authAS(w, r); !ok {
		return
	}
	writeJSON(w, 200, map[string]any{})
}

// NotFoundLogger logs every unhandled path so it's easy to discover which
// endpoints the bridge expects but we haven't implemented yet.
func (api *API) NotFoundLogger(w http.ResponseWriter, r *http.Request) {
	log.Printf("hungryshim: unhandled %s %s", r.Method, r.URL.Path)
	writeError(w, 404, "M_UNRECOGNIZED", "endpoint not implemented in hungryshim — add it to handlers/csapi.go")
}

// readAllJSON drains the request body into a generic map. We intentionally
// don't validate schema — we only store the JSON for replay.
func readAllJSON(r *http.Request) (map[string]any, error) {
	out := map[string]any{}
	if r.Body == nil {
		return out, nil
	}
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	if err := dec.Decode(&out); err != nil {
		if strings.Contains(err.Error(), "EOF") {
			return out, nil
		}
		return out, err
	}
	return out, nil
}

// WithLogging is a tiny access log middleware so the operator can grep
// hungryshim logs for "unhandled" / status codes.
func WithLogging(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &statusRecorder{ResponseWriter: w, code: 200}
		h.ServeHTTP(ww, r)
		log.Printf("%s %s -> %d (%s)", r.Method, r.URL.Path, ww.code, time.Since(start))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}
