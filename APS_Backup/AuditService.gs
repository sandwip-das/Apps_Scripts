/**
 * Audit Service
 * Tracks all Insert, Update, Delete, Login, Logout, Approval actions.
 */

var AuditService = (function() {
  
  function getAuditSheet() {
    var ss = null;
    if (typeof Database !== 'undefined' && Database.getActiveSpreadsheet) {
      try {
        ss = Database.getActiveSpreadsheet();
      } catch (e) {}
    }
    if (!ss) {
      try {
        ss = SpreadsheetApp.getActiveSpreadsheet();
      } catch (e2) {}
    }
    if (!ss) {
      throw new Error("Unable to access spreadsheet for audit logging.");
    }
    var sheet = ss.getSheetByName('audit_logs');
    if (!sheet) {
      sheet = ss.insertSheet('audit_logs');
      sheet.appendRow(['log_id', 'user_id', 'action', 'table_name', 'record_id', 'old_value', 'new_value', 'timestamp']);
    }
    return sheet;
  }

  function generateLogId() {
    return 'LOG-' + Math.floor(10000000 + Math.random() * 90000000);
  }

  return {
    log: function(action, tableName, recordId, oldValue, newValue) {
      try {
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
        console.error("Audit logging failed", e);
      }
    }
  };
})();
