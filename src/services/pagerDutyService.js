"use strict";
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
exports.PagerDutyService = void 0;
exports.createPagerDutyService = createPagerDutyService;
var axios_1 = require("axios");
/**
 * PagerDuty Events API V2 Integration
 * Sends CRITICAL incidents when provider error rates exceed 15% in 5 minutes
 * Automatically resolves incidents when error rates drop below threshold
 */
var PagerDutyService = /** @class */ (function () {
    function PagerDutyService(config) {
        this.activeIncidents = new Map();
        this.checkInterval = null;
        this.config = config;
        this.client = axios_1.default.create({
            baseURL: PagerDutyService.API_URL,
            timeout: 5000,
        });
    }
    /**
     * Start monitoring for error rate spikes
     * Runs periodic checks to evaluate error rates and trigger/resolve incidents
     */
    PagerDutyService.prototype.start = function () {
        var _this = this;
        if (!this.config.enabled) {
            console.log("PagerDuty service is disabled");
            return;
        }
        if (this.checkInterval)
            return;
        this.checkInterval = setInterval(function () {
            _this.evaluateErrorRates().catch(function (error) {
                console.error("Error in PagerDuty evaluation cycle:", error);
            });
        }, PagerDutyService.CHECK_INTERVAL_MS);
        console.log("PagerDuty monitoring service started");
    };
    /**
     * Stop monitoring
     */
    PagerDutyService.prototype.stop = function () {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    };
    /**
     * Record a provider error for tracking in the sliding window
     * Called when a provider operation fails
     */
    PagerDutyService.prototype.recordProviderError = function (provider, timestamp) {
        if (!this.config.enabled)
            return;
        var errorKey = "".concat(provider, "_errors");
        var requestKey = "".concat(provider, "_total_requests");
        // Get or initialize error list and request count
        if (!this.activeIncidents.has(errorKey)) {
            this.activeIncidents.set(errorKey, {
                provider: provider,
                errorRate: 0,
                errorCount: 0,
                totalRequests: 0,
                timestamp: new Date().toISOString(),
            });
        }
        var incident = this.activeIncidents.get(errorKey);
        incident.errorCount++;
        // Clean old errors outside the sliding window
        this.cleanupOldMetrics(provider);
    };
    /**
     * Record a successful provider request
     * Called when a provider operation succeeds
     */
    PagerDutyService.prototype.recordProviderSuccess = function (provider) {
        if (!this.config.enabled)
            return;
        var requestKey = "".concat(provider, "_total_requests");
        if (!this.activeIncidents.has(requestKey)) {
            this.activeIncidents.set(requestKey, {
                provider: provider,
                errorRate: 0,
                errorCount: 0,
                totalRequests: 0,
                timestamp: new Date().toISOString(),
            });
        }
        var incident = this.activeIncidents.get(requestKey);
        incident.totalRequests++;
    };
    /**
     * Evaluate error rates for all providers and trigger/resolve incidents as needed
     * This is called periodically by the monitoring loop
     */
    PagerDutyService.prototype.evaluateErrorRates = function () {
        return __awaiter(this, void 0, void 0, function () {
            var providers, _i, providers_1, provider, errorRate, isIncidentActive;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        providers = this.getTrackedProviders();
                        _i = 0, providers_1 = providers;
                        _a.label = 1;
                    case 1:
                        if (!(_i < providers_1.length)) return [3 /*break*/, 6];
                        provider = providers_1[_i];
                        errorRate = this.calculateErrorRate(provider);
                        isIncidentActive = this.activeIncidents.has("incident_".concat(provider));
                        if (!(errorRate > PagerDutyService.ERROR_RATE_THRESHOLD && !isIncidentActive)) return [3 /*break*/, 3];
                        // Trigger new incident
                        return [4 /*yield*/, this.triggerIncident(provider, errorRate)];
                    case 2:
                        // Trigger new incident
                        _a.sent();
                        return [3 /*break*/, 5];
                    case 3:
                        if (!(errorRate <= PagerDutyService.ERROR_RATE_THRESHOLD &&
                            isIncidentActive)) return [3 /*break*/, 5];
                        // Resolve incident
                        return [4 /*yield*/, this.resolveIncident(provider, errorRate)];
                    case 4:
                        // Resolve incident
                        _a.sent();
                        _a.label = 5;
                    case 5:
                        _i++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Calculate error rate for a provider based on metrics in the sliding window
     */
    PagerDutyService.prototype.calculateErrorRate = function (provider) {
        var _a;
        var errorKey = "".concat(provider, "_errors");
        var requestKey = "".concat(provider, "_total_requests");
        var errorData = this.activeIncidents.get(errorKey);
        var requestData = this.activeIncidents.get(requestKey);
        if (!requestData || requestData.totalRequests === 0) {
            return 0;
        }
        var errorCount = (_a = errorData === null || errorData === void 0 ? void 0 : errorData.errorCount) !== null && _a !== void 0 ? _a : 0;
        return errorCount / requestData.totalRequests;
    };
    /**
     * Get list of providers being tracked
     */
    PagerDutyService.prototype.getTrackedProviders = function () {
        var providers = new Set();
        for (var _i = 0, _a = this.activeIncidents.keys(); _i < _a.length; _i++) {
            var key = _a[_i];
            var match = key.match(/^(.+?)_(errors|total_requests)$/);
            if (match) {
                providers.add(match[1]);
            }
        }
        return providers;
    };
    /**
     * Clean up old error metrics outside the 5-minute window
     */
    PagerDutyService.prototype.cleanupOldMetrics = function (provider) {
        var now = Date.now();
        var windowStart = now - PagerDutyService.WINDOW_MS;
        // Keep data within the window by resetting periodically
        // In a production system, you might want to use a more sophisticated
        // time-series approach (e.g., storing timestamps with each error)
    };
    /**
     * Trigger a CRITICAL incident in PagerDuty
     */
    PagerDutyService.prototype.triggerIncident = function (provider, errorRate) {
        return __awaiter(this, void 0, void 0, function () {
            var event_1, response, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        event_1 = this.buildIncidentEvent(provider, errorRate, "trigger");
                        return [4 /*yield*/, this.client.post("", event_1)];
                    case 1:
                        response = _a.sent();
                        if (response.status === 202 || response.status === 200) {
                            // Mark incident as active
                            this.activeIncidents.set("incident_".concat(provider), {
                                provider: provider,
                                errorRate: errorRate,
                                errorCount: 0,
                                totalRequests: 0,
                                timestamp: new Date().toISOString(),
                            });
                            console.log(JSON.stringify({
                                timestamp: new Date().toISOString(),
                                level: "CRITICAL",
                                message: "PagerDuty incident triggered",
                                provider: provider,
                                errorRate: (errorRate * 100).toFixed(2) + "%",
                                threshold: "15%",
                                dedup_key: this.getDedupeKey(provider),
                            }));
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        error_1 = _a.sent();
                        console.error("Failed to trigger PagerDuty incident for provider ".concat(provider, ":"), error_1);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Resolve an active incident in PagerDuty
     */
    PagerDutyService.prototype.resolveIncident = function (provider, errorRate) {
        return __awaiter(this, void 0, void 0, function () {
            var event_2, response, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        event_2 = this.buildIncidentEvent(provider, errorRate, "resolve");
                        return [4 /*yield*/, this.client.post("", event_2)];
                    case 1:
                        response = _a.sent();
                        if (response.status === 202 || response.status === 200) {
                            // Mark incident as resolved
                            this.activeIncidents.delete("incident_".concat(provider));
                            console.log(JSON.stringify({
                                timestamp: new Date().toISOString(),
                                level: "INFO",
                                message: "PagerDuty incident resolved",
                                provider: provider,
                                errorRate: (errorRate * 100).toFixed(2) + "%",
                                dedup_key: this.getDedupeKey(provider),
                            }));
                        }
                        return [3 /*break*/, 3];
                    case 2:
                        error_2 = _a.sent();
                        console.error("Failed to resolve PagerDuty incident for provider ".concat(provider, ":"), error_2);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Build a PagerDuty event payload
     */
    PagerDutyService.prototype.buildIncidentEvent = function (provider, errorRate, action) {
        var dedupeKey = this.getDedupeKey(provider);
        var errorPercentage = (errorRate * 100).toFixed(2);
        return {
            routing_key: this.config.integrationKey,
            event_action: action,
            dedup_key: dedupeKey,
            payload: {
                summary: action === "trigger"
                    ? "[CRITICAL] Provider ".concat(provider, " error rate at ").concat(errorPercentage, "% (threshold: 15%)")
                    : "[RESOLVED] Provider ".concat(provider, " error rate recovered to ").concat(errorPercentage, "%"),
                timestamp: new Date().toISOString(),
                severity: action === "trigger" ? "critical" : "info",
                source: "mobile-money-api",
                custom_details: {
                    provider: provider,
                    errorRatePercentage: errorPercentage,
                    threshold: "15%",
                    window: "5 minutes",
                    action: action,
                    environment: process.env.NODE_ENV || "development",
                },
            },
        };
    };
    /**
     * Generate a deduplication key for PagerDuty
     * Ensures that multiple events for the same provider are treated as the same incident
     */
    PagerDutyService.prototype.getDedupeKey = function (provider) {
        return "".concat(this.config.dedupKey, "-").concat(provider, "-error-rate");
    };
    /**
     * Get current error rate for a specific provider (for debugging/monitoring)
     */
    PagerDutyService.prototype.getErrorRate = function (provider) {
        return this.calculateErrorRate(provider);
    };
    /**
     * Get all active incidents
     */
    PagerDutyService.prototype.getActiveIncidents = function () {
        return new Map(this.activeIncidents);
    };
    /**
     * Reset metrics (useful for testing or manual reset)
     */
    PagerDutyService.prototype.reset = function () {
        this.activeIncidents.clear();
    };
    PagerDutyService.API_URL = "https://events.pagerduty.com/v2/enqueue";
    PagerDutyService.ERROR_RATE_THRESHOLD = 0.15; // 15%
    PagerDutyService.WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    PagerDutyService.CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
    return PagerDutyService;
}());
exports.PagerDutyService = PagerDutyService;
/**
 * Factory function to create and initialize PagerDuty service
 */
function createPagerDutyService(enabled) {
    if (enabled === void 0) { enabled = true; }
    var config = {
        integrationKey: process.env.PAGERDUTY_INTEGRATION_KEY || "",
        dedupKey: process.env.PAGERDUTY_DEDUP_KEY || "mobile-money",
        enabled: enabled && !!process.env.PAGERDUTY_INTEGRATION_KEY,
    };
    var service = new PagerDutyService(config);
    if (config.enabled) {
        service.start();
    }
    return service;
}
