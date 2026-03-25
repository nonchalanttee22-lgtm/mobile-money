import { Router } from "express";
import { VersionedRequest } from "../../middleware/apiVersion";
import {
  depositHandler,
  withdrawHandler,
  getTransactionHandler,
  updateNotesHandler,
  searchTransactionsHandler,
  listTransactionsHandler,
} from "../../controllers/transactionController";
import { TimeoutPresets, haltOnTimedout } from "../../middleware/timeout";
import { validateTransactionFilters } from "../../utils/transactionFilters";

export const transactionRoutesV1 = Router();

// Deposit transaction route
transactionRoutesV1.post(
  "/deposit",
  TimeoutPresets.long,
  haltOnTimedout,
  (req: VersionedRequest, res, next) => {
    // Add API version to request for handler
    req.apiVersion = "v1";
    next();
  },
  depositHandler
);

// Withdraw transaction route
transactionRoutesV1.post(
  "/withdraw",
  TimeoutPresets.long,
  haltOnTimedout,
  (req: VersionedRequest, res, next) => {
    req.apiVersion = "v1";
    next();
  },
  withdrawHandler
);

// List transactions with status filtering and pagination
transactionRoutesV1.get(
  "/",
  TimeoutPresets.quick,
  haltOnTimedout,
  validateTransactionFilters,
  (req: VersionedRequest, res, next) => {
    req.apiVersion = "v1";
    next();
  },
  listTransactionsHandler,
);

// Get specific transaction
transactionRoutesV1.get(
  "/:id",
  TimeoutPresets.quick,
  haltOnTimedout,
  (req: VersionedRequest, res, next) => {
    req.apiVersion = "v1";
    next();
  },
  getTransactionHandler
);

// Update transaction notes
transactionRoutesV1.patch(
  "/:id/notes",
  TimeoutPresets.quick,
  haltOnTimedout,
  (req: VersionedRequest, res, next) => {
    req.apiVersion = "v1";
    next();
  },
  updateNotesHandler
);

// Search transactions
transactionRoutesV1.get(
  "/search",
  TimeoutPresets.quick,
  haltOnTimedout,
  (req: VersionedRequest, res, next) => {
    req.apiVersion = "v1";
    next();
  },
  searchTransactionsHandler
);
