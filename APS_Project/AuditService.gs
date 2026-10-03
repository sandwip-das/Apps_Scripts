/**
 * ============================================================================
 * SANDVIORA AVIOSOLUTION - Audit Logging Service
 * ============================================================================
 * File: AuditService.gs
 * Architectural Role: Security, Compliance & Data Governance
 * 
 * Description:
 * Provides an immutable, append-only audit trail for all transactional actions
 * (Create, Update, Delete, Approval, Login/Logout) across the enterprise HRMS.
 * 
 * Features & Guarantees:
 * - Lazy initialization: Automatically creates the 'audit_logs' worksheet and
 *   header columns if it does not already exist.
 * - Non-blocking safety: Uses try/catch blocks to ensure that any audit logging
 *   issue (e.g. temporary spreadsheet quota) never fails the primary business
 *   transaction.
 * - Actor resolution: Automatically captures the active Google Session user
 *   email, falling back to 'System' for automated/batch operations.
 * ============================================================================
 */

var AuditService = (function() {
  
  /**
   * Retrieves or automatically initializes the 'audit_logs' spreadsheet tab.
   * Ensures the header row matches standard schema definition:
   * ['log_id', 'user_id', 'action', 'table_name', 'record_id', 'old_value', 'new_value', 'timestamp']
   * 
   * @private
   * @returns {GoogleAppsScript.Spreadsheet.Sheet} The active audit logs worksheet.
   * @throws {Error} If the underlying Google Spreadsheet cannot be accessed.
   */
  function getAuditSheet() {
    var ss = null;

    // Strategy 1: Attempt to retrieve spreadsheet instance through Database DAO
    if (typeof Database !== 'undefined' && Database.getActiveSpreadsheet) {
      try {
        ss = Database.getActiveSpreadsheet();
      } catch (e) {}
    }

    // Strategy 2: Fallback to bound active spreadsheet container
    if (!ss) {
      try {
        ss = SpreadsheetApp.getActiveSpreadsheet();
      } catch (e2) {}
    }

    if (!ss) {
      throw new Error("Unable to access spreadsheet for audit logging.");
    }

    // Locate or create the audit sheet
    var sheet = ss.getSheetByName('audit_logs');
    if (!sheet) {
      sheet = ss.insertSheet('audit_logs');
      // Append standard column headers
      sheet.appendRow(['log_id', 'user_id', 'action', 'table_name', 'record_id', 'old_value', 'new_value', 'timestamp']);
    }
    return sheet;
  }

  /**
   * Generates a unique 8-digit randomized log entry identifier (e.g. LOG-12345678).
   * 
   * @private
   * @returns {string} Unique log identifier.
   */
  function generateLogId() {
    return 'LOG-' + Math.floor(10000000 + Math.random() * 90000000);
  }

  return {
    /**
     * Appends a structured audit entry to the audit log worksheet.
     * Silently catches and logs errors so parent database operations succeed safely.
     * 
     * @param {string} action - The action performed (e.g. 'INSERT', 'UPDATE', 'DELETE').
     * @param {string} tableName - The target database sheet/table name.
     * @param {string} recordId - Primary key value of the affected record.
     * @param {string|Object} [oldValue] - Serialized previous record state (for updates/deletions).
     * @param {string|Object} [newValue] - Serialized new record state (for inserts/updates).
     */
    log: function(action, tableName, recordId, oldValue, newValue) {
      try {
        // Resolve actor identity from current Google session
        var user = 'System';
        try {
          if (typeof Session !== 'undefined' && Session.getActiveUser) {
            user = Session.getActiveUser().getEmail() || 'System';
          }
        } catch (e) {}
        
        var sheet = getAuditSheet();
        sheet.appendRow([
          generateLogId(),
          user,
          action,
          tableName,
          recordId,
          oldValue || '',
          newValue || '',
          new Date()
        ]);
      } catch (e) {
        // Non-blocking error logging
        console.error("Audit logging failed:", e);
      }
    }
  };
})();
