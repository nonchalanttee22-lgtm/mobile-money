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
exports.executeWithCircuitBreaker = executeWithCircuitBreaker;
exports.isCircuitBreakerOpenError = isCircuitBreakerOpenError;
exports.resetCircuitBreakers = resetCircuitBreakers;
exports.getCircuitBreakerCount = getCircuitBreakerCount;
var opossum_1 = require("opossum");
var metrics_1 = require("./metrics");
var circuitBreakers = new Map();
var CIRCUIT_STATE_VALUES = {
    closed: 0,
    half_open: 0.5,
    open: 1,
};
function getCircuitKey(provider, operation) {
    return "".concat(provider, ":").concat(operation);
}
function getBreakerOptions(name) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
        name: name,
        timeout: Number((_a = process.env.PROVIDER_CIRCUIT_BREAKER_TIMEOUT_MS) !== null && _a !== void 0 ? _a : 5000),
        resetTimeout: Number((_b = process.env.PROVIDER_CIRCUIT_BREAKER_RESET_TIMEOUT_MS) !== null && _b !== void 0 ? _b : 30000),
        rollingCountTimeout: Number((_c = process.env.PROVIDER_CIRCUIT_BREAKER_ROLLING_WINDOW_MS) !== null && _c !== void 0 ? _c : 10000),
        rollingCountBuckets: Number((_d = process.env.PROVIDER_CIRCUIT_BREAKER_ROLLING_BUCKETS) !== null && _d !== void 0 ? _d : 10),
        volumeThreshold: Number((_e = process.env.PROVIDER_CIRCUIT_BREAKER_VOLUME_THRESHOLD) !== null && _e !== void 0 ? _e : 3),
        errorThresholdPercentage: Number((_f = process.env.PROVIDER_CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE) !== null && _f !== void 0 ? _f : 50),
        capacity: Number((_g = process.env.PROVIDER_CIRCUIT_BREAKER_CAPACITY) !== null && _g !== void 0 ? _g : 100),
        enableSnapshots: false,
    };
}
function setCircuitStateMetric(provider, operation, state) {
    metrics_1.providerCircuitBreakerState.set({ provider: provider, operation: operation }, CIRCUIT_STATE_VALUES[state]);
}
function emitStateTransitionMetric(provider, operation, state) {
    metrics_1.providerCircuitBreakerTransitionsTotal.inc({ provider: provider, operation: operation, state: state });
    setCircuitStateMetric(provider, operation, state);
}
function toExecutionError(error) {
    if (error instanceof Error) {
        return error;
    }
    return new Error(typeof error === "string" ? error : "Provider call failed");
}
function normalizeResult(result) {
    if (result.success) {
        return result;
    }
    throw toExecutionError(result.error);
}
function getOrCreateCircuitBreaker(provider, operation) {
    var _this = this;
    var key = getCircuitKey(provider, operation);
    var existing = circuitBreakers.get(key);
    if (existing) {
        return existing;
    }
    var breaker = new opossum_1.default(function (execute) { return __awaiter(_this, void 0, void 0, function () { var _a; return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = normalizeResult;
                return [4 /*yield*/, execute()];
            case 1: return [2 /*return*/, _a.apply(void 0, [_b.sent()])];
        }
    }); }); }, getBreakerOptions(key));
    breaker.fallback(function (_execute, fallback, error) { return __awaiter(_this, void 0, void 0, function () {
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!fallback) {
                        throw toExecutionError(error);
                    }
                    _a = normalizeResult;
                    return [4 /*yield*/, fallback(error)];
                case 1: return [2 /*return*/, _a.apply(void 0, [_b.sent()])];
            }
        });
    }); });
    breaker.on("open", function () {
        emitStateTransitionMetric(provider, operation, "open");
    });
    breaker.on("halfOpen", function () {
        emitStateTransitionMetric(provider, operation, "half_open");
    });
    breaker.on("close", function () {
        emitStateTransitionMetric(provider, operation, "closed");
    });
    setCircuitStateMetric(provider, operation, "closed");
    circuitBreakers.set(key, breaker);
    return breaker;
}
function executeWithCircuitBreaker(options) {
    return __awaiter(this, void 0, void 0, function () {
        var breaker;
        return __generator(this, function (_a) {
            breaker = getOrCreateCircuitBreaker(options.provider, options.operation);
            return [2 /*return*/, breaker.fire(options.execute, options.fallback)];
        });
    });
}
function isCircuitBreakerOpenError(error) {
    return (error instanceof Error &&
        "code" in error &&
        error.code === "EOPENBREAKER");
}
function resetCircuitBreakers() {
    for (var _i = 0, _a = circuitBreakers.values(); _i < _a.length; _i++) {
        var breaker = _a[_i];
        breaker.shutdown();
    }
    circuitBreakers.clear();
}
function getCircuitBreakerCount() {
    return circuitBreakers.size;
}
