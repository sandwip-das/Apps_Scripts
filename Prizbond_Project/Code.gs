/**
 * Prizebond Project - Google Apps Script Backend (Normalized RDBMS)
 * 
 * Instructions:
 * 1. Open Google Sheets and create a new spreadsheet.
 * 2. Create the following sheet tabs: 'Users', 'Profiles', 'PrizeBonds', 'Draws', 'DrawResults', 'WinningMatches', 'Tickets', 'TicketReplies', 'SupportSettings', 'AuditLogs'.
 * 3. Go to Extensions > Apps Script.
 * 4. Paste this code into Code.gs and save.
 * 5. Click Deploy > New Deployment. Select 'Web app', execute as 'Me', and access 'Anyone'.
 * 6. Copy the resulting Web App URL. You will use this URL to make API requests from your frontend.
 */

// Global Config
// Global Config
let SHEET_ID = "";
try {
  const activeSS = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSS) {
    SHEET_ID = activeSS.getId();
  }
} catch (e) {
  // Ignore error during global initialization
}

function getSpreadsheet() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {
    // ignore
  }

  // Fallback to SHEET_ID if defined
  if (typeof SHEET_ID !== 'undefined' && SHEET_ID) {
    try {
      return SpreadsheetApp.openById(SHEET_ID);
    } catch(e) {
      // ignore
    }
  }

  // Fallback to Script Properties
  try {
    const propId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (propId) {
      return SpreadsheetApp.openById(propId);
    }
  } catch(e) {
    // ignore
  }

  throw new Error("Target Spreadsheet not found. Please ensure this script is container-bound to a Google Sheet (Extensions > Apps Script), or set the SHEET_ID script property.");
}

function checkAndSetupDatabase() {
  try {
    const ss = getSpreadsheet();
    if (!ss) return;
    const requiredTables = ['Users', 'Profiles', 'PrizeBonds', 'Draws', 'DrawResults', 'WinningMatches', 'Tickets', 'TicketReplies', 'SupportSettings', 'AuditLogs'];
    let needsSetup = false;
    for (let i = 0; i < requiredTables.length; i++) {
      if (!ss.getSheetByName(requiredTables[i])) {
        needsSetup = true;
        break;
      }
    }
    if (needsSetup) {
      setupDatabase();
    }
  } catch(e) {
    console.error("Database setup check failed: " + e.message);
  }
}

// API Entry Point
function doPost(e) {
  // Ensure database is initialized
  checkAndSetupDatabase();

  const action = e.parameter.action;
  let response = { success: false, message: "Unknown action" };

  try {
    switch (action) {
      case 'adminCreateUser':
        response = adminCreateUser(JSON.parse(e.postData.contents));
        break;
      case 'login':
        response = loginUser(JSON.parse(e.postData.contents));
        break;
      case 'addBonds':
        response = addBonds(JSON.parse(e.postData.contents));
        break;
      case 'uploadDraw':
        response = uploadDraw(JSON.parse(e.postData.contents));
        break;
      case 'verifyRecoveryIdentifier':
        response = verifyRecoveryIdentifier(JSON.parse(e.postData.contents));
        break;
      case 'verifyRecoveryProfile':
        response = verifyRecoveryProfile(JSON.parse(e.postData.contents));
        break;
      case 'resetRecoveryPassword':
        response = resetRecoveryPassword(JSON.parse(e.postData.contents));
        break;
      case 'updateBond':
        response = updateBond(JSON.parse(e.postData.contents));
        break;
    }
  } catch (err) {
    response.message = err.message;
  }

  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // Auto-setup database if it hasn't been created yet
  checkAndSetupDatabase();

  if (!e.parameter.action) {
    // Serve the Web App HTML
    return HtmlService.createTemplateFromFile('Index').evaluate()
      .setTitle('PrizeBond')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  const action = e.parameter.action;
  let response = { success: false, message: "Unknown action" };
  
  try {
    switch(action) {
      case 'getMatches':
        response = getMatches(e.parameter.userId);
        break;
      case 'getBonds':
        response = getBonds(e.parameter.userId);
        break;
    }
  } catch(err) {
    response.message = err.message;
  }

  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------
// Database Utilities & Key Generators (Normalized RDBMS)
// ----------------------------------------------------

function generatePrimaryKey(tableName, customPrefix) {
  const rawPrefix = customPrefix || String(tableName).substring(0, 3);
  const prefix = rawPrefix.toUpperCase();
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(tableName);
  
  let existingKeys = [];
  if (sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      existingKeys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(row => String(row[0]).trim());
    }
  }
  
  let uniqueKey = '';
  let isUnique = false;
  let attempts = 0;
  
  while (!isUnique && attempts < 1000) {
    const randNum = Math.floor(100000 + Math.random() * 900000); // 6-digit random number
    uniqueKey = prefix + '-' + randNum;
    if (!existingKeys.includes(uniqueKey)) {
      isUnique = true;
    }
    attempts++;
  }
  return uniqueKey;
}

function logAuditEvent(userId, action, details) {
  try {
    const ss = getSpreadsheet();
    const logSheet = ss.getSheetByName('AuditLogs');
    if (!logSheet) return;
    
    const timestamp = new Date().toISOString();
    const logId = generatePrimaryKey('AuditLogs', 'AUD');
    
    logSheet.appendRow([
      "'" + logId,
      "'" + (userId || 'system'),
      action,
      details || '',
      timestamp,
      userId || 'system',
      timestamp,
      userId || 'system'
    ]);
  } catch (e) {
    console.error('Failed to log audit event:', e);
  }
}

// Helper to open sheet once and get values (code optimization)
function getSheetData(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { sheet: null, values: [] };
  return { sheet: sheet, values: sheet.getDataRange().getValues() };
}

// ----------------------------------------------------
// Setup Database Schema
// ----------------------------------------------------

function setupDatabase() {
  const ss = getSpreadsheet();
  const tables = [
    { name: 'Users', headers: ['UserId', 'EmailOrMobile', 'Password', 'Role', 'Status', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'Profiles', headers: ['ProfileId', 'UserId', 'FullName', 'DOB', 'Address', 'Profession', 'MobileNumber', 'EmailAddress', 'ProfilePhoto', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'PrizeBonds', headers: ['PrizeBondId', 'UserId', 'BondNumber', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'Draws', headers: ['DrawId', 'DrawNumber', 'DrawDate', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'DrawResults', headers: ['DrawResultId', 'DrawId', 'BondNumber', 'PrizeLevel', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'WinningMatches', headers: ['WinningMatchId', 'UserId', 'DrawId', 'DrawResultId', 'BondNumber', 'PrizeLevel', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'Tickets', headers: ['TicketId', 'UserId', 'Name', 'Category', 'Description', 'Status', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'TicketReplies', headers: ['ReplyId', 'TicketId', 'SenderRole', 'Message', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'SupportSettings', headers: ['SettingId', 'SettingKey', 'SettingValue', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'AuditLogs', headers: ['LogId', 'UserId', 'Action', 'Details', 'created_at', 'created_by', 'updated_at', 'updated_by'] }
  ];

  tables.forEach(table => {
    let sheet = ss.getSheetByName(table.name);
    if (!sheet) {
      sheet = ss.insertSheet(table.name);
      sheet.appendRow(table.headers);
      sheet.getRange(1, 1, 1, table.headers.length).setFontWeight("bold");
    } else {
      // Re-align headers if they mismatch the RDBMS normalized schema
      const currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
      if (currentHeaders.join(',') !== table.headers.join(',')) {
        sheet.clear();
        sheet.appendRow(table.headers);
        sheet.getRange(1, 1, 1, table.headers.length).setFontWeight("bold");
      }
    }
    
    // Apply plain text formatting (@) to preserve leading zeros in bond columns
    const maxRows = sheet.getMaxRows();
    if (table.name === 'PrizeBonds') {
      sheet.getRange(1, 3, maxRows, 1).setNumberFormat("@");
    } else if (table.name === 'DrawResults') {
      sheet.getRange(1, 3, maxRows, 1).setNumberFormat("@");
    } else if (table.name === 'WinningMatches') {
      sheet.getRange(1, 5, maxRows, 1).setNumberFormat("@");
    }
  });
  
  // Seed Support Settings if empty
  const supportSheet = ss.getSheetByName('SupportSettings');
  if (supportSheet.getLastRow() <= 1) {
    const timestamp = new Date().toISOString();
    supportSheet.appendRow(["'" + generatePrimaryKey('SupportSettings', 'SUP'), 'WhatsApp', '+8801234567890', timestamp, 'system', timestamp, 'system']);
    supportSheet.appendRow(["'" + generatePrimaryKey('SupportSettings', 'SUP'), 'Email', 'support@easybond.com', timestamp, 'system', timestamp, 'system']);
  }

  // Ensure default Admin exists in Users
  const userSheet = ss.getSheetByName('Users');
  const users = userSheet.getDataRange().getValues();
  let adminExists = false;
  for (let i = 1; i < users.length; i++) {
    const emailOrMobile = String(users[i][1]).trim();
    if (emailOrMobile === 'admin' || emailOrMobile === 'admin@easybond.com') {
      adminExists = true;
      break;
    }
  }
  
  if (!adminExists) {
    const timestamp = new Date().toISOString();
    const adminUserId = generatePrimaryKey('Users', 'USE');
    userSheet.appendRow(["'" + adminUserId, 'admin', 'admin', 'admin', 'active', timestamp, 'system', timestamp, 'system']);
    
    const profileSheet = ss.getSheetByName('Profiles');
    const profileId = generatePrimaryKey('Profiles', 'PRO');
    profileSheet.appendRow(["'" + profileId, "'" + adminUserId, 'Super Admin', '', 'HQ', 'Administrator', '', 'admin@easybond.com', '', timestamp, 'system', timestamp, 'system']);
    
    logAuditEvent(adminUserId, 'database_setup', 'Database initialized and super admin account created.');
  }
}

// ----------------------------------------------------
// Authentication Backend Logic
// ----------------------------------------------------

function registerUser(data) {
  const ss = getSpreadsheet();
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('Profiles');
  
  const users = userSheet.getDataRange().getValues();
  const targetId = String(data.id).trim();
  const cleanTargetId = targetId.replace(/^0+/, '');
  
  // Check if exists
  for (let i = 1; i < users.length; i++) {
    const dbEmailOrMobile = String(users[i][1]).trim();
    if (dbEmailOrMobile === targetId || dbEmailOrMobile.replace(/^0+/, '') === cleanTargetId) {
      return { success: false, message: 'User ID already registered.' };
    }
  }
  
  const timestamp = new Date().toISOString();
  const userId = generatePrimaryKey('Users', 'USE');
  const profileId = generatePrimaryKey('Profiles', 'PRO');
  
  // Insert Users
  userSheet.appendRow(["'" + userId, "'" + targetId, data.password, 'user', 'active', timestamp, userId, timestamp, userId]);
  
  // Insert Profiles
  const mobile = data.type === 'mobile' ? targetId : '';
  const email = data.type === 'email' ? targetId : '';
  profileSheet.appendRow(["'" + profileId, "'" + userId, data.name, '', '', '', mobile ? "'" + mobile : '', email, '', timestamp, userId, timestamp, userId]);
  
  logAuditEvent(userId, 'user_registration', 'Registered new user account with login identifier: ' + targetId);
  
  return { success: true, message: 'Registration successful' };
}

function loginUser(userid, password) {
  let targetId = userid;
  let targetPass = password;
  
  if (typeof userid === 'object' && userid !== null) {
    targetId = userid.userid || userid.id || userid.username;
    targetPass = userid.password || userid.pass;
  }
  
  targetId = String(targetId).trim();
  targetPass = String(targetPass).trim();
  const cleanTargetId = targetId.replace(/^0+/, '');
  
  const { values: users } = getSheetData('Users');
  const { values: profiles } = getSheetData('Profiles');
  
  for (let i = 1; i < users.length; i++) {
    const dbUserId = String(users[i][0]).trim();
    const dbEmailOrMobile = String(users[i][1]).trim();
    const dbPass = String(users[i][2]).trim();
    const dbRole = String(users[i][3]).trim();
    const dbStatus = String(users[i][4]).trim();
    
    if ((dbEmailOrMobile === targetId || dbEmailOrMobile.replace(/^0+/, '') === cleanTargetId) && dbPass === targetPass) {
      if (dbStatus !== 'active') {
        return { success: false, message: 'Account is disabled.' };
      }
      
      // Get profile
      let profile = { name: '', dob: '', address: '', profession: '', phone: '', email: '' };
      for (let j = 1; j < profiles.length; j++) {
        if (String(profiles[j][1]).trim() === dbUserId) {
          profile = {
            name: profiles[j][2],
            dob: profiles[j][3],
            address: profiles[j][4],
            profession: profiles[j][5],
            phone: profiles[j][6],
            email: profiles[j][7]
          };
          break;
        }
      }
      
      logAuditEvent(dbUserId, 'user_login', 'User logged in successfully.');
      
      return { 
        success: true, 
        user: {
          id: dbUserId,
          role: dbRole,
          ...profile
        }
      };
    }
  }
  
  return { success: false, message: 'Invalid credentials.' };
}

function verifyRecoveryIdentifier(data) {
  const ss = getSpreadsheet();
  const { values: users } = getSheetData('Users');
  const identifier = String(data.identifier).trim();
  const cleanIdentifier = identifier.replace(/^0+/, '');
  
  for (let i = 1; i < users.length; i++) {
    const dbEmailOrMobile = String(users[i][1]).trim();
    if (dbEmailOrMobile === identifier || dbEmailOrMobile.replace(/^0+/, '') === cleanIdentifier) {
      return { success: true, userId: String(users[i][0]).trim() };
    }
  }
  return { success: false, message: 'No registered user matches the provided identifier.' };
}

function verifyRecoveryProfile(data) {
  const ss = getSpreadsheet();
  const { values: profiles } = getSheetData('Profiles');
  const name = String(data.name).trim().toLowerCase();
  const dob = String(data.dob).trim();
  const profession = String(data.profession).trim().toLowerCase();
  
  for (let i = 1; i < profiles.length; i++) {
    const dbUserId = String(profiles[i][1]).trim();
    const dbName = String(profiles[i][2]).trim().toLowerCase();
    const dbDob = String(profiles[i][3]).trim();
    const dbProfession = String(profiles[i][5]).trim().toLowerCase();
    
    // Convert dates to ISO-like comparison
    let dobMatch = (dbDob === dob);
    if (!dobMatch && dbDob && dob) {
      dobMatch = new Date(dbDob).getTime() === new Date(dob).getTime();
    }
    
    if (dbName === name && dobMatch && dbProfession === profession) {
      return { success: true, userId: dbUserId };
    }
  }
  return { success: false, message: 'Verification failed. Profile details do not match.' };
}

function resetRecoveryPassword(data) {
  const ss = getSpreadsheet();
  const userSheet = ss.getSheetByName('Users');
  const users = userSheet.getDataRange().getValues();
  const userId = String(data.userId).trim();
  const newPassword = String(data.password).trim();
  const timestamp = new Date().toISOString();
  
  for (let i = 1; i < users.length; i++) {
    if (String(users[i][0]).trim() === userId) {
      const row = i + 1;
      userSheet.getRange(row, 3).setValue(newPassword);
      userSheet.getRange(row, 8).setValue(timestamp);
      userSheet.getRange(row, 9).setValue(userId);
      
      logAuditEvent(userId, 'reset_password', 'Password reset successfully through account recovery.');
      return { success: true, message: 'Your password has been successfully reset.' };
    }
  }
  return { success: false, message: 'User not found.' };
}

function updateProfile(data) {
  const ss = getSpreadsheet();
  const profileSheet = ss.getSheetByName('Profiles');
  const profiles = profileSheet.getDataRange().getValues();
  const timestamp = new Date().toISOString();
  
  for (let i = 1; i < profiles.length; i++) {
    if (String(profiles[i][1]).trim() === String(data.userId).trim()) {
      const rowIndex = i + 1;
      profileSheet.getRange(rowIndex, 3).setValue(data.name);
      profileSheet.getRange(rowIndex, 4).setValue(data.dob || '');
      profileSheet.getRange(rowIndex, 5).setValue(data.address || '');
      profileSheet.getRange(rowIndex, 6).setValue(data.profession || '');
      profileSheet.getRange(rowIndex, 7).setValue(data.phone || '');
      profileSheet.getRange(rowIndex, 8).setValue(data.email || '');
      profileSheet.getRange(rowIndex, 11).setValue(timestamp);
      profileSheet.getRange(rowIndex, 12).setValue(data.userId);
      
      logAuditEvent(data.userId, 'update_profile', 'Updated profile information.');
      return { success: true, message: 'Profile updated successfully' };
    }
  }
  return { success: false, message: 'User profile not found' };
}

// ----------------------------------------------------
// Administrative User Actions
// ----------------------------------------------------

function adminCreateUser(data) {
  // Option disabled per instructions, but kept as stub or logger for reference
  return { success: false, message: 'Admin user creation is disabled. All users must self-register.' };
}

function adminGetUsers() {
  const { values: users } = getSheetData('Users');
  const { values: profiles } = getSheetData('Profiles');
  const userList = [];
  
  for (let i = 1; i < users.length; i++) {
    const uId = String(users[i][0]).trim();
    const emailOrMobile = users[i][1];
    const password = users[i][2];
    const role = users[i][3];
    const status = users[i][4];
    const createdAt = users[i][5];
    const createdBy = users[i][6];
    const updatedAt = users[i][7];
    const updatedBy = users[i][8];
    
    if (role === 'admin') continue;
    
    let profile = { name: '', email: '', phone: '', dob: '', address: '', profession: '' };
    for (let j = 1; j < profiles.length; j++) {
      if (String(profiles[j][1]).trim() === uId) {
        profile = {
          name: profiles[j][2],
          dob: profiles[j][3],
          address: profiles[j][4],
          profession: profiles[j][5],
          phone: profiles[j][6],
          email: profiles[j][7]
        };
        break;
      }
    }
    
    userList.push({
      id: uId,
      emailOrMobile: emailOrMobile,
      password: password,
      role: role,
      status: status,
      createdAt: createdAt,
      createdBy: createdBy,
      updatedAt: updatedAt,
      updatedBy: updatedBy,
      ...profile
    });
  }
  
  return { success: true, users: userList };
}

function adminUpdateUser(data) {
  const ss = getSpreadsheet();
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('Profiles');
  
  const users = userSheet.getDataRange().getValues();
  const profiles = profileSheet.getDataRange().getValues();
  const timestamp = new Date().toISOString();
  const actor = data.adminId || 'admin';
  
  let userFound = false;
  for (let i = 1; i < users.length; i++) {
    if (String(users[i][0]).trim() === String(data.id).trim()) {
      const rowIndex = i + 1;
      if (data.password && data.password.trim() !== '') {
        userSheet.getRange(rowIndex, 3).setValue(data.password);
      }
      userSheet.getRange(rowIndex, 5).setValue(data.status);
      userSheet.getRange(rowIndex, 8).setValue(timestamp); // updated_at
      userSheet.getRange(rowIndex, 9).setValue(actor); // updated_by
      userFound = true;
      break;
    }
  }
  
  let profileFound = false;
  for (let i = 1; i < profiles.length; i++) {
    if (String(profiles[i][1]).trim() === String(data.id).trim()) {
      const rowIndex = i + 1;
      profileSheet.getRange(rowIndex, 3).setValue(data.name);
      profileSheet.getRange(rowIndex, 7).setValue(data.phone || '');
      profileSheet.getRange(rowIndex, 8).setValue(data.email || '');
      profileSheet.getRange(rowIndex, 11).setValue(timestamp); // updated_at
      profileSheet.getRange(rowIndex, 12).setValue(actor); // updated_by
      profileFound = true;
      break;
    }
  }
  
  if (userFound && profileFound) {
    logAuditEvent(actor, 'admin_update_user', 'Updated account settings for user ID: ' + data.id);
    return { success: true, message: 'User updated successfully' };
  }
  return { success: false, message: 'User not found' };
}

function adminDeleteUser(userId, adminId) {
  const ss = getSpreadsheet();
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('Profiles');
  const bondsSheet = ss.getSheetByName('PrizeBonds');
  const ticketSheet = ss.getSheetByName('Tickets');
  const matchesSheet = ss.getSheetByName('WinningMatches');
  const actor = adminId || 'admin';
  
  const targetId = String(userId).trim();
  
  // Deletions
  const deleteFromSheet = (sheet, colIndex) => {
    const values = sheet.getDataRange().getValues();
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][colIndex]).trim() === targetId) {
        sheet.deleteRow(i + 1);
      }
    }
  };
  
  deleteFromSheet(userSheet, 0);
  deleteFromSheet(profileSheet, 1);
  deleteFromSheet(bondsSheet, 1);
  deleteFromSheet(ticketSheet, 1);
  deleteFromSheet(matchesSheet, 1);
  
  logAuditEvent(actor, 'admin_delete_user', 'Permanently deleted user ID: ' + targetId + ' and all related bonds, tickets, matches, and profile.');
  return { success: true, message: 'User deleted successfully' };
}

// ----------------------------------------------------
// Prize Bonds CRUD (RDBMS)
// ----------------------------------------------------

function addBonds(data) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('PrizeBonds');
  const timestamp = new Date().toISOString();
  const userId = String(data.userId).trim();
  let added = 0;
  
  data.bonds.forEach(bondNum => {
    if(/^[0-9]{7}$/.test(bondNum)) {
      const prizeBondId = generatePrimaryKey('PrizeBonds', 'PRI');
      sheet.appendRow(["'" + prizeBondId, "'" + userId, "'" + bondNum, timestamp, userId, timestamp, userId]);
      added++;
    }
  });
  
  if (added > 0) {
    logAuditEvent(userId, 'add_bonds', 'Added ' + added + ' new prize bond numbers.');
  }
  
  return { success: true, message: `Added ${added} new bonds.` };
}

function getBonds(userId) {
  const { values } = getSheetData('PrizeBonds');
  const userBonds = [];
  const targetUserId = String(userId).trim();
  
  for(let i=1; i<values.length; i++) {
    if(String(values[i][1]).trim() === targetUserId) {
      userBonds.push({
        number: padBondNumber(values[i][2]),
        dateAdded: values[i][3] ? new Date(values[i][3]).toLocaleDateString() : ''
      });
    }
  }
  return { success: true, bonds: userBonds };
}

function deleteBond(data) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('PrizeBonds');
  const values = sheet.getDataRange().getValues();
  const targetUserId = String(data.userId).trim();
  const bondNumber = padBondNumber(data.bondNumber);
  let deleted = 0;
  
  for(let i = values.length - 1; i >= 1; i--) {
    if(String(values[i][1]).trim() === targetUserId && padBondNumber(values[i][2]) === bondNumber) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  
  if (deleted > 0) {
    logAuditEvent(targetUserId, 'delete_bond', 'Deleted prize bond: ' + bondNumber);
    return { success: true, message: 'Bond deleted successfully' };
  }
  return { success: false, message: 'Bond not found' };
}

// ----------------------------------------------------
// Draws & Results History (RDBMS)
// ----------------------------------------------------

function uploadDraw(data) {
  const ss = getSpreadsheet();
  const drawSheet = ss.getSheetByName('Draws');
  const resSheet = ss.getSheetByName('DrawResults');
  const matchesSheet = ss.getSheetByName('WinningMatches');
  const bondsSheet = ss.getSheetByName('PrizeBonds');
  
  const timestamp = new Date().toISOString();
  const drawId = generatePrimaryKey('Draws', 'DRA');
  const drawNum = String(data.drawNumber).trim();
  const drawDate = data.drawDate;
  
  // Insert Draw
  drawSheet.appendRow(["'" + drawId, drawNum, drawDate, timestamp, 'admin', timestamp, 'admin']);
  
  // Insert DrawResults & check matches against tracked bonds
  const bondList = bondsSheet.getDataRange().getValues();
  
  data.results.forEach(res => {
    const drawResultId = generatePrimaryKey('DrawResults', 'DRA');
    resSheet.appendRow(["'" + drawResultId, "'" + drawId, "'" + res.num, res.prize, timestamp, 'admin', timestamp, 'admin']);
    
    // Check if any user tracks this bond
    for (let i = 1; i < bondList.length; i++) {
      const dbUserId = String(bondList[i][1]).trim();
      const dbBondNum = String(bondList[i][2]).trim();
      
      if (padBondNumber(dbBondNum) === padBondNumber(res.num)) {
        const winningMatchId = generatePrimaryKey('WinningMatches', 'WIN');
        matchesSheet.appendRow([
          "'" + winningMatchId,
          "'" + dbUserId,
          "'" + drawId,
          "'" + drawResultId,
          "'" + res.num,
          res.prize,
          timestamp,
          'system',
          timestamp,
          'system'
        ]);
        logAuditEvent(dbUserId, 'win_match_detected', 'Winning match detected for draw #' + drawNum + ', Bond: ' + res.num + ' (' + res.prize + ')');
      }
    }
  });
  
  logAuditEvent('admin', 'upload_draw', 'Uploaded draw results for Draw #' + drawNum + ' (' + data.results.length + ' prizes).');
  
  return { success: true, message: `Draw ${drawNum} uploaded successfully.`};
}

function getDraws() {
  const { values: drawsData } = getSheetData('Draws');
  const { values: resultsData } = getSheetData('DrawResults');
  const draws = [];
  
  for(let i=1; i<drawsData.length; i++) {
    const drawId = String(drawsData[i][0]).trim();
    const drawNum = drawsData[i][1];
    const drawDate = drawsData[i][2] ? new Date(drawsData[i][2]).toISOString().split('T')[0] : '';
    
    const results = [];
    for(let j=1; j<resultsData.length; j++) {
      if(String(resultsData[j][1]).trim() === drawId) {
        results.push({ num: padBondNumber(resultsData[j][2]), prize: resultsData[j][3] });
      }
    }
    draws.push({ id: drawId, number: drawNum, date: drawDate, results: results });
  }
  
  draws.sort((a, b) => b.number - a.number);
  return { success: true, draws: draws };
}

function getMatches(userId) {
  const { values: matchesData } = getSheetData('WinningMatches');
  const { values: drawsData } = getSheetData('Draws');
  const targetUserId = String(userId).trim();
  const matches = [];
  
  for(let i=1; i<matchesData.length; i++) {
    if(String(matchesData[i][1]).trim() === targetUserId) {
      const drawId = String(matchesData[i][2]).trim();
      
      // Get draw number
      let drawNum = 'N/A';
      for (let j = 1; j < drawsData.length; j++) {
        if (String(drawsData[j][0]).trim() === drawId) {
          drawNum = drawsData[j][1];
          break;
        }
      }
      
      matches.push({
        draw: drawNum,
        bond: padBondNumber(matchesData[i][4]),
        prize: matchesData[i][5]
      });
    }
  }
  
  return { success: true, matches: matches };
}

// ----------------------------------------------------
// Audit & Settings Functions
// ----------------------------------------------------

function getAdminStats() {
  const { values: users } = getSheetData('Users');
  const { values: bonds } = getSheetData('PrizeBonds');
  const { values: tickets } = getSheetData('Tickets');
  const { values: support } = getSheetData('SupportSettings');
  
  const totalUsers = Math.max(0, users.length - 1);
  const activeUsers = users.filter((u, idx) => idx > 0 && u[3] === 'user' && u[4] === 'active').length;
  const totalBonds = Math.max(0, bonds.length - 1);
  const openTickets = tickets.filter((t, idx) => idx > 0 && t[5] === 'open').length;
  
  let wa = '';
  let email = '';
  for(let i=1; i<support.length; i++) {
    if(support[i][1] === 'WhatsApp') wa = support[i][2];
    if(support[i][1] === 'Email') email = support[i][2];
  }
  
  return {
    success: true,
    stats: {
      totalUsers: totalUsers,
      activeUsers: activeUsers,
      totalBonds: totalBonds,
      openTickets: openTickets,
      whatsapp: wa,
      email: email
    }
  };
}

function updateSupportSettings(data) {
  const ss = getSpreadsheet();
  const supportSheet = ss.getSheetByName('SupportSettings');
  const support = supportSheet.getDataRange().getValues();
  const timestamp = new Date().toISOString();
  
  for(let i=1; i<support.length; i++) {
    const row = i + 1;
    if(support[i][1] === 'WhatsApp') {
      supportSheet.getRange(row, 3).setValue(data.whatsapp);
    }
    if(support[i][1] === 'Email') {
      supportSheet.getRange(row, 3).setValue(data.email);
    }
  }
  logAuditEvent(data.adminId || 'admin', 'update_support_settings', 'Updated public whatsapp and email coordinates.');
  return { success: true, message: 'Support settings saved successfully.' };
}

function adminGetAuditLogs() {
  const { values } = getSheetData('AuditLogs');
  const { values: profiles } = getSheetData('Profiles');
  const list = [];
  
  for (let i = 1; i < values.length; i++) {
    const uId = String(values[i][1]).trim();
    
    // Resolve Full Name
    let userName = 'System';
    if (uId !== 'system') {
      for (let j = 1; j < profiles.length; j++) {
        if (String(profiles[j][1]).trim() === uId) {
          userName = profiles[j][2] || uId;
          break;
        }
      }
    }
    
    list.push({
      logId: String(values[i][0]).trim(),
      userId: uId,
      userName: userName,
      action: values[i][2],
      details: values[i][3],
      created_at: values[i][4]
    });
  }
  // Sort descending (most recent first)
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, logs: list };
}

// ----------------------------------------------------
// Support Ticket System Functions
// ----------------------------------------------------

function createTicket(data) {
  const ss = getSpreadsheet();
  const ticketSheet = ss.getSheetByName('Tickets');
  const timestamp = new Date().toISOString();
  const ticketId = generatePrimaryKey('Tickets', 'TIC');
  const userId = String(data.userId).trim();
  
  ticketSheet.appendRow([
    "'" + ticketId,
    "'" + userId,
    data.subject || data.name || '',
    data.category || '',
    data.description || '',
    'open',
    timestamp,
    userId,
    timestamp,
    userId
  ]);
  
  logAuditEvent(userId, 'create_ticket', 'Submitted support ticket ID: ' + ticketId);
  return { success: true, message: 'Ticket created successfully.', ticketId: ticketId };
}

function getUserTickets(userId) {
  const { values } = getSheetData('Tickets');
  const list = [];
  const targetUserId = String(userId).trim();
  
  for (let i = 1; i < values.length; i++) {
    const dbUserId = String(values[i][1]).trim();
    if (dbUserId === targetUserId) {
      list.push({
        ticketId: String(values[i][0]).trim(),
        userId: dbUserId,
        subject: values[i][2],
        category: values[i][3],
        description: values[i][4],
        status: values[i][5],
        created_at: values[i][6],
        updated_at: values[i][8]
      });
    }
  }
  
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, tickets: list };
}

function getTicketDetails(ticketId) {
  const { values: tValues } = getSheetData('Tickets');
  const { values: rValues } = getSheetData('TicketReplies');
  const targetTicketId = String(ticketId).trim();
  let ticket = null;
  
  for (let i = 1; i < tValues.length; i++) {
    const dbTicketId = String(tValues[i][0]).trim();
    if (dbTicketId === targetTicketId) {
      ticket = {
        ticketId: dbTicketId,
        userId: String(tValues[i][1]).trim(),
        subject: tValues[i][2],
        category: tValues[i][3],
        description: tValues[i][4],
        status: tValues[i][5],
        created_at: tValues[i][6],
        updated_at: tValues[i][8],
        created_by: String(tValues[i][7]).trim(),
        updated_by: String(tValues[i][9]).trim()
      };
      break;
    }
  }
  
  if (!ticket) {
    return { success: false, message: 'Ticket not found.' };
  }
  
  const replies = [];
  for (let j = 1; j < rValues.length; j++) {
    const dbTicketId = String(rValues[j][1]).trim();
    if (dbTicketId === targetTicketId) {
      replies.push({
        replyId: String(rValues[j][0]).trim(),
        ticketId: dbTicketId,
        senderRole: rValues[j][2],
        message: rValues[j][3],
        created_at: rValues[j][4],
        created_by: String(rValues[j][5]).trim()
      });
    }
  }
  
  replies.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return { success: true, ticket: ticket, replies: replies };
}

function addTicketReply(data) {
  const ss = getSpreadsheet();
  const ticketSheet = ss.getSheetByName('Tickets');
  const repliesSheet = ss.getSheetByName('TicketReplies');
  
  const ticketId = String(data.ticketId).trim();
  const senderId = String(data.senderId).trim();
  const timestamp = new Date().toISOString();
  const replyId = generatePrimaryKey('TicketReplies', 'TIC');
  
  repliesSheet.appendRow([
    "'" + replyId,
    "'" + ticketId,
    data.senderRole,
    data.message,
    timestamp,
    senderId,
    timestamp,
    senderId
  ]);
  
  // Update tickets updated_at and updated_by
  const tValues = ticketSheet.getDataRange().getValues();
  for (let i = 1; i < tValues.length; i++) {
    if (String(tValues[i][0]).trim() === ticketId) {
      const row = i + 1;
      ticketSheet.getRange(row, 9).setValue(timestamp);
      ticketSheet.getRange(row, 10).setValue(senderId);
      break;
    }
  }
  
  logAuditEvent(senderId, 'reply_ticket', 'Added reply message to ticket ID: ' + ticketId);
  return { success: true, message: 'Reply sent successfully.' };
}

function adminGetTickets() {
  const { values: tValues } = getSheetData('Tickets');
  const { values: pValues } = getSheetData('Profiles');
  const list = [];
  
  for (let i = 1; i < tValues.length; i++) {
    const ticketId = String(tValues[i][0]).trim();
    const userId = String(tValues[i][1]).trim();
    
    let userName = 'N/A';
    for (let j = 1; j < pValues.length; j++) {
      if (String(pValues[j][1]).trim() === userId) {
        userName = pValues[j][2] || 'N/A';
        break;
      }
    }
    
    list.push({
      ticketId: ticketId,
      userId: userId,
      userName: userName,
      subject: tValues[i][2],
      category: tValues[i][3],
      description: tValues[i][4],
      status: tValues[i][5],
      created_at: tValues[i][6],
      updated_at: tValues[i][8]
    });
  }
  
  list.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  return { success: true, tickets: list };
}

function adminUpdateTicketStatus(data) {
  const ss = getSpreadsheet();
  const ticketSheet = ss.getSheetByName('Tickets');
  const tValues = ticketSheet.getDataRange().getValues();
  const ticketId = String(data.ticketId).trim();
  const timestamp = new Date().toISOString();
  const actorId = String(data.adminId || data.userId || 'system').trim();
  
  for (let i = 1; i < tValues.length; i++) {
    if (String(tValues[i][0]).trim() === ticketId) {
      const row = i + 1;
      ticketSheet.getRange(row, 6).setValue(data.status);
      ticketSheet.getRange(row, 9).setValue(timestamp);
      ticketSheet.getRange(row, 10).setValue(actorId);
      
      logAuditEvent(actorId, 'update_ticket_status', 'Updated status of ticket ID: ' + ticketId + ' to: ' + data.status);
      return { success: true, message: 'Ticket status updated to ' + data.status + '.' };
    }
  }
  return { success: false, message: 'Ticket not found.' };
}

function updateBond(data) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName('PrizeBonds');
  const values = sheet.getDataRange().getValues();
  const userId = String(data.userId).trim();
  const oldNum = padBondNumber(data.oldNumber);
  const newNum = padBondNumber(data.newNumber);
  const timestamp = new Date().toISOString();
  
  if(!/^[0-9]{7}$/.test(newNum)) {
    return { success: false, message: 'Invalid new bond number. Must be exactly 7 digits.' };
  }
  
  // Check if user already tracks the new number
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).trim() === userId && padBondNumber(values[i][2]) === newNum) {
      return { success: false, message: 'You are already tracking the new bond number.' };
    }
  }
  
  // Find the row with the old number for this user
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]).trim() === userId && padBondNumber(values[i][2]) === oldNum) {
      const row = i + 1;
      sheet.getRange(row, 3).setValue("'" + newNum);
      sheet.getRange(row, 6).setValue(timestamp);
      sheet.getRange(row, 7).setValue(userId);
      
      logAuditEvent(userId, 'edit_bond', 'Updated prize bond number from ' + oldNum + ' to ' + newNum);
      return { success: true, message: 'Prize bond number updated successfully.' };
    }
  }
  
  return { success: false, message: 'Prize bond not found.' };
}

function padBondNumber(num) {
  let str = String(num).trim();
  if (!str || str === 'undefined' || str === 'null') return '';
  while (str.length < 7) {
    str = '0' + str;
  }
  return str;
}
