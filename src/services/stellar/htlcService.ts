import * as StellarSdk from "stellar-sdk";
import { getStellarServer, getNetworkPassphrase } from "../../config/stellar";
import { transactionTotal, transactionErrorsTotal } from "../../utils/metrics";

/**
 * HTLC Service for Stellar Soroban
 * Handles lock, claim and refund operations
 */
export class HtlcService {
  private server: StellarSdk.Horizon.Server;
  private networkPassphrase: string;

  constructor() {
    this.server = getStellarServer();
    this.networkPassphrase = getNetworkPassphrase();
  }

  /**
   * Build an HTLC lock transaction
   */
  async buildLockTx(params: {
    senderAddress: string;
    receiverAddress: string;
    tokenAddress: string;
    amount: string;
    hashlock: string; // 32-byte hex string
    timelock: number; // Unix timestamp
    contractId: string;
  }): Promise<StellarSdk.Transaction> {
    const senderAccount = await this.server.loadAccount(params.senderAddress);
    
    const spec = new StellarSdk.Contract(params.contractId);
    
    // Encode arguments for Soroban
    // fn initialize(env: Env, sender: Address, receiver: Address, token: Address, amount: i128, hashlock: BytesN<32>, timelock: u64)
    const args = [
      StellarSdk.nativeToScVal(params.senderAddress, { type: "address" }),
      StellarSdk.nativeToScVal(params.receiverAddress, { type: "address" }),
      StellarSdk.nativeToScVal(params.tokenAddress, { type: "address" }),
      StellarSdk.nativeToScVal(params.amount, { type: "i128" }),
      StellarSdk.nativeToScVal(Buffer.from(params.hashlock, "hex"), { type: "bytesN", size: 32 }),
      StellarSdk.nativeToScVal(params.timelock, { type: "u64" }),
    ];

    const operation = spec.call("initialize", ...args);

    return new StellarSdk.TransactionBuilder(senderAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();
  }

  /**
   * Build an HTLC claim transaction
   */
  async buildClaimTx(params: {
    claimerAddress: string;
    preimage: string; // 32-byte hex string
    contractId: string;
  }): Promise<StellarSdk.Transaction> {
    const claimerAccount = await this.server.loadAccount(params.claimerAddress);
    const spec = new StellarSdk.Contract(params.contractId);

    // fn claim(env: Env, preimage: BytesN<32>)
    const args = [
      StellarSdk.nativeToScVal(Buffer.from(params.preimage, "hex"), { type: "bytesN", size: 32 }),
    ];

    const operation = spec.call("claim", ...args);

    return new StellarSdk.TransactionBuilder(claimerAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();
  }

  /**
   * Build an HTLC refund transaction
   */
  async buildRefundTx(params: {
    refunderAddress: string;
    contractId: string;
  }): Promise<StellarSdk.Transaction> {
    const refunderAccount = await this.server.loadAccount(params.refunderAddress);
    const spec = new StellarSdk.Contract(params.contractId);

    // fn refund(env: Env)
    const operation = spec.call("refund");

    return new StellarSdk.TransactionBuilder(refunderAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();
  }

  /**
   * Get HTLC state from chain
   */
  async getHtlcState(contractId: string): Promise<any> {
    const spec = new StellarSdk.Contract(contractId);
    
    // To read state, we normally use get_state if exposed or check storage
    // For simplicity, we assume we can call get_state (read-only)
    // Note: Soroban read-only calls are usually done via simulation or specific RPC
    // Here we'll just mock it or provide a placeholder for actual RPC call
    console.log(`Fetching HTLC state for ${contractId}...`);
    
    // In a real scenario, you'd use the Soroban RPC to simulate the get_state call
    return {
      exists: true,
      // ... more fields
    };
  }
}
