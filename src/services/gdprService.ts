import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { v4 as uuid } from "uuid";
import { Transaction, TransactionModel } from "../models/transaction";
import { createZipFile } from "../utils/create-zip-file";
import { logAuditEvent } from "../utils/log-audit-event";
import { AuditLog, auditService } from "./auditlogService";
import { TransactionService } from "./transanctionService";
import {
  deactivateUserAccount,
  getUserById,
  updateUserById,
  User,
} from "./userService";

export class GDPRService {
  private txService: TransactionService;

  constructor() {
    this.txService = new TransactionService(new TransactionModel());
  }

  async exportUserData(userId: string) {
    const tempDir = path.join("/temp", `export-${uuid}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const user = await getUserById(userId);
      const txs = await this.txService.findByUserId(userId);
      // const auditLogs = await getAuditLogs(userId); // Only if there is a user log tray

      // Creat JSON files
      await fs.writeFile(
        path.join(tempDir, "profile.json"),
        JSON.stringify(user, null, 2),
      );
      await fs.writeFile(
        path.join(tempDir, "transactions.json"),
        JSON.stringify(txs, null, 2),
      );
      // await fs.writeFile(path.join(tempDir, 'transactions.json'), JSON.stringify(auditLogs, null, 2));

      // Create zip file
      const zipPath = path.join(
        "/temp",
        `gdpr-export-${userId}-${Date.now()}.zip`,
      );
      await createZipFile(tempDir, zipPath);

      // Cleanup
      await fs.rm(tempDir, { recursive: true });

      return zipPath;
    } catch (err) {
      await fs.rm(tempDir, { recursive: true }).catch(() => {});
      throw err;
    }
  }

  private hashString(str: string) {
    return crypto
      .createHash("sha256")
      .update(str)
      .digest("hex")
      .substring(0, 16);
  }

  anonymizeTransaction(tx: Transaction) {
    return {
      ...tx,
      phoneNumber: this.hashString(tx.phoneNumber),
      idempotencyKey: this.hashString(String(tx.idempotencyKey)),
      stellarAddress: this.hashString(tx.stellarAddress),
    };
  }

  anonymizeEmail(email: string) {
    return `${this.hashString(email).slice(4, 8)}-${uuid()}@anonymized.local`;
  }

  anonymizePhoneNumber(phone: string) {
    return this.hashString(phone);
  }

  anonymizeStellaAddress(addr: string) {
    return this.hashString(addr);
  }

  anonymizeBackupCode(code: string[]) {
    return code.map((c) => this.hashString(c));
  }

  async purgeUserData(userId: string) {
    try {
      // Anonymize tx records
      const transactions = await this.txService.findByUserId(userId);
      for (const tx of transactions) {
        const anonymizedTx = await this.anonymizeTransaction(tx);
        // await updateTransaction(anonymizedTx);
      }

      // Purge PII from user profile
      const user = await getUserById(userId);
      const anonymizedUser = {
        ...user,
        phone_number: this.anonymizePhoneNumber(String(user?.phone_number)),
        backup_codes: user?.backup_codes
          ? this.anonymizeBackupCode(user?.backup_codes)
          : [],
      } as User;

      await updateUserById(userId, anonymizedUser);

      // Purge PII from audit logs - this uses MOCK at the moment

      const auditLogs = await auditService.fetchAuditLogs(userId);
      for (const log of auditLogs) {
        const anonymizedLog: AuditLog = {
          ...log,
          action: this.hashString(log.action),
        };

        await auditService.updateAuditLog(anonymizedLog);
      }

      // Log erasure event
      await logAuditEvent(userId, "RIGHT_TO_BE_FORGOTTEN_EXECUTED");

      // Disable/deactivate user accout
      await this.deactivateUserAccount(userId);
    } catch (err) {
      console.error("Erasure error:", err);
      throw err;
    }
  }

  private async deactivateUserAccount(userId: string) {
    await deactivateUserAccount(userId);
  }
}
