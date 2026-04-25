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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringService = void 0;
var metrics_1 = require("../utils/metrics");
var MonitoringService = /** @class */ (function () {
    function MonitoringService() {
    }
    /**
     * Initialize the monitoring service with PagerDuty integration
     */
    MonitoringService.initialize = function (pagerDutyService) {
        this.pagerDutyService = pagerDutyService || null;
    };
    MonitoringService.start = function (intervalMs) {
        var _this = this;
        if (intervalMs === void 0) { intervalMs = 30000; }
        // Default 30 seconds for more frequent error rate checks
        if (this.checkInterval)
            return;
        this.checkInterval = setInterval(function () { return __awaiter(_this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.runChecks()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        }); }, intervalMs);
        console.log("Monitoring service started with interval ".concat(intervalMs, "ms"));
    };
    MonitoringService.stop = function () {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    };
    MonitoringService.runChecks = function () {
        return __awaiter(this, void 0, void 0, function () {
            var metrics, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, metrics_1.register.getMetricsAsJSON()];
                    case 1:
                        metrics = _a.sent();
                        // 1. Check performance metrics (P95)
                        this.checkPerformanceMetrics(metrics);
                        // 2. Check provider error rates (new PagerDuty integration)
                        this.checkProviderErrorRates(metrics);
                        return [3 /*break*/, 3];
                    case 2:
                        error_1 = _a.sent();
                        console.error("Error in monitoring service checks", error_1);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check performance metrics and alert on degradation
     */
    MonitoringService.checkPerformanceMetrics = function (metrics) {
        // 1. Check for slow average responses in Histogram
        var histogram = metrics.find(function (m) { return m.name === "provider_response_time_seconds"; });
        if (histogram && Array.isArray(histogram.values)) {
            // We look at the sum / count for each label set
            // But prom-client JSON output is a bit complex.
            // For simplicity, we can also just use the Summary quantiles.
        }
        // 2. Check P95 from Summary
        var summary = metrics.find(function (m) { return m.name === "provider_response_time_summary"; });
        if (summary && Array.isArray(summary.values)) {
            for (var _i = 0, _a = summary.values; _i < _a.length; _i++) {
                var val = _a[_i];
                if (val.labels.quantile === 0.95 &&
                    val.value > this.P95_THRESHOLD_S) {
                    console.error(JSON.stringify({
                        timestamp: new Date().toISOString(),
                        level: "CRITICAL",
                        message: "Degraded performance: P95 response time too high",
                        provider: val.labels.provider,
                        operation: val.labels.operation,
                        p95_seconds: val.value,
                        threshold_seconds: this.P95_THRESHOLD_S,
                    }));
                }
            }
        }
    };
    /**
     * Check provider error rates within the 5-minute sliding window
     * Triggers PagerDuty incidents when error rate exceeds 15%
     */
    MonitoringService.checkProviderErrorRates = function (metrics) {
        if (!this.pagerDutyService)
            return;
        var now = Date.now();
        var windowStart = now - this.WINDOW_MS;
        // Get transaction metrics
        var errorMetric = metrics.find(function (m) { return m.name === "transaction_errors_total"; });
        var totalMetric = metrics.find(function (m) { return m.name === "transaction_total"; });
        var providerErrors = new Map();
        var providerTotals = new Map();
        // Aggregate errors by provider
        if (errorMetric && Array.isArray(errorMetric.values)) {
            for (var _i = 0, _a = errorMetric.values; _i < _a.length; _i++) {
                var val = _a[_i];
                var provider = val.labels.provider;
                var currentCount = providerErrors.get(provider) || 0;
                providerErrors.set(provider, currentCount + val.value);
            }
        }
        // Aggregate totals by provider
        if (totalMetric && Array.isArray(totalMetric.values)) {
            for (var _b = 0, _c = totalMetric.values; _b < _c.length; _b++) {
                var val = _c[_b];
                var provider = val.labels.provider;
                var currentCount = providerTotals.get(provider) || 0;
                providerTotals.set(provider, currentCount + val.value);
            }
        }
        // Calculate error rates and trigger/resolve incidents
        var providers = new Set(__spreadArray(__spreadArray([], providerErrors.keys(), true), providerTotals.keys(), true));
        for (var _d = 0, providers_1 = providers; _d < providers_1.length; _d++) {
            var provider = providers_1[_d];
            var errorCount = providerErrors.get(provider) || 0;
            var totalCount = providerTotals.get(provider) || 0;
            // Record metrics in history for sliding window calculation
            this.recordMetricHistory(provider, errorCount, totalCount);
            // Calculate error rate within the sliding window
            var windowMetrics = this.getMetricsInWindow(provider, windowStart);
            var errorRate = this.calculateErrorRate(windowMetrics);
            // Update current metrics
            var metrics_2 = {
                provider: provider,
                errorCount: windowMetrics.totalErrors,
                totalCount: windowMetrics.totalCount,
                errorRate: errorRate,
                lastUpdated: new Date(),
            };
            this.providerMetricsWindow.set(provider, metrics_2);
            // Decision logic for PagerDuty
            if (errorRate > this.ERROR_RATE_THRESHOLD) {
                this.pagerDutyService.recordProviderError(provider, now);
                console.warn(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    level: "WARNING",
                    message: "Provider error rate exceeded threshold",
                    provider: provider,
                    errorRate: (errorRate * 100).toFixed(2) + "%",
                    threshold: "15%",
                    window: "5 minutes",
                    errorCount: windowMetrics.totalErrors,
                    totalCount: windowMetrics.totalCount,
                }));
            }
            else if (errorRate <= this.ERROR_RATE_THRESHOLD) {
                this.pagerDutyService.recordProviderSuccess(provider);
            }
        }
    };
    /**
     * Record metric data point in history for sliding window calculation
     */
    MonitoringService.recordMetricHistory = function (provider, errorCount, totalCount) {
        if (!this.metricsHistory.has(provider)) {
            this.metricsHistory.set(provider, []);
        }
        var history = this.metricsHistory.get(provider);
        history.push({
            timestamp: Date.now(),
            errorCount: errorCount,
            totalCount: totalCount,
        });
        // Keep only the last 5 minutes of data
        var fiveMinutesAgo = Date.now() - this.WINDOW_MS;
        var filtered = history.filter(function (h) { return h.timestamp >= fiveMinutesAgo; });
        this.metricsHistory.set(provider, filtered);
    };
    /**
     * Get aggregated metrics for a provider within the sliding window
     */
    MonitoringService.getMetricsInWindow = function (provider, windowStart) {
        var history = this.metricsHistory.get(provider) || [];
        var totalErrors = 0;
        var totalCount = 0;
        for (var _i = 0, history_1 = history; _i < history_1.length; _i++) {
            var entry = history_1[_i];
            if (entry.timestamp >= windowStart) {
                totalErrors += entry.errorCount;
                totalCount += entry.totalCount;
            }
        }
        return {
            totalErrors: totalErrors,
            totalCount: totalCount,
        };
    };
    /**
     * Calculate error rate from window metrics
     */
    MonitoringService.calculateErrorRate = function (windowMetrics) {
        if (windowMetrics.totalCount === 0) {
            return 0;
        }
        return windowMetrics.totalErrors / windowMetrics.totalCount;
    };
    /**
     * Manual check for specific provider/operation.
     * Can be called after a batch of requests.
     */
    MonitoringService.checkPerformance = function (provider, operation) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/];
            });
        });
    };
    /**
     * Get current metrics for all providers
     */
    MonitoringService.getProviderMetrics = function () {
        return Array.from(this.providerMetricsWindow.values());
    };
    /**
     * Get metrics for a specific provider
     */
    MonitoringService.getProviderMetricsFor = function (provider) {
        return this.providerMetricsWindow.get(provider);
    };
    MonitoringService.checkInterval = null;
    MonitoringService.SLOW_RESPONSE_THRESHOLD_S = 10;
    MonitoringService.P95_THRESHOLD_S = 20;
    MonitoringService.ERROR_RATE_THRESHOLD = 0.15; // 15%
    MonitoringService.WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    MonitoringService.pagerDutyService = null;
    MonitoringService.providerMetricsWindow = new Map();
    MonitoringService.metricsHistory = new Map();
    return MonitoringService;
}());
exports.MonitoringService = MonitoringService;
