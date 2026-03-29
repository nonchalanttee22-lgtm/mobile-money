import { Request, Response } from "express";
import fs from "node:fs/promises";
import { GDPRService } from "../services/gdprService";
import { logAuditEvent } from "../utils/log-audit-event";

const DATA_EXPORT_REQUIRED = "DATA_EXPORT_REQUIRED";
const RIGHT_TO_BE_FORGOTTEN_INITIATED = "RIGHT_TO_BE_FORGOTTEN_INITIATED";
const gdprService = new GDPRService();

const privacyController = {
  exportDataEndpoint: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || (req as any).userId;

      // keep for audit purpose
      await logAuditEvent(userId, DATA_EXPORT_REQUIRED);

      const zipPath = await gdprService.exportUserData(userId);

      res.download(zipPath, `gdpr-export-${userId}.zip`, async (err) => {
        if (err) {
          console.log("Download failed", err);
        }
        await fs.unlink(zipPath).catch(() => {});
      });
    } catch (err) {
      console.error("Export error: ", err);
      res.status(500).json({ error: "Failed to export data." });
    }
  },
  rightToBeForgettenEndpoint: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || (req as any).userId;

      // Explicit confirmation from user via form field or api
      const { confirmed } = req.body;

      if (!confirmed) {
        return res.status(400).json({
          error: "Erasure must be confirmed",
          message: "Send { confirmed: true } to proceed with data erasure",
        });
      }

      // Log the request
      await logAuditEvent(userId, RIGHT_TO_BE_FORGOTTEN_INITIATED);

      await gdprService.purgeUserData(userId);

      res.json({
        success: true,
        message: "Your data has been successfully erased",
        details: {
          piiPurged: true,
          accountingRecordsAnonymized: true,
          accountDeactivated: true,
        },
      });
    } catch (err) {
      console.error("Right to be forgotten error:", err);
      res.status(500).json({ error: "Failed to process erasure request" });
    }
  },
};

export default privacyController;
