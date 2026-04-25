import { Router, Request, Response, NextFunction } from "express";
import { generateToken } from "../auth/jwt";
import { updateAdminNotesHandler, refundTransactionHandler } from "../controllers/transactionController";
import {
  DashboardConfig,
  validateDashboardConfig,
  DASHBOARD_CONFIG_VALIDATION_ERRORS,
} from "../utils/dashboardConfig";
import { auditInterceptor } from "../middleware/auditInterceptor";
import {
  rateLimitExport,
  rateLimitListQueries,
  RATE_LIMIT_CONFIG,
} from "../middleware/rateLimit";
import { MobileMoneyService } from "../services/mobilemoney/mobileMoneyService";
import { getQueueStats } from "../queue/transactionQueue";
import { redisClient } from "../config/redis";
import { checkReplicaHealth, pool} from "../config/database";
import { UserModel } from "../models/users";
import { TransactionModel } from "../models/transaction";
import multer from "multer";
import {
  parseCSV,
  reconcileTransactions,
} from "../services/csvReconciliation";
import {
  getTransactionResolutionPercentiles,
  getDisputeResolutionPercentiles,
  getTransactionResolutionTrends,
  getDisputeResolutionTrends,
} from "../services/metrics";
import { dlqInspectorHandler } from "../queue/dlq";
import { triggerManualTransfer, getLiquidityTransfers } from "../services/liquidityTransferService";

const router = Router();
const IMPERSONATION_TOKEN_EXPIRES_IN = "15m";
const IMPERSONATION_TOKEN_TTL_MS = 15 * 60 * 1000;
const READ_ONLY_IMPERSONATION_MESSAGE = "Read-only mode active";

router.use(auditInterceptor(pool));

// Multer configuration for CSV uploads
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

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
const transactionModel = new TransactionModel();

const isAdminRole = (role?: string) =>
  role === "admin" || role === "super-admin";

const isSuperAdminRole = (role?: string) => role === "super-admin";

const buildAuditContext = (req: Request) => {
  const authReq = req as AuthRequest;

  return {
    actorUserId: authReq.user?.id,
    actorRole: authReq.user?.role,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    timestamp: new Date().toISOString(),
  };
};

const logImpersonationAuditEvent = (
  event:
    | "IMPERSONATION_TOKEN_ISSUED"
    | "IMPERSONATION_TOKEN_DENIED"
    | "IMPERSONATION_TOKEN_REJECTED",
  req: Request,
  details: Record<string, unknown>,
) => {
  console.log("[ADMIN IMPERSONATION]", {
    event,
    ...buildAuditContext(req),
    ...details,
  });
};

/**
 * Middleware: Require Admin Role
 */
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  // Assume req.user is set by auth middleware
  const user = (req as AuthRequest).user;

  if (!user || !isAdminRole(user.role)) {
    return res.status(403).json({ message: "Admin access required" });
  }

  next();
};

const requireSuperAdmin = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as AuthRequest).user;

  if (!user || !isSuperAdminRole(user.role)) {
    logImpersonationAuditEvent("IMPERSONATION_TOKEN_DENIED", req, {
      reason: "super_admin_required",
    });
    return res.status(403).json({
      message: "Super-admin access required",
    });
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
 * METRICS
 * =========================
 */

// GET /api/admin/metrics/transactions/resolution
router.get(
  "/metrics/transactions/resolution",
  requireAdmin,
  logAdminAction("GET_TRANSACTION_RESOLUTION_METRICS"),
  async (req: Request, res: Response) => {
    try {
      const daysBack = parseInt(req.query.days as string) || 30;
      const metrics = await getTransactionResolutionPercentiles(daysBack);
      const trends = await getTransactionResolutionTrends(7);

      res.json({
        metrics,
        trends,
        period: `${daysBack} days`,
        sla_threshold_ms: 24 * 60 * 60 * 1000,
        sla_threshold_hours: 24,
      });
    } catch (err) {
      console.error("Error fetching transaction resolution metrics:", err);
      res.status(500).json({
        message: "Failed to retrieve transaction resolution metrics",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },
);

// GET /api/admin/metrics/disputes/resolution
router.get(
  "/metrics/disputes/resolution",
  requireAdmin,
  logAdminAction("GET_DISPUTE_RESOLUTION_METRICS"),
  async (req: Request, res: Response) => {
    try {
      const daysBack = parseInt(req.query.days as string) || 30;
      const metrics = await getDisputeResolutionPercentiles(daysBack);
      const trends = await getDisputeResolutionTrends(7);

      res.json({
        metrics,
        trends,
        period: `${daysBack} days`,
        sla_threshold_ms: 24 * 60 * 60 * 1000,
        sla_threshold_hours: 24,
      });
    } catch (err) {
      console.error("Error fetching dispute resolution metrics:", err);
      res.status(500).json({
        message: "Failed to retrieve dispute resolution metrics",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },
);

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
// POST /api/admin/users/:id/impersonation-token
router.post(
  "/users/:id/impersonation-token",
  requireAdmin,
  requireSuperAdmin,
  (req: Request, res: Response) => {
    const actor = (req as AuthRequest).user;
    const targetUser = users.find((u) => u.id === req.params.id);
    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    if (!targetUser) {
      logImpersonationAuditEvent("IMPERSONATION_TOKEN_REJECTED", req, {
        targetUserId: req.params.id,
        reason: "target_user_not_found",
      });
      return res.status(404).json({ message: "User not found" });
    }

    if (!actor) {
      logImpersonationAuditEvent("IMPERSONATION_TOKEN_REJECTED", req, {
        targetUserId: targetUser.id,
        reason: "missing_actor_context",
      });
      return res.status(401).json({ message: "Authentication required" });
    }

    if (actor.id === targetUser.id) {
      logImpersonationAuditEvent("IMPERSONATION_TOKEN_REJECTED", req, {
        targetUserId: targetUser.id,
        reason: "self_impersonation_blocked",
      });
      return res.status(400).json({
        message: "Cannot generate an impersonation token for yourself",
      });
    }

    if (!reason) {
      logImpersonationAuditEvent("IMPERSONATION_TOKEN_REJECTED", req, {
        targetUserId: targetUser.id,
        reason: "missing_support_reason",
      });
      return res.status(400).json({
        message: "A support reason is required for impersonation",
      });
    }

    const email =
      typeof targetUser.email === "string" && targetUser.email.trim()
        ? targetUser.email
        : `${targetUser.id}@impersonated.local`;
    const expiresAt = new Date(
      Date.now() + IMPERSONATION_TOKEN_TTL_MS,
    ).toISOString();
    const token = generateToken(
      {
        userId: targetUser.id,
        email,
        impersonation: {
          active: true,
          readOnly: true,
          actorUserId: actor.id,
          actorRole: actor.role,
          targetUserId: targetUser.id,
          reason,
          issuedAt: new Date().toISOString(),
        },
      },
      { expiresIn: IMPERSONATION_TOKEN_EXPIRES_IN },
    );

    logImpersonationAuditEvent("IMPERSONATION_TOKEN_ISSUED", req, {
      targetUserId: targetUser.id,
      supportReason: reason,
      expiresAt,
    });

    return res.status(201).json({
      message: "Read-only impersonation token generated",
      token,
      expiresAt,
      impersonation: {
        actorUserId: actor.id,
        actorRole: actor.role,
        targetUserId: targetUser.id,
        readOnly: true,
        reason,
      },
      guidance: READ_ONLY_IMPERSONATION_MESSAGE,
    });
  },
);

export default router;

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

// POST /api/admin/users/:id/freeze
router.post(
  "/users/:id/freeze",
  requireAdmin,
  logAdminAction("FREEZE_USER"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.params.id;
      const { reason } = req.body;
      const adminUser = (req as AuthRequest).user;

      if (!adminUser) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Validate reason
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({
          message: "A reason is required for freezing an account",
        });
      }

      const userModel = new UserModel();

      // Check if user exists
      const user = await userModel.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if already frozen
      if (user.status === "frozen") {
        return res.status(400).json({
          message: "User account is already frozen",
        });
      }

      // Freeze the user
      const updatedUser = await userModel.updateStatus(
        userId,
        "frozen",
        adminUser.id,
        reason.trim(),
        req.ip,
        req.get("user-agent"),
      );

      if (!updatedUser) {
        return res
          .status(500)
          .json({ message: "Failed to freeze user account" });
      }

      console.log(`[ADMIN] User account frozen: ${userId}`, {
        adminId: adminUser.id,
        targetUserId: userId,
        reason: reason.trim(),
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: "User account frozen successfully",
        user: {
          id: updatedUser.id,
          status: updatedUser.status,
        },
      });
    } catch (error) {
      console.error("Error freezing user account:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// POST /api/admin/users/:id/unfreeze
router.post(
  "/users/:id/unfreeze",
  requireAdmin,
  logAdminAction("UNFREEZE_USER"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.params.id;
      const { reason } = req.body;
      const adminUser = (req as AuthRequest).user;

      if (!adminUser) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Validate reason
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({
          message: "A reason is required for unfreezing an account",
        });
      }

      const userModel = new UserModel();

      // Check if user exists
      const user = await userModel.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if not frozen
      if (user.status !== "frozen") {
        return res.status(400).json({
          message: "User account is not frozen",
        });
      }

      // Unfreeze the user
      const updatedUser = await userModel.updateStatus(
        userId,
        "active",
        adminUser.id,
        reason.trim(),
        req.ip,
        req.get("user-agent"),
      );

      if (!updatedUser) {
        return res
          .status(500)
          .json({ message: "Failed to unfreeze user account" });
      }

      console.log(`[ADMIN] User account unfrozen: ${userId}`, {
        adminId: adminUser.id,
        targetUserId: userId,
        reason: reason.trim(),
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: "User account unfrozen successfully",
        user: {
          id: updatedUser.id,
          status: updatedUser.status,
        },
      });
    } catch (error) {
      console.error("Error unfreezing user account:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// GET /api/admin/users/:id/status-history
router.get(
  "/users/:id/status-history",
  requireAdmin,
  logAdminAction("GET_USER_STATUS_HISTORY"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.params.id;
      const userModel = new UserModel();

      // Check if user exists
      const user = await userModel.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const auditHistory = await userModel.getAuditHistory(userId);

      res.json({
        userId: user.id,
        currentStatus: user.status,
        history: auditHistory,
      });
    } catch (error) {
      console.error("Error fetching user status history:", error);
      res.status(500).json({ message: "Internal server error" });
    }
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

// provider balance route
router.get("/providers/balances", requireAdmin, async (req, res) => {
  const mobileMoneyService = new MobileMoneyService();
  const balances = await mobileMoneyService.getAllProviderBalances();

  return res.json({
    success: true,
    data: balances,
  });
});

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
  async (req: Request, res: Response) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const reference = req.query.reference as string | undefined;

      const offset = (page - 1) * limit;

      const filters: any = {};
      if (reference) {
        filters.referenceNumber = reference;
      }

      const transactions = await transactionModel.list(limit, offset, undefined, undefined, filters);
      const total = await transactionModel.count(undefined, undefined, filters);

      res.json({
        data: transactions,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      console.error("Error listing transactions for admin:", err);
      res.status(500).json({ error: "Failed to list transactions" });
    }
  },
);

// PUT /api/admin/transactions/:id
router.put(
  "/transactions/:id",
  requireAdmin,
  rateLimitListQueries,
  logAdminAction("UPDATE_TRANSACTION"),
  async (req: Request, res: Response) => {
    try {
      const tx = await transactionModel.findById(req.params.id);

      if (!tx) {
        return res.status(404).json({ message: "Transaction not found" });
      }

      // Basic update logic - in a real app this would be more specific
      if (req.body.admin_notes) {
        await transactionModel.updateAdminNotes(req.params.id, req.body.admin_notes);
      }
      
      if (req.body.status) {
        await transactionModel.updateStatus(req.params.id, req.body.status);
      }

      const updatedTx = await transactionModel.findById(req.params.id);
      res.json({ message: "Transaction updated", transaction: updatedTx });
    } catch (err) {
      console.error("Error updating transaction:", err);
      res.status(500).json({ error: "Failed to update transaction" });
    }
  },
);

// PATCH /api/admin/transactions/:id/notes
router.patch(
  "/transactions/:id/notes",
  requireAdmin,
  logAdminAction("UPDATE_TRANSACTION_ADMIN_NOTES"),
  updateAdminNotesHandler,
);

// POST /api/admin/transactions/:id/refund
router.post(
  "/transactions/:id/refund",
  requireAdmin,
  logAdminAction("REFUND_TRANSACTION"),
  refundTransactionHandler,
);

/**
 * =========================
 * QUEUES & DLQ
 * =========================
 */

// GET /api/admin/queues/dlq
router.get("/queues/dlq", requireAdmin, logAdminAction("VIEW_DLQ"), dlqInspectorHandler);

/**
 * =========================
 * LIQUIDITY MANAGEMENT
 * =========================
 */

// GET /api/admin/liquidity/transfers
router.get(
  "/liquidity/transfers",
  requireAdmin,
  logAdminAction("LIST_LIQUIDITY_TRANSFERS"),
  async (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const transfers = await getLiquidityTransfers(limit, offset);
      res.json({ transfers });
    } catch (err) {
      console.error("[liquidity] Failed to list transfers:", err);
      res.status(500).json({ message: "Failed to retrieve liquidity transfers" });
    }
  },
);

// POST /api/admin/liquidity/transfers
router.post(
  "/liquidity/transfers",
  requireAdmin,
  logAdminAction("MANUAL_LIQUIDITY_TRANSFER"),
  async (req: Request, res: Response) => {
    try {
      const { fromProvider, toProvider, amount, note } = req.body;
      const admin = (req as AuthRequest).user;

      if (!admin) return res.status(401).json({ message: "Authentication required" });
      if (!fromProvider || !toProvider || !amount) {
        return res.status(400).json({ message: "fromProvider, toProvider, and amount are required" });
      }
      if (fromProvider === toProvider) {
        return res.status(400).json({ message: "fromProvider and toProvider must be different" });
      }
      if (typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ message: "amount must be a positive number" });
      }

      const result = await triggerManualTransfer(fromProvider, toProvider, amount, admin.id, note);
      res.status(201).json({ message: "Transfer initiated", ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transfer failed";
      console.error("[liquidity] Manual transfer error:", err);
      res.status(400).json({ message: msg });
    }
  },
);

/**
 * =========================
 * CSV RECONCILIATION
 * =========================
 */

// POST /api/admin/reconcile
router.post(
  "/reconcile",
  requireAdmin,
  logAdminAction("CSV_RECONCILIATION"),
  csvUpload.single("csv") as any,
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No file uploaded",
          message: "Please upload a CSV file with field name 'csv'",
        });
      }

      // Parse optional date range from query params
      const dateRange = {
        start: req.query.start_date as string | undefined,
        end: req.query.end_date as string | undefined,
      };

      // Parse CSV
      const providerRows = await parseCSV(req.file.buffer);

      if (providerRows.length === 0) {
        return res.status(400).json({
          error: "Empty CSV",
          message: "The uploaded CSV file contains no data rows",
        });
      }

      // Perform reconciliation
      const result = await reconcileTransactions(providerRows, dateRange);

      // Log reconciliation summary
      console.log("[CSV RECONCILIATION]", {
        adminId: (req as AuthRequest).user?.id,
        filename: req.file.originalname,
        summary: result.summary,
        timestamp: new Date().toISOString(),
      });

      res.json({
        message: "Reconciliation completed successfully",
        result,
      });
    } catch (error) {
      console.error("[CSV RECONCILIATION ERROR]", error);

      if (error instanceof Error) {
        return res.status(500).json({
          error: "Reconciliation failed",
          message: error.message,
        });
      }

      res.status(500).json({
        error: "Reconciliation failed",
        message: "An unexpected error occurred during reconciliation",
      });
    }
  },
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
 * FINANCIAL DASHBOARD
 * =========================
 */

// GET /api/admin/financial/pnl - last 30 days of daily PnL snapshots
router.get(
  "/financial/pnl",
  requireAdmin,
  async (_req: Request, res: Response) => {
    try {
      const { queryRead } = await import("../config/database");
      const result = await queryRead<{
        report_date: string;
        user_fees: string;
        provider_fees: string;
        pnl: string;
      }>(
        `SELECT report_date, user_fees, provider_fees, pnl
         FROM daily_pnl_snapshots
         WHERE report_date >= CURRENT_DATE - INTERVAL '29 days'
         ORDER BY report_date ASC`,
        [],
      );

      const rows = result.rows.map((r) => ({
        date: r.report_date,
        feesCollected: parseFloat(r.user_fees),
        providerCosts: parseFloat(r.provider_fees),
        netProfit: parseFloat(r.pnl),
      }));

      const totals = rows.reduce(
        (acc, r) => ({
          feesCollected: acc.feesCollected + r.feesCollected,
          providerCosts: acc.providerCosts + r.providerCosts,
          netProfit: acc.netProfit + r.netProfit,
        }),
        { feesCollected: 0, providerCosts: 0, netProfit: 0 },
      );

      res.json({ rows, totals });
    } catch (err) {
      console.error("[financial/pnl]", err);
      res.status(500).json({ error: "Failed to fetch PnL data" });
    }
  },
);

// GET /api/admin/financial/dashboard - self-contained HTML dashboard
router.get(
  "/financial/dashboard",
  requireAdmin,
  (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Financial Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}
  h1{font-size:1.4rem;font-weight:600;margin-bottom:20px;color:#f8fafc}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}
  .card{background:#1e293b;border-radius:10px;padding:20px}
  .card .label{font-size:.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
  .card .value{font-size:1.6rem;font-weight:700}
  .green{color:#34d399}.red{color:#f87171}.blue{color:#60a5fa}
  .chart-box{background:#1e293b;border-radius:10px;padding:20px}
  .chart-box h2{font-size:.9rem;color:#94a3b8;margin-bottom:16px;font-weight:500}
  #status{font-size:.75rem;color:#64748b;margin-top:14px;text-align:right}
  .error{color:#f87171;padding:20px;background:#1e293b;border-radius:10px}
</style>
</head>
<body>
<h1>Financial Health — Last 30 Days</h1>
<div class="cards">
  <div class="card"><div class="label">Fees Collected</div><div class="value green" id="totalFees">—</div></div>
  <div class="card"><div class="label">Provider Costs</div><div class="value red" id="totalCosts">—</div></div>
  <div class="card"><div class="label">Net Profit</div><div class="value blue" id="totalProfit">—</div></div>
</div>
<div class="chart-box">
  <h2>Daily Breakdown</h2>
  <canvas id="chart" height="90"></canvas>
</div>
<div class="chart-box" style="margin-top: 24px;">
  <h2>Transaction Search</h2>
  <div style="display:flex;gap:8px;margin-bottom:16px;">
    <input type="text" id="txSearch" placeholder="Enter Transaction Reference..." style="flex:1;background:#0f172a;border:1px solid #334155;color:#f8fafc;padding:8px 12px;border-radius:6px;">
    <button onclick="searchTx()" style="background:#3b82f6;color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600;">Search</button>
  </div>
  <div id="txResults" style="font-size:0.85rem;">
    <table style="width:100%;border-collapse:collapse;display:none;margin-top:10px;" id="txTable">
      <thead>
        <tr style="text-align:left;color:#94a3b8;border-bottom:1px solid #334155;">
          <th style="padding:8px 4px;">Reference</th>
          <th style="padding:8px 4px;">Type</th>
          <th style="padding:8px 4px;">Amount</th>
          <th style="padding:8px 4px;">Status</th>
          <th style="padding:8px 4px;">Date</th>
        </tr>
      </thead>
      <tbody id="txBody"></tbody>
    </table>
    <div id="txEmpty" style="color:#64748b;text-align:center;padding:20px;">Enter a reference number to search</div>
  </div>
</div>
<div id="status"></div>
<script>
const fmt = (n) => '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

async function load() {
  try {
    const r = await fetch('/api/admin/financial/pnl', {credentials:'include'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const {rows, totals} = await r.json();

    document.getElementById('totalFees').textContent = fmt(totals.feesCollected);
    document.getElementById('totalCosts').textContent = fmt(totals.providerCosts);
    document.getElementById('totalProfit').textContent = fmt(totals.netProfit);
    document.getElementById('totalProfit').className = 'value ' + (totals.netProfit >= 0 ? 'green' : 'red');

    const labels = rows.map(r => r.date);
    new Chart(document.getElementById('chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {label:'Fees Collected', data: rows.map(r=>r.feesCollected), backgroundColor:'rgba(52,211,153,.7)', borderRadius:3},
          {label:'Provider Costs', data: rows.map(r=>r.providerCosts), backgroundColor:'rgba(248,113,113,.7)', borderRadius:3},
          {label:'Net Profit', data: rows.map(r=>r.netProfit), type:'line', borderColor:'#60a5fa', backgroundColor:'rgba(96,165,250,.15)', tension:.3, fill:true, pointRadius:3},
        ]
      },
      options: {
        responsive:true,
        interaction:{mode:'index',intersect:false},
        plugins:{legend:{labels:{color:'#94a3b8',font:{size:12}}}},
        scales:{
          x:{ticks:{color:'#64748b',maxRotation:45},grid:{color:'rgba(255,255,255,.05)'}},
          y:{ticks:{color:'#64748b',callback:v=>'\$'+v.toLocaleString()},grid:{color:'rgba(255,255,255,.05)'}}
        }
      }
    });

    document.getElementById('status').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch(e) {
    document.querySelector('.chart-box').innerHTML = '<div class="error">Failed to load data: ' + e.message + '</div>';
  }
}

async function searchTx() {
  const ref = document.getElementById('txSearch').value.trim();
  if (!ref) return;
  
  const table = document.getElementById('txTable');
  const body = document.getElementById('txBody');
  const empty = document.getElementById('txEmpty');
  
  empty.textContent = 'Searching...';
  empty.style.display = 'block';
  table.style.display = 'none';
  
  try {
    const r = await fetch('/api/admin/transactions?reference=' + encodeURIComponent(ref), {credentials:'include'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const {data} = await r.json();
    
    if (!data || data.length === 0) {
      empty.textContent = 'No transaction found with reference: ' + ref;
      return;
    }
    
    body.innerHTML = '';
    data.forEach(tx => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #1e293b';
      const statusBg = tx.status === 'completed' ? 'rgba(52,211,153,.2)' : 
                       tx.status === 'pending' ? 'rgba(250,204,21,.2)' : 
                       tx.status === 'failed' ? 'rgba(248,113,113,.2)' : 'rgba(148,163,184,.2)';
      const statusColor = tx.status === 'completed' ? '#34d399' : 
                         tx.status === 'pending' ? '#fbbf24' : 
                         tx.status === 'failed' ? '#f87171' : '#94a3b8';
      
      tr.innerHTML = \`
        <td style="padding:12px 4px;font-family:monospace;color:#60a5fa">\${tx.referenceNumber}</td>
        <td style="padding:12px 4px;text-transform:capitalize;">\${tx.type}</td>
        <td style="padding:12px 4px;font-weight:600;">\${tx.amount}</td>
        <td style="padding:12px 4px;"><span style="padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;background:\${statusBg};color:\${statusColor}">\${tx.status.toUpperCase()}</span></td>
        <td style="padding:12px 4px;color:#64748b">\${new Date(tx.createdAt).toLocaleDateString()}</td>
      \`;
      body.appendChild(tr);
    });
    
    table.style.display = 'table';
    empty.style.display = 'none';
  } catch (e) {
    empty.textContent = 'Error: ' + e.message;
  }
}

document.getElementById('txSearch').onkeydown = (e) => { if(e.key === 'Enter') searchTx(); };

load();
setInterval(load, 60000);
</script>
</body>
</html>`);
  },
);

export { router as adminRoutes };
