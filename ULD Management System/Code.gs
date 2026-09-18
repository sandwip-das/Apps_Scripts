/**
 * ULD Inventory Management System - Google Apps Script Backend
 * 
 * Target Platform: Google Apps Script (V8 Engine)
 * Database: Google Sheets (Spreadsheet API)
 * Design: High Performance, Zero Heavy Frameworks, Lightweight JSON RPC
 */

// Global Config & Constants
const SPREADSHEET_ID_PROPERTY = 'SPREADSHEET_ID';
const DEFAULT_ADMIN_EMAIL = 'admin@system.local';
const DEFAULT_ADMIN_OTP = 'Admin123!';

/**
 * Serves the HTML Web App UI
 */
function doGet(e) {
  try {
    initDatabase(); // Ensures database structure is ready
    const template = HtmlService.createTemplateFromFile('Index');
    return template.evaluate()
      .setTitle('ULD Inventory Management System')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return HtmlService.createHtmlOutput('<h3>Error initializing application: ' + err.toString() + '</h3>');
  }
}

/**
 * Helper to include partial HTML files (Styles, JavaScript) into main Index.html
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Helper to get or bind active Google Spreadsheet DB
 */
function getSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let sheetId = props.getProperty(SPREADSHEET_ID_PROPERTY);
  let ss = null;

  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {
    // Create new spreadsheet if none is bound
    ss = SpreadsheetApp.create('ULD_Inventory_Database');
    PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_PROPERTY, ss.getId());
  }

  return ss;
}

/**
 * Database Initializer - Creates tabs & seeds initial Admin + Prefixes
 */
function initDatabase() {
  const ss = getSpreadsheet();
  
  // Sheet Definitions with Headers
  const tables = {
    'USERS': ['user_id', 'name', 'email', 'role', 'password_hash', 'is_otp', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at'],
    'ULD_PREFIXES': ['prefix_id', 'prefix_code', 'type', 'description', 'status', 'created_by', 'created_at', 'updated_by', 'updated_at'],
    'INVENTORY_TRANSACTIONS': ['txn_id', 'prefix', 'number', 'full_uld_number', 'type', 'transaction_type', 'quantity', 'remarks', 'created_by', 'created_at', 'updated_by', 'updated_at'],
    'AUDIT_LOGS': ['log_id', 'user_id', 'user_email', 'action', 'details', 'timestamp']
  };

  for (let sheetName in tables) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(tables[sheetName]);
      // Format Header Row
      const headerRange = sheet.getRange(1, 1, 1, tables[sheetName].length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#1e3b2c');
      headerRange.setFontColor('#ffffff');
    }
  }

  // Remove default "Sheet1" if present
  let defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  // Seed Default Admin User if USERS is empty
  const userSheet = ss.getSheetByName('USERS');
  if (userSheet.getLastRow() <= 1) {
    const adminId = 'USR-' + Utilities.getUuid().substring(0, 8);
    const now = new Date().toISOString();
    const adminPassHash = hashPassword(DEFAULT_ADMIN_OTP);
    
    userSheet.appendRow([
      adminId,
      'System Administrator',
      DEFAULT_ADMIN_EMAIL,
      'ADMIN',
      adminPassHash,
      'TRUE', // Required OTP change on first login
      'ACTIVE',
      'SYSTEM',
      now,
      'SYSTEM',
      now
    ]);

    logActivityDirect(adminId, DEFAULT_ADMIN_EMAIL, 'SYSTEM_INIT', 'Default admin user created');
  }

  // Seed Default ULD Prefixes if ULD_PREFIXES is empty
  const prefixSheet = ss.getSheetByName('ULD_PREFIXES');
  if (prefixSheet.getLastRow() <= 1) {
    const now = new Date().toISOString();
    const defaultPrefixes = [
      ['PRX-001', 'AKE', 'Container', 'Standard Main Deck / Lower Deck Container', 'ACTIVE', 'SYSTEM', now, 'SYSTEM', now],
      ['PRX-002', 'ALF', 'Container', 'Full Width Lower Deck Container', 'ACTIVE', 'SYSTEM', now, 'SYSTEM', now],
      ['PRX-003', 'PAG', 'Palette', 'Standard Aircraft Cargo Palette', 'ACTIVE', 'SYSTEM', now, 'SYSTEM', now],
      ['PRX-004', 'PMC', 'Palette', '10-Foot Cargo Palette', 'ACTIVE', 'SYSTEM', now, 'SYSTEM', now]
    ];
    defaultPrefixes.forEach(row => prefixSheet.appendRow(row));
  }
}

/**
 * Utility: Password Hashing using SHA-256
 */
function hashPassword(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return digest.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
}

/**
 * Helper: Convert Sheet to Array of Objects
 */
function getSheetObjects(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const results = [];

  for (let i = 1; i < data.length; i++) {
    let row = data[i];
    let obj = {};
    let empty = true;
    for (let j = 0; j < headers.length; j++) {
      let val = row[j];
      if (val instanceof Date) {
        val = val.toISOString();
      }
      obj[headers[j]] = val;
      if (val !== '' && val !== null) empty = false;
    }
    if (!empty) results.push(obj);
  }
  return results;
}

/**
 * Direct Log Activity helper
 */
function logActivityDirect(userId, userEmail, action, details) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('AUDIT_LOGS');
    if (sheet) {
      const logId = 'LOG-' + Utilities.getUuid().substring(0, 8);
      sheet.appendRow([logId, userId || 'UNKNOWN', userEmail || 'UNKNOWN', action, details, new Date().toISOString()]);
    }
  } catch (e) {
    Logger.log('Error writing log: ' + e.toString());
  }
}

/**
 * API: Authentication - User Login
 */
function loginUser(email, password) {
  try {
    if (!email || !password) {
      return { success: false, message: 'Contact your administrator' };
    }

    const users = getSheetObjects('USERS');
    const inputHash = hashPassword(password);
    const user = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase() || u.user_id.toLowerCase() === email.trim().toLowerCase());

    if (!user) {
      return { success: false, message: 'Contact your administrator' };
    }

    if (user.status !== 'ACTIVE') {
      return { success: false, message: 'Contact your administrator' };
    }

    if (user.password_hash !== inputHash) {
      return { success: false, message: 'Contact your administrator' };
    }

    // Generate lightweight Session Token
    const sessionToken = Utilities.base64Encode(JSON.stringify({
      userId: user.user_id,
      email: user.email,
      role: user.role,
      exp: new Date().getTime() + (8 * 60 * 60 * 1000) // 8 Hours
    }));

    logActivityDirect(user.user_id, user.email, 'USER_LOGIN', 'Successful user login');

    return {
      success: true,
      token: sessionToken,
      user: {
        userId: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        isOtp: String(user.is_otp).toUpperCase() === 'TRUE'
      }
    };
  } catch (err) {
    return { success: false, message: 'Contact your administrator' };
  }
}

/**
 * API: Authentication - Verify Session Token
 */
function verifySession(token) {
  if (!token) return null;
  try {
    const jsonStr = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    const session = JSON.parse(jsonStr);
    if (new Date().getTime() > session.exp) return null;

    const users = getSheetObjects('USERS');
    const user = users.find(u => u.user_id === session.userId && u.status === 'ACTIVE');
    if (!user) return null;

    return {
      userId: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      isOtp: String(user.is_otp).toUpperCase() === 'TRUE'
    };
  } catch (e) {
    return null;
  }
}

/**
 * API: Force Password Reset for OTP Users
 */
function changePassword(token, currentPassword, newPassword) {
  try {
    const session = verifySession(token);
    if (!session) return { success: false, message: 'Unauthorized session.' };

    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: 'New password must be at least 6 characters.' };
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('USERS');
    const data = sheet.getDataRange().getValues();
    const currentHash = hashPassword(currentPassword);
    const newHash = hashPassword(newPassword);
    const now = new Date().toISOString();

    let userFound = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === session.userId) {
        if (data[i][4] !== currentHash) {
          return { success: false, message: 'Current OTP password is incorrect.' };
        }
        // Update password_hash (col 5), is_otp (col 6 = FALSE), updated_by (col 10), updated_at (col 11)
        sheet.getRange(i + 1, 5).setValue(newHash);
        sheet.getRange(i + 1, 6).setValue('FALSE');
        sheet.getRange(i + 1, 10).setValue(session.userId);
        sheet.getRange(i + 1, 11).setValue(now);
        userFound = true;
        break;
      }
    }

    if (!userFound) return { success: false, message: 'User record not found.' };

    logActivityDirect(session.userId, session.email, 'PASSWORD_CHANGE', 'User updated password successfully');
    return { success: true, message: 'Password updated successfully! You can now access full dashboard.' };
  } catch (err) {
    return { success: false, message: 'Password reset error: ' + err.toString() };
  }
}

/**
 * API: Admin - Create New User with OTP
 */
function adminCreateUser(token, name, email, role, otpPassword) {
  try {
    const session = verifySession(token);
    if (!session || session.role !== 'ADMIN') {
      return { success: false, message: 'Access denied. Admin rights required.' };
    }

    if (!name || !email || !role || !otpPassword) {
      return { success: false, message: 'All fields (Name, Email, Role, OTP) are required.' };
    }

    const users = getSheetObjects('USERS');
    if (users.some(u => u.email.toLowerCase() === email.trim().toLowerCase())) {
      return { success: false, message: 'User with this email already exists.' };
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('USERS');
    const newUserId = 'USR-' + Utilities.getUuid().substring(0, 8);
    const passHash = hashPassword(otpPassword);
    const now = new Date().toISOString();

    sheet.appendRow([
      newUserId,
      name.trim(),
      email.trim().toLowerCase(),
      role.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER',
      passHash,
      'TRUE', // OTP Flag active
      'ACTIVE',
      session.userId,
      now,
      session.userId,
      now
    ]);

    logActivityDirect(session.userId, session.email, 'CREATE_USER', `Created new user: ${email} (${role})`);
    return { success: true, message: `User ${email} created successfully with One-Time Password.` };
  } catch (err) {
    return { success: false, message: 'User creation error: ' + err.toString() };
  }
}

/**
 * API: Admin - Reset Existing User Password to New OTP
 */
function adminResetUserOtp(token, targetUserId, newOtp) {
  try {
    const session = verifySession(token);
    if (!session || session.role !== 'ADMIN') {
      return { success: false, message: 'Access denied. Admin rights required.' };
    }

    if (!targetUserId || !newOtp || newOtp.length < 4) {
      return { success: false, message: 'Valid Target User ID and new OTP (Min 4 chars) are required.' };
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('USERS');
    const data = sheet.getDataRange().getValues();
    const newHash = hashPassword(newOtp);
    const now = new Date().toISOString();

    let userFound = false;
    let targetEmail = '';

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === targetUserId) {
        targetEmail = data[i][2];
        // Update password_hash (col 5), is_otp (col 6 = TRUE), updated_by (col 10), updated_at (col 11)
        sheet.getRange(i + 1, 5).setValue(newHash);
        sheet.getRange(i + 1, 6).setValue('TRUE');
        sheet.getRange(i + 1, 10).setValue(session.userId);
        sheet.getRange(i + 1, 11).setValue(now);
        userFound = true;
        break;
      }
    }

    if (!userFound) return { success: false, message: 'User record not found.' };

    logActivityDirect(session.userId, session.email, 'RESET_USER_OTP', `Reset OTP for user ${targetEmail} (${targetUserId})`);
    return { success: true, message: `New OTP generated for user ${targetUserId}. User must change password upon next login.` };
  } catch (err) {
    return { success: false, message: 'Reset OTP error: ' + err.toString() };
  }
}

/**
 * API: Admin - Fetch User List
 */
function adminGetUsers(token) {
  const session = verifySession(token);
  if (!session || session.role !== 'ADMIN') {
    return { success: false, message: 'Access denied.' };
  }
  const users = getSheetObjects('USERS').map(u => ({
    userId: u.user_id,
    name: u.name,
    email: u.email,
    role: u.role,
    isOtp: u.is_otp,
    status: u.status,
    createdAt: u.created_at
  }));
  return { success: true, users: users };
}

/**
 * API: Admin - Manage ULD Prefixes (Add Prefix)
 */
function adminAddUldPrefix(token, prefixCode, type, description) {
  try {
    const session = verifySession(token);
    if (!session || session.role !== 'ADMIN') {
      return { success: false, message: 'Access denied. Admin rights required.' };
    }

    if (!prefixCode || !type) {
      return { success: false, message: 'Prefix Code and Type (Container/Palette) are required.' };
    }

    const cleanCode = prefixCode.trim().toUpperCase();
    const prefixes = getSheetObjects('ULD_PREFIXES');
    if (prefixes.some(p => p.prefix_code.toUpperCase() === cleanCode)) {
      return { success: false, message: `Prefix '${cleanCode}' already exists.` };
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('ULD_PREFIXES');
    const prefixId = 'PRX-' + Utilities.getUuid().substring(0, 8);
    const now = new Date().toISOString();

    sheet.appendRow([
      prefixId,
      cleanCode,
      type === 'Container' ? 'Container' : 'Palette',
      description || '',
      'ACTIVE',
      session.userId,
      now,
      session.userId,
      now
    ]);

    logActivityDirect(session.userId, session.email, 'ADD_PREFIX', `Added ULD prefix: ${cleanCode} (${type})`);
    return { success: true, message: `ULD Prefix '${cleanCode}' added successfully.` };
  } catch (err) {
    return { success: false, message: 'Add prefix error: ' + err.toString() };
  }
}

/**
 * API: Get Active ULD Prefixes for Dropdown (Available for all authenticated users)
 */
function getActiveUldPrefixes(token) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'Unauthorized session.' };

  const prefixes = getSheetObjects('ULD_PREFIXES')
    .filter(p => String(p.status).toUpperCase() === 'ACTIVE')
    .map(p => ({
      prefixId: p.prefix_id,
      prefixCode: p.prefix_code,
      type: p.type,
      description: p.description
    }));

  return { success: true, prefixes: prefixes };
}

/**
 * API: Transaction - Record ULD In / ULD Out
 */
function addInventoryTransaction(token, prefixCode, number, txnType, quantity, remarks) {
  try {
    const session = verifySession(token);
    if (!session) return { success: false, message: 'Unauthorized session.' };

    if (!prefixCode || !number || !txnType) {
      return { success: false, message: 'Prefix, 5-digit number, and transaction type are required.' };
    }

    // Format 5-digit number
    const formattedNum = String(number).padStart(5, '0');
    if (!/^\d{5}$/.test(formattedNum)) {
      return { success: false, message: 'ULD Number must be exactly 5 digits (e.g. 02587).' };
    }

    // Find Prefix to determine Type (Container vs Palette)
    const prefixes = getSheetObjects('ULD_PREFIXES');
    const matchedPrefix = prefixes.find(p => p.prefix_code.toUpperCase() === prefixCode.toUpperCase());
    if (!matchedPrefix) {
      return { success: false, message: `Invalid ULD Prefix '${prefixCode}'.` };
    }

    const type = matchedPrefix.type; // 'Container' or 'Palette'
    const fullUldNum = prefixCode.toUpperCase() + formattedNum;
    const qty = parseInt(quantity, 10) || 1;
    const cleanTxnType = txnType === 'ULD Out' ? 'ULD Out' : 'ULD In';

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('INVENTORY_TRANSACTIONS');
    const txnId = 'TXN-' + Utilities.getUuid().substring(0, 8);
    const now = new Date().toISOString();

    sheet.appendRow([
      txnId,
      prefixCode.toUpperCase(),
      formattedNum,
      fullUldNum,
      type,
      cleanTxnType,
      qty,
      remarks || '',
      session.userId,
      now,
      session.userId,
      now
    ]);

    logActivityDirect(session.userId, session.email, 'ADD_TRANSACTION', `Recorded ${cleanTxnType} for ${fullUldNum} (Qty: ${qty}, Type: ${type})`);
    return { success: true, message: `Successfully recorded ${cleanTxnType} for ${fullUldNum}` };
  } catch (err) {
    return { success: false, message: 'Transaction error: ' + err.toString() };
  }
}

/**
 * API: Reporting - Fetch Stock Summary & Transaction History
 */
function getInventoryData(token) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'Unauthorized session.' };

  const txns = getSheetObjects('INVENTORY_TRANSACTIONS');
  
  // Calculate Live Stock by ULD Registration
  const stockMap = {};

  txns.forEach(t => {
    const key = t.full_uld_number;
    if (!stockMap[key]) {
      stockMap[key] = {
        fullUldNumber: t.full_uld_number,
        prefix: t.prefix,
        number: t.number,
        type: t.type, // Container or Palette
        totalIn: 0,
        totalOut: 0,
        currentStock: 0,
        lastUpdated: t.created_at
      };
    }

    const qty = parseInt(t.quantity, 10) || 1;
    if (t.transaction_type === 'ULD In') {
      stockMap[key].totalIn += qty;
    } else if (t.transaction_type === 'ULD Out') {
      stockMap[key].totalOut += qty;
    }
    stockMap[key].currentStock = stockMap[key].totalIn - stockMap[key].totalOut;
    stockMap[key].lastUpdated = t.created_at;
  });

  const stockList = Object.values(stockMap);

  return {
    success: true,
    transactions: txns.reverse(), // latest first
    stock: stockList
  };
}

/**
 * API: Dynamic Reports Generator (Daily, Weekly, Monthly)
 */
function getReportData(token, reportType, targetDateStr) {
  const session = verifySession(token);
  if (!session) return { success: false, message: 'Unauthorized session.' };

  const txns = getSheetObjects('INVENTORY_TRANSACTIONS');
  const now = targetDateStr ? new Date(targetDateStr) : new Date();
  
  let filteredTxns = [];

  if (reportType === 'DAILY') {
    const targetDateIso = now.toISOString().split('T')[0];
    filteredTxns = txns.filter(t => {
      const d = new Date(t.created_at).toISOString().split('T')[0];
      return d === targetDateIso;
    });
  } else if (reportType === 'WEEKLY') {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    filteredTxns = txns.filter(t => {
      const d = new Date(t.created_at);
      return d >= startOfWeek && d <= now;
    });
  } else if (reportType === 'MONTHLY') {
    const targetMonth = now.getMonth();
    const targetYear = now.getFullYear();
    filteredTxns = txns.filter(t => {
      const d = new Date(t.created_at);
      return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
    });
  } else {
    filteredTxns = txns;
  }

  // Aggregate breakdown by Container vs Palette
  const containerSummary = { totalIn: 0, totalOut: 0, netChange: 0, uniqueUlds: new Set() };
  const paletteSummary = { totalIn: 0, totalOut: 0, netChange: 0, uniqueUlds: new Set() };

  filteredTxns.forEach(t => {
    const qty = parseInt(t.quantity, 10) || 1;
    if (t.type === 'Container') {
      containerSummary.uniqueUlds.add(t.full_uld_number);
      if (t.transaction_type === 'ULD In') containerSummary.totalIn += qty;
      else if (t.transaction_type === 'ULD Out') containerSummary.totalOut += qty;
    } else if (t.type === 'Palette') {
      paletteSummary.uniqueUlds.add(t.full_uld_number);
      if (t.transaction_type === 'ULD In') paletteSummary.totalIn += qty;
      else if (t.transaction_type === 'ULD Out') paletteSummary.totalOut += qty;
    }
  });

  containerSummary.netChange = containerSummary.totalIn - containerSummary.totalOut;
  containerSummary.uniqueCount = containerSummary.uniqueUlds.size;
  delete containerSummary.uniqueUlds;

  paletteSummary.netChange = paletteSummary.totalIn - paletteSummary.totalOut;
  paletteSummary.uniqueCount = paletteSummary.uniqueUlds.size;
  delete paletteSummary.uniqueUlds;

  logActivityDirect(session.userId, session.email, 'GENERATE_REPORT', `Generated ${reportType} report`);

  return {
    success: true,
    reportType: reportType,
    containerSummary: containerSummary,
    paletteSummary: paletteSummary,
    transactions: filteredTxns
  };
}

/**
 * API: Admin - Fetch Audit Logs (Exclusive for Admin)
 */
function adminGetAuditLogs(token) {
  const session = verifySession(token);
  if (!session || session.role !== 'ADMIN') {
    return { success: false, message: 'Access denied. Only System Administrator can view Audit Trail.' };
  }

  const logs = getSheetObjects('AUDIT_LOGS');
  return { success: true, logs: logs.reverse() }; // Newest logs first
}
