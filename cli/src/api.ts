import axios, { AxiosInstance } from "axios";
import { getConfig } from "./config";

export interface Transaction {
  id: string;
  referenceNumber: string;
  type: string;
  amount: string;
  phoneNumber: string;
  provider: string;
  status: string;
  retryCount: number;
  createdAt: string;
}

function buildClient(): AxiosInstance {
  const { apiUrl, apiKey } = getConfig();
  return axios.create({
    baseURL: apiUrl,
    headers: { "X-API-Key": apiKey },
  });
}

function extractMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (data) {
      if (typeof data["error"] === "string") return data["error"];
      if (typeof data["message"] === "string") return data["message"];
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function getTransaction(id: string): Promise<Transaction> {
  try {
    const { data } = await buildClient().get<Transaction>(
      `/api/admin/transactions/${id}`,
    );
    return data;
  } catch (err) {
    throw new Error(extractMessage(err));
  }
}

export async function retryTransaction(
  id: string,
): Promise<{ message: string; transaction: Transaction }> {
  try {
    const { data } = await buildClient().put<{
      message: string;
      transaction: Transaction;
    }>(`/api/admin/transactions/${id}`, { status: "pending" });
    return data;
  } catch (err) {
    throw new Error(extractMessage(err));
  }
}

export async function checkAuth(): Promise<{ status: string }> {
  try {
    const { data } = await buildClient().get<{ status: string }>("/api/stats");
    return data;
  } catch (err) {
    throw new Error(extractMessage(err));
  }
}
