import crypto from "crypto";
import PDFDocument from "pdfkit";
import { amlService, AMLAlert } from "../services/aml";
import { TransactionModel, Transaction } from "../models/transaction";
import { getUserById, User } from "../services/userService";
import { uploadToS3, UploadResult } from "../services/s3Upload";
import { DB_ENCRYPTION_KEY } from "../config/env";

/**
 * Data needed for SAR PDF generation
 */
interface SARData {
  user: User;
  transactions: Transaction[];
  alerts: AMLAlert[];
  summary: {
    totalTransactions: number;
    totalAmount: number;
    riskFlags: string[];
    reportDate: Date;
  };
}

/**
 * Collates transaction history and AML alerts for a user.
 */
async function fetchSARData(userId: string): Promise<SARData> {
  const user = await getUserById(userId);
  if (!user) throw new Error(`User not found: ${userId}`);

  const transactionModel = new TransactionModel();
  // Fetch recent completed transactions (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const transactions = await transactionModel.findCompletedByUserSince(userId, thirtyDaysAgo);

  // Fetch recent alerts
  const alerts = amlService.getAlerts({ userId }).filter(a => new Date(a.createdAt) >= thirtyDaysAgo);

  const totalAmount = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);
  const riskFlags = Array.from(new Set(alerts.flatMap(a => a.ruleHits.map(h => h.rule))));

  return {
    user,
    transactions,
    alerts,
    summary: {
      totalTransactions: transactions.length,
      totalAmount,
      riskFlags,
      reportDate: new Date(),
    },
  };
}

/**
 * Generates a PDF report buffer using PDFKit.
 */
async function generatePDFBuffer(data: SARData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    // Header
    doc.fontSize(20).text("Suspicious Activity Report (SAR)", { align: "center" });
    doc.moveDown();
    doc.fontSize(10).text(`Report Generated: ${data.summary.reportDate.toISOString()}`, { align: "right" });
    doc.moveDown();

    // User Summary
    doc.fontSize(14).text("User Information", { underline: true });
    doc.fontSize(12).text(`User ID: ${data.user.id}`);
    doc.text(`Phone Number: ${data.user.phone_number}`);
    doc.text(`KYC Level: ${data.user.kyc_level}`);
    doc.moveDown();

    // Activity Summary
    doc.fontSize(14).text("Activity Summary", { underline: true });
    doc.fontSize(12).text(`Total Transactions (30d): ${data.summary.totalTransactions}`);
    doc.text(`Total Amount (30d): ${data.summary.totalAmount.toLocaleString()} XAF`);
    doc.moveDown();

    // Risk Flags
    doc.fontSize(14).text("Risk Flags", { underline: true });
    if (data.summary.riskFlags.length > 0) {
      data.summary.riskFlags.forEach(flag => {
        doc.fontSize(12).text(`• ${flag}`);
      });
    } else {
      doc.fontSize(12).text("No specific risk flags detected.");
    }
    doc.moveDown();

    // Transaction List
    doc.fontSize(14).text("Recent Transactions", { underline: true });
    doc.moveDown(0.5);

    // Simple table header
    const tableTop = doc.y;
    doc.fontSize(10).text("Date", 50, tableTop);
    doc.text("Type", 150, tableTop);
    doc.text("Amount", 250, tableTop);
    doc.text("Status", 350, tableTop);
    doc.text("Ref", 450, tableTop);
    
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
    
    let currentY = tableTop + 25;
    data.transactions.slice(0, 20).forEach(tx => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }
      doc.text(tx.createdAt.toISOString().split("T")[0], 50, currentY);
      doc.text(tx.type, 150, currentY);
      doc.text(`${tx.amount} XAF`, 250, currentY);
      doc.text(tx.status, 350, currentY);
      doc.text(tx.referenceNumber.substring(0, 8), 450, currentY);
      currentY += 20;
    });

    if (data.transactions.length > 20) {
      doc.text(`... and ${data.transactions.length - 20} more transactions`, 50, currentY);
    }

    doc.end();
  });
}

/**
 * Encrypts a buffer using AES-256-GCM.
 * Prepends IV and Auth Tag to the buffer.
 */
function encryptBuffer(buffer: Buffer): Buffer {
  const ALGORITHM = "aes-256-gcm";
  const IV_LENGTH = 12;

  const iv = crypto.randomBytes(IV_LENGTH);
  const secretKey = crypto.scryptSync(DB_ENCRYPTION_KEY, "sar-salt", 32);
  const cipher = crypto.createCipheriv(ALGORITHM, secretKey, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Result: [IV (12 bytes)][AuthTag (16 bytes)][EncryptedData]
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Uploads encrypted SAR to storage.
 */
async function storeSAR(encryptedBuffer: Buffer, userId: string): Promise<string> {
  const filename = `SAR_${userId}_${Date.now()}.pdf.enc`;
  
  // Wrap in a fake Multer file for the existing S3 service
  const file = {
    buffer: encryptedBuffer,
    originalname: filename,
    mimetype: "application/octet-stream",
    size: encryptedBuffer.length,
    fieldname: "file",
    encoding: "7bit",
  } as Express.Multer.File;

  const result: UploadResult = await uploadToS3({
    userId,
    file,
    metadata: {
      reportType: "SAR",
      encrypted: "true",
      algorithm: "AES-256-GCM"
    }
  });

  if (!result.success || !result.fileUrl) {
    throw new Error(`Failed to store SAR: ${result.error || "Unknown error"}`);
  }

  return result.fileUrl;
}

/**
 * Main function to generate, encrypt, and store a SAR report for a user.
 * @param userId - Use ID to generate report for
 * @returns Storage reference URL/ID
 */
export async function generateSAR(userId: string): Promise<string> {
  try {
    // 1. Collate data
    const data = await fetchSARData(userId);

    // 2. Generate PDF
    const pdfBuffer = await generatePDFBuffer(data);

    // 3. Encrypt PDF
    const encryptedBuffer = encryptBuffer(pdfBuffer);

    // 4. Store encrypted file
    const storageRef = await storeSAR(encryptedBuffer, userId);

    console.log(`SAR generated and stored for user ${userId}: ${storageRef}`);
    return storageRef;
  } catch (error) {
    console.error(`Error generating SAR for user ${userId}:`, error);
    throw error;
  }
}
