import crypto from "crypto";

export interface ApiKey {
  key: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

// Generate secure API key
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Create a new API key
export function createApiKey(user: any): ApiKey {
  if (!user.apiKeys) {
    user.apiKeys = [];
  }

  const newKey: ApiKey = {
    key: generateApiKey(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    isActive: true,
  };

  user.apiKeys.push(newKey);
  return newKey;
}

// Validate API key
export function validateApiKey(user: any, key: string): ApiKey | null {
  if (!user.apiKeys) return null;

  const validKey = user.apiKeys.find(
    (k: ApiKey) =>
      k.key === key &&
      k.isActive &&
      new Date(k.expiresAt) > new Date()
  );

  return validKey || null;
}

// Rotate API key (no downtime)
export function rotateApiKey(user: any): ApiKey {
  if (!user.apiKeys) {
    user.apiKeys = [];
  }

  const newKey: ApiKey = {
    key: generateApiKey(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    isActive: true,
  };

  // IMPORTANT: keep old keys active
  user.apiKeys.push(newKey);

  return newKey;
}