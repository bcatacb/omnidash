package store

// In-memory + Postgres hybrid store for hungryshim. We persist anything
// that mautrix-discord might query back (rooms, profiles, events), and
// keep the hot path entirely in maps to avoid round-tripping to Postgres
// on every send. Postgres is a TODO: writes go straight to memory today;
// the schema is reserved for the next iteration so we can survive restarts.

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Room struct {
	AccountID string
	RoomID    string
	Name      string
	Topic     string
	IsDirect  bool
	CreatedAt time.Time
}

type Event struct {
	AccountID string
	RoomID    string
	EventID   string
	Type      string
	TxnID     string
	Body      json.RawMessage
	CreatedAt time.Time
}

type Profile struct {
	AccountID   string
	UserID      string
	DisplayName string
	AvatarURL   string
}

type Store struct {
	mu       sync.RWMutex
	rooms    map[string]Room    // room_id -> Room
	events   []Event            // append-only log
	profiles map[string]Profile // user_id -> Profile

	// pg is reserved for future durability; nil-safe today.
	pg *pgxpool.Pool
}

func Open(ctx context.Context, dsn string) (*Store, error) {
	s := &Store{
		rooms:    map[string]Room{},
		profiles: map[string]Profile{},
		events:   make([]Event, 0, 1024),
	}
	if dsn == "" {
		return s, nil
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		// Non-fatal: hungryshim can run in pure memory mode for v1.
		return s, nil
	}
	s.pg = pool
	// TODO: CREATE TABLE IF NOT EXISTS rooms / events / profiles here.
	return s, nil
}

func (s *Store) Close() {
	if s.pg != nil {
		s.pg.Close()
	}
}

func (s *Store) CreateRoom(_ context.Context, accountID, roomID, name, topic string, isDirect bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rooms[roomID] = Room{
		AccountID: accountID,
		RoomID:    roomID,
		Name:      name,
		Topic:     topic,
		IsDirect:  isDirect,
		CreatedAt: time.Now().UTC(),
	}
	return nil
}

func (s *Store) InsertEvent(_ context.Context, accountID, roomID, eventID, eventType, txnID string, body map[string]any) error {
	enc, err := json.Marshal(body)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, Event{
		AccountID: accountID,
		RoomID:    roomID,
		EventID:   eventID,
		Type:      eventType,
		TxnID:     txnID,
		Body:      enc,
		CreatedAt: time.Now().UTC(),
	})
	return nil
}

func (s *Store) UpsertProfile(_ context.Context, accountID, userID, displayName, avatarURL string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.profiles[userID]
	p.AccountID = accountID
	p.UserID = userID
	if displayName != "" {
		p.DisplayName = displayName
	}
	if avatarURL != "" {
		p.AvatarURL = avatarURL
	}
	s.profiles[userID] = p
	return nil
}

var ErrNotFound = errors.New("not found")

func (s *Store) GetProfile(_ context.Context, userID string) (Profile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.profiles[userID]
	if !ok {
		return Profile{}, ErrNotFound
	}
	return p, nil
}
