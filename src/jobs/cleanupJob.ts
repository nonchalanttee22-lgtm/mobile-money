import { pool } from '../config/database';

/**
 * Cleanup Job
 * Schedule: Daily at 2:00 AM (0 2 * * *)
 * Deletes transactions older than LOG_RETENTION_DAYS (default: 90 days)
 * that are in a terminal state (completed or failed).
 */
export async function runCleanupJob(): Promise<void> {
  const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '90', 10);

  const result = await pool.query(
    `DELETE FROM transactions
     WHERE status IN ('completed', 'failed')
       AND created_at < NOW() - INTERVAL '${retentionDays} days'`
  );

  console.log(`[cleanup] Deleted ${result.rowCount} old transaction(s) older than ${retentionDays} days`);
}
