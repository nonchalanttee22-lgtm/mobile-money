import { Request, Response, NextFunction } from "express";
import { redisClient } from "../config/redis";

type Bucket = "auth" | "read" | "mutation";

const WINDOW_SECONDS = 60; // per-minute windows

// Acceptance criteria limits
const LIMITS: Record<Bucket, number> = {
  auth: 5, // strictly limited to 5/min
  read: 100, // allow 100/min
  mutation: 30, // reasonable default for mutations (assumption)
};

// Weights per method/default. Endpoints can be assigned heavier weights here by path.
const DEFAULT_WEIGHT_BY_METHOD: Record<string, number> = {
  GET: 1,
  POST: 5,
  PUT: 5,
  PATCH: 5,
  DELETE: 5,
};

// Optional per-path weights (prefix match). Add entries here if some endpoints should cost more.
const PATH_WEIGHTS: Array<{ prefix: string; weight: number }> = [
  // Example: { prefix: "/api/v1/transactions/bulk", weight: 10 },
];

function getWeight(req: Request): number {
  for (const p of PATH_WEIGHTS) {
    if (req.path.startsWith(p.prefix)) return p.weight;
  }
  return DEFAULT_WEIGHT_BY_METHOD[req.method] || 1;
}

function getBucket(req: Request): Bucket {
  // Auth endpoints explicitly mapped
  if (req.path.startsWith("/api/auth") || req.path.startsWith("/oauth"))
    return "auth";

  // Reads: consider GET methods as read endpoints
  if (req.method === "GET") return "read";

  // All others treated as mutation
  return "mutation";
}

function getIdentifier(req: Request): string {
  // Try user-based identifier if available (req.session or req.user), else fall back to IP
  // Don't depend on session middleware being present; safest is IP-based rate limiting.
  const ip = (req.ip || req.headers["x-forwarded-for"] || "unknown") as string;
  return ip;
}

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!redisClient || !redisClient.isOpen) {
      // If Redis isn't available, allow requests (fail open) but log a warning.
      console.warn("Rate limiter: Redis not available, skipping rate limiting");
      return next();
    }

    const bucket = getBucket(req);
    const limit = LIMITS[bucket];
    const weight = getWeight(req);
    const ident = getIdentifier(req);

    const windowIdx = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `ratelimit:${bucket}:${ident}:${windowIdx}`;

    // Atomically increment by weight and set expiry when first created.
    // Using INCRBY and then setting EXPIRE if value equals weight.
    const newCount = await redisClient.incrBy(key, weight);
    if (newCount === weight) {
      // newly created in this window; set TTL to remaining seconds in window
      const elapsed = Date.now() / 1000 - windowIdx * WINDOW_SECONDS;
      const ttl = Math.max(1, WINDOW_SECONDS - Math.floor(elapsed));
      try {
        await redisClient.expire(key, ttl);
      } catch (err) {
        // Non-fatal
        console.warn("Rate limiter: failed to set key TTL", err);
      }
    }

    const remaining = Math.max(0, limit - newCount);

    // Set informative headers similar to common rate-limit middleware
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    if (newCount > limit) {
      // compute retry-after using the TTL on the key
      let retryAfter = WINDOW_SECONDS;
      try {
        const ttl = await redisClient.ttl(key);
        if (ttl && ttl > 0) retryAfter = ttl;
      } catch {
        // ignore
      }

      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      });
      return;
    }

    return next();
  } catch (err) {
    console.error("Rate limiter: unexpected error", err);
    // Fail open on error to avoid blocking traffic on unexpected errors
    return next();
  }
}

export default rateLimitMiddleware;
