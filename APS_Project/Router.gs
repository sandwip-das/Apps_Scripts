/**
 * ============================================================================
 * SANDVIORA AVIOSOLUTION - Global API Router & Web App Controller
 * ============================================================================
 * File: Router.gs
 * Architectural Role: Remote Procedure Call (RPC) Gateway & HTTP Controller
 * 
 * Description:
 * Connects client-side asynchronous RPC calls (via google.script.run) to the
 * corresponding backend services (Database.gs, HrmService.gs, FileService.gs, etc.).
 * 
 * Key Responsibilities:
 * 1. CRUD API Endpoints: Generic Create, Read, Update, Delete for all database sheets.
 * 2. Specialized Business Logic Endpoints: Employee read models, service timelines,
 *    promotion intelligence, workforce setups, and monthly allowance calculations.
 * 3. Master Data Consolidation: Consolidated bundle fetcher for 0ms frontend caching.
 * 4. Exception & Duplicate Mapping: Serializes errors cleanly and tags duplicate key
 *    conflicts with `status: 'duplicate'` so the UI can trigger prompt modals.
 * 5. Web App Lifecycle: Handles `doGet` template evaluation and fragment inclusion (`include`).
 * ============================================================================
 */

// ============================================================================
// SECTION 1: Generic CRUD API Endpoints
// ============================================================================

/**
 * Reads all active records from a specified database table/sheet.
 * 
 * @param {string} tableName - Name of the target table (e.g. 'employees', 'stations').
 * @returns {Object} JSON payload: { status: 'success', data: Array<Object> } or { status: 'error', message: string }
 */
function api_read(tableName) {
  try {
    if (!tableName || typeof tableName !== 'string') {
      return { status: 'error', message: 'tableName is required and must be a string' };
    }
    var records = Database.getAll(tableName);
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Inserts a new record into a specified database table/sheet.
 * Automatically intercepts base64 images to store them in Google Drive via FileService.
 * Intercepts employee and promotion records to execute business calculations before insert.
 * 
 * @param {string} tableName - Target table name.
 * @param {Object} data - Key-value pair payload representing the row fields.
 * @param {string} [pkPrefix] - Optional primary key prefix (e.g. 'EMP-', 'STA-').
 * @param {string} [pkColName] - Optional primary key column name (e.g. 'emp_id').
 * @returns {Object} JSON payload: { status: 'success', data: Object } or error/duplicate status.
 */
function api_create(tableName, data, pkPrefix, pkColName) {
  try {
    if (!tableName || !data) {
      return { status: 'error', message: 'tableName and data payload are required' };
    }

    // Step 1: Detect and extract Base64 picture payloads into Google Drive
    if (typeof FileService !== 'undefined' && FileService.uploadImage) {
      for (var key in data) {
        if (data.hasOwnProperty(key) && typeof data[key] === 'string' && data[key].indexOf('data:image/') === 0) {
          var filename = key + '_' + new Date().getTime() + '.png';
          data[key] = FileService.uploadImage(data[key], filename);
        }
      }
    }

    // Step 2: Route promotion creation through HrmService to resolve reference numbers & sequences
    if (tableName === 'promotions') {
      var promoResult = HrmService.savePromotion(data);
      return JSON.parse(JSON.stringify({ status: 'success', data: promoResult }));
    }

    // Step 3: Route employee creation through HrmService to calculate statutory retirement date
    if (tableName === 'employees') {
      var empResult = HrmService.saveEmployee(data);
      return JSON.parse(JSON.stringify({ status: 'success', data: empResult }));
    }

    // Step 4: Generic transactional insert with duplicate validation
    var record = Database.insert(tableName, data, pkPrefix, pkColName);
    return JSON.parse(JSON.stringify({ status: 'success', data: record }));
  } catch (e) {
    // Check if error is a duplicate constraint violation
    var isDup = e.isDuplicate || (e.message && (e.message.indexOf('already exists') !== -1 || e.message.indexOf('Duplicate') !== -1));
    return { status: isDup ? 'duplicate' : 'error', message: e.message };
  }
}

/**
 * Updates an existing record in a specified database table/sheet.
 * 
 * @param {string} tableName - Target table name.
 * @param {string} pkColumn - Name of the primary key column (e.g. 'staff_id', 'emp_id').
 * @param {string|number} id - Target record primary key value.
 * @param {Object} data - Key-value pair payload containing fields to update.
 * @returns {Object} JSON payload: { status: 'success', data: Object } or error/duplicate status.
 */
function api_update(tableName, pkColumn, id, data) {
  try {
    if (!tableName || !pkColumn || !id || !data) {
      return { status: 'error', message: 'Missing update parameters (tableName, pkColumn, id, data)' };
    }

    // Handle image upload if a new Base64 picture was provided in the update
    if (typeof FileService !== 'undefined' && FileService.uploadImage) {
      for (var key in data) {
        if (data.hasOwnProperty(key) && typeof data[key] === 'string' && data[key].indexOf('data:image/') === 0) {
          var filename = key + '_' + new Date().getTime() + '.png';
          data[key] = FileService.uploadImage(data[key], filename);
        }
      }
    }

    // Special routing for employee profile updates
    if (tableName === 'employees') {
      data[pkColumn] = id;
      var empUpResult = HrmService.saveEmployee(data);
      return JSON.parse(JSON.stringify({ status: 'success', data: empUpResult }));
    }

    // Generic update via Database DAO
    var record = Database.update(tableName, pkColumn, id, data);
    return JSON.parse(JSON.stringify({ status: 'success', data: record }));
  } catch (e) {
    var isDup = e.isDuplicate || (e.message && (e.message.indexOf('already exists') !== -1 || e.message.indexOf('Duplicate') !== -1));
    return { status: isDup ? 'duplicate' : 'error', message: e.message };
  }
}

/**
 * Deletes a record from a database table/sheet (soft-delete with fallback to physical row removal).
 * 
 * @param {string} tableName - Target table name.
 * @param {string} pkColumn - Primary key column name.
 * @param {string|number} id - Target record ID.
 * @returns {Object} JSON payload: { status: 'success', data: Object } or { status: 'error', message: string }
 */
function api_delete(tableName, pkColumn, id) {
  try {
    if (!tableName || !pkColumn || !id) {
      return { status: 'error', message: 'Missing delete parameters (tableName, pkColumn, id)' };
    }
    var result = Database.deleteRow(tableName, pkColumn, id);
    return JSON.parse(JSON.stringify({ status: 'success', data: result }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ============================================================================
// SECTION 2: Specialized HRM Business Logic Endpoints
// ============================================================================

/**
 * Retrieves the comprehensive canonical read model for employees.
 * Merges placements, postings, promotions, acting assignments, and computed seniority.
 * Powers the 7 primary spreadsheet views.
 * 
 * @param {boolean} [forceRefresh] - Bypasses memory cache if true.
 * @returns {Object} JSON payload containing array of employee detail objects.
 */
function api_get_hrm_details(forceRefresh) {
  try {
    var records = HrmService.getEmployeesDetailsList(forceRefresh);
    return JSON.parse(JSON.stringify({ status: 'success', data: Array.isArray(records) ? records : [] }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Retrieves the complete chronological assignment history for an employee.
 * Calculates segment end dates and highlights longest continuous service.
 * 
 * @param {string} empId - Staff ID of the employee.
 * @param {string} [mode] - History mode ('section' or 'station').
 * @returns {Object} JSON payload with timeline array and longest service summary.
 */
function api_get_service_history(empId, mode) {
  try {
    var history = HrmService.getServiceHistory(empId, mode);
    return JSON.parse(JSON.stringify({ status: 'success', data: history }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Retrieves consolidated promotion batches grouped by official reference letters.
 * 
 * @returns {Object} JSON payload containing promotion batch list.
 */
function api_get_promotion_batches() {
  try {
    var batches = HrmService.getPromotionBatches();
    return JSON.parse(JSON.stringify({ status: 'success', data: batches }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Generates an official individual promotion progression and career summary report.
 * 
 * @param {string} empIdentifier - Employee Staff ID.
 * @returns {Object} JSON payload containing employee promotion report card.
 */
function api_get_employee_promotion_report(empIdentifier) {
  try {
    var report = HrmService.getEmployeePromotionReport(empIdentifier);
    return JSON.parse(JSON.stringify({ status: 'success', data: report }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Retrieves all promotion events with detailed staff, pay group, and sequence info.
 * 
 * @returns {Object} JSON payload containing promotion records array.
 */
function api_get_all_promotions_detailed() {
  try {
    var records = HrmService.getAllPromotionsDetailed();
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Evaluates active employees against promotion eligibility criteria.
 * Criteria: Minimum 3 years in current pay group, satisfactory ACRs, no adverse disciplinary cases.
 * Excludes Pay Group 1 and retired employees.
 * 
 * @param {Object} [filters] - Optional filter parameters (target pay group, etc.).
 * @returns {Object} JSON payload containing eligible candidates.
 */
function api_get_promotion_eligibility(filters) {
  try {
    var records = HrmService.getPromotionEligibilityList(filters);
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Generates the Workforce Sanction vs Existing Headcount vs Deficit report.
 * 
 * @param {Object} [filters] - Optional station, department, or pay group filters.
 * @returns {Object} JSON payload containing setup vs actual deficit rows.
 */
function api_get_workforce_setup_report(filters) {
  try {
    var report = HrmService.getWorkforceSetupReport(filters);
    return JSON.parse(JSON.stringify({ status: 'success', data: report }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Generates the geographical workforce station-to-headcount distribution matrix.
 * 
 * @param {Object} [filters] - Optional filters.
 * @returns {Object} JSON payload containing station-wise deployment numbers.
 */
function api_get_workforce_distribution(filters) {
  try {
    var report = HrmService.getWorkforceDistribution(filters);
    return JSON.parse(JSON.stringify({ status: 'success', data: report }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Computes high-level airline HR metrics (Gender diversity, turnover, tier ratios, etc.).
 * 
 * @returns {Object} JSON payload with statistical analytics KPIs.
 */
function api_get_workforce_analytics() {
  try {
    var analytics = HrmService.getAirlineHRAnalytics();
    return JSON.parse(JSON.stringify({ status: 'success', data: analytics }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Computes monthly payroll/allowance adjustments based on attendance and basic pay.
 * 
 * @param {Object} data - Input payload (staff_id, period, attendance_days, overtime_hours).
 * @returns {Object} JSON payload with computed gross allowance amount.
 */
function api_calculate_allowance(data) {
  try {
    var result = HrmService.calculateAllowance(data);
    return JSON.parse(JSON.stringify({ status: 'success', data: result }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ============================================================================
// SECTION 3: Consolidated Master Reference Data Fetcher
// ============================================================================

/**
 * Consolidates all reference datasets (stations, pay groups, shifts, directorates,
 * departments, sections, work locations, employee types) into a single payload.
 * Synthesizes 3NF organizational units into legacy hierarchical collections
 * for seamless backward compatibility.
 * 
 * @param {boolean} [forceRefresh] - Bypasses cache if true.
 * @returns {Object} Consolidated master reference dictionary.
 */
function api_get_master_data(forceRefresh) {
  try {
    var rawOrgUnits = Database.getAll('organization_units', forceRefresh) || [];
    var rawDirectorates = [];
    var rawDepartments = [];
    var rawSections = [];
    if (rawOrgUnits.length === 0) {
      // Legacy fallback only if organization_units has no records
      rawDirectorates = Database.getAll('directorates', forceRefresh) || [];
      rawDepartments = Database.getAll('departments', forceRefresh) || [];
      rawSections = Database.getAll('sections', forceRefresh) || [];
    }

    // Synthesize 3NF collections dynamically from centralized organization_units
    var synthDirectorates = [];
    var synthDepartments = [];
    var synthSections = [];

    rawOrgUnits.forEach(function(u) {
      var type = String(u.unit_type || '').toUpperCase();
      if (type === 'DIRECTORATE' || type === 'HEADQUARTER' || (!u.parent_unit_id && type !== 'SECTION' && type !== 'DEPARTMENT')) {
        synthDirectorates.push({
          dir_id: u.unit_id,
          dir_code: u.unit_code,
          dir_letter_code: u.letter_code || u.unit_code,
          dir_name: u.unit_name,
          unit_id: u.unit_id,
          unit_code: u.unit_code,
          unit_name: u.unit_name
        });
      }
      if (type === 'DEPARTMENT' || type === 'DIVISION') {
        synthDepartments.push({
          dep_id: u.unit_id,
          dir_id: u.parent_unit_id || '',
          dep_code: u.unit_code,
          dep_letter_code: u.letter_code || u.unit_code,
          dep_name: u.unit_name,
          unit_id: u.unit_id,
          unit_code: u.unit_code,
          unit_name: u.unit_name
        });
      }
      if (type === 'SECTION' || type === 'WING' || type === 'UNIT') {
        synthSections.push({
          sec_id: u.unit_id,
          dep_id: u.parent_unit_id || '',
          location_id: u.location_id || '',
          station_id: u.station_id || '',
          sec_code: u.unit_code,
          sec_letter_code: u.letter_code || u.unit_code,
          sec_name: u.unit_name,
          unit_id: u.unit_id,
          unit_code: u.unit_code,
          unit_name: u.unit_name
        });
      }
    });

    var finalDirectorates = synthDirectorates.length > 0 ? synthDirectorates : rawDirectorates;
    var finalDepartments = synthDepartments.length > 0 ? synthDepartments : rawDepartments;
    var finalSections = synthSections.length > 0 ? synthSections : rawSections;

    var masterData = {
      directorates: finalDirectorates,
      departments: finalDepartments,
      sections: finalSections,
      organization_units: rawOrgUnits,
      stations: Database.getAll('stations', forceRefresh),
      work_locations: Database.getAll('work_locations', forceRefresh),
      shifts: Database.getAll('shifts', forceRefresh),
      pay_groups: Database.getAll('pay_groups', forceRefresh),
      employee_types: Database.getAll('employee_types', forceRefresh),
      workforce_setup: Database.getAll('workforce_setup', forceRefresh)
    };

    return JSON.parse(JSON.stringify({ status: 'success', data: masterData }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Flushes all in-memory server cache objects across Database DAO and HrmService.
 * 
 * @returns {Object} JSON status confirmation.
 */
function api_clear_all_caches() {
  try {
    Database.invalidateCache();
    return { status: 'success', message: 'All server caches cleared successfully.' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Administrative maintenance utility.
 * Validates and ensures that all 25+ worksheets and their mandatory audit columns exist in Google Sheets.
 * 
 * @returns {Object} JSON summary of checked/updated tables.
 */
function api_sync_tables_and_audit() {
  try {
    var res = Database.ensureAllTablesAndAuditColumns();
    return { status: 'success', data: res };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

// ============================================================================
// SECTION 4: Web App Lifecycle & HTML Fragment Inclusion
// ============================================================================

/**
 * Primary HTTP GET entry point for Google Apps Script Web App.
 * Evaluates Index.html template with embedded Styles, Schemas, and Controllers.
 * 
 * @param {Object} e - HTTP event parameters.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} Rendered web application page.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SANDVIORA AVIOSOLUTION | Enterprise Aviation Platform')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Server-side HTML template fragment inclusion helper.
 * Used inside HTML files with scriptlet syntax: <?!= include('Filename'); ?>
 * 
 * @param {string} filename - Base name of the HTML fragment file (e.g. 'Styles', 'Api').
 * @returns {string} Raw HTML content of the target file.
 * @throws {Error} If the target file does not exist in the project.
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    try {
      return HtmlService.createHtmlOutputFromFile(filename + '.html').getContent();
    } catch (e2) {
      throw new Error("Could not find HTML file named '" + filename + "'.");
    }
  }
}
