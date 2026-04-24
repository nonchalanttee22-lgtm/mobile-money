import { Router, Request, Response } from "express";
import { rateLimitExport as exportRateLimiter } from "../middleware/rateLimit";
import QueryStream from "pg-query-stream";
import { pipeline, Transform } from "stream";
import ExcelJS from "exceljs";
import { pool } from "../config/database";
import { requireAuth } from "../middleware/auth";
import { TransactionStatus } from "../models/transaction";

type QueryValue = string | string[] | undefined;

export interface TransactionExportFilters {
  status?: TransactionStatus;
  provider?: string;
  type?: "deposit" | "withdraw";
  phoneNumber?: string;
  stellarAddress?: string;
  referenceNumber?: string;
  from?: Date;
  to?: Date;
  tags?: string[];
  userId?: string;
}

type QueryStreamFactory = (text: string, values: unknown[]) => unknown;

interface QueryableClient {
  query(query: unknown): NodeJS.ReadableStream;
  release(): void;
}

interface PoolLike {
  connect(): Promise<QueryableClient>;
}

interface ExportRouteDependencies {
  db?: PoolLike;
  createQueryStream?: QueryStreamFactory;
}

const CSV_HEADERS = [
  "ID",
  "Reference Number",
  "Type",
  "Amount",
  "Phone Number",
  "Provider",
  "Status",
  "Stellar Address",
  "Tags",
  "Notes",
  "Admin Notes",
  "User ID",
  "Created At",
  "Updated At",
];

function singleQueryValue(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseDate(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} date`);
  }
  return date;
}

export function parseTransactionExportFilters(
  query: Request["query"],
): TransactionExportFilters {
  const status = singleQueryValue(query.status as QueryValue);
  const provider = singleQueryValue(query.provider as QueryValue);
  const type = singleQueryValue(query.type as QueryValue);
  const phoneNumber =
    singleQueryValue(query.phoneNumber as QueryValue) ??
    singleQueryValue(query.phone as QueryValue);
  const stellarAddress = singleQueryValue(query.stellarAddress as QueryValue);
  const referenceNumber = singleQueryValue(query.referenceNumber as QueryValue);
  const from = singleQueryValue(query.from as QueryValue);
  const to = singleQueryValue(query.to as QueryValue);
  const tags = singleQueryValue(query.tags as QueryValue);

  if (
    status &&
    !Object.values(TransactionStatus).includes(status as TransactionStatus)
  ) {
    throw new Error(
      `Invalid status. Expected one of: ${Object.values(TransactionStatus).join(", ")}`,
    );
  }

  if (type && type !== "deposit" && type !== "withdraw") {
    throw new Error("Invalid type. Expected one of: deposit, withdraw");
  }

  const filters: TransactionExportFilters = {};

  if (status) filters.status = status as TransactionStatus;
  if (provider) filters.provider = provider;
  if (type) filters.type = type as "deposit" | "withdraw";
  if (phoneNumber) filters.phoneNumber = phoneNumber;
  if (stellarAddress) filters.stellarAddress = stellarAddress;
  if (referenceNumber) filters.referenceNumber = referenceNumber;
  if (from) filters.from = parseDate(from, "from");
  if (to) filters.to = parseDate(to, "to");
  if (tags) {
    filters.tags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return filters;
}

export function buildTransactionExportQuery(
  filters: TransactionExportFilters,
): {
  text: string;
  values: unknown[];
} {
  const whereClauses: string[] = [];
  const values: unknown[] = [];

  const addClause = (
    clauseFactory: (index: number) => string,
    value: unknown,
  ) => {
    values.push(value);
    whereClauses.push(clauseFactory(values.length));
  };

  if (filters.status) addClause((i) => `status = $${i}`, filters.status);
  if (filters.provider) addClause((i) => `provider = $${i}`, filters.provider);
  if (filters.type) addClause((i) => `type = $${i}`, filters.type);
  if (filters.phoneNumber) {
    addClause((i) => `phone_number = $${i}`, filters.phoneNumber);
  }
  if (filters.stellarAddress) {
    addClause((i) => `stellar_address = $${i}`, filters.stellarAddress);
  }
  if (filters.referenceNumber) {
    addClause((i) => `reference_number = $${i}`, filters.referenceNumber);
  }
  if (filters.from) addClause((i) => `created_at >= $${i}`, filters.from);
  if (filters.to) addClause((i) => `created_at <= $${i}`, filters.to);
  if (filters.tags?.length) {
    addClause((i) => `tags @> $${i}::text[]`, filters.tags);
  }
  if (filters.userId) {
    addClause((i) => `user_id = $${i}`, filters.userId);
  }

  const whereSql =
    whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";

  return {
    text:
      `SELECT id, reference_number, type, amount, phone_number, provider, status, ` +
      `stellar_address, tags, notes, admin_notes, user_id, created_at, updated_at ` +
      `FROM transactions${whereSql} ORDER BY created_at DESC`,
    values,
  };
}

function formatReadableDate(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    [
      date.getUTCFullYear(),
      pad(date.getUTCMonth() + 1),
      pad(date.getUTCDate()),
    ].join("-") +
    " " +
    [
      pad(date.getUTCHours()),
      pad(date.getUTCMinutes()),
      pad(date.getUTCSeconds()),
    ].join(":")
  );
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const raw = Array.isArray(value)
    ? value.map((item) => String(item)).join("|")
    : String(value);

  const escaped = raw.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function transactionRowToCsv(row: Record<string, unknown>): string {
  const fields = [
    row.id,
    row.reference_number,
    row.type,
    row.amount,
    row.phone_number,
    row.provider,
    row.status,
    row.stellar_address,
    row.tags,
    row.notes,
    row.admin_notes,
    row.user_id,
    formatReadableDate(row.created_at),
    formatReadableDate(row.updated_at),
  ];

  return `${fields.map(escapeCsvValue).join(",")}\n`;
}

function defaultQueryStreamFactory(text: string, values: unknown[]): unknown {
  return new QueryStream(text, values, { batchSize: 250 });
}

function getScopedUserId(req: Request): string | undefined {
  const requestWithAuth = req as Request & {
    jwtUser?: { userId?: string; role?: string };
    user?: { id?: string; role?: string };
  };
  const authUserId =
    requestWithAuth.jwtUser?.userId ?? requestWithAuth.user?.id;
  const role = requestWithAuth.jwtUser?.role ?? requestWithAuth.user?.role;

  if (!authUserId || role === "admin" || authUserId === "admin-system") {
    return undefined;
  }

  return authUserId;
}

function transactionRowToWorksheetRow(row: Record<string, unknown>): unknown[] {
  return [
    row.id ?? "",
    row.reference_number ?? "",
    row.type ?? "",
    row.amount ?? "",
    row.phone_number ?? "",
    row.provider ?? "",
    row.status ?? "",
    row.stellar_address ?? "",
    Array.isArray(row.tags) ? row.tags.join("|") : (row.tags ?? ""),
    row.notes ?? "",
    row.admin_notes ?? "",
    row.user_id ?? "",
    formatReadableDate(row.created_at),
    formatReadableDate(row.updated_at),
  ];
}

async function streamTransactionsAsXlsx(
  rowStream: NodeJS.ReadableStream,
  res: Response,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: false,
    useSharedStrings: false,
  });

  const sheet = workbook.addWorksheet("Transactions");
  sheet.addRow(CSV_HEADERS).commit();

  for await (const row of rowStream as AsyncIterable<Record<string, unknown>>) {
    sheet.addRow(transactionRowToWorksheetRow(row)).commit();
  }

  sheet.commit();
  await workbook.commit();
}

const exportRateLimiterMiddleware = exportRateLimiter;

export function createExportRoutes(
  dependencies: ExportRouteDependencies = {},
): Router {
  const router = Router();
  const db = dependencies.db ?? pool;
  const createQueryStream =
    dependencies.createQueryStream ?? defaultQueryStreamFactory;

  router.get(
    "/export",
    exportRateLimiterMiddleware,
    requireAuth,
    async (req: Request, res: Response) => {
      let client: QueryableClient | null = null;
      let released = false;

      const releaseClient = () => {
        if (client && !released) {
          released = true;
          client.release();
        }
      };

      try {
        const filters = parseTransactionExportFilters(req.query);
        const scopedUserId = getScopedUserId(req);
        if (scopedUserId) {
          filters.userId = scopedUserId;
        }
        const { text, values } = buildTransactionExportQuery(filters);

        client = await db.connect();
        const queryStream = createQueryStream(text, values);
        const rowStream = client.query(queryStream);

        const filename = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
        res.status(200);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.write(`${CSV_HEADERS.join(",")}\n`);

        const csvTransform = new Transform({
          objectMode: true,
          transform(chunk: Record<string, unknown>, _encoding, callback) {
            callback(null, transactionRowToCsv(chunk));
          },
        });

        res.on("close", () => {
          if (
            "destroy" in rowStream &&
            typeof rowStream.destroy === "function"
          ) {
            rowStream.destroy();
          }
          releaseClient();
        });

        pipeline(rowStream, csvTransform, res, (error) => {
          releaseClient();
          if (error) {
            console.error("Transaction CSV export failed:", error);
          }
        });
      } catch (error) {
        releaseClient();
        const message =
          error instanceof Error
            ? error.message
            : "Failed to export transactions";
        const statusCode = message.startsWith("Invalid") ? 400 : 500;
        res.status(statusCode).json({ error: message });
      }
    },
  );

  router.get(
    "/export/xlsx",
    exportRateLimiterMiddleware,
    requireAuth,
    async (req: Request, res: Response) => {
      let client: QueryableClient | null = null;
      let released = false;

      const releaseClient = () => {
        if (client && !released) {
          released = true;
          client.release();
        }
      };

      try {
        const filters = parseTransactionExportFilters(req.query);
        const scopedUserId = getScopedUserId(req);
        if (scopedUserId) {
          filters.userId = scopedUserId;
        }
        const { text, values } = buildTransactionExportQuery(filters);

        client = await db.connect();
        const queryStream = createQueryStream(text, values);
        const rowStream = client.query(queryStream);

        const filenameDate = new Date().toISOString().slice(0, 10);
        const filename = `transactions-${filenameDate}.xlsx`;

        res.status(200);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );

        res.on("close", () => {
          if (
            "destroy" in rowStream &&
            typeof rowStream.destroy === "function"
          ) {
            rowStream.destroy();
          }
          releaseClient();
        });

        await streamTransactionsAsXlsx(rowStream, res);
        releaseClient();
      } catch (error) {
        releaseClient();
        const message =
          error instanceof Error
            ? error.message
            : "Failed to export transactions";
        const statusCode = message.startsWith("Invalid") ? 400 : 500;
        res.status(statusCode).json({ error: message });
      }
    },
  );

  return router;
}

export const exportRoutes = createExportRoutes();
