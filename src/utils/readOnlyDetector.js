"use strict";
/**
 * Detects whether a SQL query is read-only (SELECT) or write-capable (INSERT/UPDATE/DELETE).
 * This enables automatic routing to read replicas for SELECT queries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReadOnlyQuery = isReadOnlyQuery;
exports.getQueryCommand = getQueryCommand;
/**
 * Check if a SQL query is a read-only SELECT statement.
 * Returns true for pure SELECT queries, false for write operations (INSERT/UPDATE/DELETE) or mixed.
 *
 * @param query - The SQL query string
 * @returns true if the query is a read-only SELECT, false otherwise
 */
function isReadOnlyQuery(query) {
    if (!query || typeof query !== 'string') {
        return false;
    }
    // Trim and normalize the query
    var normalized = query.trim().toUpperCase();
    // If it doesn't start with SELECT or WITH, it's not read-only
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
        return false;
    }
    // Check for write operations in the query (case-insensitive)
    // This catches queries that might have INSERT/UPDATE/DELETE in subqueries or CTEs
    var writePattern = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/i;
    if (writePattern.test(query)) {
        return false;
    }
    // Check for transaction control statements
    var transactionPattern = /\b(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i;
    if (transactionPattern.test(query)) {
        return false;
    }
    // It's safe to route to replica
    return true;
}
/**
 * Extracts the main SQL command from a query string.
 * Useful for logging and debugging purposes.
 *
 * @param query - The SQL query string
 * @returns The main command (SELECT, INSERT, UPDATE, etc.)
 */
function getQueryCommand(query) {
    if (!query || typeof query !== 'string') {
        return 'UNKNOWN';
    }
    var match = query.trim().match(/^(\w+)/i);
    return match ? match[1].toUpperCase() : 'UNKNOWN';
}
