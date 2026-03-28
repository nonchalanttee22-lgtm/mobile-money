import { Router, Request, Response } from "express";
import { Pool } from "pg";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";

/**
 * SEP-02: Federation Server
 *
 * Provides a Stellar address resolution service that maps human-readable
 * identifiers (phone numbers, email addresses, usernames) to Stellar
 * account IDs and vice-versa.
 *
 * Specification: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0002.md
 */

// ============================================================================
// Types
// ============================================================================

export interface FederationRecord {
  stellar_address: string; // e.g. "alice*mobilemoney.com"
  account_id: string;      // G... Stellar public key
  memo_type?: "text" | "id" | "hash";
  memo?: string;
}

export interface FederationError {
  detail: string;
}

export type FederationQueryType = "name" | "id" | "txid" | "forward";

// ============================================================================
// Helpers
// ============================================================================

/** Stable SHA-256 hex digest used for indexed phone/email lookups. */
function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}

/**
 * Normalise a phone number to E.164-ish form for hashing.
 * Strips whitespace and dashes; keeps the leading "+".
 */
function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, "");
}

/** Parse a federation address into { localPart, domain }. */
function parseFederationAddress(address: string): { localPart: string; domain: string } | null {
  const parts = address.split("*");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { localPart: parts[0], domain: parts[1] };
}

/** Returns the configured federation domain (no trailing slash). */
function getFederationDomain(): string {
  return (process.env.STELLAR_FEDERATION_DOMAIN || process.env.STELLAR_WEB_AUTH_DOMAIN || "mobilemoney.com").replace(
    /^https?:\/\//,
    ""
  );
}

// ============================================================================
// FederationService
// ============================================================================

export class FederationService {
  constructor(private readonly db: Pool) {}

  /**
   * Lookup by federation name (type=name).
   * q is a full federation address, e.g. "alice*mobilemoney.com".
   */
  async lookupByName(federationAddress: string): Promise<FederationRecord | null> {
    const parsed = parseFederationAddress(federationAddress);
    if (!parsed) return null;

    const { localPart, domain } = parsed;
    const expectedDomain = getFederationDomain();

    if (domain.toLowerCase() !== expectedDomain.toLowerCase()) return null;

    // 1. Try username (exact, case-insensitive)
    const byUsername = await this.db.query<{
      id: string;
      stellar_address: string | null;
      username: string | null;
    }>(
      "SELECT id, stellar_address, username FROM users WHERE LOWER(username) = LOWER($1) AND stellar_address IS NOT NULL LIMIT 1",
      [localPart]
    );

    if (byUsername.rows.length > 0) {
      const row = byUsername.rows[0];
      return this.buildRecord(row.username ?? localPart, domain, row.stellar_address!);
    }

    // 2. Try phone hash (local part treated as phone number)
    const phoneHash = sha256(normalizePhone(localPart));
    const byPhone = await this.db.query<{
      id: string;
      stellar_address: string | null;
      username: string | null;
      phone_hash: string | null;
    }>(
      "SELECT id, stellar_address, username, phone_hash FROM users WHERE phone_hash = $1 AND stellar_address IS NOT NULL LIMIT 1",
      [phoneHash]
    );

    if (byPhone.rows.length > 0) {
      const row = byPhone.rows[0];
      return this.buildRecord(row.username ?? localPart, domain, row.stellar_address!);
    }

    // 3. Try email hash (local part treated as email address)
    const emailHash = sha256(localPart.toLowerCase());
    const byEmail = await this.db.query<{
      id: string;
      stellar_address: string | null;
      username: string | null;
      email_hash: string | null;
    }>(
      "SELECT id, stellar_address, username, email_hash FROM users WHERE email_hash = $1 AND stellar_address IS NOT NULL LIMIT 1",
      [emailHash]
    );

    if (byEmail.rows.length > 0) {
      const row = byEmail.rows[0];
      return this.buildRecord(row.username ?? localPart, domain, row.stellar_address!);
    }

    return null;
  }

  /**
   * Reverse lookup by Stellar account ID (type=id).
   * q is a G... or M... Stellar address.
   */
  async lookupById(accountId: string): Promise<FederationRecord | null> {
    const domain = getFederationDomain();

    const result = await this.db.query<{
      stellar_address: string;
      username: string | null;
      phone_hash: string | null;
    }>(
      "SELECT stellar_address, username, phone_hash FROM users WHERE stellar_address = $1 LIMIT 1",
      [accountId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    // Prefer username for the human-readable part; fall back to account_id truncated
    const localPart = row.username ?? accountId;
    return this.buildRecord(localPart, domain, row.stellar_address);
  }

  private buildRecord(localPart: string, domain: string, accountId: string): FederationRecord {
    return {
      stellar_address: `${localPart}*${domain}`,
      account_id: accountId,
    };
  }
}

// ============================================================================
// Validation schemas
// ============================================================================

const federationQuerySchema = z.object({
  q: z.string().min(1, "q is required"),
  type: z.enum(["name", "id", "txid", "forward"], {
    errorMap: () => ({ message: "type must be one of: name, id, txid, forward" }),
  }),
});

// ============================================================================
// Router factory
// ============================================================================

const federationRateLimit = rateLimit({
  windowMs: 60_000,       // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Too many requests. Please try again later." },
});

export function createFederationRouter(db: Pool): Router {
  const router = Router();
  const service = new FederationService(db);

  /**
   * GET /federation
   *
   * SEP-02 compliant federation lookup endpoint.
   *
   * Query params:
   *   q    – The address or account ID to look up
   *   type – "name" | "id"  (txid and forward are not implemented)
   *
   * Successful response (200):
   *   { stellar_address, account_id, memo_type?, memo? }
   *
   * Error response (400 / 404 / 501):
   *   { detail: "<message>" }
   */
  router.get("/", federationRateLimit, async (req: Request, res: Response) => {
    const parsed = federationQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ detail: parsed.error.errors[0].message });
    }

    const { q, type } = parsed.data;

    try {
      let record: FederationRecord | null = null;

      if (type === "name") {
        record = await service.lookupByName(q);
      } else if (type === "id") {
        record = await service.lookupById(q);
      } else {
        // txid and forward are not implemented
        return res.status(501).json({ detail: `Federation type "${type}" is not supported.` });
      }

      if (!record) {
        return res.status(404).json({ detail: "Account not found." });
      }

      return res.status(200).json(record);
    } catch (err) {
      console.error("[SEP-02] Federation lookup error:", err);
      return res.status(500).json({ detail: "Internal server error." });
    }
  });

  return router;
}

// ============================================================================
// Stellar TOML helper
// ============================================================================

/**
 * Returns the FEDERATION_SERVER line for inclusion in stellar.toml.
 * If you already serve a stellar.toml elsewhere, merge this value in.
 */
export function getFederationServerTomlLine(): string {
  const base = process.env.STELLAR_FEDERATION_SERVER_URL || `https://${getFederationDomain()}`;
  return `FEDERATION_SERVER="${base}/federation"`;
}

/**
 * Minimal stellar.toml content that declares this federation server.
 * Mount this at /.well-known/stellar.toml if you don't already serve one.
 */
export function buildStellarToml(): string {
  const domain = getFederationDomain();
  const network = (process.env.STELLAR_NETWORK || "testnet").toUpperCase();
  const signingKey = process.env.STELLAR_SIGNING_KEY || "";
  const federationServer = process.env.STELLAR_FEDERATION_SERVER_URL || `https://${domain}`;

  return [
    `NETWORK_PASSPHRASE="${network === "MAINNET" ? "Public Global Stellar Network ; September 2015" : "Test SDF Network ; September 2015"}"`,
    `FEDERATION_SERVER="${federationServer}/federation"`,
    ...(signingKey ? [`SIGNING_KEY="${signingKey}"`] : []),
    "",
    "[[PRINCIPALS]]",
    `name="${domain}"`,
    `email="support@${domain}"`,
  ].join("\n");
}
