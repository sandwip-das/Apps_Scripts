/**
 * Audit Service
 * Tracks all Insert, Update, Delete, Login, Logout, Approval actions.
 */

var AuditService = (function() {
  
  function getAuditSheet() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
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
        var sheet = getAuditSheet();
        var user = Session.getActiveUser().getEmail() || 'System';
        
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
