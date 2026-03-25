import { Router } from "express";
import {
  depositHandler,
  withdrawHandler,
  getTransactionHandler,
  updateNotesHandler,
  searchTransactionsHandler,
  listTransactionsHandler,
} from "../controllers/transactionController";
import { TimeoutPresets, haltOnTimedout } from "../middleware/timeout";
import { validateTransactionFilters } from "../utils/transactionFilters";

export const transactionRoutes = Router();

// Deposit route
transactionRoutes.post(
  "/deposit",
  TimeoutPresets.long,
  haltOnTimedout,
  validateTransaction,
  depositHandler
);

// Withdraw route
transactionRoutes.post(
  "/withdraw",
  TimeoutPresets.long,
  haltOnTimedout,
  validateTransaction,
  withdrawHandler
);

// List transactions with status filtering and pagination
transactionRoutes.get(
  "/",
  TimeoutPresets.quick,
  haltOnTimedout,
  validateTransactionFilters,
  listTransactionsHandler,
);

// Quick read operation
transactionRoutes.get(
  "/:id",
  TimeoutPresets.quick,
  haltOnTimedout,
  getTransactionHandler,
);

// Notes and search
transactionRoutes.patch(
  "/:id/notes",
  TimeoutPresets.quick,
  haltOnTimedout,
  updateNotesHandler,
);

transactionRoutes.get(
  "/search",
  TimeoutPresets.quick,
  haltOnTimedout,
  searchTransactionsHandler,
);
