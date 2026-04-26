import NodeCache from "node-cache";
import { redisClient } from "../config/redis";

/**
 * Layered Cache Implementation (L1: Memory, L2: Redis)
 * 
 * Performance Goals:
 * - Sub-millisecond response for L1 hits
 * - Automatic L2 -> L1 propagation on misses
 * - Instance-wide invalidation via Redis Pub/Sub
 */

// L1 Cache configuration
const l1 = new NodeCache({
  stdTTL: 300,        // 5 minutes default
  checkperiod: 60,    // cleanup every 1 min
  useClones: false,   // performance boost (don't deep clone on get/set)
  maxKeys: 1000,      // memory limit safety
});

const INVALIDATION_CHANNEL = "cache:invalidate:l1";

export class LayeredCache {
  private subscriber: any = null;
  private isInitialized = false;

  /**
   * Initialize Redis subscription for L1 invalidation
   */
  async init() {
    if (this.isInitialized) return;
    
    if (redisClient && redisClient.isOpen) {
      try {
        this.subscriber = redisClient.duplicate();
        await this.subscriber.connect();
        
        await this.subscriber.subscribe(INVALIDATION_CHANNEL, (key: string) => {
          l1.del(key);
        });
        
        this.isInitialized = true;
        console.log("[LayeredCache] Initialized L1 invalidation subscriber");
      } catch (err) {
        console.error("[LayeredCache] Failed to initialize subscriber", err);
      }
    }
  }

  /**
   * Get item from layered cache
   */
  async get<T>(key: string): Promise<T | null> {
    // 1. Try L1 (Memory) - Extremely fast
    const cachedL1 = l1.get<T>(key);
    if (cachedL1 !== undefined) {
      return cachedL1;
    }

    // 2. Try L2 (Redis)
    if (!redisClient || !redisClient.isOpen) return null;
    
    try {
      const raw = await redisClient.get(key);
      if (!raw) return null;
      
      const parsed = JSON.parse(raw.toString());
      
      // Populate L1 for future fast access
      // We use the remaining TTL from Redis or a default
      l1.set(key, parsed);
      
      return parsed as T;
    } catch (err) {
      console.warn(`[LayeredCache] Get failed for key: ${key}`, err);
      return null;
    }
  }

  /**
   * Set item in layered cache
   */
  async set(key: string, value: any, ttlSec: number = 3600): Promise<void> {
    // 1. Update L1
    l1.set(key, value, ttlSec);

    // 2. Update L2
    if (redisClient && redisClient.isOpen) {
      try {
        await redisClient.setEx(key, ttlSec, JSON.stringify(value));
        
        // 3. Propagate invalidation to other instances' L1
        await redisClient.publish(INVALIDATION_CHANNEL, key);
      } catch (err) {
        console.warn(`[LayeredCache] Set failed for key: ${key}`, err);
      }
    }
  }

  /**
   * Invalidate key across all instances
   */
  async del(key: string): Promise<void> {
    // 1. Remove from local L1
    l1.del(key);

    // 2. Remove from L2
    if (redisClient && redisClient.isOpen) {
      try {
        await redisClient.del(key);
        
        // 3. Propagate to others
        await redisClient.publish(INVALIDATION_CHANNEL, key);
      } catch (err) {
        console.warn(`[LayeredCache] Delete failed for key: ${key}`, err);
      }
    }
  }

  /**
   * Invalidate keys matching a pattern across all instances
   */
  async delPattern(pattern: string): Promise<void> {
    if (redisClient && redisClient.isOpen) {
      try {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(keys as string[]);
          
          // Propagate invalidation for each key
          for (const key of keys) {
            const keyStr = key.toString();
            l1.del(keyStr);
            await redisClient.publish(INVALIDATION_CHANNEL, keyStr);
          }
        }
      } catch (err) {
        console.warn(`[LayeredCache] DelPattern failed for pattern: ${pattern}`, err);
      }
    }
  }

  /**
   * Get L1 metrics for monitoring
   */
  getStats() {
    return {
      l1: l1.getStats(),
      memory: process.memoryUsage().heapUsed,
    };
  }
}

export const layeredCache = new LayeredCache();
