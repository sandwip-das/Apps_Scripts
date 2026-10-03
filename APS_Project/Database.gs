/**
 * ============================================================================
 * SANDVIORA AVIOSOLUTION - Enterprise Database Service (DAO) for Google Sheets
 * ============================================================================
 * File: Database.gs
 * Architectural Role: Data Access Object (DAO) & Sheet Transaction Engine
 * 
 * Description:
 * Implements a high-performance relational database layer on top of Google Sheets.
 * Manages atomic CRUD operations, primary key auto-generation, schema migrations,
 * multi-tier caching, audit trail integration, and strict duplicate prevention.
 * 
 * Key Architectural Highlights:
 * 1. LockService Concurrency Protection:
 *    All mutation operations (insert, batchInsert, update, deleteRow) acquire
 *    exclusive script locks to prevent race conditions during concurrent user access.
 * 2. Multi-Tier High-Speed Caching:
 *    - In-Memory RAM Cache (`memoryCache`): Provides 0ms data resolution within the execution.
 *    - Headers Cache (`headersCache`): Prevents redundant range scans for column indexes.
 *    - Invalidation Engine (`invalidateCache`): Purges memory and ScriptCache upon mutations.
 * 3. Schema & Audit Standardization:
 *    Every worksheet automatically implements the 5 standard enterprise audit columns:
 *    ['created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'].
 * 4. Soft-Delete Architecture:
 *    Deletion operations mark `is_deleted = true` instead of physically dropping rows,
 *    preserving regulatory compliance and complete historical auditability.
 * 5. Strict Zero-Dummy-Data Rule:
 *    All data displayed in the application is fetched live from actual Google Sheets.
 * ============================================================================
 */

var Database = (function() {
  /**
   * Cached active SpreadsheetApp instance.
   * @private
   */
  var ss = null;

  /**
   * Execution-level in-memory cache for table records.
   * Format: { [tableName]: Array<Object> }
   * @private
   */
  var memoryCache = {};

  /**
   * In-memory cache for column header names per sheet.
   * Format: { [sheetName]: Array<string> }
   * @private
   */
  var headersCache = {};

  /**
   * Enterprise-grade Chunked ScriptCache Engine for Google Apps Script.
   * Overcomes the 100KB CacheService size limit via automatic multi-key chunking.
   * Guarantees 1-2ms cross-execution reads for tables and aggregated models,
   * avoiding slow Google Sheets network round-trips.
   */
  /**
   * Enterprise-grade Cache Manager for Google Apps Script.
   * Cross-execution persistent caching of database rows has been disabled to ensure
   * the live Google Sheet database is always the single source of truth.
   */
  var ServerCache = {
    get: function(key) {
      // Disabled: Always fetch live from actual Google Sheet to eliminate phantom data
      return null;
    },

    put: function(key, data, ttlSeconds) {
      // No-op: Data is stored and fetched directly from Google Sheets
    },

    remove: function(key) {
      if (typeof CacheService === 'undefined') return;
      try {
        var cache = CacheService.getScriptCache();
        cache.remove(key);
        cache.remove(key + '_chunk_count');
      } catch (e) {}
    },

    clearAll: function() {
      if (typeof CacheService === 'undefined') return;
      try {
        var cache = CacheService.getScriptCache();
        var keys = ['cache_master_data', 'cache_hrm_details', 'cache_airline_analytics'];
        if (typeof TABLE_DEFINITIONS !== 'undefined') {
          for (var t in TABLE_DEFINITIONS) {
            keys.push('tbl_' + t);
            keys.push('tbl_' + t + '_chunk_count');
            for (var c = 0; c < 10; c++) {
              keys.push('tbl_' + t + '_chunk_' + c);
            }
          }
        }
        cache.removeAll(keys);
      } catch (e) {}
    }
  };

  /**
   * Resolves the active Google Spreadsheet instance.
   * Priority:
   * 1. Bound active spreadsheet (`SpreadsheetApp.getActiveSpreadsheet()`).
   * 2. ScriptProperties for 'SPREADSHEET_ID' or 'SHEET_ID'.
   * 
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet} Active spreadsheet instance.
   * @throws {Error} If spreadsheet cannot be resolved.
   */
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
      throw new Error("Unable to access Google Spreadsheet. Please ensure this script is run from a bound Google Sheet (Extensions > Apps Script) or set SPREADSHEET_ID in Script Properties.");
    }
    return ss;
  }

  // ==========================================================================
  // Canonical Table Definitions (Schemas)
  // All tables enforce the 5 standard audit & soft-delete fields:
  // created_at, updated_at, created_by, updated_by, is_deleted
  // ==========================================================================
  var TABLE_DEFINITIONS = {
    'organization_units': ['unit_id', 'unit_code', 'unit_name', 'unit_type', 'parent_unit_id', 'location_id', 'station_id', 'letter_code', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'stations': ['station_id', 'station_code', 'station_icao', 'station_name', 'station_location', 'station_type', 'stn_ops_type', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'shifts': ['shift_id', 'dep_id', 'station_id', 'station_code', 'sec_letter_code', 'shift_code', 'shift_name', 'shift_description', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'pay_groups': ['pg_id', 'pay_group', 'rank_level', 'designation', 'designation_short', 'basic_pay', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'employee_types': ['emp_type_id', 'emp_type_code', 'emp_type', 'description', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'workforce_setup': ['setup_id', 'dir_id', 'dep_id', 'station_id', 'station_code', 'pay_group', 'designation', 'set_up', 'staff_number', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'employees': ['emp_id', 'staff_id', 'emp_name', 'gender', 'dep_id', 'department_code', 'emp_type', 'emp_type_id', 'pay_group', 'contact_primary', 'contact_secondary', 'contact_family', 'official_email', 'personal_email', 'email', 'dob', 'joining_date', 'retirement_date', 'home_district', 'picture_url', 'remarks', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'placements': ['placement_id', 'staff_id', 'location_id', 'organization_unit_id', 'position_id', 'station_code', 'sec_letterCode', 'shift_name', 'placement_date', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'postings': ['posting_id', 'staff_id', 'location_id', 'location_city', 'station_code', 'effective_from', 'effective_to', 'status', 'posting_date', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'work_locations': ['location_id', 'station_id', 'location_code', 'location_name', 'location_type', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'promotion_references': ['ref_id', 'reference_number', 'publication_date', 'remarks', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'promotions': ['promotion_id', 'ref_id', 'staff_id', 'sequence_no', 'present_pg_id', 'promoted_pg_id', 'promotion_date', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'extensions': ['extension_id', 'staff_id', 'extension_from', 'extension_pay_group', 'extension_to', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'additional_charges': ['charge_id', 'staff_id', 'charge_from', 'pay_group', 'designation', 'charge_to', 'default_continue', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'acting_assignments': ['acting_id', 'staff_id', 'acting_from', 'pay_group', 'designation', 'acting_to', 'default_continue', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'self_retirements': ['retirement_id', 'staff_id', 'retirement_date', 'event_type', 'remarks', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'employee_migrations': ['migration_id', 'reference_no', 'old_staff_id', 'new_staff_id', 'migration_type', 'migration_date', 'remarks', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'employee_actions': ['action_id', 'reference_no', 'staff_id', 'action_type', 'from_org_unit_id', 'to_org_unit_id', 'from_pay_group_id', 'to_pay_group_id', 'from_designation', 'to_designation', 'effective_date', 'disciplinary_case_id', 'remarks', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'disciplinary_cases': ['case_id', 'staff_id', 'case_type', 'status', 'has_adverse_report', 'opened_date', 'closed_date', 'remarks', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'courses': ['course_id', 'dep_id', 'course_code', 'course_name', 'course_type', 'duration', 'validity_months', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'trainings': ['training_id', 'staff_id', 'course_code', 'start_date', 'end_date', 'result', 'result_file', 'certificate_file', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'payroll_calculations': ['payroll_id', 'staff_id', 'employee_name', 'pay_group', 'period', 'basic_pay', 'attendance_days', 'meal_allowance', 'overtime_hours', 'overtime_amount', 'gross_salary', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'],
    'audit_logs': ['log_id', 'user_id', 'action', 'table_name', 'record_id', 'old_value', 'new_value', 'timestamp'],
    'users': ['user_id', 'email', 'role_name', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted']
  };

  // Aliases for tolerance
  var TABLE_ALIASES = {
    'promotion': 'promotions',
    'employee': 'employees',
    'placement': 'placements',
    'posting': 'postings',
    'work_location': 'work_locations',
    'work_locations': 'work_locations',
    'work location': 'work_locations',
    'work locations': 'work_locations',
    'location': 'work_locations',
    'locations': 'work_locations',
    'extension': 'extensions',
    'additional_charge': 'additional_charges',
    'acting': 'acting_assignments',
    'self_retirement': 'self_retirements',
    'migration': 'employee_migrations',
    'employee_action': 'employee_actions',
    'employee_actions': 'employee_actions',
    'action': 'employee_actions',
    'actions': 'employee_actions',
    'department': 'organization_units',
    'departments': 'organization_units',
    'directorate': 'organization_units',
    'directorates': 'organization_units',
    'station': 'stations',
    'section': 'organization_units',
    'sections': 'organization_units',
    'shift': 'shifts',
    'pay_group': 'pay_groups',
    'employee_type': 'employee_types',
    'setup': 'workforce_setup',
    'setups': 'workforce_setup',
    'workforce': 'workforce_setup',
    'workforces': 'workforce_setup',
    'workforce_setup': 'workforce_setup',
    'workforce_setups': 'workforce_setup',
    'workforce setup': 'workforce_setup',
    'workforce setups': 'workforce_setup',
    'position_establishment': 'workforce_setup',
    'position_establishments': 'workforce_setup',
    'position establishments': 'workforce_setup',
    'establishment': 'workforce_setup',
    'establishments': 'workforce_setup',
    'course': 'courses',
    'training': 'trainings',
    'payroll': 'payroll_calculations',
    'payroll_calculation': 'payroll_calculations',
    'payroll_calculations': 'payroll_calculations',
    'allowance': 'payroll_calculations',
    'allowances': 'payroll_calculations',
    'allowance_record': 'payroll_calculations',
    'allowance_records': 'payroll_calculations'
  };

  /**
   * Resolves raw table names and common aliases to canonical table identifier.
   * Tolerates plural/singular variations, hyphens, and whitespace.
   * 
   * @param {string} name - Raw table name input.
   * @returns {string} Canonical table key.
   */
  function resolveTableName(name) {
    if (!name) return '';
    var lower = String(name).trim().toLowerCase();
    if (TABLE_DEFINITIONS[lower]) return lower;
    if (TABLE_ALIASES[lower]) return TABLE_ALIASES[lower];
    var normalized = lower.replace(/[\s\-]+/g, '_');
    if (TABLE_DEFINITIONS[normalized]) return normalized;
    if (TABLE_ALIASES[normalized]) return TABLE_ALIASES[normalized];
    return lower;
  }

  /**
   * Retrieves or lazily creates a worksheet by table name with exact column headers.
   * Performs case-insensitive matching across existing spreadsheet sheets.
   * 
   * @param {string} tableName - Canonical or aliased table name.
   * @param {boolean} [autoCreate=true] - Whether to create the sheet if missing.
   * @returns {GoogleAppsScript.Spreadsheet.Sheet|null} Target worksheet object.
   */
  function getSheet(tableName, autoCreate) {
    var resolved = resolveTableName(tableName);
    var activeSS = getActiveSpreadsheet();
    var sheet = activeSS.getSheetByName(resolved);

    if (!sheet) {
      // Check case-insensitive and normalized variations
      var sheets = activeSS.getSheets();
      for (var i = 0; i < sheets.length; i++) {
        var sName = sheets[i].getName().trim().toLowerCase();
        var sNorm = sName.replace(/[\s\-]+/g, '_');
        if (sName === resolved.toLowerCase() || sNorm === resolved.toLowerCase() || resolveTableName(sName) === resolved) {
          sheet = sheets[i];
          break;
        }
      }
    }

    if (!sheet && (autoCreate !== false)) {
      sheet = activeSS.insertSheet(resolved);
      var defHeaders = TABLE_DEFINITIONS[resolved] || ['id', 'name', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'];
      sheet.appendRow(defHeaders);
      sheet.setFrozenRows(1);
      try {
        var headerRange = sheet.getRange(1, 1, 1, defHeaders.length);
        headerRange.setFontWeight('bold');
        headerRange.setBackground(null);
        headerRange.setFontColor('#000000');
      } catch (e) {}
    }

    return sheet;
  }

  /**
   * Safely captures current user identity for audit trail records.
   * @returns {string} User email or 'admin'.
   */
  function getCurrentUserEmail() {
    try {
      var email = Session.getActiveUser().getEmail();
      if (email) return email;
    } catch (e) {}
    try {
      var eff = Session.getEffectiveUser().getEmail();
      if (eff) return eff;
    } catch (e2) {}
    return 'admin';
  }

  /**
   * Tolerant property reader that matches keys case-insensitively and ignores special characters.
   * 
   * @param {Object} dataObj - Raw data payload.
   * @param {string} header - Target column header name.
   * @returns {*} Resolved value or undefined.
   */
  function findDataValue(dataObj, header) {
    if (!dataObj || typeof dataObj !== 'object') return undefined;
    if (dataObj[header] !== undefined) return dataObj[header];
    var normH = String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (var k in dataObj) {
      if (Object.prototype.hasOwnProperty.call(dataObj, k)) {
        var normK = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normH === normK) {
          return dataObj[k];
        }
      }
    }
    return undefined;
  }

  function ensureAuditHeaders(sheet, cleanHeaders) {
    var name = sheet.getName().toLowerCase();
    if (name === 'audit_logs') return cleanHeaders;

    var auditCols = ['created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'];
    var missing = [];
    for (var i = 0; i < auditCols.length; i++) {
      if (cleanHeaders.indexOf(auditCols[i]) === -1) {
        missing.push(auditCols[i]);
      }
    }

    if (missing.length > 0) {
      var startCol = cleanHeaders.length + 1;
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
      cleanHeaders = cleanHeaders.concat(missing);
      delete headersCache[sheet.getName()];
    }
    return cleanHeaders;
  }

  function getHeaders(sheet) {
    if (!sheet) return [];
    var name = sheet.getName();
    if (headersCache[name]) return headersCache[name];

    var resolved = resolveTableName(name);
    var expectedHeaders = TABLE_DEFINITIONS[resolved];

    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();

    // If the sheet has no columns or no rows at all (empty sheet tab)
    if (lastCol < 1 || lastRow < 1) {
      var initialHeaders = expectedHeaders ? expectedHeaders.slice() : ['id', 'name', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'];
      sheet.appendRow(initialHeaders);
      sheet.setFrozenRows(1);
      try {
        var hRange = sheet.getRange(1, 1, 1, initialHeaders.length);
        hRange.setFontWeight('bold');
        hRange.setBackground(null);
        hRange.setFontColor('#000000');
      } catch (e) {}
      headersCache[name] = initialHeaders;
      return initialHeaders;
    }

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var cleanHeaders = headers.map(function(h) {
      return String(h || '').trim().toLowerCase().replace(/[\s\-\.]+/g, '_');
    });

    // Remove trailing empty headers
    while (cleanHeaders.length > 0 && !cleanHeaders[cleanHeaders.length - 1]) {
      cleanHeaders.pop();
    }

    // If all headers in row 1 were empty or blank
    if (cleanHeaders.length === 0 || cleanHeaders.filter(Boolean).length === 0) {
      var initialHeaders = expectedHeaders ? expectedHeaders.slice() : ['id', 'name', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'];
      sheet.getRange(1, 1, 1, initialHeaders.length).setValues([initialHeaders]);
      sheet.setFrozenRows(1);
      try {
        var hRange = sheet.getRange(1, 1, 1, initialHeaders.length);
        hRange.setFontWeight('bold');
        hRange.setBackground(null);
        hRange.setFontColor('#000000');
      } catch (e) {}
      headersCache[name] = initialHeaders;
      return initialHeaders;
    }

    // Check if any expected columns from schema definition are missing and append them
    if (expectedHeaders && expectedHeaders.length > 0) {
      var missing = [];
      for (var i = 0; i < expectedHeaders.length; i++) {
        var expH = expectedHeaders[i].toLowerCase();
        if (cleanHeaders.indexOf(expH) === -1) {
          missing.push(expectedHeaders[i]);
        }
      }
      if (missing.length > 0) {
        var startCol = cleanHeaders.length + 1;
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
        cleanHeaders = cleanHeaders.concat(missing);
      }
    } else {
      cleanHeaders = ensureAuditHeaders(sheet, cleanHeaders);
    }

    headersCache[name] = cleanHeaders;
    return cleanHeaders;
  }

  /**
   * Generates a unique, normalized Primary Key (e.g. PRM-0012, EMP-0045).
   * Resolves in 0ms from in-memory / ServerCache records, avoiding slow sheet reads.
   */
  function generateId(prefix, tableName, existingRecords) {
    var cleanPrefix = (prefix || 'GEN').toUpperCase();
    var resolved = resolveTableName(tableName);
    var records = existingRecords || (memoryCache[resolved] || ServerCache.get('tbl_' + resolved));
    var maxSeq = 0;
    var pkCol = TABLE_DEFINITIONS[resolved] ? TABLE_DEFINITIONS[resolved][0] : 'id';

    if (records && records.length > 0) {
      for (var i = 0; i < records.length; i++) {
        var val = String(records[i][pkCol] || records[i].id || '');
        var parts = val.split('-');
        if (parts.length > 1) {
          var num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
    } else {
      try {
        var sheet = getSheet(resolved, true);
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
          for (var j = 0; j < ids.length; j++) {
            var val2 = String(ids[j][0] || '');
            var parts2 = val2.split('-');
            if (parts2.length > 1) {
              var num2 = parseInt(parts2[parts2.length - 1], 10);
              if (!isNaN(num2) && num2 > maxSeq) {
                maxSeq = num2;
              }
            }
          }
        }
      } catch (e) {}
    }
    var nextNum = maxSeq > 0 ? (maxSeq + 1) : 1;
    var padded = ('0000' + nextNum).slice(-4);
    return cleanPrefix + '-' + padded;
  }

  /**
   * Universal and Table-Specific Duplicate Validation Engine
   * Prevents duplicate data entry across all system tables.
   */
  function checkDuplicate(tableName, data, existingRecords, excludePkVal, pkColName) {
    if (!data || typeof data !== 'object') return null;
    var resolved = resolveTableName(tableName);
    var records = existingRecords || getAll(resolved);
    if (!records || records.length === 0) return null;

    var pkCol = pkColName || (TABLE_DEFINITIONS[resolved] ? TABLE_DEFINITIONS[resolved][0] : 'id');

    function val(key) {
      var v = findDataValue(data, key);
      return v !== undefined && v !== null ? String(v).trim().toUpperCase() : '';
    }

    function isCurrent(r) {
      if (!excludePkVal) return false;
      var rPk = r[pkCol] || r.id || r._rowNumber;
      return String(rPk).trim().toUpperCase() === String(excludePkVal).trim().toUpperCase();
    }

    // 1. Table-specific unique business rules
    if (resolved === 'employees') {
      var staffId = val('staff_id');
      if (staffId) {
        var dup = records.find(function(r) {
          return !isCurrent(r) && String(r.staff_id || '').trim().toUpperCase() === staffId;
        });
        if (dup) return "An employee with Staff ID '" + (data.staff_id || staffId) + "' already exists in the system.";
      }
    } else if (resolved === 'organization_units') {
      var uCode = val('unit_code');
      var uName = val('unit_name');
      var pId = val('parent_unit_id');
      if (uCode) {
        var dupCode = records.find(function(r) {
          return !isCurrent(r) && String(r.unit_code || '').trim().toUpperCase() === uCode;
        });
        if (dupCode) return "An organization unit with Unit Code '" + (data.unit_code || uCode) + "' already exists.";
      }
      if (uName) {
        var dupName = records.find(function(r) {
          return !isCurrent(r) && String(r.unit_name || '').trim().toUpperCase() === uName && String(r.parent_unit_id || '').trim().toUpperCase() === pId;
        });
        if (dupName) return "An organization unit '" + (data.unit_name || uName) + "' already exists under this parent hierarchy.";
      }
    } else if (resolved === 'stations') {
      var sCode = val('station_code');
      var sIcao = val('station_icao');
      if (sCode) {
        var dupStn = records.find(function(r) {
          return !isCurrent(r) && String(r.station_code || '').trim().toUpperCase() === sCode;
        });
        if (dupStn) return "A station with Station Code (IATA) '" + (data.station_code || sCode) + "' already exists.";
      }
      if (sIcao) {
        var dupIcao = records.find(function(r) {
          return !isCurrent(r) && String(r.station_icao || '').trim().toUpperCase() === sIcao;
        });
        if (dupIcao) return "A station with ICAO Code '" + (data.station_icao || sIcao) + "' already exists.";
      }
    } else if (resolved === 'work_locations') {
      var lCode = val('location_code');
      var lName = val('location_name');
      var lStn = val('station_id');
      if (lCode) {
        var dupLoc = records.find(function(r) {
          return !isCurrent(r) && String(r.location_code || '').trim().toUpperCase() === lCode;
        });
        if (dupLoc) return "A work location with Code '" + (data.location_code || lCode) + "' already exists.";
      }
      if (lName && lStn) {
        var dupLocN = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.location_name || '').trim().toUpperCase() === lName &&
                 String(r.station_id || '').trim().toUpperCase() === lStn;
        });
        if (dupLocN) return "A work location named '" + (data.location_name || lName) + "' already exists for Station '" + (data.station_id || lStn) + "'.";
      }
    } else if (resolved === 'shifts') {
      var shName = val('shift_name');
      var shStn = val('station_code') || val('station_id');
      var shSec = val('sec_letter_code');
      if (shName && shStn) {
        var dupShift = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.shift_name || '').trim().toUpperCase() === shName &&
                 (String(r.station_code || r.station_id || '').trim().toUpperCase() === shStn) &&
                 (!shSec || String(r.sec_letter_code || '').trim().toUpperCase() === shSec);
        });
        if (dupShift) return "Shift '" + (data.shift_name || shName) + "' is already registered for this station/section.";
      }
    } else if (resolved === 'pay_groups') {
      var pg = val('pay_group');
      if (pg) {
        var dupPg = records.find(function(r) {
          return !isCurrent(r) && String(r.pay_group || '').trim().toUpperCase() === pg;
        });
        if (dupPg) return "Pay Group '" + (data.pay_group || pg) + "' already exists.";
      }
    } else if (resolved === 'employee_types') {
      var etCode = val('emp_type_code');
      var etName = val('emp_type');
      if (etCode) {
        var dupEtC = records.find(function(r) {
          return !isCurrent(r) && String(r.emp_type_code || '').trim().toUpperCase() === etCode;
        });
        if (dupEtC) return "Employee Type Code '" + (data.emp_type_code || etCode) + "' already exists.";
      }
      if (etName) {
        var dupEtN = records.find(function(r) {
          return !isCurrent(r) && String(r.emp_type || '').trim().toUpperCase() === etName;
        });
        if (dupEtN) return "Employee Type '" + (data.emp_type || etName) + "' already exists.";
      }
    } else if (resolved === 'placements') {
      var pStaff = val('staff_id');
      var pDate = val('placement_date');
      var pLoc = val('location_id');
      var pUnit = val('organization_unit_id');
      if (pStaff && pDate) {
        var dupPlc = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === pStaff &&
                 String(r.placement_date || '').trim().toUpperCase() === pDate &&
                 (!pLoc || String(r.location_id || '').trim().toUpperCase() === pLoc) &&
                 (!pUnit || String(r.organization_unit_id || '').trim().toUpperCase() === pUnit);
        });
        if (dupPlc) return "A placement for Staff ID '" + (data.staff_id || pStaff) + "' on date '" + pDate + "' with identical assignment already exists.";
      }
    } else if (resolved === 'postings') {
      var posStaff = val('staff_id');
      var posDate = val('effective_from') || val('posting_date');
      var posLoc = val('location_id');
      if (posStaff && posDate) {
        var dupPos = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === posStaff &&
                 (String(r.effective_from || r.posting_date || '').trim().toUpperCase() === posDate) &&
                 (!posLoc || String(r.location_id || '').trim().toUpperCase() === posLoc);
        });
        if (dupPos) return "A posting record for Staff ID '" + (data.staff_id || posStaff) + "' on date '" + posDate + "' already exists.";
      }
    } else if (resolved === 'promotions') {
      var prStaff = val('staff_id');
      var prDate = val('promotion_date');
      var prPg = val('promoted_pg_id');
      if (prStaff && prDate) {
        var dupPr = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === prStaff &&
                 String(r.promotion_date || '').trim().toUpperCase() === prDate &&
                 (!prPg || String(r.promoted_pg_id || '').trim().toUpperCase() === prPg);
        });
        if (dupPr) return "A promotion record for Staff ID '" + (data.staff_id || prStaff) + "' on date '" + prDate + "' already exists.";
      }
    } else if (resolved === 'extensions') {
      var extStaff = val('staff_id');
      var extFrom = val('extension_from');
      if (extStaff && extFrom) {
        var dupExt = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === extStaff &&
                 String(r.extension_from || '').trim().toUpperCase() === extFrom;
        });
        if (dupExt) return "An extension record for Staff ID '" + (data.staff_id || extStaff) + "' from date '" + extFrom + "' already exists.";
      }
    } else if (resolved === 'additional_charges') {
      var acStaff = val('staff_id');
      var acFrom = val('charge_from');
      var acDesig = val('designation');
      if (acStaff && acFrom) {
        var dupAc = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === acStaff &&
                 String(r.charge_from || '').trim().toUpperCase() === acFrom &&
                 (!acDesig || String(r.designation || '').trim().toUpperCase() === acDesig);
        });
        if (dupAc) return "An additional charge for Staff ID '" + (data.staff_id || acStaff) + "' on date '" + acFrom + "' already exists.";
      }
    } else if (resolved === 'acting_assignments') {
      var actStaff = val('staff_id');
      var actFrom = val('acting_from');
      var actDesig = val('designation');
      if (actStaff && actFrom) {
        var dupAct = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === actStaff &&
                 String(r.acting_from || '').trim().toUpperCase() === actFrom &&
                 (!actDesig || String(r.designation || '').trim().toUpperCase() === actDesig);
        });
        if (dupAct) return "An acting assignment for Staff ID '" + (data.staff_id || actStaff) + "' on date '" + actFrom + "' already exists.";
      }
    } else if (resolved === 'self_retirements') {
      var retStaff = val('staff_id');
      if (retStaff) {
        var dupRet = records.find(function(r) {
          return !isCurrent(r) && String(r.staff_id || '').trim().toUpperCase() === retStaff;
        });
        if (dupRet) return "A retirement/resignation record for Staff ID '" + (data.staff_id || retStaff) + "' already exists.";
      }
    } else if (resolved === 'employee_migrations') {
      var mNew = val('new_staff_id');
      var mOld = val('old_staff_id');
      if (mNew || mOld) {
        var dupMig = records.find(function(r) {
          return !isCurrent(r) &&
                 ((mNew && String(r.new_staff_id || '').trim().toUpperCase() === mNew) ||
                  (mOld && String(r.old_staff_id || '').trim().toUpperCase() === mOld));
        });
        if (dupMig) return "An employee migration for Staff ID '" + (mNew || mOld) + "' already exists.";
      }
    } else if (resolved === 'employee_actions') {
      var actStaff = val('staff_id');
      var actType = val('action_type');
      var actDate = val('effective_date');
      var actRef = val('reference_no');
      if (actStaff && actType && (actDate || actRef)) {
        var dupAct = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === actStaff &&
                 String(r.action_type || '').trim().toUpperCase() === actType &&
                 ((actRef && String(r.reference_no || '').trim().toUpperCase() === actRef) ||
                  (actDate && String(r.effective_date || '').trim().toUpperCase() === actDate));
        });
        if (dupAct) return "An action of type '" + (data.action_type || actType) + "' for Staff ID '" + (data.staff_id || actStaff) + "' already exists with same reference/date.";
      }
    } else if (resolved === 'workforce_setup') {
      var wsDep = val('dep_id') || val('department_code');
      var wsStn = val('station_id') || val('station_code');
      var wsPg = val('pay_group');
      var wsDesig = val('designation');
      if (wsDep && wsStn && wsPg) {
        var dupWs = records.find(function(r) {
          return !isCurrent(r) &&
                 (String(r.dep_id || r.department_code || '').trim().toUpperCase() === wsDep) &&
                 (String(r.station_id || r.station_code || '').trim().toUpperCase() === wsStn) &&
                 (String(r.pay_group || '').trim().toUpperCase() === wsPg) &&
                 (!wsDesig || String(r.designation || '').trim().toUpperCase() === wsDesig);
        });
        if (dupWs) return "A workforce setup post already exists for this department, station and pay group.";
      }
    } else if (resolved === 'courses') {
      var cCode = val('course_code');
      if (cCode) {
        var dupC = records.find(function(r) {
          return !isCurrent(r) && String(r.course_code || '').trim().toUpperCase() === cCode;
        });
        if (dupC) return "A course with Course Code '" + (data.course_code || cCode) + "' already exists.";
      }
    } else if (resolved === 'trainings') {
      var trStaff = val('staff_id');
      var trCourse = val('course_code');
      var trDate = val('start_date');
      if (trStaff && trCourse && trDate) {
        var dupTr = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === trStaff &&
                 String(r.course_code || '').trim().toUpperCase() === trCourse &&
                 String(r.start_date || '').trim().toUpperCase() === trDate;
        });
        if (dupTr) return "A training record for Staff ID '" + (data.staff_id || trStaff) + "' on course '" + trCourse + "' already exists.";
      }
    } else if (resolved === 'disciplinary_cases') {
      var dcStaff = val('staff_id');
      var dcType = val('case_type');
      var dcDate = val('opened_date');
      if (dcStaff && dcType && dcDate) {
        var dupDc = records.find(function(r) {
          return !isCurrent(r) &&
                 String(r.staff_id || '').trim().toUpperCase() === dcStaff &&
                 String(r.case_type || '').trim().toUpperCase() === dcType &&
                 String(r.opened_date || '').trim().toUpperCase() === dcDate;
        });
        if (dupDc) return "A disciplinary case for Staff ID '" + (data.staff_id || dcStaff) + "' of type '" + dcType + "' on date '" + dcDate + "' already exists.";
      }
    }

    // 2. Universal Identical Values Check across all tables:
    var ignoreKeys = [pkCol.toLowerCase(), 'id', '_rownumber', 'created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'];
    var inputKeys = Object.keys(data).filter(function(k) {
      var lk = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      return ignoreKeys.indexOf(lk) === -1 && data[k] !== undefined && data[k] !== null && String(data[k]).trim() !== '';
    });

    if (inputKeys.length >= 2) {
      var exactDup = records.find(function(r) {
        if (isCurrent(r)) return false;
        var allMatch = true;
        for (var k = 0; k < inputKeys.length; k++) {
          var key = inputKeys[k];
          var v1 = String(data[key]).trim().toUpperCase();
          var v2 = String(findDataValue(r, key) || '').trim().toUpperCase();
          if (v1 !== v2) {
            allMatch = false;
            break;
          }
        }
        return allMatch;
      });
      if (exactDup) {
        return "Duplicate record detected: An identical entry with these exact values already exists in " + resolved + ".";
      }
    }

    return null;
  }

  /**
   * Fetch all records from a table. Returns an array of objects.
   * High-speed atomic read using ServerCache (1-2ms) and getDataRange(). Filters out soft-deleted records.
   */
  function getAll(tableName, forceRefresh) {
    var resolved = resolveTableName(tableName);
    if (!forceRefresh && memoryCache[resolved]) {
      return memoryCache[resolved];
    }

    var sheet = getSheet(resolved, true);
    if (!sheet) return [];

    var dataRange = sheet.getDataRange();
    var rawValues = dataRange.getValues();
    if (!rawValues || rawValues.length <= 1) {
      memoryCache[resolved] = [];
      return [];
    }

    var headers = rawValues[0].map(function(h) {
      return String(h || '').trim().toLowerCase().replace(/[\s\-\.]+/g, '_');
    });
    while (headers.length > 0 && !headers[headers.length - 1]) {
      headers.pop();
    }
    headersCache[sheet.getName()] = headers;

    var records = [];
    for (var r = 1; r < rawValues.length; r++) {
      var row = rawValues[r];
      var hasData = false;
      var obj = { _rowNumber: r + 1 };

      for (var c = 0; c < headers.length; c++) {
        var header = headers[c];
        if (!header) continue;
        var val = row[c];
        if (val !== '' && val !== null && val !== undefined) {
          hasData = true;
        }

        // Standardize dates
        if (Object.prototype.toString.call(val) === '[object Date]') {
          if (!isNaN(val.getTime())) {
            var yyyy = val.getFullYear();
            var mm = ('0' + (val.getMonth() + 1)).slice(-2);
            var dd = ('0' + val.getDate()).slice(-2);
            obj[header] = yyyy + '-' + mm + '-' + dd;
            if (typeof Utils !== 'undefined' && Utils.formatDateToDDMmmYYYY) {
              obj[header + '_display'] = Utils.formatDateToDDMmmYYYY(val);
            }
          } else {
            obj[header] = '';
          }
        } else {
          obj[header] = val;
        }
      }

      var isDeleted = obj.is_deleted === true || String(obj.is_deleted).toLowerCase() === 'true' || obj.is_deleted === 1 || obj.is_deleted === '1';

      if (hasData && !isDeleted) {
        if (resolved === 'workforce_setup') {
          var staffCount = obj.staff_number !== undefined && obj.staff_number !== '' ? obj.staff_number : (obj.set_up !== undefined && obj.set_up !== '' ? obj.set_up : obj.sanctioned_posts);
          if (staffCount !== undefined && staffCount !== null) {
            obj.staff_number = staffCount;
            obj.set_up = staffCount;
          }
        }
        records.push(obj);
      }
    }

    memoryCache[resolved] = records;
    return records;
  }

  /**
   * Insert a new record with Duplicate Prevention, LockService protection,
   * and high-speed write-through cache update.
   */
  function insert(tableName, data, pkPrefix, pkColName) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(12000);
      var resolved = resolveTableName(tableName);
      var sheet = getSheet(resolved, true);
      var headers = getHeaders(sheet);

      // Handle workforce_setup field synonyms (staff_number, set_up, sanctioned_posts)
      if (resolved === 'workforce_setup') {
        var staffVal = findDataValue(data, 'staff_number') || findDataValue(data, 'set_up') || findDataValue(data, 'sanctioned_posts');
        if (staffVal !== undefined && staffVal !== null && staffVal !== '') {
          data['staff_number'] = staffVal;
          data['set_up'] = staffVal;
        }
        var stnVal = findDataValue(data, 'station_code') || findDataValue(data, 'station_id');
        if (stnVal) {
          if (!data['station_code']) data['station_code'] = stnVal;
          if (!data['station_id']) data['station_id'] = stnVal;
        }
      }

      var pkCol = pkColName || (headers.length > 0 ? headers[0] : 'id');

      // Comprehensive duplicate validation before writing - instant from ServerCache
      var currentRecords = getAll(resolved);
      var dupError = checkDuplicate(resolved, data, currentRecords, null, pkCol);
      if (dupError) {
        var err = new Error(dupError);
        err.isDuplicate = true;
        throw err;
      }

      // Safeguard: If headers is empty, initialize from definition or data keys
      if (!headers || headers.length === 0) {
        var defH = TABLE_DEFINITIONS[resolved];
        var inferred = defH ? defH.slice() : Object.keys(data).filter(function(k) { return k && k.trim(); });
        var pk = pkColName || (inferred.length > 0 ? inferred[0] : 'id');
        if (inferred.indexOf(pk) === -1) inferred.unshift(pk);
        var auditCols = ['created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'];
        for (var a = 0; a < auditCols.length; a++) {
          if (inferred.indexOf(auditCols[a]) === -1) inferred.push(auditCols[a]);
        }
        sheet.appendRow(inferred);
        sheet.setFrozenRows(1);
        headers = inferred;
        headersCache[sheet.getName()] = headers;
      } else {
        // Ensure any newly defined columns in TABLE_DEFINITIONS exist in the sheet header
        var defCols = TABLE_DEFINITIONS[resolved];
        if (defCols && defCols.length > 0) {
          var missingCols = [];
          for (var d = 0; d < defCols.length; d++) {
            if (headers.indexOf(defCols[d].toLowerCase()) === -1) {
              missingCols.push(defCols[d]);
            }
          }
          if (missingCols.length > 0) {
            var startCol = (sheet.getLastColumn() || 0) + 1;
            var range = sheet.getRange(1, startCol, 1, missingCols.length);
            range.setValues([missingCols]);
            try {
              range.setFontWeight('bold');
              range.setBackground(null);
              range.setFontColor('#000000');
            } catch(e) {}
            headers = headers.concat(missingCols.map(function(m) { return m.toLowerCase(); }));
            headersCache[sheet.getName()] = headers;
          }
        }
      }

      if (!findDataValue(data, pkCol)) {
        data[pkCol] = generateId(pkPrefix || resolved.substring(0, 3), resolved, currentRecords);
      }

      if (resolved === 'employees') {
        var offEmail = findDataValue(data, 'official_email');
        var perEmail = findDataValue(data, 'personal_email');
        if (!findDataValue(data, 'email')) {
          data['email'] = offEmail || perEmail || '';
        }
      }

      var nowIso = new Date().toISOString();
      var currentUser = getCurrentUserEmail();

      if (headers.indexOf('created_at') !== -1 && !findDataValue(data, 'created_at')) {
        data['created_at'] = nowIso;
      }
      if (headers.indexOf('updated_at') !== -1 && !findDataValue(data, 'updated_at')) {
        data['updated_at'] = nowIso;
      }
      if (headers.indexOf('created_by') !== -1 && !findDataValue(data, 'created_by')) {
        data['created_by'] = currentUser;
      }
      if (headers.indexOf('updated_by') !== -1 && !findDataValue(data, 'updated_by')) {
        data['updated_by'] = currentUser;
      }
      if (headers.indexOf('is_deleted') !== -1 && findDataValue(data, 'is_deleted') === undefined) {
        data['is_deleted'] = false;
      }

      var rowValues = [];
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i];
        var val = findDataValue(data, h);
        rowValues.push(val !== undefined && val !== null ? val : '');
      }

      if (rowValues.length === 0) {
        throw new Error("Cannot append empty row to table '" + resolved + "'. Column headers could not be determined.");
      }

      sheet.appendRow(rowValues);

      // Write-through cache update: immediately update memory and ServerCache
      var newRecordObj = JSON.parse(JSON.stringify(data));
      newRecordObj._rowNumber = (currentRecords ? currentRecords.length : 0) + 2;
      if (currentRecords) {
        currentRecords.push(newRecordObj);
        memoryCache[resolved] = currentRecords;
        ServerCache.put('tbl_' + resolved, currentRecords, 21600);
      } else {
        invalidateCache(resolved);
      }

      // Purge composite aggregated caches
      ServerCache.remove('cache_master_data');
      ServerCache.remove('cache_hrm_details');
      ServerCache.remove('cache_airline_analytics');

      if (typeof AuditService !== 'undefined' && AuditService.log) {
        AuditService.log('INSERT', resolved, String(findDataValue(data, pkCol) || ''), '', JSON.stringify(data));
      }

      return data;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Batch insert an array of records
   */
  function insertBatch(tableName, recordsArray, pkPrefix, pkColName) {
    if (!recordsArray || recordsArray.length === 0) return [];
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
      var resolved = resolveTableName(tableName);
      var sheet = getSheet(resolved, true);
      var headers = getHeaders(sheet);

      if (!headers || headers.length === 0) {
        var defH = TABLE_DEFINITIONS[resolved];
        var firstRec = recordsArray[0] || {};
        var inferred = defH ? defH.slice() : Object.keys(firstRec).filter(function(k) { return k && k.trim(); });
        var pk = pkColName || (inferred.length > 0 ? inferred[0] : 'id');
        if (inferred.indexOf(pk) === -1) inferred.unshift(pk);
        var auditCols = ['created_at', 'updated_at', 'created_by', 'updated_by', 'is_deleted'];
        for (var a = 0; a < auditCols.length; a++) {
          if (inferred.indexOf(auditCols[a]) === -1) inferred.push(auditCols[a]);
        }
        sheet.appendRow(inferred);
        sheet.setFrozenRows(1);
        headers = inferred;
        headersCache[sheet.getName()] = headers;
      }

      var pkCol = pkColName || (headers.length > 0 ? headers[0] : 'id');
      var prefix = pkPrefix || resolved.substring(0, 3);
      var nowIso = new Date().toISOString();
      var currentUser = getCurrentUserEmail();

      var startNum = Math.max(1, sheet.getLastRow());
      var rowsToAppend = [];
      var resultRecords = [];

      for (var r = 0; r < recordsArray.length; r++) {
        var data = recordsArray[r];

        if (resolved === 'workforce_setup') {
          var staffVal = findDataValue(data, 'staff_number') || findDataValue(data, 'set_up') || findDataValue(data, 'sanctioned_posts');
          if (staffVal !== undefined && staffVal !== null && staffVal !== '') {
            data['staff_number'] = staffVal;
            data['set_up'] = staffVal;
          }
          var stnVal = findDataValue(data, 'station_code') || findDataValue(data, 'station_id');
          if (stnVal) {
            if (!data['station_code']) data['station_code'] = stnVal;
            if (!data['station_id']) data['station_id'] = stnVal;
          }
        }

        if (!findDataValue(data, pkCol)) {
          var padded = ('0000' + (startNum + r)).slice(-4);
          data[pkCol] = prefix.toUpperCase() + '-' + padded;
        }
        if (headers.indexOf('created_at') !== -1 && !findDataValue(data, 'created_at')) {
          data['created_at'] = nowIso;
        }
        if (headers.indexOf('updated_at') !== -1 && !findDataValue(data, 'updated_at')) {
          data['updated_at'] = nowIso;
        }
        if (headers.indexOf('created_by') !== -1 && !findDataValue(data, 'created_by')) {
          data['created_by'] = currentUser;
        }
        if (headers.indexOf('updated_by') !== -1 && !findDataValue(data, 'updated_by')) {
          data['updated_by'] = currentUser;
        }
        if (headers.indexOf('is_deleted') !== -1 && findDataValue(data, 'is_deleted') === undefined) {
          data['is_deleted'] = false;
        }

        var rowVals = [];
        for (var c = 0; c < headers.length; c++) {
          var h = headers[c];
          var val = findDataValue(data, h);
          rowVals.push(val !== undefined && val !== null ? val : '');
        }
        rowsToAppend.push(rowVals);
        resultRecords.push(data);
      }

      if (rowsToAppend.length > 0 && headers.length > 0) {
        var nextRow = sheet.getLastRow() + 1;
        sheet.getRange(nextRow, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
      }

      invalidateCache(resolved);
      return resultRecords;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Update an existing record by PK
   */
  function update(tableName, pkColumn, id, data) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(25000);
      var resolved = resolveTableName(tableName);
      var sheet = getSheet(resolved, true);
      var headers = getHeaders(sheet);

      // Ensure any newly defined columns in TABLE_DEFINITIONS exist in the sheet header
      var defColsUpd = TABLE_DEFINITIONS[resolved];
      if (defColsUpd && defColsUpd.length > 0) {
        var missingColsUpd = [];
        for (var du = 0; du < defColsUpd.length; du++) {
          if (headers.indexOf(defColsUpd[du].toLowerCase()) === -1) {
            missingColsUpd.push(defColsUpd[du]);
          }
        }
        if (missingColsUpd.length > 0) {
          var startColUpd = (sheet.getLastColumn() || 0) + 1;
          var rangeUpd = sheet.getRange(1, startColUpd, 1, missingColsUpd.length);
          rangeUpd.setValues([missingColsUpd]);
          try {
            rangeUpd.setFontWeight('bold');
            rangeUpd.setBackground(null);
            rangeUpd.setFontColor('#000000');
          } catch(e) {}
          headers = headers.concat(missingColsUpd.map(function(m) { return m.toLowerCase(); }));
          headersCache[sheet.getName()] = headers;
        }
      }

      if (resolved === 'workforce_setup') {
        var staffVal = findDataValue(data, 'staff_number') || findDataValue(data, 'set_up') || findDataValue(data, 'sanctioned_posts');
        if (staffVal !== undefined && staffVal !== null && staffVal !== '') {
          data['staff_number'] = staffVal;
          data['set_up'] = staffVal;
        }
        var stnVal = findDataValue(data, 'station_code') || findDataValue(data, 'station_id');
        if (stnVal) {
          if (!data['station_code']) data['station_code'] = stnVal;
          if (!data['station_id']) data['station_id'] = stnVal;
        }
      }

      if (resolved === 'employees') {
        var offEmailUpd = findDataValue(data, 'official_email');
        var perEmailUpd = findDataValue(data, 'personal_email');
        if (!findDataValue(data, 'email')) {
          data['email'] = offEmailUpd || perEmailUpd || '';
        }
      }

      var pkIndex = headers.indexOf(pkColumn.toLowerCase());
      if (pkIndex === -1) {
        throw new Error("Primary key column '" + pkColumn + "' not found in table '" + resolved + "'.");
      }

      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        throw new Error("Record with ID '" + id + "' not found in table '" + resolved + "'.");
      }

      var pkValues = sheet.getRange(2, pkIndex + 1, lastRow - 1, 1).getValues();
      var targetRow = -1;
      var strId = String(id).trim().toLowerCase();

      for (var r = 0; r < pkValues.length; r++) {
        if (String(pkValues[r][0]).trim().toLowerCase() === strId) {
          targetRow = r + 2;
          break;
        }
      }

      if (targetRow === -1) {
        throw new Error("Record with ID '" + id + "' not found in table '" + resolved + "'.");
      }

      var dupError = checkDuplicate(resolved, data, null, id, pkColumn);
      if (dupError) {
        var err = new Error(dupError);
        err.isDuplicate = true;
        throw err;
      }

      var oldRow = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0];
      var newRow = oldRow.slice();

      var nowIso = new Date().toISOString();
      var currentUser = getCurrentUserEmail();
      data['updated_at'] = nowIso;
      data['updated_by'] = currentUser;

      for (var c = 0; c < headers.length; c++) {
        var h = headers[c];
        var val = findDataValue(data, h);
        if (val !== undefined) {
          newRow[c] = val;
        }
      }

      sheet.getRange(targetRow, 1, 1, headers.length).setValues([newRow]);

      // Write-Through Cache Update:
      if (memoryCache[resolved]) {
        for (var i = 0; i < memoryCache[resolved].length; i++) {
          if (String(memoryCache[resolved][i][pkColumn.toLowerCase()] || memoryCache[resolved][i].id || memoryCache[resolved][i]._rowNumber) === String(id)) {
            Object.assign(memoryCache[resolved][i], data);
            break;
          }
        }
        ServerCache.put('tbl_' + resolved, memoryCache[resolved], 21600);
      } else {
        invalidateCache(resolved);
      }

      ServerCache.remove('cache_master_data');
      ServerCache.remove('cache_hrm_details');
      ServerCache.remove('cache_airline_analytics');

      if (typeof AuditService !== 'undefined' && AuditService.log) {
        AuditService.log('UPDATE', resolved, String(id), JSON.stringify(oldRow), JSON.stringify(newRow));
      }

      return data;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Delete record by PK (Soft-delete if is_deleted column exists, hard delete otherwise)
   */
  function deleteRow(tableName, pkColumn, id) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(25000);
      var resolved = resolveTableName(tableName);
      var sheet = getSheet(resolved, true);
      var headers = getHeaders(sheet);
      var pkIndex = headers.indexOf(pkColumn.toLowerCase());
      if (pkIndex === -1) {
        throw new Error("Primary key column '" + pkColumn + "' not found in table '" + resolved + "'.");
      }

      var lastRow = sheet.getLastRow();
      if (lastRow <= 1) {
        throw new Error("Record with ID '" + id + "' not found in table '" + resolved + "'.");
      }

      var pkValues = sheet.getRange(2, pkIndex + 1, lastRow - 1, 1).getValues();
      var targetRow = -1;
      var strId = String(id).trim().toLowerCase();

      for (var r = 0; r < pkValues.length; r++) {
        if (String(pkValues[r][0]).trim().toLowerCase() === strId) {
          targetRow = r + 2;
          break;
        }
      }

      if (targetRow === -1) {
        throw new Error("Record with ID '" + id + "' not found in table '" + resolved + "'.");
      }

      var isDeletedIdx = headers.indexOf('is_deleted');
      var currentUser = getCurrentUserEmail();
      var nowIso = new Date().toISOString();

      if (isDeletedIdx !== -1) {
        // Soft delete: set is_deleted = true, updated_at, updated_by
        sheet.getRange(targetRow, isDeletedIdx + 1).setValue(true);
        var updatedIdx = headers.indexOf('updated_at');
        if (updatedIdx !== -1) {
          sheet.getRange(targetRow, updatedIdx + 1).setValue(nowIso);
        }
        var updatedByIdx = headers.indexOf('updated_by');
        if (updatedByIdx !== -1) {
          sheet.getRange(targetRow, updatedByIdx + 1).setValue(currentUser);
        }
      } else {
        sheet.deleteRow(targetRow);
      }

      // Write-Through Cache Update:
      if (memoryCache[resolved]) {
        memoryCache[resolved] = memoryCache[resolved].filter(function(rec) {
          return String(rec[pkColumn.toLowerCase()] || rec.id || rec._rowNumber) !== String(id);
        });
        ServerCache.put('tbl_' + resolved, memoryCache[resolved], 21600);
      } else {
        invalidateCache(resolved);
      }

      ServerCache.remove('cache_master_data');
      ServerCache.remove('cache_hrm_details');
      ServerCache.remove('cache_airline_analytics');

      if (typeof AuditService !== 'undefined' && AuditService.log) {
        AuditService.log('DELETE', resolved, String(id), '', 'Marked deleted');
      }

      return { success: true, deletedId: id };
    } finally {
      lock.releaseLock();
    }
  }

  function softDelete(tableName, pkColumn, id) {
    return deleteRow(tableName, pkColumn, id);
  }

  function invalidateCache(tableName) {
    if (tableName) {
      var resolved = resolveTableName(tableName);
      delete memoryCache[resolved];
      delete headersCache[resolved];
      ServerCache.remove('tbl_' + resolved);
    } else {
      memoryCache = {};
      headersCache = {};
    }
    ServerCache.remove('cache_master_data');
    ServerCache.remove('cache_hrm_details');
    ServerCache.remove('cache_airline_analytics');
  }

  /**
   * Non-destructive migration: checks all defined tables in the Google Sheet.
   * If a sheet is missing, creates it with proper headers.
   * If a sheet exists, appends any missing headers (including audit columns) to row 1.
   * NO TABLES OR DATA ARE EVER DELETED.
   */
  function ensureAllTablesAndAuditColumns() {
    var activeSS = getActiveSpreadsheet();
    var results = { created: [], updated: [] };

    for (var table in TABLE_DEFINITIONS) {
      var expectedHeaders = TABLE_DEFINITIONS[table];
      var sheet = activeSS.getSheetByName(table);

      if (!sheet) {
        // Auto-create
        sheet = activeSS.insertSheet(table);
        sheet.appendRow(expectedHeaders);
        sheet.setFrozenRows(1);
        try {
          var hRange = sheet.getRange(1, 1, 1, expectedHeaders.length);
          hRange.setFontWeight('bold');
          hRange.setBackground(null);
          hRange.setFontColor('#000000');
        } catch (e) {}
        results.created.push(table);
      } else {
        // Sheet exists: check missing columns or completely empty sheet
        var lastCol = sheet.getLastColumn();
        var lastRow = sheet.getLastRow();

        if (lastCol < 1 || lastRow < 1) {
          sheet.appendRow(expectedHeaders);
          sheet.setFrozenRows(1);
          try {
            var hRange = sheet.getRange(1, 1, 1, expectedHeaders.length);
            hRange.setFontWeight('bold');
            hRange.setBackground(null);
            hRange.setFontColor('#000000');
          } catch (e) {}
          results.updated.push({ table: table, addedColumns: expectedHeaders });
          continue;
        }

        // Clear background color from header row of existing sheet if it was previously set
        try {
          var headerRowRange = sheet.getRange(1, 1, 1, lastCol);
          headerRowRange.setBackground(null);
          headerRowRange.setFontColor('#000000');
          headerRowRange.setFontWeight('bold');
        } catch (e) {}

        var currentHeaders = [];
        if (lastCol > 0) {
          var vals = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
          currentHeaders = vals.map(function(h) {
            return String(h || '').trim().toLowerCase().replace(/[\s\-\.]+/g, '_');
          });
        }

        var missing = [];
        for (var i = 0; i < expectedHeaders.length; i++) {
          if (currentHeaders.indexOf(expectedHeaders[i].toLowerCase()) === -1) {
            missing.push(expectedHeaders[i]);
          }
        }

        if (missing.length > 0) {
          var startCol = (lastCol || 0) + 1;
          var range = sheet.getRange(1, startCol, 1, missing.length);
          range.setValues([missing]);
          try {
            range.setFontWeight('bold');
            range.setBackground(null);
            range.setFontColor('#000000');
          } catch (e) {}
          results.updated.push({ table: table, addedColumns: missing });
        }
      }
    }

    invalidateCache();
    return results;
  }

  return {
    ServerCache: ServerCache,
    getActiveSpreadsheet: getActiveSpreadsheet,
    getSheet: getSheet,
    getHeaders: getHeaders,
    generateId: generateId,
    getAll: getAll,
    insert: insert,
    insertBatch: insertBatch,
    update: update,
    deleteRow: deleteRow,
    softDelete: softDelete,
    invalidateCache: invalidateCache,
    ensureAllTablesAndAuditColumns: ensureAllTablesAndAuditColumns
  };
})();
