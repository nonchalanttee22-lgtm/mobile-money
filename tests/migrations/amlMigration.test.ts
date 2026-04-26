import * as fs from "fs";
import * as path from "path";

describe("AML root migration", () => {
  const migrationsDir = path.join(process.cwd(), "migrations");
  const amlMigrationPath = path.join(
    migrationsDir,
    "008_create_aml_alerts_table.sql",
  );

  let migrationContent: string;

  beforeAll(() => {
    migrationContent = fs.readFileSync(amlMigrationPath, "utf8");
  });

  it("should run before the partition and transaction index migrations", () => {
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter(
        (file) => /^\d+_.+\.sql$/.test(file) && !file.endsWith(".down.sql"),
      )
      .sort();

    const amlMigrationIndex = migrationFiles.indexOf(
      "008_create_aml_alerts_table.sql",
    );

    expect(amlMigrationIndex).toBeGreaterThanOrEqual(0);
    expect(
      migrationFiles.indexOf("009_partition_transactions.sql"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      migrationFiles.indexOf("20260425_add_transaction_indexes.sql"),
    ).toBeGreaterThanOrEqual(0);
    expect(amlMigrationIndex).toBeLessThan(
      migrationFiles.indexOf("009_partition_transactions.sql"),
    );
    expect(amlMigrationIndex).toBeLessThan(
      migrationFiles.indexOf("20260425_add_transaction_indexes.sql"),
    );
  });

  it("should create AML alert tables with required columns and compatible FKs", () => {
    expect(migrationContent).toContain("CREATE TABLE IF NOT EXISTS aml_alerts");
    expect(migrationContent).toContain(
      "CREATE TABLE IF NOT EXISTS aml_alert_review_history",
    );
    expect(migrationContent).toContain(
      "transaction_id UUID NOT NULL REFERENCES transactions(id)",
    );
    expect(migrationContent).toContain(
      "user_id UUID NOT NULL REFERENCES users(id)",
    );
    expect(migrationContent).toContain("reviewed_by UUID REFERENCES users(id)");

    const requiredAlertColumns = [
      "id",
      "transaction_id",
      "user_id",
      "severity",
      "status",
      "rule_hits",
      "reasons",
      "created_at",
      "updated_at",
      "reviewed_at",
      "reviewed_by",
      "review_notes",
    ];

    for (const column of requiredAlertColumns) {
      expect(migrationContent).toContain(column);
    }
  });

  it("should use idempotent table and index creation", () => {
    expect(migrationContent).toContain("CREATE TABLE IF NOT EXISTS aml_alerts");
    expect(migrationContent).toContain(
      "CREATE TABLE IF NOT EXISTS aml_alert_review_history",
    );
    expect(migrationContent).toContain("CREATE INDEX IF NOT EXISTS");
  });
});
