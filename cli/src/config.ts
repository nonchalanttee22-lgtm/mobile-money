import dotenv from "dotenv";
import path from "path";

// Load .momorc from the cli/ directory, fall back to process.env
dotenv.config({ path: path.resolve(__dirname, "..", ".momorc") });

export interface CliConfig {
  apiUrl: string;
  apiKey: string;
}

export function getConfig(): CliConfig {
  const apiKey = process.env.MOMO_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MOMO_API_KEY is required. Set it in cli/.momorc or as an environment variable.",
    );
  }
  return {
    apiUrl: process.env.MOMO_API_URL ?? "http://localhost:3000",
    apiKey,
  };
}
