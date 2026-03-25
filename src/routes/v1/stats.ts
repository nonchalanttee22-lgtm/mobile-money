import { Router } from "express";
import { VersionedRequest } from "../../middleware/apiVersion";
import { TimeoutPresets, haltOnTimedout } from "../../middleware/timeout";

export const statsRoutesV1 = Router();

/**
 * V1 Statistics and analytics routes
 */

statsRoutesV1.get(
  "/summary",
  TimeoutPresets.quick,
  haltOnTimedout,
  (req: VersionedRequest, res, next) => {
    req.apiVersion = "v1";
    next();
  }
  // Add stats summary handler
);

statsRoutesV1.get(
  "/daily",
  TimeoutPresets.quick,
  haltOnTimedout,
  (req: VersionedRequest, res, next) => {
    req.apiVersion = "v1";
    next();
  }
  // Add daily stats handler
);

statsRoutesV1.get(
  "/",
  TimeoutPresets.quick,
  haltOnTimedout,
  (req: VersionedRequest, res, next) => {
    req.apiVersion = "v1";
    next();
  }
  // Add general stats handler
);
