// ingest-go — Callback Ingestion Service (Go / fasthttp)
//
// POST /ingest
//   - Validates JSON payload
//   - Publishes to Redis Stream  (REDIS_ENABLED=true, default)
//   - Publishes to NATS JetStream (NATS_ENABLED=true)
//   - Returns 202 Accepted immediately
//
// Environment variables:
//   PORT           — HTTP port (default: 3002)
//   REDIS_URL      — Redis URL  (default: redis://localhost:6379)
//   NATS_URL       — NATS URL   (default: nats://localhost:4222)
//   REDIS_ENABLED  — publish to Redis Streams (default: true)
//   NATS_ENABLED   — publish to NATS JetStream (default: false)
//   REDIS_STREAM   — stream key (default: callbacks)
//   NATS_SUBJECT   — NATS subject (default: callbacks.ingest)

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
	"github.com/valyala/fasthttp"
)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var (
	port         = getEnv("PORT", "3002")
	redisURL     = getEnv("REDIS_URL", "redis://localhost:6379")
	natsURL      = getEnv("NATS_URL", "nats://localhost:4222")
	redisEnabled = getEnv("REDIS_ENABLED", "true") != "false"
	natsEnabled  = getEnv("NATS_ENABLED", "false") == "true"
	redisStream  = getEnv("REDIS_STREAM", "callbacks")
	natsSubject  = getEnv("NATS_SUBJECT", "callbacks.ingest")
)

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

type CallbackPayload struct {
	EventType string                 `json:"event_type"`
	Provider  string                 `json:"provider"`
	Reference string                 `json:"reference"`
	Amount    float64                `json:"amount"`
	Currency  string                 `json:"currency"`
	Status    string                 `json:"status"`
	Timestamp string                 `json:"timestamp"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

func (p *CallbackPayload) Validate() error {
	if p.EventType == "" || len(p.EventType) > 64 {
		return fmt.Errorf("event_type is required and must be ≤64 chars")
	}
	if p.Provider == "" || len(p.Provider) > 32 {
		return fmt.Errorf("provider is required and must be ≤32 chars")
	}
	if p.Reference == "" || len(p.Reference) > 128 {
		return fmt.Errorf("reference is required and must be ≤128 chars")
	}
	if p.Amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if len(p.Currency) != 3 {
		return fmt.Errorf("currency must be a 3-letter ISO code")
	}
	switch p.Status {
	case "pending", "success", "failed":
	default:
		return fmt.Errorf("status must be pending|success|failed")
	}
	if _, err := time.Parse(time.RFC3339, p.Timestamp); err != nil {
		return fmt.Errorf("timestamp must be RFC3339")
	}
	return nil
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

var (
	rdb *redis.Client
	nc  *nats.Conn
	js  nats.JetStreamContext
	ctx = context.Background()
)

func initMessaging() error {
	if redisEnabled {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			return fmt.Errorf("redis URL parse: %w", err)
		}
		rdb = redis.NewClient(opt)
		if err := rdb.Ping(ctx).Err(); err != nil {
			return fmt.Errorf("redis ping: %w", err)
		}
		log.Printf("[redis] connected to %s", redisURL)
	}

	if natsEnabled {
		var err error
		nc, err = nats.Connect(natsURL)
		if err != nil {
			return fmt.Errorf("nats connect: %w", err)
		}
		js, err = nc.JetStream()
		if err != nil {
			return fmt.Errorf("nats jetstream: %w", err)
		}
		log.Printf("[nats] connected to %s", natsURL)
	}

	return nil
}

func publish(p *CallbackPayload) error {
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}

	if redisEnabled && rdb != nil {
		// Redis Streams — at-least-once, persistent
		if err := rdb.XAdd(ctx, &redis.XAddArgs{
			Stream: redisStream,
			ID:     "*",
			Values: map[string]interface{}{
				"event_type": p.EventType,
				"provider":   p.Provider,
				"reference":  p.Reference,
				"data":       string(data),
			},
		}).Err(); err != nil {
			return fmt.Errorf("redis xadd: %w", err)
		}
	}

	if natsEnabled && js != nil {
		if _, err := js.Publish(natsSubject, data); err != nil {
			return fmt.Errorf("nats publish: %w", err)
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

func handleIngest(ctx *fasthttp.RequestCtx) {
	if !ctx.IsPost() {
		ctx.SetStatusCode(fasthttp.StatusMethodNotAllowed)
		return
	}

	var payload CallbackPayload
	if err := json.Unmarshal(ctx.PostBody(), &payload); err != nil {
		ctx.SetStatusCode(fasthttp.StatusBadRequest)
		ctx.SetBodyString(`{"error":"invalid JSON"}`)
		return
	}

	if err := payload.Validate(); err != nil {
		ctx.SetStatusCode(fasthttp.StatusBadRequest)
		fmt.Fprintf(ctx, `{"error":%q}`, err.Error())
		return
	}

	if err := publish(&payload); err != nil {
		log.Printf("[ingest] publish error: %v", err)
		ctx.SetStatusCode(fasthttp.StatusInternalServerError)
		ctx.SetBodyString(`{"error":"publish failed"}`)
		return
	}

	ctx.SetStatusCode(fasthttp.StatusAccepted)
	fmt.Fprintf(ctx, `{"status":"accepted","reference":%q}`, payload.Reference)
}

func handleHealth(ctx *fasthttp.RequestCtx) {
	ctx.SetStatusCode(fasthttp.StatusOK)
	ctx.SetBodyString(`{"status":"ok","runtime":"go"}`)
}

func router(ctx *fasthttp.RequestCtx) {
	ctx.SetContentType("application/json")
	switch string(ctx.Path()) {
	case "/ingest":
		handleIngest(ctx)
	case "/health":
		handleHealth(ctx)
	default:
		ctx.SetStatusCode(fasthttp.StatusNotFound)
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	if err := initMessaging(); err != nil {
		log.Fatalf("[ingest-go] messaging init failed: %v", err)
	}

	portInt, _ := strconv.Atoi(port)
	addr := fmt.Sprintf("0.0.0.0:%d", portInt)
	log.Printf("[ingest-go] listening on :%s", port)

	server := &fasthttp.Server{
		Handler:            router,
		ReadTimeout:        5 * time.Second,
		WriteTimeout:       5 * time.Second,
		MaxRequestBodySize: 1 * 1024 * 1024, // 1 MB
		Concurrency:        256 * 1024,
	}

	if err := server.ListenAndServe(addr); err != nil {
		log.Fatalf("[ingest-go] server error: %v", err)
	}
}
