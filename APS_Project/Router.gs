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
function api_get_hrm_details() {
  try {
    AuthService.enforcePermission('View');
    var records = HrmService.getEmployeesDetailsList();
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
