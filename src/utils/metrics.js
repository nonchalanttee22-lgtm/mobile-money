"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheHitRatio = exports.cacheMissesTotal = exports.cacheHitsTotal = exports.register = exports.activeConnections = exports.healthCheckResponseTimeSeconds = exports.providerCircuitBreakerState = exports.providerCircuitBreakerTransitionsTotal = exports.providerFailoverAlerts = exports.providerFailoverTotal = exports.providerResponseTimeSummary = exports.providerResponseTimeSeconds = exports.transactionErrorsTotal = exports.transactionTotal = exports.httpRequestDurationSeconds = exports.httpRequestsTotal = void 0;
var prom_client_1 = require("prom-client");
var register = new prom_client_1.Registry();
exports.register = register;
// Add default metrics (CPU, Memory, etc.)
(0, prom_client_1.collectDefaultMetrics)({ register: register });
// HTTP Metrics
exports.httpRequestsTotal = new prom_client_1.Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status_code"],
    registers: [register],
});
exports.httpRequestDurationSeconds = new prom_client_1.Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10], // standard buckets
    registers: [register],
});
// Business Logic Metrics
exports.transactionTotal = new prom_client_1.Counter({
    name: "transaction_total",
    help: "Total number of transactions processed",
    labelNames: ["type", "provider", "status"], // type: payment/payout
    registers: [register],
});
exports.transactionErrorsTotal = new prom_client_1.Counter({
    name: "transaction_errors_total",
    help: "Total number of transaction errors",
    labelNames: ["type", "provider", "error_type"],
    registers: [register],
});
exports.providerResponseTimeSeconds = new prom_client_1.Histogram({
    name: "provider_response_time_seconds",
    help: "Duration of provider operations in seconds",
    labelNames: ["provider", "operation", "status"],
    buckets: [0.1, 0.3, 0.5, 1, 3, 5, 10, 30],
    registers: [register],
});
exports.providerResponseTimeSummary = new prom_client_1.Summary({
    name: "provider_response_time_summary",
    help: "Summary of provider operation durations in seconds",
    labelNames: ["provider", "operation"],
    percentiles: [0.5, 0.9, 0.95, 0.99],
    registers: [register],
});
// Failover metrics
exports.providerFailoverTotal = new prom_client_1.Counter({
    name: "provider_failover_total",
    help: "Total number of automatic provider failovers",
    labelNames: ["type", "from_provider", "to_provider", "reason"],
    registers: [register],
});
exports.providerFailoverAlerts = new prom_client_1.Counter({
    name: "provider_failover_alerts_total",
    help: "Number of failover alert notifications emitted",
    labelNames: ["provider"],
    registers: [register],
});
exports.providerCircuitBreakerTransitionsTotal = new prom_client_1.Counter({
    name: "provider_circuit_breaker_transitions_total",
    help: "Total number of provider circuit breaker state transitions",
    labelNames: ["provider", "operation", "state"],
    registers: [register],
});
exports.providerCircuitBreakerState = new prom_client_1.Gauge({
    name: "provider_circuit_breaker_state",
    help: "Current provider circuit breaker state (0=closed, 0.5=half_open, 1=open)",
    labelNames: ["provider", "operation"],
    registers: [register],
});
exports.healthCheckResponseTimeSeconds = new prom_client_1.Histogram({
    name: "health_check_response_time_seconds",
    help: "Duration of provider health checks in seconds",
    labelNames: ["provider", "status"],
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 3, 5, 10],
    registers: [register],
});
// Connection Metrics
exports.activeConnections = new prom_client_1.Gauge({
    name: "active_connections",
    help: "Number of active HTTP connections",
    registers: [register],
});
// Cache Metrics
exports.cacheHitsTotal = new prom_client_1.Counter({
    name: "cache_hits_total",
    help: "Total number of cache hits",
    labelNames: ["route"],
    registers: [register],
});
exports.cacheMissesTotal = new prom_client_1.Counter({
    name: "cache_misses_total",
    help: "Total number of cache misses",
    labelNames: ["route"],
    registers: [register],
});
// A gauge that mirrors the hit ratio for easier scraping; updated on each hit/miss
exports.cacheHitRatio = new prom_client_1.Gauge({
    name: "cache_hit_ratio",
    help: "Cache hit ratio (hits / (hits+misses))",
    labelNames: ["route"],
    registers: [register],
});
