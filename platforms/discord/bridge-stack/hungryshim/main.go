// Package main is the entrypoint for hungryshim — a minimal Matrix C-S +
// appservice subset for mautrix-discord. It speaks ONLY the endpoints
// known to be exercised by bridgev2 in token-auth single-tenant mode.
//
// =============================================================================
// NOT IMPLEMENTED — if the bridge calls any of these, you'll see a 404 in the
// logs. Add a handler and route here, then mirror in handlers/csapi.go.
// =============================================================================
//
//   - /_matrix/media/* (upload, download, thumbnail) — required for attachments
//       in either direction. Without this, image/file bridging WILL break.
//   - /_matrix/client/r0/rooms/{roomId}/state/* (set arbitrary state events)
//   - /_matrix/client/r0/rooms/{roomId}/redact/{eventId}/{txnId}
//   - /_matrix/client/r0/rooms/{roomId}/invite
//   - /_matrix/client/r0/rooms/{roomId}/kick
//   - /_matrix/client/r0/rooms/{roomId}/messages (back-pagination)
//   - /_matrix/client/r0/rooms/{roomId}/context/{eventId}
//   - /_matrix/client/r0/user/{userId}/account_data/{type}
//   - /_matrix/client/r0/user/{userId}/rooms/{roomId}/account_data/{type}
//   - /_matrix/client/r0/directory/room/{roomAlias}
//   - /_matrix/client/r0/joined_rooms
//   - /_matrix/client/r0/typing/{userId}
//   - /_matrix/client/r0/receipt/{receiptType}/{eventId}
//   - /_matrix/client/r0/keys/* (e2ee — skip if encryption disabled in config)
//   - /_matrix/client/r0/login (only needed for double-puppeting)
//   - /_matrix/client/v3/* aliases (we currently only respond on /r0)
//   - appservice "PUT /_matrix/app/v1/transactions/{txnId}" — only matters
//       if the bridge runs in appservice-HTTP-push mode. For websocket mode
//       (which we use) the transport is reversed and lives in
//       handlers/appservice.go.
//
// When you spot a 404 in the bridge logs, add the route here and wire a
// handler. Most endpoints can return a stub success body — the bridge
// usually only inspects a couple of fields.
//
// =============================================================================
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/mux"

	"github.com/discord-account-manager/hungryshim/handlers"
	"github.com/discord-account-manager/hungryshim/store"
)

func main() {
	listen := envOr("HUNGRY_LISTEN", ":8008")
	dsn := envOr("HUNGRY_DB_DSN", "")
	domain := envOr("HUNGRY_DOMAIN", "bridge.local")
	tokenFile := envOr("HUNGRY_TOKEN_FILE", "/etc/hungry/tokens.json")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	st, err := store.Open(ctx, dsn)
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	tokens, err := handlers.LoadTokens(tokenFile)
	if err != nil {
		log.Printf("warning: load tokens: %v (continuing with empty set; orchestrator will repopulate)", err)
		tokens = handlers.NewTokenSet()
	}

	api := handlers.New(st, tokens, domain)

	r := mux.NewRouter()

	// Version probe used by EVERY Matrix client before issuing real requests.
	r.HandleFunc("/_matrix/client/versions", api.Versions).Methods("GET")
	// Federation probe — bridgev2 occasionally hits this.
	r.HandleFunc("/_matrix/federation/v1/version", api.FederationVersion).Methods("GET")

	// We expose both /r0 and /v3 aliases because mautrix-discord/bridgev2
	// has used both over time.
	csVersions := []string{"r0", "v3"}
	for _, v := range csVersions {
		base := "/_matrix/client/" + v
		r.HandleFunc(base+"/sync", api.Sync).Methods("GET")
		r.HandleFunc(base+"/createRoom", api.CreateRoom).Methods("POST")
		r.HandleFunc(base+"/rooms/{roomId}/send/{eventType}/{txnId}", api.RoomSend).Methods("PUT")
		r.HandleFunc(base+"/rooms/{roomId}/join", api.RoomJoin).Methods("POST")
		r.HandleFunc(base+"/rooms/{roomId}/leave", api.RoomLeave).Methods("POST")
		r.HandleFunc(base+"/register", api.Register).Methods("POST")
		r.HandleFunc(base+"/profile/{userId}", api.GetProfile).Methods("GET")
		r.HandleFunc(base+"/profile/{userId}/displayname", api.SetDisplayName).Methods("PUT")
		r.HandleFunc(base+"/profile/{userId}/avatar_url", api.SetAvatarURL).Methods("PUT")
		// Whoami is dirt-cheap and bridgev2 checks it on startup.
		r.HandleFunc(base+"/account/whoami", api.Whoami).Methods("GET")
	}

	// Appservice WebSocket transport — bridgev2 connects here when
	// `homeserver.websocket: true` in config.yaml.
	r.HandleFunc("/_matrix/client/unstable/fi.mau.as_sync", api.AppserviceWS).Methods("GET")

	// Catch-all logger so unknown endpoints are easy to spot in logs.
	r.PathPrefix("/").HandlerFunc(api.NotFoundLogger)

	srv := &http.Server{
		Addr:              listen,
		Handler:           handlers.WithLogging(r),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("hungryshim listening on %s (domain=%s)", listen, domain)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Printf("shutting down...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
}

func envOr(k, def string) string {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	return v
}
