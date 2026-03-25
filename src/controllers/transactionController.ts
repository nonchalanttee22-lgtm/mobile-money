import { Request, Response } from "express";
import { MobileMoneyService } from "../services/mobilemoney/mobileMoneyService";
import { StellarService } from "../services/stellar/stellarService";
import {
  Transaction,
  TransactionModel,
  TransactionStatus,
} from "../models/transaction";
import { lockManager, LockKeys } from "../utils/lock";
import { TransactionLimitService } from "../services/transactionLimit/transactionLimitService";
import { KYCService } from "../services/kyc/kycService";
import { addTransactionJob, getJobProgress } from "../queue";

const IDEMPOTENCY_TTL_HOURS = Number(
  process.env.IDEMPOTENCY_KEY_TTL_HOURS || 24,
);

// Initialized for upcoming transaction execution work.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const stellarService = new StellarService();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mobileMoneyService = new MobileMoneyService();
const transactionModel = new TransactionModel();
const kycService = new KYCService();
const transactionLimitService = new TransactionLimitService(
  kycService,
  transactionModel,
);

type TransactionRequestType = "deposit" | "withdraw";

interface CreateTransactionResponse {
  transactionId: string;
  referenceNumber: string;
  status: TransactionStatus;
  jobId: string;
}

function getRequestAmount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  return parsed;
}

function getIdempotencyKey(req: Request): string | null {
  const key = req.header("Idempotency-Key")?.trim();

  if (!key) {
    return null;
  }

  if (key.length > 255) {
    throw new Error("Idempotency-Key must be 255 characters or fewer");
  }

  return key;
}

function buildIdempotencyExpiry(): Date {
  const now = Date.now();
  return new Date(now + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);
}

function buildTransactionResponse(
  transaction: Transaction,
): CreateTransactionResponse {
  return {
    transactionId: transaction.id,
    referenceNumber: transaction.referenceNumber,
    status: transaction.status,
    jobId: transaction.id,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return "code" in error && error.code === "23505";
}

async function findExistingIdempotentTransaction(
  idempotencyKey: string,
): Promise<Transaction | null> {
  await transactionModel.releaseExpiredIdempotencyKey(idempotencyKey);
  return transactionModel.findActiveByIdempotencyKey(idempotencyKey);
}

async function processTransactionRequest(
  req: Request,
  res: Response,
  type: TransactionRequestType,
): Promise<Response> {
  try {
    const { amount, phoneNumber, provider, stellarAddress, userId, notes } =
      req.body;

    const requestAmount = getRequestAmount(amount);
    if (!Number.isFinite(requestAmount) || requestAmount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const idempotencyKey = getIdempotencyKey(req);

    const limitCheck = await transactionLimitService.checkTransactionLimit(
      userId,
      requestAmount,
    );

    if (!limitCheck.allowed) {
      return res.status(400).json({
        error: "Transaction limit exceeded",
        details: {
          kycLevel: limitCheck.kycLevel,
          dailyLimit: limitCheck.dailyLimit,
          currentDailyTotal: limitCheck.currentDailyTotal,
          remainingLimit: limitCheck.remainingLimit,
          message: limitCheck.message,
          upgradeAvailable: limitCheck.upgradeAvailable,
        },
      });
    }

    const createOrReuse = async (): Promise<CreateTransactionResponse> => {
      if (idempotencyKey) {
        const existingTransaction =
          await findExistingIdempotentTransaction(idempotencyKey);
        if (existingTransaction) {
          return buildTransactionResponse(existingTransaction);
        }
      }

      try {
        return await lockManager.withLock(
          LockKeys.phoneNumber(phoneNumber),
          async () => {
            if (idempotencyKey) {
              const existingTransaction =
                await findExistingIdempotentTransaction(idempotencyKey);
              if (existingTransaction) {
                return buildTransactionResponse(existingTransaction);
              }
            }

            const transaction = await transactionModel.create({
              type,
              amount: String(amount),
              phoneNumber,
              provider,
              stellarAddress,
              status: TransactionStatus.Pending,
              tags: [],
              notes,
              userId,
              idempotencyKey,
              idempotencyExpiresAt: idempotencyKey
                ? buildIdempotencyExpiry()
                : null,
            });

            const job = await addTransactionJob(
              {
                transactionId: transaction.id,
                type,
                amount: String(amount),
                phoneNumber,
                provider,
                stellarAddress,
              },
              {
                jobId: transaction.id,
              },
            );

            return {
              ...buildTransactionResponse(transaction),
              jobId: String(job.id ?? transaction.id),
            };
          },
          15000,
        );
      } catch (error) {
        if (idempotencyKey && isUniqueViolation(error)) {
          const existingTransaction =
            await findExistingIdempotentTransaction(idempotencyKey);

          if (existingTransaction) {
            return buildTransactionResponse(existingTransaction);
          }
        }

        throw error;
      }
    };

    const result = idempotencyKey
      ? await lockManager.withLock(
          LockKeys.idempotency(idempotencyKey),
          createOrReuse,
          15000,
        )
      : await createOrReuse();

    return res.status(200).json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Idempotency-Key must be")
    ) {
      return res.status(400).json({ error: error.message });
    }

    if (error instanceof Error && error.message.includes("Unable to acquire lock")) {
      return res.status(409).json({
        error: "Transaction already in progress for this resource",
      });
    }

    return res.status(500).json({ error: "Transaction failed" });
  }
}

export const depositHandler = async (req: Request, res: Response) => {
  return processTransactionRequest(req, res, "deposit");
};

export const withdrawHandler = async (req: Request, res: Response) => {
  return processTransactionRequest(req, res, "withdraw");
};

export const getTransactionHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const transaction = await transactionModel.findById(id);

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    let jobProgress = null;
    if (transaction.status === TransactionStatus.Pending) {
      jobProgress = await getJobProgress(id);
    }

    const timeoutMinutes = Number(
      process.env.TRANSACTION_TIMEOUT_MINUTES || 30,
    );

    if (transaction.status === TransactionStatus.Pending) {
      const createdAt = new Date(transaction.createdAt).getTime();
      const now = Date.now();
      const diffMinutes = (now - createdAt) / (1000 * 60);

      if (diffMinutes > timeoutMinutes) {
        await transactionModel.updateStatus(id, TransactionStatus.Failed);

        console.log("Transaction timed out (on fetch)", {
          transactionId: id,
          timeoutMinutes,
          reason: "Transaction timeout",
        });

        transaction.status = TransactionStatus.Failed;
        return res.json({
          ...transaction,
          reason: "Transaction timeout",
          jobProgress,
        });
      }
    }

    return res.json({ ...transaction, jobProgress });
  } catch (err) {
    console.error("Failed to fetch transaction:", err);
    return res.status(500).json({ error: "Failed to fetch transaction" });
  }
};

export const cancelTransactionHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const transaction = await transactionModel.findById(id);
    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    if (transaction.status !== TransactionStatus.Pending) {
      return res.status(400).json({
        error: `Cannot cancel transaction with status '${transaction.status}'`,
      });
    }

    await transactionModel.updateStatus(id, TransactionStatus.Cancelled);
    const updatedTransaction = await transactionModel.findById(id);

    if (!updatedTransaction) {
      return res
        .status(500)
        .json({ error: "Failed to load transaction after cancel" });
    }

    if (process.env.WEBHOOK_URL) {
      try {
        await fetch(process.env.WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "transaction.cancelled",
            data: updatedTransaction,
          }),
        });
      } catch (webhookError) {
        console.error("Webhook notification failed", webhookError);
      }
    }

    return res.json({
      message: "Transaction cancelled successfully",
      transaction: updatedTransaction,
    });
  } catch (err) {
    console.error("Failed to cancel transaction:", err);
    return res.status(500).json({
      error: "Failed to cancel transaction",
    });
  }
};

export const updateNotesHandler = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (typeof notes !== "string") {
      return res.status(400).json({ error: "Notes must be a string" });
    }

    const transaction = await transactionModel.updateNotes(id, notes);
    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    return res.json(transaction);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update notes";

    return res
      .status(
        err instanceof Error && err.message.includes("characters") ? 400 : 500,
      )
      .json({ error: message });
  }
};

export const updateAdminNotesHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const { admin_notes: adminNotes } = req.body;

    if (typeof adminNotes !== "string") {
      return res.status(400).json({ error: "Admin notes must be a string" });
    }

    const transaction = await transactionModel.updateAdminNotes(id, adminNotes);
    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    return res.json(transaction);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update admin notes";

    return res
      .status(
        err instanceof Error && err.message.includes("characters") ? 400 : 500,
      )
      .json({ error: message });
  }
};

export const searchTransactionsHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    const transactions = await transactionModel.searchByNotes(q);
    return res.json(transactions);
  } catch (err) {
    console.error("Search failed:", err);
    return res.status(500).json({ error: "Search failed" });
  }
};
