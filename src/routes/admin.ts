import { Router, Request, Response, NextFunction } from "express";
import { updateAdminNotesHandler } from "../controllers/transactionController";
import {
  DashboardConfig,
  validateDashboardConfig,
  DASHBOARD_CONFIG_VALIDATION_ERRORS,
} from "../utils/dashboardConfig";
import {
  rateLimitExport,
  rateLimitListQueries,
  RATE_LIMIT_CONFIG,
} from "../middleware/rateLimit";
import { MobileMoneyService } from "../services/mobilemoney/mobileMoneyService";
import { getQueueStats } from "../queue/transactionQueue";
import { redisClient } from "../config/redis";
import { checkReplicaHealth } from "../config/database";

const router = Router();

interface User {
  id: string;
  role: string;
  locked?: boolean;
  dashboard_config?: DashboardConfig;
  [key: string]: unknown;
}

interface Transaction {
  id: string;
  [key: string]: unknown;
}

interface AuthRequest extends Request {
  user?: User;
}

/**
 * Mock services (replace with real DB/services)
 */
const users: User[] = [];
const transactions: Transaction[] = [];

/**
 * Middleware: Require Admin Role
 */
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  // Assume req.user is set by auth middleware
  const user = (req as AuthRequest).user;

  if (!user || user.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }

  next();
};

/**
 * Middleware: Admin Logger
 */
const logAdminAction = (action: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    console.log(`[ADMIN ACTION] ${action}`, {
      adminId: (req as AuthRequest).user?.id,
      method: req.method,
      path: req.originalUrl,
      body: req.body,
      timestamp: new Date().toISOString(),
    });
    next();
  };
};

/**
 * Helper: Pagination
 */
const paginate = <T>(data: T[], page: number, limit: number) => {
  const start = (page - 1) * limit;
  const end = start + limit;

  return {
    data: data.slice(start, end),
    pagination: {
      total: data.length,
      page,
      limit,
      totalPages: Math.ceil(data.length / limit),
    },
  };
};

/**
 * =========================
 * USERS
 * =========================
 */

// GET /api/admin/users
router.get(
  "/users",
  requireAdmin,
  rateLimitListQueries,
  logAdminAction("LIST_USERS"),
  (req: Request, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const result = paginate(users, page, limit);

    res.json(result);
  },
);

// GET /api/admin/users/:id
router.get(
  "/users/:id",
  requireAdmin,
  logAdminAction("GET_USER"),
  (req: Request, res: Response) => {
    const user = users.find((u) => u.id === req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  },
);

// PUT /api/admin/users/:id
router.put(
  "/users/:id",
  requireAdmin,
  logAdminAction("UPDATE_USER"),
  (req: Request, res: Response) => {
    const user = users.find((u) => u.id === req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    Object.assign(user, req.body);

    res.json({ message: "User updated", user });
  },
);

// POST /api/admin/users/:id/unlock
router.post(
  "/users/:id/unlock",
  requireAdmin,
  logAdminAction("UNLOCK_USER"),
  (req: Request, res: Response) => {
    const user = users.find((u) => u.id === req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.locked = false;

    res.json({ message: "User account unlocked" });
  },
);

/**
 * =========================
 * DASHBOARD CONFIGURATION
 * =========================
 */

// GET /api/admin/users/:id/dashboard-config
router.get(
  "/users/:id/dashboard-config",
  requireAdmin,
  logAdminAction("GET_DASHBOARD_CONFIG"),
  (req: Request, res: Response) => {
    const user = users.find((u) => u.id === req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const config = user.dashboard_config || {
      layout: "grid",
      widgets: [],
    };

    res.json({
      userId: user.id,
      config,
    });
  },
);

// PUT /api/admin/users/:id/dashboard-config
router.put(
  "/users/:id/dashboard-config",
  requireAdmin,
  logAdminAction("UPDATE_DASHBOARD_CONFIG"),
  (req: Request, res: Response) => {
    const user = users.find((u) => u.id === req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { config } = req.body;

    // Validate the dashboard config against the JSON schema
    if (!validateDashboardConfig(config)) {
      return res.status(400).json({
        message: "Invalid dashboard configuration",
        errors: DASHBOARD_CONFIG_VALIDATION_ERRORS,
      });
    }

    // Save the configuration
    user.dashboard_config = config;

    res.json({
      message: "Dashboard configuration saved",
      userId: user.id,
      config: user.dashboard_config,
    });
  },
);

/**
 * =========================
 * TRANSACTIONS
 * =========================
 */

// GET /api/admin/transactions
router.get(
  "/transactions",
  requireAdmin,
  logAdminAction("LIST_TRANSACTIONS"),
  (req: Request, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const result = paginate(transactions, page, limit);

    res.json(result);
  },
);

// PUT /api/admin/transactions/:id
router.put(
  "/transactions/:id",
  requireAdmin,
  rateLimitListQueries,
  logAdminAction("UPDATE_TRANSACTION"),
  (req: Request, res: Response) => {
    const tx = transactions.find((t) => t.id === req.params.id);

    if (!tx) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    Object.assign(tx, req.body);

    res.json({ message: "Transaction updated", transaction: tx });
  },
);

// PATCH /api/admin/transactions/:id/notes
router.patch(
  "/transactions/:id/notes",
  requireAdmin,
  logAdminAction("UPDATE_TRANSACTION_ADMIN_NOTES"),
  updateAdminNotesHandler,
);

/**
 * =========================
 * HEALTH & MONITORING
 * =========================
 */

// GET /api/admin/providers/health
router.get(
  "/providers/health",
  requireAdmin,
  logAdminAction("GET_PROVIDER_HEALTH"),
  async (req: Request, res: Response) => {
    try {
      const timestamp = new Date().toISOString();
      const mobileMoneyService = new MobileMoneyService();

      // Get failover stats
      let providers = {};
      try {
        providers = mobileMoneyService.getFailoverStats();
      } catch (err) {
        console.error("Error fetching failover stats:", err);
      }

      // Get queue stats
      let queue = { status: "unknown", stats: {} };
      try {
        const queueStats = await getQueueStats();
        queue = {
          status: queueStats.failed > 100 ? "degraded" : "healthy",
          stats: queueStats,
        };
      } catch (err) {
        console.error("Error fetching queue stats:", err);
      }

      // Get Redis status
      const redis = { status: "unknown" };
      try {
        if (redisClient.isOpen) {
          await redisClient.ping();
          redis.status = "ok";
        } else {
          redis.status = "closed";
        }
      } catch (err) {
        console.error("Error checking Redis status:", err);
        redis.status = "down";
      }

      // Get database replica health
      let database: {
        primary: string;
        replicas: { url: string; healthy: boolean }[];
      } = {
        primary: "unknown",
        replicas: [],
      };
      try {
        const replicaHealth = await checkReplicaHealth();
        database = {
          primary: "ok", // Primary is assumed ok if we can query replicas
          replicas: replicaHealth,
        };
      } catch (err) {
        console.error("Error checking database health:", err);
      }

      res.json({
        status: "healthy",
        timestamp,
        providers,
        queue,
        redis,
        database,
      });
    } catch (err) {
      console.error("Health check error:", err);
      res.status(500).json({
        status: "error",
        message: "Failed to retrieve health data",
        timestamp: new Date().toISOString(),
      });
    }
  },
);

/**
 * =========================
 * DATA EXPORT
 * =========================
 */

// POST /api/admin/export/users
router.post(
  "/export/users",
  requireAdmin,
  rateLimitExport,
  logAdminAction("EXPORT_USERS"),
  (req: Request, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const result = paginate(users, page, limit);

    // Set export headers
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="users-export.json"');

    res.json({
      exportedAt: new Date().toISOString(),
      exportedBy: (req as AuthRequest).user?.id,
      dataType: "users",
      ...result,
    });
  },
);

// POST /api/admin/export/transactions
router.post(
  "/export/transactions",
  requireAdmin,
  rateLimitExport,
  logAdminAction("EXPORT_TRANSACTIONS"),
  (req: Request, res: Response) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const result = paginate(transactions, page, limit);

    // Set export headers
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="transactions-export.json"',
    );

    res.json({
      exportedAt: new Date().toISOString(),
      exportedBy: (req as AuthRequest).user?.id,
      dataType: "transactions",
      ...result,
    });
  },
);

export const adminRoutes = router;