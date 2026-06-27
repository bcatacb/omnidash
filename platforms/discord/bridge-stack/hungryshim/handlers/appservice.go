package handlers

import (
	"log"
	"net/http"
)

// AppserviceWS is the websocket transport used by bridgev2 when
// `homeserver.websocket: true` is set in config.yaml.
//
// The wire format is documented (loosely) by mautrix-wsproxy:
// each message is a JSON object containing an "id", a "command" (e.g.
// "transaction", "syncproxy_error"), and a "data" field. Server pushes
// "transaction" frames with appservice events to the bridge, and the
// bridge replies with a result frame.
//
// For v1 we only implement enough to:
//   1. Accept the upgrade and validate the as_token in the URL/header.
//   2. Hold the connection open so the bridge doesn't crash-loop.
//
// Actual event delivery (Matrix -> Discord) is TODO. Once the orchestrator
// has a Matrix client that sends room events into hungryshim, we will
// fan those out over this socket as "transaction" frames.
func (api *API) AppserviceWS(w http.ResponseWriter, r *http.Request) {
	// Validate token before upgrading.
	if _, ok := api.authAS(w, r); !ok {
		return
	}
	// We deliberately do NOT pull in gorilla/websocket here yet; the build
	// stays slim and the bridge will simply fall back to HTTP push if we
	// don't accept the upgrade. When you're ready to implement, drop in
	// github.com/gorilla/websocket, call Upgrade(), and loop reading
	// command frames. See:
	//   https://github.com/mautrix/wsproxy/blob/main/wsproxy/wsproxy.go
	log.Printf("hungryshim: AppserviceWS hit but websocket transport not implemented; returning 501")
	writeError(w, http.StatusNotImplemented, "M_UNRECOGNIZED", "appservice websocket not implemented yet")
}
