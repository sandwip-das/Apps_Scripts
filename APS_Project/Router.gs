/**
 * Global Router / API Endpoints
 * All requests from the SPA hit these functions.
 */

function api_read(tableName) {
  try {
    AuthService.enforcePermission('View');
    var records = Database.getAll(tableName);
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Universal Duplicate Data Validator
 * Ensures no unique codes or exact rows are duplicated across ANY table.
 */
function validateUniqueness(tableName, data, excludeId, pkColumn) {
  var existingRecords = Database.getAll(tableName);
  
  for (var i = 0; i < existingRecords.length; i++) {
    // If updating, skip comparing against the record being updated itself
    if (excludeId && existingRecords[i][pkColumn] === excludeId) continue;
    
    var matchCount = 0;
    var keysCount = 0;
    
    for (var key in data) {
      if (data.hasOwnProperty(key) && data[key] !== '') {
        keysCount++;
        
        // 1. Strict Unique Fields (Applies to ORG, HRM, TQC)
        var isUniqueField = key.endsWith('_code') || 
                            key === 'pay_group' || 
                            key === 'staff_id' || 
                            key === 'email' || 
                            key === 'contact_primary';
                            
        if (isUniqueField && existingRecords[i][key] !== undefined) {
          if (String(existingRecords[i][key]).toLowerCase() === String(data[key]).toLowerCase()) {
            throw new Error("Duplicate entry blocked: '" + data[key] + "' already exists. Please use a unique value.");
          }
        }
        
        // Count exact matches for full row duplication check
        if (existingRecords[i][key] !== undefined && String(existingRecords[i][key]).trim() === String(data[key]).trim()) {
          matchCount++;
        }
      }
    }
    
    // 2. Check for exact duplicate row (all fields match exactly)
    if (keysCount > 0 && matchCount === keysCount) {
      throw new Error("This exact data already exists in the system. Duplicates are not allowed.");
    }
  }
}

/**
 * Intercepts Base64 image strings from the frontend, uploads them to Drive, and replaces
 * the data payload with the actual Drive URL.
 */
function processUploads(data) {
  if (typeof FileService === 'undefined') return;
  for (var key in data) {
    if (data.hasOwnProperty(key) && typeof data[key] === 'string' && data[key].indexOf('data:image/') === 0) {
      // Generate a unique filename using timestamp
      var filename = key + '_' + new Date().getTime() + '.png';
      data[key] = FileService.uploadImage(data[key], filename);
    }
  }
}

function api_create(tableName, data, pkPrefix, pkColName) {
  try {
    AuthService.enforcePermission('Create');
    processUploads(data);
    validateUniqueness(tableName, data, null, null);
    var record = Database.insert(tableName, data, pkPrefix, pkColName);
    return JSON.parse(JSON.stringify({ status: 'success', data: record }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_create_bulk_promotions(data, pkPrefix, pkColName) {
  try {
    AuthService.enforcePermission('Create');
    processUploads(data);
    
    var bulkData = data.bulk_staff_data;
    if (!bulkData || typeof bulkData !== 'string') {
      throw new Error("Bulk staff data is required and must be text.");
    }
    
    var tokens = bulkData.trim().split(/\s+/);
    if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === '')) {
      throw new Error("No Staff ID and Sequence Number entries found.");
    }
    
    if (tokens.length % 2 !== 0) {
      throw new Error("Invalid bulk data format. Each Staff ID must have a corresponding Sequence Number. (Total values: " + tokens.length + ")");
    }
    
    // Create map of existing employees by staff_id for O(1) checks
    var employees = Database.getAll('employees');
    var empStaffIdMap = {};
    employees.forEach(function(emp) {
      if (emp.staff_id) {
        empStaffIdMap[String(emp.staff_id).trim().toUpperCase()] = true;
      }
    });
    
    var batchKeys = {};
    var promotionsToInsert = [];
    
    // First pass: validation
    for (var i = 0; i < tokens.length; i += 2) {
      var staffId = tokens[i].trim();
      var seqNoStr = tokens[i+1].trim();
      
      // Check if employee exists
      if (!empStaffIdMap[staffId.toUpperCase()]) {
        throw new Error("Validation Error: Employee with Staff ID '" + staffId + "' does not exist.");
      }
      
      // Check sequence number is a valid positive integer
      var seqNo = parseInt(seqNoStr, 10);
      if (isNaN(seqNo) || seqNo <= 0 || String(seqNo) !== seqNoStr) {
        throw new Error("Validation Error: Sequence number for Staff ID '" + staffId + "' must be a valid positive integer. Got: '" + seqNoStr + "'");
      }
      
      // Check for duplicate entry in this batch
      var batchKey = staffId.toUpperCase() + '_' + seqNo;
      if (batchKeys[batchKey]) {
        throw new Error("Validation Error: Duplicate entry in batch for Staff ID '" + tokens[i] + "' and Sequence Number '" + seqNoStr + "'.");
      }
      batchKeys[batchKey] = true;
      
      var promoRecord = {
        emp_id: staffId, // promotions.emp_id stores the staff_id
        sequence_no: seqNo,
        present_pg_id: data.present_pg_id,
        promoted_pg_id: data.promoted_pg_id,
        promotion_date: data.promotion_date
      };
      
      // Check database uniqueness
      validateUniqueness('promotions', promoRecord, null, null);
      
      promotionsToInsert.push(promoRecord);
    }
    
    // Second pass: batch insert
    var insertedRecords = Database.insertBatch('promotions', promotionsToInsert, pkPrefix, pkColName);
    
    return JSON.parse(JSON.stringify({ status: 'success', data: insertedRecords }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_update(tableName, pkColumn, id, data) {
  try {
    AuthService.enforcePermission('Edit');
    processUploads(data);
    validateUniqueness(tableName, data, id, pkColumn);
    var record = Database.update(tableName, pkColumn, id, data);
    return JSON.parse(JSON.stringify({ status: 'success', data: record }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_delete(tableName, pkColumn, id) {
  try {
    AuthService.enforcePermission('Delete');
    var result = Database.softDelete(tableName, pkColumn, id);
    return JSON.parse(JSON.stringify({ status: 'success', data: result }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/** 
 * Complex Business Logic APIs 
 */
function api_get_hrm_details(forceRefresh) {
  try {
    AuthService.enforcePermission('View');
    var records = HrmService.getEmployeesDetailsList(forceRefresh);
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_get_service_history(empId) {
  try {
    AuthService.enforcePermission('View');
    var records = HrmService.getServiceHistory(empId);
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_get_tqc_records() {
  try {
    AuthService.enforcePermission('View');
    var records = TqcService.getTrainingRecords();
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_get_promotions_detailed() {
  try {
    AuthService.enforcePermission('View');
    var records = HrmService.getAllPromotionsDetailed();
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_get_employee_promotion_report(empIdentifier) {
  try {
    AuthService.enforcePermission('View');
    var report = HrmService.getEmployeePromotionReport(empIdentifier);
    return JSON.parse(JSON.stringify({ status: 'success', data: report }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_get_promotion_eligibility() {
  try {
    AuthService.enforcePermission('View');
    var records = HrmService.getPromotionEligibilityList();
    return JSON.parse(JSON.stringify({ status: 'success', data: records }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/**
 * Enterprise Workforce APIs
 */
function api_get_workforce_setup_report(filters) {
  try {
    AuthService.enforcePermission('View');
    var report = HrmService.getWorkforceSetupReport(filters);
    return JSON.parse(JSON.stringify({ status: 'success', data: report }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_get_workforce_distribution(filters) {
  try {
    AuthService.enforcePermission('View');
    var report = HrmService.getWorkforceDistribution(filters);
    return JSON.parse(JSON.stringify({ status: 'success', data: report }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_get_workforce_analytics() {
  try {
    AuthService.enforcePermission('View');
    var analytics = HrmService.getAirlineHRAnalytics();
    return JSON.parse(JSON.stringify({ status: 'success', data: analytics }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}


/**
 * Consolidated Master Reference Data Fetcher
 * Loads all static reference tables in a single spreadsheet read pass for fast client caching.
 */
function api_get_master_data(forceRefresh) {
  try {
    AuthService.enforcePermission('View');
    if (!forceRefresh && Database.ServerCache) {
      var cached = Database.ServerCache.get('cache_master_data');
      if (cached) {
        return JSON.parse(JSON.stringify({ status: 'success', data: cached }));
      }
    }
    var masterData = {
      directorates: Database.getAll('directorates', forceRefresh),
      departments: Database.getAll('departments', forceRefresh),
      stations: Database.getAll('stations', forceRefresh),
      sections: Database.getAll('sections', forceRefresh),
      shifts: Database.getAll('shifts', forceRefresh),
      pay_groups: Database.getAll('pay_groups', forceRefresh),
      employee_types: Database.getAll('employee_types', forceRefresh),
      courses: Database.getAll('courses', forceRefresh),
      workforce_setup: Database.getAll('workforce_setup', forceRefresh)
    };
    if (Database.ServerCache) {
      Database.ServerCache.put('cache_master_data', masterData, 21600);
    }
    return JSON.parse(JSON.stringify({ status: 'success', data: masterData }));
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function api_clear_all_caches() {
  try {
    AuthService.enforcePermission('View');
    Database.invalidateCache();
    return { status: 'success', message: 'All server caches cleared.' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

/** Specific complex queries can go here or in specific Service files */

/**
 * doGet is executed when the Web App URL is visited.
 * It serves the Index.html file as the main Single Page Application (SPA).
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  var output = template.evaluate();
  
  // Extract title dynamically from Index.html so the user can easily control it
  var content = output.getContent();
  var titleMatch = content.match(/<title>(.*?)<\/title>/i);
  var pageTitle = titleMatch ? titleMatch[1] : 'App';
  
  return output
    .setTitle(pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * include is a helper function to include HTML/JS/CSS fragments within the main Index.html.
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    try {
      return HtmlService.createHtmlOutputFromFile(filename + '.html').getContent();
    } catch (e2) {
      throw new Error("Could not find HTML file named '" + filename + "'. Please ensure it's created as an HTML file in the editor.");
    }
  }
}
