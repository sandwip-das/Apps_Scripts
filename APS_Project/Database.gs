/**
 * Enterprise Database Service (DAO)
 * Handles CRUD operations, primary key generation, soft deletes, and injects audit fields.
 */

var Database = (function() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  function formatForSheet(val) {
    if (typeof val === 'string') {
      if (val.match(/^(\d{2})-([a-zA-Z]{3})-(\d{4})$/)) {
        return "'" + val; // force text
      }
      if (val.startsWith('+')) {
        return "'" + val; // prevent formula errors for phone numbers
      }
    }
    return val;
  }

  function getNowString() {
    return "'" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yyyy H:mm:ss");
  }

  function parseToNativeDateIfMatch(val) {
    if (typeof val === 'string') {
      var match = val.match(/^(\d{2})-([a-zA-Z]{3})-(\d{4})$/);
      if (match) {
        var months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
        var d = parseInt(match[1], 10);
        var m = months[match[2]];
        var y = parseInt(match[3], 10);
        if (m !== undefined) {
          return new Date(y, m, d);
        }
      }
    }
    return val;
  }

  function getSheet(tableName) {
    var sheet = ss.getSheetByName(tableName);
    if (!sheet) {
      sheet = ss.insertSheet(tableName);
    }
    return sheet;
  }

  function generatePK(prefix) {
    var num = Math.floor(100000 + Math.random() * 900000);
    return prefix + '-' + num;
  }

  function getActiveUser() {
    return Session.getActiveUser().getEmail() || 'System';
  }

  function getAll(tableName) {
    var sheet = getSheet(tableName);
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    var headers = data[0];
    var records = [];
    var deletedIdx = headers.indexOf('is_deleted');

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (deletedIdx === -1 || row[deletedIdx] !== true) {
        var record = {};
        for (var j = 0; j < headers.length; j++) {
          var val = row[j];
          if (Object.prototype.toString.call(val) === '[object Date]') {
            if (headers[j] === 'created_at' || headers[j] === 'updated_at') {
              val = Utilities.formatDate(val, Session.getScriptTimeZone(), "M/d/yyyy H:mm:ss");
            } else {
              var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              var d = String(val.getDate());
              if (d.length === 1) d = '0' + d;
              var m = months[val.getMonth()];
              var y = val.getFullYear();
              val = d + '-' + m + '-' + y;
            }
          }
          record[headers[j]] = val;
        }
        record._rowIndex = i + 1;
        records.push(record);
      }
    }
    return records;
  }

  return {
    getAll: getAll,

    getById: function(tableName, pkColumn, id) {
      var records = getAll(tableName);
      for(var i=0; i<records.length; i++) {
        if (records[i][pkColumn] === id) return records[i];
      }
      return null;
    },

    insert: function(tableName, record, pkPrefix, pkColName) {
      var sheet = getSheet(tableName);
      var lastCol = sheet.getLastColumn();
      var headers = [];
      
      if (lastCol === 0) {
        // Table is brand new, build headers dynamically
        if (pkColName) headers.push(pkColName);
        for (var k in record) {
          if (k !== pkColName) headers.push(k);
        }
        headers.push('created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted');
        sheet.appendRow(headers);
      } else {
        headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        
        // Auto-add any missing columns from the incoming record
        var addedMissingCol = false;
        for (var k in record) {
          if (headers.indexOf(k) === -1) {
            headers.push(k);
            addedMissingCol = true;
          }
        }
        if (addedMissingCol) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        }
      }
      
      // PK Generation
      var pkCol = headers[0];
      if (pkCol && pkPrefix) {
        record[pkCol] = generatePK(pkPrefix);
      }

      var now = getNowString();
      var user = getActiveUser();

      record['created_at'] = now.substring(1); // Store without quote in local object
      record['created_by'] = user;
      record['updated_at'] = now.substring(1);
      record['updated_by'] = user;
      record['is_deleted'] = false;

      var row = [];
      for (var i = 0; i < headers.length; i++) {
        if (headers[i] === 'created_at' || headers[i] === 'updated_at') {
          row.push(now); // Push with quote for Sheets
        } else {
          var rawVal = record[headers[i]] !== undefined ? record[headers[i]] : '';
          row.push(formatForSheet(rawVal));
        }
      }

      sheet.appendRow(row);
      
      // Audit trail
      if (typeof AuditService !== 'undefined') {
        AuditService.log('INSERT', tableName, record[pkCol] || 'NEW', null, JSON.stringify(record));
      }

      return record;
    },

    update: function(tableName, pkColumn, id, updateData) {
      var records = getAll(tableName);
      var record = null;
      for(var i=0; i<records.length; i++) {
        if (records[i][pkColumn] === id) {
          record = records[i];
          break;
        }
      }
      
      if (!record) throw new Error("Record not found");

      var sheet = getSheet(tableName);
      var headers = sheet.getDataRange().getValues()[0];
      
      var now = getNowString();
      var user = getActiveUser();

      updateData['updated_at'] = now.substring(1); // For local object
      updateData['updated_by'] = user;

      // Deep copy for audit
      var oldRecord = JSON.parse(JSON.stringify(record));

      for (var key in updateData) {
        if (updateData.hasOwnProperty(key)) {
          var colIdx = headers.indexOf(key);
          if (colIdx > -1) {
            var valToSave = (key === 'updated_at') ? now : formatForSheet(updateData[key]);
            sheet.getRange(record._rowIndex, colIdx + 1).setValue(valToSave);
            record[key] = updateData[key]; // Update local object
          }
        }
      }

      // Audit trail
      if (typeof AuditService !== 'undefined') {
        AuditService.log('UPDATE', tableName, id, JSON.stringify(oldRecord), JSON.stringify(record));
      }

      return record;
    },

    softDelete: function(tableName, pkColumn, id) {
      return this.update(tableName, pkColumn, id, { is_deleted: true });
    }
  };
})();

// One-off utility to fix sheet formatting
function runCleanup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) continue;
    
    var headers = data[0];
    
    for (var i = 1; i < data.length; i++) {
      for (var j = 0; j < headers.length; j++) {
        var val = data[i][j];
        
        // Fix Error cells (e.g., #ERROR! from +880...)
        if (val instanceof Error || (typeof val === 'string' && val.indexOf('#') === 0)) {
          var f = sheet.getRange(i + 1, j + 1).getFormula();
          if (f && f.startsWith('=+')) {
             val = "'" + f.substring(1);
             sheet.getRange(i + 1, j + 1).setValue(val);
             continue;
          }
        }
        
        // Fix ISO Strings
        if (typeof val === 'string' && val.length >= 20 && val.includes('T') && val.endsWith('Z')) {
          var d = new Date(val);
          if (!isNaN(d.getTime())) {
            if (headers[j] === 'created_at' || headers[j] === 'updated_at') {
              val = "'" + Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/d/yyyy H:mm:ss');
            } else {
              var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              var dStr = String(d.getDate());
              if (dStr.length === 1) dStr = '0' + dStr;
              val = "'" + dStr + '-' + months[d.getMonth()] + '-' + d.getFullYear();
            }
            sheet.getRange(i + 1, j + 1).setValue(val);
          }
        }
        
        // Fix Native Dates
        if (Object.prototype.toString.call(val) === '[object Date]') {
          if (headers[j] === 'created_at' || headers[j] === 'updated_at') {
            val = "'" + Utilities.formatDate(val, Session.getScriptTimeZone(), 'M/d/yyyy H:mm:ss');
          } else {
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var dStr = String(val.getDate());
            if (dStr.length === 1) dStr = '0' + dStr;
            val = "'" + dStr + '-' + months[val.getMonth()] + '-' + val.getFullYear();
          }
          sheet.getRange(i + 1, j + 1).setValue(val);
        }
      }
    }
  }
}
