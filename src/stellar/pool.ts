import * as StellarSdk from "stellar-sdk";
import { getStellarServer } from "../config/stellar";

interface ChannelState {
  publicKey: string;
  keypair: StellarSdk.Keypair | null;
  sequence: bigint;
  inUse: boolean;
}

interface Waiter {
  resolve: (lease: ChannelAccountLease) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
}

export interface ChannelAccountConfig {
  publicKey: string;
  secret?: string;
}

export interface ChannelAccountPoolOptions {
  channelAccounts: ChannelAccountConfig[];
  server?: StellarSdk.Horizon.Server;
  defaultAcquireTimeoutMs?: number;
  maxSequenceMismatchRetries?: number;
}

export interface SubmitWithChannelOptions {
  acquireTimeoutMs?: number;
  maxSequenceMismatchRetries?: number;
}

export type SequenceProvider = {
  publicKey: string;
  keypair: StellarSdk.Keypair | null;
  currentSequence: string;
};

type StellarSubmitTransaction = StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;
type BuildTransaction<T extends StellarSubmitTransaction> = (
  account: SequenceProvider,
) => Promise<T> | T;

export const isSequenceMismatchError = (error: unknown): boolean => {
  const candidate = error as {
    message?: string;
    response?: {
      data?: {
        extras?: {
          result_codes?: {
            transaction?: string;
          };
        };
      };
    };
  };

  const txCode =
    candidate.response?.data?.extras?.result_codes?.transaction || "";
  if (txCode === "tx_bad_seq") {
    return true;
  }

  const message = candidate.message?.toLowerCase() || "";
  return message.includes("tx_bad_seq") || message.includes("bad sequence");
};

export class ChannelAccountLease {
  private released = false;
  private readonly state: ChannelState;
  private readonly pool: ChannelAccountPool;

  constructor(pool: ChannelAccountPool, state: ChannelState) {
    this.pool = pool;
    this.state = state;
  }

  get publicKey(): string {
    return this.state.publicKey;
  }

  get keypair(): StellarSdk.Keypair | null {
    return this.state.keypair;
  }

  getCurrentSequence(): string {
    return this.state.sequence.toString();
  }

  reserveSequence(): string {
    const reserved = this.state.sequence.toString();
    this.state.sequence += 1n;
    return reserved;
  }

  async syncSequence(): Promise<string> {
    return this.pool.syncAccountSequence(this.state);
  }

  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.pool.release(this.state.publicKey);
  }
}

export class ChannelAccountPool {
  private readonly server: StellarSdk.Horizon.Server;
  private readonly states = new Map<string, ChannelState>();
  private readonly available: string[] = [];
  private readonly waiters: Waiter[] = [];
  private readonly defaultAcquireTimeoutMs: number;
  private readonly maxSequenceMismatchRetries: number;
  private initializePromise: Promise<void> | null = null;
  private initialized = false;

  constructor(options: ChannelAccountPoolOptions) {
    if (options.channelAccounts.length === 0) {
      throw new Error("At least one channel account is required");
    }

    this.server = options.server ?? getStellarServer();
    this.defaultAcquireTimeoutMs = options.defaultAcquireTimeoutMs ?? 10_000;
    this.maxSequenceMismatchRetries = options.maxSequenceMismatchRetries ?? 1;

    for (const account of options.channelAccounts) {
      if (!StellarSdk.StrKey.isValidEd25519PublicKey(account.publicKey)) {
        throw new Error(`Invalid channel account public key: ${account.publicKey}`);
      }

      const keypair = account.secret
        ? StellarSdk.Keypair.fromSecret(account.secret)
        : null;

      if (keypair && keypair.publicKey() !== account.publicKey) {
        throw new Error(
          `Secret key does not match public key for account ${account.publicKey}`,
        );
      }

      if (!this.states.has(account.publicKey)) {
        this.states.set(account.publicKey, {
          publicKey: account.publicKey,
          keypair,
          sequence: 0n,
          inUse: false,
        });
        this.available.push(account.publicKey);
      }
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = (async () => {
      await Promise.all(
        Array.from(this.states.values()).map((state) =>
          this.syncAccountSequence(state),
        ),
      );
      this.initialized = true;
    })();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  getSize(): number {
    return this.states.size;
  }

  getAvailableCount(): number {
    return this.available.length;
  }

  getInUseCount(): number {
    return this.states.size - this.available.length;
  }

  async acquire(timeoutMs: number = this.defaultAcquireTimeoutMs): Promise<ChannelAccountLease> {
    await this.initialize();

    const direct = this.tryAcquire();
    if (direct) {
      return direct;
    }

    return new Promise<ChannelAccountLease>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      if (timeoutMs > 0) {
        waiter.timeoutId = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) {
            this.waiters.splice(idx, 1);
          }
          reject(new Error("Timed out waiting for a free channel account"));
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }

  release(publicKey: string): void {
    const state = this.states.get(publicKey);
    if (!state) {
      return;
    }

    if (!state.inUse) {
      return;
    }

    state.inUse = false;
    this.available.push(publicKey);
    this.dispatchWaiters();
  }

  async withAccount<T>(
    work: (lease: ChannelAccountLease) => Promise<T> | T,
    timeoutMs?: number,
  ): Promise<T> {
    const lease = await this.acquire(timeoutMs);
    try {
      return await work(lease);
    } finally {
      lease.release();
    }
  }

  async submitWithChannel<T extends StellarSubmitTransaction>(
    buildTransaction: BuildTransaction<T>,
    options: SubmitWithChannelOptions = {},
  ): Promise<StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse> {
    const retries =
      options.maxSequenceMismatchRetries ?? this.maxSequenceMismatchRetries;
    const lease = await this.acquire(options.acquireTimeoutMs);

    try {
      let attempt = 0;
      while (attempt <= retries) {
        const reservedSequence = lease.reserveSequence();
        const transaction = await buildTransaction({
          publicKey: lease.publicKey,
          keypair: lease.keypair,
          currentSequence: reservedSequence,
        });

        try {
          const response = await this.server.submitTransaction(transaction);
          return response;
        } catch (error: unknown) {
          if (isSequenceMismatchError(error) && attempt < retries) {
            await lease.syncSequence();
            attempt += 1;
            continue;
          }

          await lease.syncSequence().catch(() => {
            // Preserve original submission error on refresh failures.
          });
          throw error;
        }
      }

      throw new Error("Channel submit failed after exhausting retry attempts");
    } finally {
      lease.release();
    }
  }

  async syncAccountSequence(state: ChannelState): Promise<string> {
    const account = await this.server.loadAccount(state.publicKey);
    const accountSequence = BigInt(account.sequence);
    state.sequence = accountSequence;
    return state.sequence.toString();
  }

  private tryAcquire(): ChannelAccountLease | null {
    const publicKey = this.available.shift();
    if (!publicKey) {
      return null;
    }

    const state = this.states.get(publicKey);
    if (!state) {
      return null;
    }

    state.inUse = true;
    return new ChannelAccountLease(this, state);
  }

  private dispatchWaiters(): void {
    while (this.waiters.length > 0 && this.available.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) {
        return;
      }
      if (waiter.timeoutId) {
        clearTimeout(waiter.timeoutId);
      }

      const lease = this.tryAcquire();
      if (!lease) {
        return;
      }

      waiter.resolve(lease);
    }
  }
}

export const createChannelAccountPool = (
  options: ChannelAccountPoolOptions,
): ChannelAccountPool => new ChannelAccountPool(options);
