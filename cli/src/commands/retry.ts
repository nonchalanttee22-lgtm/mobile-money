import { Command } from "commander";
import { getTransaction, retryTransaction } from "../api";

export function registerRetryCommand(program: Command): void {
  program
    .command("retry <transactionId>")
    .description("Force-retry a failed transaction")
    .action(async (transactionId: string) => {
      try {
        const tx = await getTransaction(transactionId);

        if (tx.status === "pending" || tx.status === "completed") {
          console.log(
            `⚠ Transaction ${transactionId} is already ${tx.status} — no action taken.`,
          );
          process.exit(0);
        }

        await retryTransaction(transactionId);
        console.log(
          `✓ Transaction ${transactionId} reset to pending — worker will pick it up shortly.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`✗ ${msg}`);
        process.exit(1);
      }
    });
}
