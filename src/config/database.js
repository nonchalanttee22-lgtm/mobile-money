"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.queryRead = queryRead;
exports.queryWrite = queryWrite;
exports.checkReplicaHealth = checkReplicaHealth;
exports.querySmart = querySmart;
exports.getPgBouncerStats = getPgBouncerStats;
var pg_1 = require("pg");
var readOnlyDetector_1 = require("../utils/readOnlyDetector");
// Configuration for slow query logging
var SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || "1000");
var ENABLE_SLOW_QUERY_LOGGING = process.env.ENABLE_SLOW_QUERY_LOGGING === "true" ||
    (process.env.NODE_ENV === "development" &&
        process.env.ENABLE_SLOW_QUERY_LOGGING !== "false");
/**
 * Sanitizes a SQL query by removing sensitive data patterns
 */
function sanitizeQuery(query) {
    return (query
        // Remove potential sensitive values in WHERE clauses
        .replace(/(WHERE\s+[^=]+\s*=\s*)'[^']*'/gi, "$1***")
        .replace(/(WHERE\s+[^=]+\s*=\s*)\d+/gi, "$1***")
        // Remove sensitive data in INSERT/UPDATE values
        .replace(/(VALUES\s*\([^)]*)'[^']*'([^)]*\))/gi, "$1***$2")
        .replace(/(SET\s+[^=]+\s*=\s*)'[^']*'/gi, "$1***")
        .replace(/(SET\s+[^=]+\s*=\s*)\d+/gi, "$1***")
        // Remove email patterns
        .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "***@***.***")
        // Remove phone number patterns
        .replace(/\b\d{10,}\b/g, "***")
        // Remove API keys and tokens
        .replace(/\b[A-Za-z0-9]{20,}\b/g, "***"));
}
/**
 * Sanitizes query parameters to remove sensitive data
 */
function sanitizeParams(params) {
    if (!params || !Array.isArray(params))
        return params;
    return params.map(function (param) {
        if (typeof param === "string") {
            // Check for email patterns
            if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/.test(param)) {
                return "***@***.***";
            }
            // Check for phone numbers (10+ digits)
            if (/^\d{10,}$/.test(param)) {
                return "***";
            }
            // Check for potential API keys/tokens (20+ chars, alphanumeric)
            if (/^[A-Za-z0-9]{20,}$/.test(param)) {
                return "***";
            }
            // Check for potential sensitive data in quotes
            if (param.length > 50) {
                return "***";
            }
            return param;
        }
        if (typeof param === "number" && param > 1000000) {
            return "***";
        }
        return param;
    });
}
/**
 * Logs slow queries with sanitized information
 */
function logSlowQuery(query, duration, params) {
    if (!ENABLE_SLOW_QUERY_LOGGING)
        return;
    var logEntry = {
        type: "slow_query",
        duration: Math.round(duration),
        threshold: SLOW_QUERY_THRESHOLD_MS,
        query: sanitizeQuery(query),
        params: params ? sanitizeParams(params) : undefined,
        timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(logEntry));
}
// Enhanced Pool with query timing
var SlowQueryPool = /** @class */ (function (_super) {
    __extends(SlowQueryPool, _super);
    function SlowQueryPool() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    SlowQueryPool.prototype.query = function (queryConfig, values) {
        return __awaiter(this, void 0, void 0, function () {
            var startTime, queryString, queryParams, result, endTime, durationMs, error_1, endTime, durationMs;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        startTime = process.hrtime.bigint();
                        queryString = typeof queryConfig === "string" ? queryConfig : queryConfig.text;
                        queryParams = typeof queryConfig === "string" ? values : queryConfig.values;
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, _super.prototype.query.call(this, queryConfig, values)];
                    case 2:
                        result = (_a.sent());
                        endTime = process.hrtime.bigint();
                        durationMs = Number(endTime - startTime) / 1e6;
                        if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
                            logSlowQuery(queryString, durationMs, queryParams);
                        }
                        return [2 /*return*/, result];
                    case 3:
                        error_1 = _a.sent();
                        endTime = process.hrtime.bigint();
                        durationMs = Number(endTime - startTime) / 1e6;
                        if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
                            logSlowQuery(queryString, durationMs, queryParams);
                        }
                        throw error_1;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return SlowQueryPool;
}(pg_1.Pool));
/**
 * Primary connection pool – now routes through PgBouncer for transaction-level pooling
 * This significantly reduces the number of direct connections to Postgres
 * (INSERT, UPDATE, DELETE) and read operations when no replica is available.
 */
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
// Wrap query for slow-query logging while preserving Pool typings.
var originalPoolQuery = exports.pool.query.bind(exports.pool);
exports.pool.query = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    return __awaiter(void 0, void 0, void 0, function () {
        var queryConfig, values, startTime, queryString, queryParams, result, endTime, durationMs, error_2, endTime, durationMs;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    queryConfig = args[0];
                    values = args[1];
                    startTime = process.hrtime.bigint();
                    queryString = typeof queryConfig === "string" ? queryConfig : (_a = queryConfig === null || queryConfig === void 0 ? void 0 : queryConfig.text) !== null && _a !== void 0 ? _a : "";
                    queryParams = typeof queryConfig === "string" ? values : queryConfig === null || queryConfig === void 0 ? void 0 : queryConfig.values;
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, originalPoolQuery.apply(void 0, args)];
                case 2:
                    result = _b.sent();
                    endTime = process.hrtime.bigint();
                    durationMs = Number(endTime - startTime) / 1e6;
                    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
                        logSlowQuery(queryString, durationMs, queryParams);
                    }
                    return [2 /*return*/, result];
                case 3:
                    error_2 = _b.sent();
                    endTime = process.hrtime.bigint();
                    durationMs = Number(endTime - startTime) / 1e6;
                    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
                        logSlowQuery(queryString, durationMs, queryParams);
                    }
                    throw error_2;
                case 4: return [2 /*return*/];
            }
        });
    });
};
/**
 * Read replica connection pool – handles SELECT queries to take load off the
 * primary. If READ_REPLICA_URL is not configured, falls back to the primary.
 *
 * Multiple replica URLs can be provided as a comma-separated list in
 * READ_REPLICA_URL. The pool load-balances across all replicas via round-robin.
 */
var replicaUrls = process.env.READ_REPLICA_URL
    ? process.env.READ_REPLICA_URL.split(",").map(function (url) { return url.trim(); })
    : [];
// Build an individual Pool for each replica URL
var replicaPools = replicaUrls.map(function (url) {
    return new pg_1.Pool({
        connectionString: url,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    });
});
// Track which replica to use next for round-robin load balancing
var replicaIndex = 0;
/**
 * Return the next replica pool in round-robin order.
 * Returns null if no replica pools are configured.
 */
function getNextReplicaPool() {
    if (replicaPools.length === 0)
        return null;
    var selected = replicaPools[replicaIndex % replicaPools.length];
    replicaIndex += 1;
    return selected;
}
/**
 * Execute a read-only SQL query against a replica pool if available.
 * If the replica is unreachable (pool error or connection failure) the query
 * automatically falls over to the primary pool so callers are unaffected.
 *
 * @param text   - The parameterised SQL query string
 * @param params - Optional query parameters
 */
function queryRead(text, params) {
    return __awaiter(this, void 0, void 0, function () {
        var replicaPool, client, result, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    replicaPool = getNextReplicaPool();
                    if (!replicaPool) return [3 /*break*/, 6];
                    client = null;
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, 5, 6]);
                    return [4 /*yield*/, replicaPool.connect()];
                case 2:
                    client = _a.sent();
                    return [4 /*yield*/, client.query(text, params)];
                case 3:
                    result = _a.sent();
                    return [2 /*return*/, result];
                case 4:
                    err_1 = _a.sent();
                    // Log replica failure and fall back to primary
                    console.warn("Read replica query failed, falling back to primary:", err_1);
                    return [3 /*break*/, 6];
                case 5:
                    client === null || client === void 0 ? void 0 : client.release();
                    return [7 /*endfinally*/];
                case 6: 
                // Fall back: use primary pool (which goes through PgBouncer)
                return [2 /*return*/, exports.pool.query(text, params)];
            }
        });
    });
}
/**
 * Execute a write SQL query (INSERT / UPDATE / DELETE) against the primary pool.
 * All writes now route through PgBouncer via the primary pool connection.
 *
 * @param text   - The parameterised SQL query string
 * @param params - Optional query parameters
 */
function queryWrite(text, params) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, exports.pool.query(text, params)];
        });
    });
}
/**
 * Health check for all replica pools.
 * Returns an array of status objects – useful for monitoring endpoints.
 */
function checkReplicaHealth() {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            return [2 /*return*/, Promise.all(replicaUrls.map(function (url, idx) { return __awaiter(_this, void 0, void 0, function () {
                    var client, _a;
                    return __generator(this, function (_b) {
                        switch (_b.label) {
                            case 0:
                                client = null;
                                _b.label = 1;
                            case 1:
                                _b.trys.push([1, 4, 5, 6]);
                                return [4 /*yield*/, replicaPools[idx].connect()];
                            case 2:
                                client = _b.sent();
                                return [4 /*yield*/, client.query("SELECT 1")];
                            case 3:
                                _b.sent();
                                return [2 /*return*/, { url: url, healthy: true }];
                            case 4:
                                _a = _b.sent();
                                return [2 /*return*/, { url: url, healthy: false }];
                            case 5:
                                client === null || client === void 0 ? void 0 : client.release();
                                return [7 /*endfinally*/];
                            case 6: return [2 /*return*/];
                        }
                    });
                }); }))];
        });
    });
}
/**
 * Smart query router: automatically detects read-only (SELECT) queries and
 * routes them to replica pools, while routing writes (INSERT/UPDATE/DELETE) to primary.
 * This enables transparent replica usage without changing existing code patterns.
 *
 * @param text   - The parameterised SQL query string
 * @param params - Optional query parameters
 */
function querySmart(text, params) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            // Auto-detect if this is a read-only query
            if ((0, readOnlyDetector_1.isReadOnlyQuery)(text)) {
                return [2 /*return*/, queryRead(text, params)];
            }
            else {
                return [2 /*return*/, queryWrite(text, params)];
            }
            return [2 /*return*/];
        });
    });
}
/**
 * Get PgBouncer pool statistics
 * Queries PgBouncer admin database to get connection pool metrics
 */
function getPgBouncerStats() {
    return __awaiter(this, void 0, void 0, function () {
        var pgbouncerPool, result, row, err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    pgbouncerPool = new pg_1.Pool({
                        connectionString: process.env.PGBOUNCER_ADMIN_URL || "postgresql://user:password@localhost:6432/pgbouncer",
                    });
                    return [4 /*yield*/, pgbouncerPool.query("SELECT sum(cl_active) as active, sum(cl_idle) as idle, sum(sv_active) as sv_active, sum(sv_idle) as sv_idle FROM pgbouncer.client_lookup;")];
                case 1:
                    result = _a.sent();
                    return [4 /*yield*/, pgbouncerPool.end()];
                case 2:
                    _a.sent();
                    row = result.rows[0] || {};
                    return [2 /*return*/, {
                            activeConnections: parseInt(row.sv_active || 0),
                            idleConnections: parseInt(row.sv_idle || 0),
                            totalConnections: (parseInt(row.sv_active || 0) + parseInt(row.sv_idle || 0)),
                            clientConnections: (parseInt(row.cl_active || 0) + parseInt(row.cl_idle || 0)),
                        }];
                case 3:
                    err_2 = _a.sent();
                    console.warn("Failed to get PgBouncer stats:", err_2);
                    return [2 /*return*/, {
                            activeConnections: 0,
                            idleConnections: 0,
                            totalConnections: 0,
                            clientConnections: 0,
                        }];
                case 4: return [2 /*return*/];
            }
        });
    });
}
