import { generateSAR } from "../compliance/sar";
import { amlService } from "../services/aml";
import { TransactionModel } from "../models/transaction";
import * as userService from "../services/userService";
import * as s3Upload from "../services/s3Upload";
import crypto from "crypto";
import { DB_ENCRYPTION_KEY } from "../config/env";

jest.mock("../services/aml");
jest.mock("../models/transaction");
jest.mock("../services/userService");
jest.mock("../services/s3Upload");

describe("SAR Generation", () => {
  const mockUserId = "user-123";
  const mockUser = {
    id: mockUserId,
    phone_number: "237670000000",
    kyc_level: "verified",
  };
  
  const mockTransactions = [
    {
      id: "tx-1",
      amount: "500000",
      type: "deposit",
      status: "completed",
      createdAt: new Date(),
      referenceNumber: "REF12345678",
    },
  ];

  const mockAlerts = [
    {
      id: "alert-1",
      userId: mockUserId,
      ruleHits: [{ rule: "single_transaction_threshold" }],
      createdAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    
    (userService.getUserById as jest.Mock).mockResolvedValue(mockUser);
    (TransactionModel.prototype.findCompletedByUserSince as jest.Mock).mockResolvedValue(mockTransactions);
    (amlService.getAlerts as jest.Mock).mockReturnValue(mockAlerts);
    (s3Upload.uploadToS3 as jest.Mock).mockResolvedValue({
      success: true,
      fileUrl: "https://s3.amazonaws.com/bucket/sar-123.pdf.enc",
    });
  });

  it("should generate, encrypt, and store a SAR report", async () => {
    const result = await generateSAR(mockUserId);

    expect(result).toBe("https://s3.amazonaws.com/bucket/sar-123.pdf.enc");
    expect(userService.getUserById).toHaveBeenCalledWith(mockUserId);
    expect(s3Upload.uploadToS3).toHaveBeenCalled();
    
    // Check if the uploaded buffer is encrypted (by trying to decrypt it)
    const uploadCall = (s3Upload.uploadToS3 as jest.Mock).mock.calls[0][0];
    const encryptedBuffer = uploadCall.file.buffer;
    
    // Attempt decryption
    const IV_LENGTH = 12;
    const AUTH_TAG_LENGTH = 16;
    const iv = encryptedBuffer.slice(0, IV_LENGTH);
    const authTag = encryptedBuffer.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encryptedData = encryptedBuffer.slice(IV_LENGTH + AUTH_TAG_LENGTH);
    
    const secretKey = crypto.scryptSync(DB_ENCRYPTION_KEY, "sar-salt", 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    
    // Verify decrypted content starts with %PDF (PDF signature)
    expect(decrypted.toString("utf8", 0, 4)).toBe("%PDF");
  });

  it("should throw error if user not found", async () => {
    (userService.getUserById as jest.Mock).mockResolvedValue(null);
    await expect(generateSAR("unknown")).rejects.toThrow("User not found");
  });

  it("should throw error if storage fails", async () => {
    (s3Upload.uploadToS3 as jest.Mock).mockResolvedValue({
      success: false,
      error: "S3 down",
    });
    await expect(generateSAR(mockUserId)).rejects.toThrow("Failed to store SAR");
  });
});
