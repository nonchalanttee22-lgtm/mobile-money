import { connection } from "./config";
import { transactionQueue } from "./transactionQueue";
import { transactionWorker, closeWorker } from "./worker";
import {
  providerBalanceAlertQueue,
  closeProviderBalanceAlertQueue,
  scheduleProviderBalanceAlertJob,
} from "./providerBalanceAlertQueue";
import {
  closeProviderBalanceAlertWorker,
  startProviderBalanceAlertWorker,
} from "./providerBalanceAlertWorker";

export async function shutdownQueue(): Promise<void> {
  await closeProviderBalanceAlertWorker().catch(() => undefined);
  await closeProviderBalanceAlertQueue().catch(() => undefined);
  await closeWorker().catch(() => undefined);
  await transactionQueue.close().catch(() => undefined);
  await connection.quit().catch(() => undefined);
}

export {
  transactionQueue,
  providerBalanceAlertQueue,
  addTransactionJob,
  getJobById,
  getJobProgress,
  getQueueStats,
  pauseQueue,
  resumeQueue,
  drainQueue,
} from "./transactionQueue";
export type {
  TransactionJobData,
  TransactionJobResult,
} from "./transactionQueue";
export { transactionWorker, closeWorker };
export {
  scheduleProviderBalanceAlertJob,
  startProviderBalanceAlertWorker,
  closeProviderBalanceAlertWorker,
};
export { createQueueDashboard } from "./dashboard";
export {
  getQueueHealth,
  pauseQueueEndpoint,
  resumeQueueEndpoint,
} from "./health";
export { queueOptions } from "./config";
export { deadLetterQueue, DLQ_NAME, capturePersistentFailure } from "./dlq";
