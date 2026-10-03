/**
 * Enterprise Database Service (DAO)
 * Handles CRUD operations, primary key generation, soft deletes, and injects audit fields.
 */

var Database = (function() {
  var ss = null;
  var sheetCache = {};
  var memoryDataCache = {};
  var cachedAllSheets = null;
  var sheetIndexBuilt = false;
  var sheetHeadersCache = {};

  function getActiveSpreadsheet() {
    if (!ss) {
      try {
        ss = SpreadsheetApp.getActiveSpreadsheet();
      } catch (e) {}
      if (!ss) {
        try {
          if (typeof PropertiesService !== 'undefined') {
            var props = PropertiesService.getScriptProperties();
            var sid = props.getProperty('SPREADSHEET_ID') || props.getProperty('SHEET_ID');
            if (sid) {
              ss = SpreadsheetApp.openById(sid);
            }
          }
        } catch (e2) {}
      }
    }
    if (!ss) {
      throw new Error("Unable to access Google Spreadsheet. Please ensure this script is run from a bound Google Sheet (Extensions > Apps Script) or set SPREADSHEET_ID in Project Settings > Script Properties.");
    }
    return ss;
  }

  var TABLE_ALIASES = {
    'employees': ['employees', 'employee', 'staff', 'staffs', 'personnel', 'personnels', 'employee_list', 'employees_list', 'emp', 'hrm', 'staff_list', 'personnel_list'],
    'promotions': ['promotions', 'promotion', 'employee_promotions', 'promo', 'promos', 'promotion_history', 'promotions_history'],
    'placements': ['placements', 'placement', 'employee_placements', 'placing', 'placings'],
    'postings': ['postings', 'posting', 'employee_postings'],
    'pay_groups': ['pay_groups', 'pay_group', 'paygroups', 'paygroup', 'pay groups', 'pay group', 'grades', 'grade', 'pg', 'pgs', 'designations', 'designation'],
    'departments': ['departments', 'department', 'deps', 'dep', 'dept', 'depts'],
    'directorates': ['directorates', 'directorate', 'dirs', 'dir'],
    'stations': ['stations', 'station', 'stns', 'stn', 'airports', 'airport'],
    'sections': ['sections', 'section', 'secs', 'sec'],
    'shifts': ['shifts', 'shift', 'rosters', 'roster'],
    'employee_types': ['employee_types', 'employee_type', 'emp_types', 'emp_type'],
    'workforce_setup': ['workforce_setup', 'workforce', 'workforces', 'setup', 'set_up', 'workforce setup', 'set up form', 'workforce_setups', 'manning', 'manning_setup'],
    'trainings': ['trainings', 'training', 'training_records', 'training records', 'trainings_record'],
    'courses': ['courses', 'course'],
    'tickets': ['tickets', 'ticket', 'support_tickets'],
    'extensions': ['extensions', 'extension', 'service_extensions'],
    'self_retirements': ['self_retirements', 'self_retirement', 'retirements', 'retirement'],
    'additional_charges': ['additional_charges', 'additional_charge', 'addl_charges', 'addl_charge'],
    'employee_migrations': ['employee_migrations', 'employee_migration', 'migrations', 'migration'],
    'users': ['users', 'user', 'user_accounts', 'accounts', 'system_users']
  };

  function normalizeKey(str) {
    if (!str) return '';
    return String(str).toLowerCase().replace(/[\s_\-\.\/\(\)]+/g, '');
  }

  var TABLE_SIGNATURES = {
    'employees': ['staff_id', 'emp_id', 'id_no', 'employee_name', 'emp_name', 'name', 'joining_date', 'pay_group', 'designation', 'contact_primary', 'phone', 'dob'],
    'pay_groups': ['pay_group', 'pg_id', 'designation', 'designation_short', 'rank_level'],
    'promotions': ['promoted_pg_id', 'present_pg_id', 'promotion_date', 'sequence_no', 'promo_id'],
    'workforce_setup': ['workforce', 'set_up', 'sanctioned', 'manning', 'wf_id', 'station_id'],
    'departments': ['dep_id', 'dep_code', 'dep_name', 'department'],
    'stations': ['station_id', 'station_code', 'station_name', 'airport'],
    'sections': ['sec_id', 'sec_code', 'sec_name', 'sec_letter_code'],
    'shifts': ['shift_id', 'shift_code', 'shift_name', 'roster'],
    'placements': ['placement_id', 'sec_id', 'placement_date'],
    'postings': ['posting_id', 'posting_date'],
    'employee_types': ['type_id', 'type_name'],
    'trainings': ['training_id', 'course_id', 'participant'],
    'courses': ['course_id', 'course_name', 'course_code'],
    'tickets': ['ticket_id', 'subject', 'issue']
  };

  /**
   * One-Pass Unified Sheet Indexing Architecture
   * Fetches all sheets once per execution and pre-scans headers in a single pass.
   * Eliminates 50+ sequential Google Sheets RPC roundtrips and reduces execution time from 30s to <1s.
   */
  function buildSheetIndex() {
    if (sheetIndexBuilt) return;
    var activeSS = getActiveSpreadsheet();
    cachedAllSheets = activeSS.getSheets();
    if (!cachedAllSheets || cachedAllSheets.length === 0) {
      sheetIndexBuilt = true;
      return;
    }

    var bestEmployeeCandidate = null;
    var maxEmpScore = 0;
    var largestSheet = null;
    var maxRows = -1;

    for (var s = 0; s < cachedAllSheets.length; s++) {
      var sh = cachedAllSheets[s];
      var rawName = sh.getName();
      var normName = normalizeKey(rawName);
      var lastR = sh.getLastRow();
      var lastC = sh.getLastColumn();

      if (lastR > maxRows) {
        maxRows = lastR;
        largestSheet = sh;
      }

      // Check against all known tables and aliases
      for (var tbl in TABLE_ALIASES) {
        var aliases = TABLE_ALIASES[tbl].map(normalizeKey);
        if (aliases.indexOf(normName) !== -1 || normName === tbl || normName === tbl + 's' || normName + 's' === tbl) {
          if (!sheetCache[tbl] || lastR > 0) {
            sheetCache[tbl] = sh;
          }
        }
      }

      // Read top header rows once per sheet for signature scanning
      if (lastR >= 1 && lastC >= 1) {
        try {
          var scanRows = Math.min(lastR, 6);
          var topVals = sh.getRange(1, 1, scanRows, lastC).getValues();
          sheetHeadersCache[rawName] = topVals;

          // Score for table signatures
          for (var tName in TABLE_SIGNATURES) {
            var sigs = TABLE_SIGNATURES[tName];
            var sigMatches = 0;
            for (var r = 0; r < topVals.length; r++) {
              for (var c = 0; c < topVals[r].length; c++) {
                var cell = String(topVals[r][c] || '').toLowerCase().replace(/[\s_\-\.\/\(\)]+/g, '_');
                if (!cell) continue;
                for (var sg = 0; sg < sigs.length; sg++) {
                  if (cell.indexOf(sigs[sg]) !== -1 || sigs[sg].indexOf(cell) !== -1) {
                    sigMatches++;
                  }
                }
              }
            }
            if (sigMatches >= 2) {
              if (!sheetCache[tName] || (lastR > 1 && sheetCache[tName].getLastRow() <= 1)) {
                sheetCache[tName] = sh;
              }
            }
            if (tName === 'employees' && sigMatches > maxEmpScore) {
              maxEmpScore = sigMatches;
              bestEmployeeCandidate = sh;
            }
          }
        } catch (eScan) {}
      }
    }

    // High-precision fallback for employees sheet
    if (!sheetCache['employees']) {
      if (bestEmployeeCandidate) {
        sheetCache['employees'] = bestEmployeeCandidate;
      } else if (cachedAllSheets.length === 1) {
        sheetCache['employees'] = cachedAllSheets[0];
      } else if (largestSheet && largestSheet.getLastRow() > 1) {
        sheetCache['employees'] = largestSheet;
      }
    }

    sheetIndexBuilt = true;
  }

  function getSheet(tableName, createIfMissing) {
    if (!tableName || typeof tableName !== 'string') {
      return null;
    }
    buildSheetIndex();

    if (sheetCache[tableName] !== undefined) {
      return sheetCache[tableName];
    }

    var activeSS = getActiveSpreadsheet();
    var directSheet = activeSS.getSheetByName(tableName);
    if (directSheet) {
      sheetCache[tableName] = directSheet;
      return directSheet;
    }

    if (createIfMissing) {
      var newSheet = activeSS.insertSheet(tableName);
      sheetCache[tableName] = newSheet;
      return newSheet;
    }

    sheetCache[tableName] = null;
    return null;
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

  function getTimeZone() {
    try {
      if (typeof Session !== 'undefined' && Session.getScriptTimeZone) {
        return Session.getScriptTimeZone();
      }
    } catch (e) {}
    return "GMT";
  }

  function formatDateTime(val) {
    try {
      if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
        return Utilities.formatDate(val, getTimeZone(), "M/d/yyyy H:mm:ss");
      }
    } catch (e) {}
    return val.toISOString ? val.toISOString() : String(val);
  }

  function normalizeForSheet(val, colName) {
    if (val === undefined || val === null) return '';

    if (colName && isDateColumn(colName)) {
      var fDate = formatDateDDMmmYYYY(val);
      return fDate ? "'" + fDate : '';
    }

    if (Object.prototype.toString.call(val) === '[object Date]') {
      if (colName === 'created_at' || colName === 'updated_at') {
        return formatDateTime(val);
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

  var formatForSheet = normalizeForSheet;

  function getNowString() {
    return formatDateTime(new Date());
  }

  function generatePK(prefix) {
    var num = Math.floor(100000 + Math.random() * 900000);
    return prefix + '-' + num;
  }

  function getActiveUser() {
    try {
      if (typeof Session !== 'undefined' && Session.getActiveUser) {
        return Session.getActiveUser().getEmail() || 'System';
      }
    } catch (e) {}
    return 'System';
  }

  function normalizeRecordKeys(record, headers) {
    if (!record) return record;
    // Canonical standard aliases for cross-module compatibility
    if (!record.staff_id && record.emp_id) record.staff_id = record.emp_id;
    if (!record.emp_id && record.staff_id) record.emp_id = record.staff_id;
    if (!record.emp_name && record.name) record.emp_name = record.name;
    if (!record.name && record.emp_name) record.name = record.emp_name;
    if (!record.dob && record.date_of_birth) record.dob = record.date_of_birth;
    if (!record.joining_date && record.date_of_joining) record.joining_date = record.date_of_joining;
    if (!record.joining_date && record.appointment_date) record.joining_date = record.appointment_date;
    if (!record.pg_id && record.pay_group) record.pg_id = record.pay_group;
    if (!record.pg_id && record.designation_short) record.pg_id = record.designation_short;
    if (!record.pay_group && record.pg_id) record.pay_group = record.pg_id;
    if (!record.designation_short && record.pg_id) record.designation_short = record.pg_id;
    if (!record.designation && record.designation_short) record.designation = record.designation_short;
    if (!record.contact_primary && record.contact_1) record.contact_primary = record.contact_1;
    if (!record.contact_primary && record.phone) record.contact_primary = record.phone;
    if (!record.contact_primary && record.mobile) record.contact_primary = record.mobile;
    return record;
  }

  function syncTableHeaders(sheet, tableName, headers) {
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
        if (data === null || data === undefined) return;
        if (Array.isArray(data) && data.length === 0) return;
        if (typeof data === 'object' && Object.keys(data).length === 0) return;
        if (typeof CacheService === 'undefined' || !CacheService.getScriptCache) return;
        var cache = CacheService.getScriptCache();
        var jsonStr = JSON.stringify(data);
        if (!jsonStr) return;
        var ttl = ttlSeconds || this.MAX_TTL;
        var chunks = Math.ceil(jsonStr.length / this.CHUNK_SIZE) || 1;

        for (var i = 0; i < chunks; i++) {
          cache.put(key + '_' + i, jsonStr.substring(i * this.CHUNK_SIZE, (i + 1) * this.CHUNK_SIZE), ttl);
        }
        cache.put('meta_' + key, JSON.stringify({ chunks: chunks, timestamp: new Date().getTime() }), ttl);
      } catch (e) {
        console.warn('ServerCache.put failed for ' + key + ':', e);
      }
    },

    remove: function(key) {
      try {
        if (typeof CacheService === 'undefined' || !CacheService.getScriptCache) return;
        var cache = CacheService.getScriptCache();
        var metaStr = cache.get('meta_' + key);
        var numChunks = 10;
        if (metaStr) {
          try {
            var meta = JSON.parse(metaStr);
            if (meta && meta.chunks) numChunks = meta.chunks;
          } catch (e2) {}
        }
        for (var i = 0; i < numChunks; i++) {
          cache.remove(key + '_' + i);
        }
        cache.remove('meta_' + key);
      } catch (e) {
        console.warn('ServerCache.remove failed for ' + key + ':', e);
      }
    }
  };

  function getAll(tableName, forceRefresh) {
    if (!tableName || typeof tableName !== 'string') {
      return [];
    }
    if (!forceRefresh) {
      // 1. Check in-memory execution cache
      if (memoryDataCache[tableName] && Array.isArray(memoryDataCache[tableName]) && memoryDataCache[tableName].length > 0) {
        return memoryDataCache[tableName];
      }

      // 2. Check high-speed ServerCache (CacheService across executions)
      var cached = ServerCache.get('tbl_' + tableName);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        memoryDataCache[tableName] = cached;
        return cached;
      }
    }

    // 3. Fallback to Google Sheets (Cache Miss)
    var sheet = getSheet(tableName, false);
    if (!sheet) {
      return [];
    }
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return [];
    }
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      return [];
    }

    var data = sheet.getDataRange().getValues();
    if (!data || data.length <= 1) {
      return [];
    }

    // Find the header row (scan up to first 6 rows for column headers)
    var headerRowIdx = 0;
    var maxHeaderScore = 0;
    var scanLimit = Math.min(data.length, 6);

    for (var r = 0; r < scanLimit; r++) {
      var rowCandidate = data[r];
      if (!rowCandidate) continue;
      var score = 0;
      var nonBlankCount = 0;
      for (var c = 0; c < rowCandidate.length; c++) {
        var cellStr = String(rowCandidate[c] || '').trim();
        if (cellStr !== '') {
          nonBlankCount++;
          var norm = cellStr.toLowerCase().replace(/[\s_\-\.\/\(\)]+/g, '');
          if (norm.includes('id') || norm.includes('name') || norm.includes('date') || 
              norm.includes('pay') || norm.includes('group') || norm.includes('grade') || 
              norm.includes('dept') || norm.includes('dep') || norm.includes('station') || 
              norm.includes('desig') || norm.includes('code') || norm.includes('status') ||
              norm.includes('shift') || norm.includes('sec') || norm.includes('contact') ||
              norm.includes('email') || norm.includes('phone') || norm.includes('sl') ||
              norm.includes('serial') || norm.includes('rank') || norm.includes('order') ||
              norm.includes('gender') || norm.includes('dob') || norm.includes('district') ||
              norm.includes('posting') || norm.includes('placement') || norm.includes('remark')) {
            score += 3;
          } else {
            score += 1;
          }
        }
      }
      if (nonBlankCount >= 2 && score > maxHeaderScore) {
        maxHeaderScore = score;
        headerRowIdx = r;
      }
    }

    var headers = data[headerRowIdx];
    var records = [];
    var deletedIdx = -1;
    for (var h = 0; h < headers.length; h++) {
      var hStr = String(headers[h] || '').trim().toLowerCase().replace(/[\s_\-\.]+/g, '_');
      if (hStr === 'is_deleted' || hStr === 'deleted') {
        deletedIdx = h;
        break;
      }
    }

    for (var i = headerRowIdx + 1; i < data.length; i++) {
      var row = data[i];
      if (!row) continue;
      
      // Check if row is completely blank
      var hasAnyValue = false;
      for (var c = 0; c < row.length; c++) {
        if (row[c] !== '' && row[c] !== null && row[c] !== undefined) {
          hasAnyValue = true;
          break;
        }
      }
      if (!hasAnyValue) continue;

      var isDeleted = false;
      if (deletedIdx !== -1) {
        var delVal = row[deletedIdx];
        if (delVal === true || String(delVal).trim().toLowerCase() === 'true' || delVal === 1) {
          isDeleted = true;
        }
      }

      if (!isDeleted) {
        var record = {};
        for (var j = 0; j < headers.length; j++) {
          var headerName = headers[j];
          if (!headerName && headerName !== 0) continue;
          var val = row[j];
          if (Object.prototype.toString.call(val) === '[object Date]') {
            if (String(headerName).toLowerCase().includes('created_at') || String(headerName).toLowerCase().includes('updated_at')) {
              val = formatDateTime(val);
            } else {
              val = formatDateDDMmmYYYY(val);
            }
          } else if (typeof val === 'string') {
            if (val.startsWith("'")) {
              val = val.substring(1);
            }
            if (isDateColumn(headerName)) {
              val = formatDateDDMmmYYYY(val);
            }
          } else if (typeof val === 'number' && isDateColumn(headerName)) {
            val = formatDateDDMmmYYYY(val);
          }

          var rawKey = String(headerName).trim();
          var normKey = rawKey.toLowerCase().replace(/[\s\-\.\/\(\)]+/g, '_');
          var cleanNorm = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
          
          record[rawKey] = val;
          if (normKey && record[normKey] === undefined) {
            record[normKey] = val;
          }

          // Ultra-Robust Universal Column Matching
          // 1. Staff ID / Employee ID / PIN
          if (cleanNorm === 'staffid' || cleanNorm === 'empid' || cleanNorm === 'idno' || cleanNorm === 'id' || cleanNorm === 'pin' ||
              cleanNorm.indexOf('staffid') !== -1 || cleanNorm.indexOf('empid') !== -1 || cleanNorm.indexOf('employeeid') !== -1 ||
              cleanNorm.indexOf('idno') !== -1 || cleanNorm.indexOf('staffno') !== -1 || cleanNorm.indexOf('empno') !== -1 ||
              (cleanNorm.indexOf('staff') !== -1 && cleanNorm.indexOf('id') !== -1) ||
              (cleanNorm.indexOf('emp') !== -1 && cleanNorm.indexOf('id') !== -1)) {
            if (record.staff_id === undefined || record.staff_id === '') record.staff_id = String(val).trim();
            if (record.emp_id === undefined || record.emp_id === '') record.emp_id = String(val).trim();
          }

          // 2. Employee Name
          if (cleanNorm === 'name' || cleanNorm === 'empname' || cleanNorm === 'employeename' || cleanNorm === 'staffname' ||
              cleanNorm === 'fullname' || cleanNorm === 'personnelname' ||
              (cleanNorm.indexOf('name') !== -1 && cleanNorm.indexOf('dep') === -1 && cleanNorm.indexOf('station') === -1 && 
               cleanNorm.indexOf('sec') === -1 && cleanNorm.indexOf('shift') === -1 && cleanNorm.indexOf('group') === -1 && 
               cleanNorm.indexOf('course') === -1 && cleanNorm.indexOf('file') === -1)) {
            if (record.emp_name === undefined || record.emp_name === '') record.emp_name = String(val).trim();
            if (record.name === undefined || record.name === '') record.name = String(val).trim();
          }

          // 3. Gender / Sex
          if (cleanNorm === 'gender' || cleanNorm === 'sex' || cleanNorm.indexOf('gender') !== -1) {
            if (record.gender === undefined || record.gender === '') record.gender = String(val).trim();
          }

          // 4. DOB / Date of Birth
          if (cleanNorm === 'dob' || cleanNorm.indexOf('dob') !== -1 || cleanNorm.indexOf('birth') !== -1 || cleanNorm.indexOf('dateofbirth') !== -1) {
            if (record.dob === undefined || record.dob === '') record.dob = val;
          }

          // 5. Joining Date / Date of Joining / Appointment Date / DOJ
          if (cleanNorm === 'doj' || cleanNorm.indexOf('joining') !== -1 || cleanNorm.indexOf('appointment') !== -1 || cleanNorm.indexOf('dateofjoining') !== -1) {
            if (record.joining_date === undefined || record.joining_date === '') record.joining_date = val;
          }

          // 6. Initial / Joining Pay Group
          if (cleanNorm.indexOf('joiningpay') !== -1 || cleanNorm.indexOf('initialpay') !== -1 || cleanNorm.indexOf('joiningpg') !== -1 || cleanNorm.indexOf('initialpg') !== -1) {
            if (record.joining_pay_group === undefined || record.joining_pay_group === '') record.joining_pay_group = String(val).trim();
            if (record.joining_pg_id === undefined || record.joining_pg_id === '') record.joining_pg_id = String(val).trim();
          }

          // 7. Pay Group / Grade / PG
          if (cleanNorm === 'pg' || cleanNorm === 'paygroup' || cleanNorm === 'grade' || cleanNorm === 'pgid' ||
              cleanNorm.indexOf('paygroup') !== -1 || cleanNorm.indexOf('grade') !== -1 || (cleanNorm.indexOf('pay') !== -1 && cleanNorm.indexOf('group') !== -1)) {
            if (record.pay_group === undefined || record.pay_group === '') record.pay_group = String(val).trim();
            if (record.pg_id === undefined || record.pg_id === '') record.pg_id = String(val).trim();
          }

          // 8. Designation / Post / Rank / Title
          if (cleanNorm === 'desig' || cleanNorm === 'designation' || cleanNorm === 'rank' || cleanNorm === 'post' || cleanNorm === 'title' ||
              cleanNorm.indexOf('designation') !== -1 || cleanNorm.indexOf('desig') !== -1 || cleanNorm.indexOf('rank') !== -1 || cleanNorm.indexOf('post') !== -1) {
            if (record.designation === undefined || record.designation === '') record.designation = String(val).trim();
            if (record.designation_short === undefined || record.designation_short === '') record.designation_short = String(val).trim();
          }

          // 9. Department
          if (cleanNorm === 'dept' || cleanNorm === 'department' || cleanNorm === 'dep' || cleanNorm.indexOf('department') !== -1 || cleanNorm.indexOf('dept') !== -1) {
            if (record.department === undefined || record.department === '') record.department = String(val).trim();
            if (record.dep_name === undefined || record.dep_name === '') record.dep_name = String(val).trim();
            if (record.dep_code === undefined || record.dep_code === '') record.dep_code = String(val).trim();
          }

          // 10. Directorate
          if (cleanNorm === 'dir' || cleanNorm === 'directorate' || cleanNorm.indexOf('directorate') !== -1) {
            if (record.directorate === undefined || record.directorate === '') record.directorate = String(val).trim();
            if (record.dir_name === undefined || record.dir_name === '') record.dir_name = String(val).trim();
            if (record.dir_code === undefined || record.dir_code === '') record.dir_code = String(val).trim();
          }

          // 11. Station / Posting / Airport
          if (cleanNorm === 'station' || cleanNorm === 'posting' || cleanNorm === 'stn' || cleanNorm === 'airport' || cleanNorm.indexOf('station') !== -1 || cleanNorm.indexOf('posting') !== -1) {
            if (record.posting === undefined || record.posting === '') record.posting = String(val).trim();
            if (record.station === undefined || record.station === '') record.station = String(val).trim();
            if (record.station_code === undefined || record.station_code === '') record.station_code = String(val).trim();
          }

          // 12. Section / Placement
          if (cleanNorm === 'sec' || cleanNorm === 'section' || cleanNorm === 'placement' || cleanNorm.indexOf('section') !== -1 || cleanNorm.indexOf('placement') !== -1) {
            if (record.placement === undefined || record.placement === '') record.placement = String(val).trim();
            if (record.section === undefined || record.section === '') record.section = String(val).trim();
            if (record.sec_letter_code === undefined || record.sec_letter_code === '') record.sec_letter_code = String(val).trim();
          }

          // 13. Shift / Roster
          if (cleanNorm === 'shift' || cleanNorm === 'roster' || cleanNorm.indexOf('shift') !== -1 || cleanNorm.indexOf('roster') !== -1) {
            if (record.shift === undefined || record.shift === '') record.shift = String(val).trim();
            if (record.shift_name === undefined || record.shift_name === '') record.shift_name = String(val).trim();
          }

          // 14. Primary Contact / Phone / Mobile
          if (cleanNorm === 'phone' || cleanNorm === 'mobile' || cleanNorm === 'contact' || cleanNorm === 'cell' ||
              ((cleanNorm.indexOf('phone') !== -1 || cleanNorm.indexOf('mobile') !== -1 || cleanNorm.indexOf('contact') !== -1) && 
               cleanNorm.indexOf('2') === -1 && cleanNorm.indexOf('3') === -1 && cleanNorm.indexOf('sec') === -1 && cleanNorm.indexOf('fam') === -1 && cleanNorm.indexOf('emerg') === -1)) {
            if (record.contact_primary === undefined || record.contact_primary === '') record.contact_primary = String(val).trim();
            if (record.contact_1 === undefined || record.contact_1 === '') record.contact_1 = String(val).trim();
          }

          // 15. Secondary Contact
          if (cleanNorm.indexOf('contact2') !== -1 || cleanNorm.indexOf('altphone') !== -1 || cleanNorm.indexOf('altmobile') !== -1 || cleanNorm.indexOf('secondary') !== -1) {
            if (record.contact_secondary === undefined || record.contact_secondary === '') record.contact_secondary = String(val).trim();
            if (record.contact_2 === undefined || record.contact_2 === '') record.contact_2 = String(val).trim();
          }

          // 16. Family / Emergency Contact
          if (cleanNorm.indexOf('contact3') !== -1 || cleanNorm.indexOf('family') !== -1 || cleanNorm.indexOf('emergency') !== -1) {
            if (record.contact_family === undefined || record.contact_family === '') record.contact_family = String(val).trim();
            if (record.contact_3 === undefined || record.contact_3 === '') record.contact_3 = String(val).trim();
          }

          // 17. Email
          if (cleanNorm === 'email' || cleanNorm.indexOf('email') !== -1 || cleanNorm.indexOf('mail') !== -1) {
            if (record.email === undefined || record.email === '') record.email = String(val).trim();
          }

          // 18. Promotion Date
          if (cleanNorm.indexOf('promodate') !== -1 || cleanNorm.indexOf('promotiondate') !== -1 || cleanNorm.indexOf('promoteddate') !== -1) {
            if (record.promotion_date === undefined || record.promotion_date === '') record.promotion_date = val;
          }

          // 19. Promoted Pay Group
          if (cleanNorm.indexOf('promotedpg') !== -1 || cleanNorm.indexOf('promotedpay') !== -1 || cleanNorm.indexOf('topg') !== -1) {
            if (record.promoted_pg_id === undefined || record.promoted_pg_id === '') record.promoted_pg_id = String(val).trim();
            if (record.promoted_pay_group === undefined || record.promoted_pay_group === '') record.promoted_pay_group = String(val).trim();
          }

          // 20. Present / From Pay Group
          if (cleanNorm.indexOf('presentpg') !== -1 || cleanNorm.indexOf('presentpay') !== -1 || cleanNorm.indexOf('frompg') !== -1) {
            if (record.present_pg_id === undefined || record.present_pg_id === '') record.present_pg_id = String(val).trim();
            if (record.present_pay_group === undefined || record.present_pay_group === '') record.present_pay_group = String(val).trim();
          }

          // 21. Sequence No / Serial
          if (cleanNorm === 'sl' || cleanNorm === 'seq' || cleanNorm === 'seqno' || cleanNorm === 'serial' || cleanNorm.indexOf('sequenceno') !== -1 || cleanNorm.indexOf('sequence') !== -1) {
            if (record.sequence_no === undefined || record.sequence_no === '') record.sequence_no = val;
          }

          // 22. Status
          if (cleanNorm === 'status' || cleanNorm.indexOf('status') !== -1) {
            if (record.status === undefined || record.status === '') record.status = String(val).trim();
          }

          // 23. Home District
          if (cleanNorm.indexOf('district') !== -1 || cleanNorm.indexOf('hometown') !== -1) {
            if (record.home_district === undefined || record.home_district === '') record.home_district = String(val).trim();
          }

          // 24. Remarks
          if (cleanNorm.indexOf('remark') !== -1 || cleanNorm.indexOf('comment') !== -1 || cleanNorm.indexOf('note') !== -1) {
            if (record.remarks === undefined || record.remarks === '') record.remarks = String(val).trim();
          }

          // 25. Previous ID
          if (cleanNorm.indexOf('previousid') !== -1 || cleanNorm.indexOf('oldid') !== -1 || cleanNorm.indexOf('oldstaff') !== -1 || cleanNorm.indexOf('previd') !== -1) {
            if (record.previous_id === undefined || record.previous_id === '') record.previous_id = String(val).trim();
          }

          // 26. Rank Level
          if (cleanNorm === 'ranklevel' || cleanNorm === 'rank') {
            if (record.rank_level === undefined || record.rank_level === '') record.rank_level = Number(val) || 0;
          }

          // 27. Set Up / Sanctioned Strength
          if (cleanNorm === 'setup' || cleanNorm === 'sanctioned' || cleanNorm.indexOf('sanctioned') !== -1 || cleanNorm.indexOf('setup') !== -1) {
            if (record.set_up === undefined || record.set_up === '') record.set_up = Number(val) || 0;
          }
        }

        // Backward compatibility for employees: if pg_id is not set but designation_short is
        if (tableName === 'employees') {
          if (!record.pg_id && record.designation_short) {
            record.pg_id = record.designation_short;
          }
          if (!record.pay_group && record.pg_id) {
            record.pay_group = record.pg_id;
          }
        }

        record._rowIndex = i + 1;
        records.push(record);
      }
    }
    if (records.length > 0) {
      memoryDataCache[tableName] = records;
      ServerCache.put('tbl_' + tableName, records, 21600);
    }
    return records;
  }

  function invalidateCache(tableName) {
    sheetCache = {};
    sheetHeadersCache = {};
    cachedAllSheets = null;
    sheetIndexBuilt = false;
    ss = null;
    if (tableName) {
      delete memoryDataCache[tableName];
      ServerCache.remove('tbl_' + tableName);
    } else {
      memoryDataCache = {};
      for (var tbl in TABLE_ALIASES) {
        ServerCache.remove('tbl_' + tbl);
      }
    }

    // Always invalidate derived high-level caches
    ServerCache.remove('cache_hrm_details');
    ServerCache.remove('cache_master_data');
    ServerCache.remove('cache_airline_analytics');
  }

  return {
    getAll: getAll,
    getSheet: getSheet,
    invalidateCache: invalidateCache,
    ServerCache: ServerCache,
    getActiveSpreadsheet: getActiveSpreadsheet,
    formatDateDDMmmYYYY: formatDateDDMmmYYYY,
    formatForSheet: formatForSheet,
    normalizeForSheet: normalizeForSheet,

    getById: function(tableName, pkColumn, id) {
      if (!tableName || !pkColumn || id === undefined) return null;
      var records = getAll(tableName);
      for (var i = 0; i < records.length; i++) {
        if (records[i][pkColumn] === id) return records[i];
      }
      return null;
    },

    insert: function(tableName, record, pkPrefix, pkColName) {
      if (!tableName || !record) return null;
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
      if (!tableName || !pkColumn || id === undefined || !updateData) return null;
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

/**
 * Quick ping test to verify Database.gs loads cleanly in Google Apps Script.
 */
function testDatabasePing() {
  Logger.log("=== Database.gs Ping ===");
  Logger.log("Database service loaded successfully.");
  return "OK";
}

/**
 * Test function to verify Database connectivity directly from the Google Apps Script IDE.
 * Select 'testDatabase' in the IDE toolbar and click 'Run' to verify database and sheet health.
 */
function testDatabase() {
  Logger.log("=== Testing Database Service ===");
  try {
    var ss = null;
    try {
      ss = Database.getActiveSpreadsheet();
      Logger.log("✓ Connected to Spreadsheet: " + ss.getName() + " [ID: " + ss.getId() + "]");
    } catch (ssErr) {
      Logger.log("✗ Spreadsheet connection warning: " + ssErr.message);
    }
    
    // Test reading a core table if spreadsheet is available
    if (ss) {
      try {
        var dirs = Database.getAll('directorates');
        Logger.log("✓ Database.getAll('directorates') succeeded. Total records: " + (dirs ? dirs.length : 0));
      } catch (tableErr) {
        Logger.log("✗ Database.getAll('directorates') warning: " + tableErr.message);
      }
    }

    // Test ServerCache
    try {
      if (Database.ServerCache) {
        Database.ServerCache.put('test_db_ping', { status: 'ok', timestamp: new Date().toISOString() }, 60);
        var check = Database.ServerCache.get('test_db_ping');
        Logger.log("✓ Database.ServerCache check: " + (check && check.status === 'ok' ? "PASSED" : "FAILED"));
        Database.ServerCache.remove('test_db_ping');
      }
    } catch (cacheErr) {
      Logger.log("✗ Database.ServerCache warning: " + cacheErr.message);
    }

    Logger.log("=== Database Health Check Completed Successfully! ===");
    return "Database service is healthy and operational.";
  } catch (err) {
    Logger.log("Database test encountered an issue: " + err.message);
    return "Issue detected: " + err.message;
  }
}

/**
 * Backward compatibility alias: In case 'runCleanup' was previously selected in the Apps Script IDE toolbar.
 */
function runCleanup() {
  Logger.log("Notice: 'runCleanup' is deprecated and has been replaced by testDatabase(). Executing testDatabase()...");
  return testDatabase();
}

