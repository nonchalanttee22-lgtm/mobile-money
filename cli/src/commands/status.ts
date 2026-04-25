import { Command } from "commander";
import { getTransaction } from "../api";

export function registerStatusCommand(program: Command): void {
  program
    .command("status <transactionId>")
    .description("Get transaction details")
    .action(async (transactionId: string) => {
      try {
        const tx = await getTransaction(transactionId);
        console.log(`Transaction: ${tx.id}`);
        console.log(`Reference:   ${tx.referenceNumber}`);
        console.log(`Type:        ${tx.type}`);
        console.log(`Amount:      ${tx.amount}`);
        console.log(`Phone:       ${tx.phoneNumber}`);
        console.log(`Provider:    ${tx.provider}`);
        console.log(`Status:      ${tx.status}`);
        console.log(`Retries:     ${tx.retryCount}`);
        console.log(`Created:     ${tx.createdAt}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`✗ ${msg}`);
        process.exit(1);
      }
    });
}
