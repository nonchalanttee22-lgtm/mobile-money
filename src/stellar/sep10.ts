import { Router, Request, Response } from "express";
import * as StellarSdk from "stellar-sdk";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { getStellarServer, getNetworkPassphrase } from "../config/stellar";

/**
 * SEP-10: Stellar Authentication
 * 
 * This implements Stellar Ecosystem Proposal 10 (SEP-10) standard for
 * authentication using Stellar accounts.
 * 
 * Specification: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface Sep10ChallengeResponse {
  transaction: string;
  network_passphrase: string;
}

export interface Sep10TokenResponse {
  token: string;
}

export interface Sep10ChallengeParams {
  account: string;
  home_domain?: string;
  client_domain?: string;
  memo?: string;
}

export interface Sep10VerifyParams {
  transaction: string;
}

// ============================================================================
// Configuration
// ============================================================================

const CHALLENGE_EXPIRY_SECONDS = 300; // 5 minutes
const JWT_EXPIRY_SECONDS = 86400; // 24 hours
const MAX_FEE = 100000; // 0.1 XLM in stroops

/**
 * Get the signing key for the server
 * This is the secret key used to sign challenge transactions
 */
function getSigningKey(): string {
  const signingKey = process.env.STELLAR_SIGNING_KEY;
  if (!signingKey) {
    throw new Error("STELLAR_SIGNING_KEY environment variable is not set");
  }
  return signingKey;
}

/**
 * Get the JWT secret for token signing
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

/**
 * Get the home domain for the server
 */
function getHomeDomain(): string {
  return process.env.STELLAR_HOME_DOMAIN || "api.mobilemoney.com";
}

// ============================================================================
// SEP-10 Service
// ============================================================================

export class Sep10Service {
  private server: StellarSdk.Horizon.Server;
  private networkPassphrase: string;

  constructor() {
    this.server = getStellarServer();
    this.networkPassphrase = getNetworkPassphrase();
  }

  /**
   * Generate a challenge transaction for SEP-10 authentication
   * 
   * @param params - Challenge parameters including account, home_domain, client_domain, memo
   * @returns Challenge response with transaction XDR and network passphrase
   */
  async generateChallenge(params: Sep10ChallengeParams): Promise<Sep10ChallengeResponse> {
    const { account, home_domain, client_domain, memo } = params;

    // Validate account address
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(account)) {
      throw new Error("Invalid Stellar account address");
    }

    // Load the server's signing account
    const signingKey = getSigningKey();
    const serverKeypair = StellarSdk.Keypair.fromSecret(signingKey);
    const serverAccount = await this.server.loadAccount(serverKeypair.publicKey());

    // Generate a random memo for the challenge transaction
    const memoId = memo || uuidv4();

    // Create the challenge transaction
    const transaction = new StellarSdk.TransactionBuilder(serverAccount, {
      fee: MAX_FEE.toString(),
      networkPassphrase: this.networkPassphrase,
    })
      // Add the client's account as a source account
      .addOperation(
        StellarSdk.Operation.manageData({
          source: account,
          name: `${getHomeDomain()} auth`,
          value: memoId,
        })
      )
      // Add a timebound to make the transaction expire
      .addMemo(StellarSdk.Memo.text(memoId))
      .setTimeout(CHALLENGE_EXPIRY_SECONDS)
      .build();

    // Sign the transaction with the server's key
    transaction.sign(serverKeypair);

    // Return the transaction XDR and network passphrase
    return {
      transaction: transaction.toXDR(),
      network_passphrase: this.networkPassphrase,
    };
  }

  /**
   * Verify a signed challenge transaction and issue a JWT token
   * 
   * @param params - Verify parameters including the signed transaction XDR
   * @returns JWT token response
   */
  async verifyChallenge(params: Sep10VerifyParams): Promise<Sep10TokenResponse> {
    const { transaction: transactionXDR } = params;

    // Parse the transaction from XDR
    let transaction: StellarSdk.Transaction;
    try {
      transaction = new StellarSdk.Transaction(
        transactionXDR,
        this.networkPassphrase
      );
    } catch (error) {
      throw new Error("Invalid transaction XDR");
    }

    // Verify the transaction is signed by the server
    const signingKey = getSigningKey();
    const serverKeypair = StellarSdk.Keypair.fromSecret(signingKey);
    
    if (!transaction.signatures.some(sig => 
      sig.hint().equals(serverKeypair.signatureHint())
    )) {
      throw new Error("Transaction is not signed by the server");
    }

    // Verify the transaction has not expired
    const timeBounds = transaction.timeBounds;
    if (timeBounds) {
      const now = Math.floor(Date.now() / 1000);
      if (now > parseInt(timeBounds.maxTime)) {
        throw new Error("Challenge transaction has expired");
      }
    }

    // Extract the client's public key from the transaction
    // The client's account should be the source account of the manageData operation
    const manageDataOps = transaction.operations.filter(
      op => op.type === "manageData"
    );

    if (manageDataOps.length === 0) {
      throw new Error("Transaction does not contain a manageData operation");
    }

    const clientPublicKey = manageDataOps[0].source;
    if (!clientPublicKey) {
      throw new Error("manageData operation does not have a source account");
    }

    // Verify the client's signature on the transaction
    const clientKeypair = StellarSdk.Keypair.fromPublicKey(clientPublicKey);
    
    // Check if the transaction is signed by the client
    const isClientSigned = transaction.signatures.some(sig => {
      try {
        // Verify the signature using the client's public key
        const txHash = transaction.hash();
        return clientKeypair.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    });

    if (!isClientSigned) {
      throw new Error("Transaction is not signed by the client");
    }

    // Verify the transaction is signed by the server
    const isServerSigned = transaction.signatures.some(sig => {
      try {
        const txHash = transaction.hash();
        return serverKeypair.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    });

    if (!isServerSigned) {
      throw new Error("Transaction is not signed by the server");
    }

    // Issue a JWT token
    const token = this.issueToken(clientPublicKey);

    return { token };
  }

  /**
   * Issue a JWT token for the authenticated client
   * 
   * @param clientPublicKey - The Stellar public key of the authenticated client
   * @returns JWT token string
   */
  private issueToken(clientPublicKey: string): string {
    const jwtSecret = getJwtSecret();
    const homeDomain = getHomeDomain();

    const payload = {
      iss: homeDomain,
      sub: clientPublicKey,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS,
      jti: uuidv4(),
    };

    return jwt.sign(payload, jwtSecret, { algorithm: "HS256" });
  }

  /**
   * Verify a JWT token issued by SEP-10
   * 
   * @param token - JWT token to verify
   * @returns Decoded token payload
   */
  verifyToken(token: string): jwt.JwtPayload {
    const jwtSecret = getJwtSecret();
    
    try {
      const decoded = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
      return decoded as jwt.JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error("Token has expired");
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error("Invalid token");
      } else {
        throw new Error("Token verification failed");
      }
    }
  }
}

// ============================================================================
// SEP-10 Router
// ============================================================================

export function createSep10Router(): Router {
  const router = Router();
  const sep10Service = new Sep10Service();

  /**
   * GET /auth
   * 
   * SEP-10 challenge endpoint
   * Returns a challenge transaction for the client to sign
   */
  router.get("/auth", async (req: Request, res: Response) => {
    try {
      const { account, home_domain, client_domain, memo } = req.query;

      // Validate required parameters
      if (!account || typeof account !== "string") {
        return res.status(400).json({
          error: "Missing required parameter: account",
        });
      }

      // Generate the challenge transaction
      const challenge = await sep10Service.generateChallenge({
        account,
        home_domain: home_domain as string | undefined,
        client_domain: client_domain as string | undefined,
        memo: memo as string | undefined,
      });

      return res.json(challenge);
    } catch (error) {
      console.error("[SEP-10] Error generating challenge:", error);
      
      if (error instanceof Error) {
        if (error.message.includes("Invalid Stellar account address")) {
          return res.status(400).json({
            error: "Invalid Stellar account address",
          });
        }
      }

      return res.status(500).json({
        error: "Failed to generate challenge transaction",
      });
    }
  });

  /**
   * POST /auth
   * 
   * SEP-10 verification endpoint
   * Verifies the signed challenge transaction and issues a JWT token
   */
  router.post("/auth", async (req: Request, res: Response) => {
    try {
      const { transaction } = req.body;

      // Validate required parameters
      if (!transaction || typeof transaction !== "string") {
        return res.status(400).json({
          error: "Missing required parameter: transaction",
        });
      }

      // Verify the challenge and issue a token
      const tokenResponse = await sep10Service.verifyChallenge({
        transaction,
      });

      return res.json(tokenResponse);
    } catch (error) {
      console.error("[SEP-10] Error verifying challenge:", error);
      
      if (error instanceof Error) {
        if (error.message.includes("Invalid transaction XDR")) {
          return res.status(400).json({
            error: "Invalid transaction XDR",
          });
        }
        if (error.message.includes("not signed by the server")) {
          return res.status(400).json({
            error: "Transaction is not signed by the server",
          });
        }
        if (error.message.includes("not signed by the client")) {
          return res.status(400).json({
            error: "Transaction is not signed by the client",
          });
        }
        if (error.message.includes("expired")) {
          return res.status(400).json({
            error: "Challenge transaction has expired",
          });
        }
      }

      return res.status(500).json({
        error: "Failed to verify challenge transaction",
      });
    }
  });

  return router;
}

// Export singleton instance
export const sep10Service = new Sep10Service();
