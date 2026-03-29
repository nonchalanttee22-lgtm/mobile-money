import { Request, Response, NextFunction } from "express";

/**
 * Rate Limit Configuration
 * These values can be easily tuned for different use cases
 */
export const RATE_LIMIT_CONFIG = {
  // Export endpoint: 5 requests per hour per admin
  EXPORT_LIMIT: 5,
  EXPORT_WINDOW_MS: 60 * 60 * 1000, // 1 hour in milliseconds

  // List queries: warn when requesting more than 1000 items
  MASSIVE_LIST_THRESHOLD: 1000,

  // Suspicious queries: more than 50 items without pagination
  SUSPICIOUS_QUERY_THRESHOLD: 50,
};

/**
 * Interface for tracking rate limit data
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * In-memory store for rate limit tracking
 * In production, use Redis or similar for distributed systems
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Log high-severity events
 */
const logHighSeverity = (message: string, context: Record<string, unknown>) => {
  console.error(`[RATE_LIMIT_BREACH] HIGH SEVERITY: ${message}`, {
    timestamp: new Date().toISOString(),
    ...context,
  });
};

/**
 * Generate a rate limit key based on user ID and endpoint
 */
const generateRateLimitKey = (userId: string, endpoint: string): string => {
  return `${userId}:${endpoint}`;
};

/**
 * Check and update rate limit counter
 */
const checkRateLimit = (
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetTime: number } => {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  // If entry doesn't exist or has expired, create a new one
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 0,
      resetTime: now + windowMs,
    };
    rateLimitStore.set(key, entry);
  }

  const remaining = Math.max(0, limit - entry.count);
  const allowed = entry.count < limit;

  if (allowed) {
    entry.count++;
  }

  return {
    allowed,
    remaining,
    resetTime: entry.resetTime,
  };
};

/**
 * Middleware: Rate limit for export endpoints
 * Limit: 5 exports per hour per admin
 */
export const rateLimitExport = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userId = (req as any).user?.id;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const key = generateRateLimitKey(userId, "EXPORT");
  const { allowed, remaining, resetTime } = checkRateLimit(
    key,
    RATE_LIMIT_CONFIG.EXPORT_LIMIT,
    RATE_LIMIT_CONFIG.EXPORT_WINDOW_MS,
  );

  // Set rate limit headers
  res.setHeader("X-RateLimit-Limit", RATE_LIMIT_CONFIG.EXPORT_LIMIT);
  res.setHeader("X-RateLimit-Remaining", remaining);
  res.setHeader("X-RateLimit-Reset", new Date(resetTime).toISOString());

  if (!allowed) {
    logHighSeverity("Export rate limit exceeded", {
      userId,
      limit: RATE_LIMIT_CONFIG.EXPORT_LIMIT,
      window: "1 hour",
      path: req.path,
      method: req.method,
    });

    return res.status(429).json({
      message: "Rate limit exceeded for exports",
      error: "TOO_MANY_EXPORT_REQUESTS",
      retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
      resetTime: new Date(resetTime).toISOString(),
    });
  }

  next();
};

/**
 * Middleware: Intelligent rate limiting for list queries
 * Detects and limits massive data requests
 */
export const rateLimitListQueries = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const userId = (req as any).user?.id;
  const limit = Number(req.query.limit) || 10;
  const page = Number(req.query.page) || 1;

  // Check if this is a massive list query (requesting more than threshold items)
  if (limit > RATE_LIMIT_CONFIG.MASSIVE_LIST_THRESHOLD) {
    logHighSeverity("Massive list query detected", {
      userId,
      requestedLimit: limit,
      threshold: RATE_LIMIT_CONFIG.MASSIVE_LIST_THRESHOLD,
      path: req.path,
      page,
      timestamp: new Date().toISOString(),
    });

    return res.status(400).json({
      message: "List query limit exceeded",
      error: "LIST_LIMIT_TOO_HIGH",
      maxAllowed: RATE_LIMIT_CONFIG.MASSIVE_LIST_THRESHOLD,
      currentRequest: limit,
    });
  }

  // Warn about suspicious queries (high limits without pagination awareness)
  if (limit > RATE_LIMIT_CONFIG.SUSPICIOUS_QUERY_THRESHOLD && page === 1) {
    console.warn("[RATE_LIMIT_WARNING] Suspicious list query", {
      userId,
      requestedLimit: limit,
      threshold: RATE_LIMIT_CONFIG.SUSPICIOUS_QUERY_THRESHOLD,
      path: req.path,
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

/**
 * Middleware: Combined rate limiting for sensitive admin operations
 * Applies both export and list query limits
 */
export const rateLimitAdminOperations = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // First apply list query limits
  rateLimitListQueries(req, res, (err) => {
    if (err) return; // Response already sent

    // Then pass to next middleware or route handler
    next();
  });
};

/**
 * Middleware: Cleanup expired rate limit entries
 * Call periodically to prevent memory leaks
 */
export const cleanupRateLimitStore = () => {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(
      `[RATE_LIMIT_CLEANUP] Cleaned up ${cleaned} expired rate limit entries`,
    );
  }
};

// Cleanup expired entries every 30 minutes
setInterval(cleanupRateLimitStore, 30 * 60 * 1000);
