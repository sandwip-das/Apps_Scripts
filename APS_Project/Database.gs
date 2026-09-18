/**
 * Enterprise Database Service (DAO)
 * Handles CRUD operations, primary key generation, soft deletes, and injects audit fields.
 */

var Database = (function() {
  var ss = null;
  var sheetCache = {};
  var memoryDataCache = {};

  function getActiveSpreadsheet() {
    if (!ss) {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    }
    return ss;
  }

  var dateMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var dateMonthsLower = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

  function isDateColumn(colName) {
    if (!colName) return false;
    var c = String(colName).toLowerCase();
    if (c === 'created_at' || c === 'created_by' || c === 'updated_at' || c === 'updated_by' || c === 'is_deleted') {
      return false;
    }
    return c === 'dob' || c.endsWith('_date') || c.endsWith('_from') || c.endsWith('_to') || c === 'date';
  }

  function formatDateDDMmmYYYY(val) {
    if (!val || val === '-' || val === 'null' || val === 'undefined') return '';
    var d = null;
    if (Object.prototype.toString.call(val) === '[object Date]') {
      d = val;
    } else if (typeof val === 'number') {
      if (val >= 10000000 && val <= 99999999) {
        var sNum = String(val);
        var dNum = parseInt(sNum.substring(0, 2), 10);
        var mNum = parseInt(sNum.substring(2, 4), 10) - 1;
        var yNum = parseInt(sNum.substring(4, 8), 10);
        d = new Date(yNum, mNum, dNum);
      } else if (val > 10000 && val < 100000) {
        var ms = Math.round((val - 25569) * 86400 * 1000);
        d = new Date(ms);
      }
    } else if (typeof val === 'string') {
      var s = val.trim();
      if (s.startsWith("'")) s = s.substring(1).trim();
      if (!s || s === '-') return '';
      // 8-digit DDMMYYYY
      if (/^\d{8}$/.test(s)) {
        var day = parseInt(s.substring(0, 2), 10);
        var month = parseInt(s.substring(2, 4), 10) - 1;
        var year = parseInt(s.substring(4, 8), 10);
        d = new Date(year, month, day);
      } else if (/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{4})$/.test(s)) {
        var m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{4})$/);
        var day = parseInt(m[1], 10);
        var monthStr = m[2].toLowerCase();
        var year = parseInt(m[3], 10);
        var mIdx = dateMonthsLower.indexOf(monthStr);
        if (mIdx !== -1) {
          d = new Date(year, mIdx, day);
        }
      } else {
        var parsed = new Date(s);
        if (!isNaN(parsed.getTime())) {
          d = parsed;
        }
      }
    }
    if (!d || isNaN(d.getTime())) return String(val);
    var dStr = String(d.getDate());
    if (dStr.length === 1) dStr = '0' + dStr;
    return dStr + ' ' + dateMonths[d.getMonth()] + ' ' + d.getFullYear();
  }

  function formatForSheet(val, colName) {
    if (val === null || val === undefined) return '';

    // If it's a date column (excluding system-generated timestamp fields)
    if (colName && isDateColumn(colName)) {
      var fDate = formatDateDDMmmYYYY(val);
      return fDate ? "'" + fDate : '';
    }

    if (Object.prototype.toString.call(val) === '[object Date]') {
      if (colName === 'created_at' || colName === 'updated_at') {
        return Utilities.formatDate(val, Session.getScriptTimeZone(), "M/d/yyyy H:mm:ss");
      }
      var fDate = formatDateDDMmmYYYY(val);
      return fDate ? "'" + fDate : '';
    }

    if (typeof val === 'string') {
      var trimmed = val.trim();
      // Normalize phone number if it has + or starts with country code
      if (trimmed.startsWith('+')) {
        return '+' + trimmed.substring(1).replace(/[^0-9]/g, '');
      }
      if (colName && isDateColumn(colName)) {
        var fDate = formatDateDDMmmYYYY(trimmed);
        return fDate ? "'" + fDate : trimmed;
      }
      return trimmed;
    }
    return val;
  }

  function getNowString() {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "M/d/yyyy H:mm:ss");
  }

  function getSheet(tableName) {
    if (sheetCache[tableName]) return sheetCache[tableName];
    var activeSS = getActiveSpreadsheet();
    var sheet = activeSS.getSheetByName(tableName);
    if (!sheet) {
      sheet = activeSS.insertSheet(tableName);
    }
    sheetCache[tableName] = sheet;
    return sheet;
  }

  function generatePK(prefix) {
    var num = Math.floor(100000 + Math.random() * 900000);
    return prefix + '-' + num;
  }

  function getActiveUser() {
    return Session.getActiveUser().getEmail() || 'System';
  }

  function syncTableHeaders(sheet, tableName, headers) {
    if (tableName === 'employees') {
      var desigIdx = headers.indexOf('designation_short');
      var firstPgIdx = headers.indexOf('pg_id');
      var lastPgIdx = headers.lastIndexOf('pg_id');

      // Case 1: Sheet only has designation_short (no pg_id) -> Rename header cell to pg_id
      if (desigIdx > -1 && firstPgIdx === -1) {
        headers[desigIdx] = 'pg_id';
        try {
          sheet.getRange(1, desigIdx + 1).setValue('pg_id');
        } catch (e) {
          console.warn('Could not rename header cell in sheet:', e);
        }
      } 
      // Case 2: Sheet has both designation_short AND an appended pg_id column
      else if (desigIdx > -1 && firstPgIdx > -1 && desigIdx !== firstPgIdx) {
        try {
          var lastRow = sheet.getLastRow();
          if (lastRow > 1) {
            var desigColVals = sheet.getRange(2, desigIdx + 1, lastRow - 1, 1).getValues();
            var pgColVals = sheet.getRange(2, firstPgIdx + 1, lastRow - 1, 1).getValues();
            var mergedVals = [];
            for (var r = 0; r < desigColVals.length; r++) {
              var v = pgColVals[r][0] !== '' && pgColVals[r][0] !== undefined ? pgColVals[r][0] : desigColVals[r][0];
              mergedVals.push([v]);
            }
            sheet.getRange(2, desigIdx + 1, lastRow - 1, 1).setValues(mergedVals);
          }
          sheet.getRange(1, desigIdx + 1).setValue('pg_id');
          sheet.deleteColumn(firstPgIdx + 1);
          headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        } catch (e) {
          console.warn('Error merging duplicate columns:', e);
          headers[desigIdx] = 'pg_id';
        }
      } 
      // Case 3: Two duplicate pg_id columns exist
      else if (firstPgIdx > -1 && lastPgIdx > -1 && firstPgIdx !== lastPgIdx) {
        try {
          var lastRow = sheet.getLastRow();
          if (lastRow > 1) {
            var firstColVals = sheet.getRange(2, firstPgIdx + 1, lastRow - 1, 1).getValues();
            var lastColVals = sheet.getRange(2, lastPgIdx + 1, lastRow - 1, 1).getValues();
            var mergedVals = [];
            for (var r = 0; r < firstColVals.length; r++) {
              var v = firstColVals[r][0] !== '' && firstColVals[r][0] !== undefined ? firstColVals[r][0] : lastColVals[r][0];
              mergedVals.push([v]);
            }
            sheet.getRange(2, firstPgIdx + 1, lastRow - 1, 1).setValues(mergedVals);
          }
          sheet.deleteColumn(lastPgIdx + 1);
          headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        } catch (e) {
          console.warn('Error cleaning duplicate pg_id column:', e);
        }
      }
    }
    return headers;
  }

  /**
   * High-Performance Server-Side CacheService Layer
   * Stores JSON serialized data in Google's high-speed memory cache across executions.
   * Includes automatic chunking to bypass Google's 100KB per-key limit.
   */
  var ServerCache = {
    CHUNK_SIZE: 90000, // 90KB per chunk to safely stay under Google's 100KB limit
    MAX_TTL: 21600,    // 6 hours in seconds

    get: function(key) {
      try {
        if (typeof CacheService === 'undefined' || !CacheService.getScriptCache) return null;
        var cache = CacheService.getScriptCache();
        var metaStr = cache.get('meta_' + key);
        if (!metaStr) return null;
        var meta = JSON.parse(metaStr);
        if (!meta || !meta.chunks) return null;

        var fullStr = '';
        if (meta.chunks === 1) {
          fullStr = cache.get(key + '_0');
        } else {
          var chunkKeys = [];
          for (var i = 0; i < meta.chunks; i++) {
            chunkKeys.push(key + '_' + i);
          }
          var chunkMap = cache.getAll(chunkKeys);
          for (var j = 0; j < meta.chunks; j++) {
            var piece = chunkMap[key + '_' + j];
            if (piece === undefined || piece === null) return null;
            fullStr += piece;
          }
        }
        return fullStr ? JSON.parse(fullStr) : null;
      } catch (e) {
        console.warn('ServerCache.get failed for ' + key + ':', e);
        return null;
      }
    },

    put: function(key, data, ttlSeconds) {
      try {
        if (typeof CacheService === 'undefined' || !CacheService.getScriptCache) return;
        var cache = CacheService.getScriptCache();
        var jsonStr = JSON.stringify(data);
        var ttl = ttlSeconds || this.MAX_TTL;
        var chunks = Math.ceil(jsonStr.length / this.CHUNK_SIZE) || 1;

        var entries = {};
        for (var i = 0; i < chunks; i++) {
          entries[key + '_' + i] = jsonStr.substring(i * this.CHUNK_SIZE, (i + 1) * this.CHUNK_SIZE);
        }
        entries['meta_' + key] = JSON.stringify({ chunks: chunks, timestamp: new Date().getTime() });
        cache.putAll(entries, ttl);
      } catch (e) {
        console.warn('ServerCache.put failed for ' + key + ':', e);
      }
    },

    remove: function(key) {
      try {
        if (typeof CacheService === 'undefined' || !CacheService.getScriptCache) return;
        var cache = CacheService.getScriptCache();
        var metaStr = cache.get('meta_' + key);
        var keysToRemove = ['meta_' + key];
        if (metaStr) {
          try {
            var meta = JSON.parse(metaStr);
            for (var i = 0; i < (meta.chunks || 10); i++) {
              keysToRemove.push(key + '_' + i);
            }
          } catch (e2) {}
        } else {
          for (var k = 0; k < 5; k++) {
            keysToRemove.push(key + '_' + k);
          }
        }
        cache.removeAll(keysToRemove);
      } catch (e) {
        console.warn('ServerCache.remove failed for ' + key + ':', e);
      }
    }
  };

  function getAll(tableName, forceRefresh) {
    if (!forceRefresh) {
      // 1. Check in-memory execution cache
      if (memoryDataCache[tableName]) {
        return memoryDataCache[tableName];
      }

      // 2. Check high-speed ServerCache (CacheService across executions)
      var cached = ServerCache.get('tbl_' + tableName);
      if (cached && Array.isArray(cached)) {
        memoryDataCache[tableName] = cached;
        return cached;
      }
    }

    // 3. Fallback to Google Sheets (Cache Miss)
    var sheet = getSheet(tableName);
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      memoryDataCache[tableName] = [];
      ServerCache.put('tbl_' + tableName, [], 21600);
      return [];
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      memoryDataCache[tableName] = [];
      ServerCache.put('tbl_' + tableName, [], 21600);
      return [];
    }

    var headers = data[0];
    headers = syncTableHeaders(sheet, tableName, headers);
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
              val = formatDateDDMmmYYYY(val);
            }
          } else if (typeof val === 'string') {
            if (val.startsWith("'")) {
              val = val.substring(1);
            }
            if (isDateColumn(headers[j])) {
              val = formatDateDDMmmYYYY(val);
            }
          } else if (typeof val === 'number' && isDateColumn(headers[j])) {
            val = formatDateDDMmmYYYY(val);
          }
          record[headers[j]] = val;
        }

        // Backward compatibility for employees: if pg_id is not set but designation_short is
        if (tableName === 'employees') {
          if (!record.pg_id && record.designation_short) {
            record.pg_id = record.designation_short;
          }
        }

        record._rowIndex = i + 1;
        records.push(record);
      }
    }
    memoryDataCache[tableName] = records;
    ServerCache.put('tbl_' + tableName, records, 21600);
    return records;
  }

  function invalidateCache(tableName) {
    if (tableName) {
      delete memoryDataCache[tableName];
      ServerCache.remove('tbl_' + tableName);
    } else {
      memoryDataCache = {};
    }

    // Always invalidate derived high-level caches
    ServerCache.remove('cache_hrm_details');
    ServerCache.remove('cache_master_data');
    ServerCache.remove('cache_airline_analytics');
  }

  return {
    getAll: getAll,
    invalidateCache: invalidateCache,
    ServerCache: ServerCache,

    getById: function(tableName, pkColumn, id) {

      var records = getAll(tableName);
      for (var i = 0; i < records.length; i++) {
        if (records[i][pkColumn] === id) return records[i];
      }
      return null;
    },

    insert: function(tableName, record, pkPrefix, pkColName) {
      var sheet = getSheet(tableName);
      var lastCol = sheet.getLastColumn();
      var headers = [];
      
      if (lastCol === 0) {
        if (pkColName) headers.push(pkColName);
        for (var k in record) {
          if (k !== pkColName) headers.push(k);
        }
        headers.push('created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted');
        sheet.appendRow(headers);
      } else {
        headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        headers = syncTableHeaders(sheet, tableName, headers);
        
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
      
      var pkCol = headers[0];
      if (pkCol && pkPrefix && !record[pkCol]) {
        record[pkCol] = generatePK(pkPrefix);
      }

      var now = getNowString();
      var user = getActiveUser();

      record['created_at'] = now;
      record['created_by'] = user;
      record['updated_at'] = now;
      record['updated_by'] = user;
      record['is_deleted'] = false;

      var row = [];
      for (var i = 0; i < headers.length; i++) {
        var rawVal = record[headers[i]] !== undefined ? record[headers[i]] : '';
        row.push(formatForSheet(rawVal, headers[i]));
      }

      sheet.appendRow(row);
      invalidateCache(tableName);
      
      if (typeof AuditService !== 'undefined') {
        AuditService.log('INSERT', tableName, record[pkCol] || 'NEW', null, JSON.stringify(record));
      }

      return record;
    },

    insertBatch: function(tableName, records, pkPrefix, pkColName) {
      if (!records || records.length === 0) return [];
      var sheet = getSheet(tableName);
      var lastCol = sheet.getLastColumn();
      var headers = [];
      
      if (lastCol === 0) {
        if (pkColName) headers.push(pkColName);
        for (var k in records[0]) {
          if (k !== pkColName) headers.push(k);
        }
        headers.push('created_at', 'created_by', 'updated_at', 'updated_by', 'is_deleted');
        sheet.appendRow(headers);
      } else {
        headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        headers = syncTableHeaders(sheet, tableName, headers);
      }

      var pkCol = headers[0];
      var now = getNowString();
      var user = getActiveUser();
      var rowsToAppend = [];

      for (var r = 0; r < records.length; r++) {
        var record = records[r];
        if (pkCol && pkPrefix && !record[pkCol]) {
          record[pkCol] = generatePK(pkPrefix);
        }
        record['created_at'] = now;
        record['created_by'] = user;
        record['updated_at'] = now;
        record['updated_by'] = user;
        record['is_deleted'] = false;

        var row = [];
        for (var i = 0; i < headers.length; i++) {
          var rawVal = record[headers[i]] !== undefined ? record[headers[i]] : '';
          row.push(formatForSheet(rawVal, headers[i]));
        }
        rowsToAppend.push(row);
      }

      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
      invalidateCache(tableName);

      if (typeof AuditService !== 'undefined') {
        AuditService.log('INSERT_BATCH', tableName, 'BATCH_' + records.length, null, 'Inserted ' + records.length + ' rows');
      }

      return records;
    },

    update: function(tableName, pkColumn, id, updateData) {
      var records = getAll(tableName);
      var record = null;
      for (var i = 0; i < records.length; i++) {
        if (records[i][pkColumn] === id) {
          record = records[i];
          break;
        }
      }
      
      if (!record) throw new Error("Record not found");

      var sheet = getSheet(tableName);
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      headers = syncTableHeaders(sheet, tableName, headers);
      
      var now = getNowString();
      var user = getActiveUser();

      updateData['updated_at'] = now;
      updateData['updated_by'] = user;

      var oldRecord = JSON.parse(JSON.stringify(record));

      // Fetch entire existing row to update in batch
      var existingRowRange = sheet.getRange(record._rowIndex, 1, 1, headers.length);
      var rowValues = existingRowRange.getValues()[0];

      for (var key in updateData) {
        if (updateData.hasOwnProperty(key)) {
          var colIdx = headers.indexOf(key);
          if (colIdx > -1) {
            var valToSave = formatForSheet(updateData[key], key);
            rowValues[colIdx] = valToSave;
            record[key] = (isDateColumn(key) && valToSave) ? formatDateDDMmmYYYY(updateData[key]) : updateData[key];
          }
        }
      }

      // Single batch write for the entire updated row
      existingRowRange.setValues([rowValues]);
      invalidateCache(tableName);

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
              val = "'" + formatDateDDMmmYYYY(d);
            }
            sheet.getRange(i + 1, j + 1).setValue(val);
          }
        }
        
        // Fix Native Dates
        if (Object.prototype.toString.call(val) === '[object Date]') {
          if (headers[j] === 'created_at' || headers[j] === 'updated_at') {
            val = "'" + Utilities.formatDate(val, Session.getScriptTimeZone(), 'M/d/yyyy H:mm:ss');
          } else {
            val = "'" + formatDateDDMmmYYYY(val);
          }
          sheet.getRange(i + 1, j + 1).setValue(val);
        }
      }
    }
  }
}
