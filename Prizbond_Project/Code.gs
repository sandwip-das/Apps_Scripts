/**
 * Prizebond Project - Google Apps Script Backend
 * 
 * Instructions:
 * 1. Open Google Sheets and create a new spreadsheet.
 * 2. Create the following sheet tabs: 'Users', 'PrizeBonds', 'Draws', 'DrawResults', 'Tickets'.
 * 3. Go to Extensions > Apps Script.
 * 4. Paste this code into Code.gs and save.
 * 5. Click Deploy > New Deployment. Select 'Web app', execute as 'Me', and access 'Anyone'.
 * 6. Copy the resulting Web App URL. You will use this URL to make API requests from your frontend.
 */

// Global Config
const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// API Entry Point
function doPost(e) {
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
      // Additional cases would go here
    }
  } catch (err) {
    response.message = err.message;
  }

  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  // Auto-setup database if it hasn't been created yet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('Users')) {
    setupDatabase();
  }

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
      // Additional cases...
    }
  } catch(err) {
    response.message = err.message;
  }

  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------
// Core Functions (Examples of DB Operations)
// ----------------------------------------------------

function adminCreateUser(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('UserProfiles');
  
  const users = userSheet.getDataRange().getValues();
  for(let i=1; i<users.length; i++) {
    if(users[i][0] === data.id || users[i][1] === data.id) {
      return { success: false, message: 'User ID already exists.' };
    }
  }
  
  const timestamp = new Date().toISOString();
  
  // Headers: ID, EmailOrMobile, Password, Role, Status, created_at, created_by, updated_at, updated_by
  userSheet.appendRow([data.id, data.id, data.password, 'user', 'active', timestamp, 'admin', timestamp, 'admin']);
  
  // Headers: UserId, FullName, DOB, Address, Profession, MobileNumber, EmailAddress, ProfilePhoto, created_at, created_by, updated_at, updated_by
  profileSheet.appendRow([data.id, data.name, '', '', '', data.phone, data.email, '', timestamp, 'admin', timestamp, 'admin']);
  
  return { success: true, message: 'User created successfully' };
}

function adminGetUsers() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('UserProfiles');
  
  const usersData = userSheet.getDataRange().getValues();
  const profilesData = profileSheet.getDataRange().getValues();
  const userList = [];
  
  for (let i = 1; i < usersData.length; i++) {
    const uId = usersData[i][0];
    const role = usersData[i][3];
    const status = usersData[i][4];
    const password = usersData[i][2];
    const createdAt = usersData[i][5];
    
    if (role === 'admin') continue;
    
    let profile = { name: '', email: '', phone: '', dob: '', address: '', profession: '' };
    for (let j = 1; j < profilesData.length; j++) {
      if (profilesData[j][0] === uId) {
        profile = {
          name: profilesData[j][1],
          dob: profilesData[j][2],
          address: profilesData[j][3],
          profession: profilesData[j][4],
          phone: profilesData[j][5],
          email: profilesData[j][6]
        };
        break;
      }
    }
    
    userList.push({
      id: uId,
      password: password,
      role: role,
      status: status,
      createdAt: createdAt,
      ...profile
    });
  }
  
  return { success: true, users: userList };
}

function adminUpdateUser(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('UserProfiles');
  
  const users = userSheet.getDataRange().getValues();
  const profiles = profileSheet.getDataRange().getValues();
  const timestamp = new Date().toISOString();
  
  let userFound = false;
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === data.id) {
      const rowIndex = i + 1;
      userSheet.getRange(rowIndex, 3).setValue(data.password);
      userSheet.getRange(rowIndex, 5).setValue(data.status);
      userSheet.getRange(rowIndex, 8).setValue(timestamp);
      userFound = true;
      break;
    }
  }
  
  let profileFound = false;
  for (let i = 1; i < profiles.length; i++) {
    if (profiles[i][0] === data.id) {
      const rowIndex = i + 1;
      profileSheet.getRange(rowIndex, 2).setValue(data.name);
      profileSheet.getRange(rowIndex, 6).setValue(data.phone || '');
      profileSheet.getRange(rowIndex, 7).setValue(data.email || '');
      profileSheet.getRange(rowIndex, 11).setValue(timestamp);
      profileFound = true;
      break;
    }
  }
  
  if (userFound && profileFound) {
    return { success: true, message: 'User updated successfully' };
  }
  return { success: false, message: 'User not found' };
}

function adminDeleteUser(userId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('UserProfiles');
  const bondsSheet = ss.getSheetByName('PrizeBonds');
  
  // Delete user from Users
  const users = userSheet.getDataRange().getValues();
  for (let i = users.length - 1; i >= 1; i--) {
    if (users[i][0] === userId) {
      userSheet.deleteRow(i + 1);
    }
  }
  
  // Delete user from UserProfiles
  const profiles = profileSheet.getDataRange().getValues();
  for (let i = profiles.length - 1; i >= 1; i--) {
    if (profiles[i][0] === userId) {
      profileSheet.deleteRow(i + 1);
    }
  }
  
  // Delete user's bonds
  const bonds = bondsSheet.getDataRange().getValues();
  for (let i = bonds.length - 1; i >= 1; i--) {
    if (bonds[i][0] === userId) {
      bondsSheet.deleteRow(i + 1);
    }
  }
  
  return { success: true, message: 'User deleted successfully' };
}

function addBonds(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('PrizeBonds');
  const date = new Date().toISOString();
  let added = 0;
  
  data.bonds.forEach(bondNum => {
    if(/^[0-9]{7}$/.test(bondNum)) {
      sheet.appendRow([data.userId, bondNum, date, data.userId, date, data.userId]);
      added++;
    }
  });
  
  return { success: true, message: `Added ${added} new bonds.` };
}

function getBonds(userId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('PrizeBonds');
  const values = sheet.getDataRange().getValues();
  const userBonds = [];
  
  for(let i=1; i<values.length; i++) {
    if(values[i][0] === userId) {
      userBonds.push({
        number: values[i][1],
        dateAdded: values[i][2] ? new Date(values[i][2]).toLocaleDateString() : ''
      });
    }
  }
  return { success: true, bonds: userBonds };
}

function deleteBond(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('PrizeBonds');
  const values = sheet.getDataRange().getValues();
  let deleted = 0;
  
  for(let i = values.length - 1; i >= 1; i--) {
    if(values[i][0] === data.userId && values[i][1] === data.bondNumber) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  
  if (deleted > 0) {
    return { success: true, message: 'Bond deleted successfully' };
  }
  return { success: false, message: 'Bond not found' };
}

function getDraws() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const drawSheet = ss.getSheetByName('Draws');
  const resSheet = ss.getSheetByName('DrawResults');
  
  const draws = [];
  const drawVals = drawSheet.getDataRange().getValues();
  const resVals = resSheet.getDataRange().getValues();
  
  for(let i=1; i<drawVals.length; i++) {
    const drawNum = drawVals[i][0];
    const drawDate = drawVals[i][1] ? new Date(drawVals[i][1]).toISOString().split('T')[0] : '';
    
    const results = [];
    for(let j=1; j<resVals.length; j++) {
      if(resVals[j][0] === drawNum) {
        results.push({ num: resVals[j][1], prize: resVals[j][2] });
      }
    }
    draws.push({ number: drawNum, date: drawDate, results: results });
  }
  
  // Sort descending by draw number
  draws.sort((a, b) => b.number - a.number);
  return { success: true, draws: draws };
}

function getMatches(userId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const bondsSheet = ss.getSheetByName('PrizeBonds');
  const resultsSheet = ss.getSheetByName('DrawResults');
  
  const userBonds = [];
  const bVals = bondsSheet.getDataRange().getValues();
  for(let i=1; i<bVals.length; i++) {
    if(bVals[i][0] === userId) {
      userBonds.push(bVals[i][1]);
    }
  }
  
  const matches = [];
  const rVals = resultsSheet.getDataRange().getValues();
  for(let i=1; i<rVals.length; i++) {
    if(userBonds.includes(rVals[i][1])) {
      matches.push({
        draw: rVals[i][0],
        bond: rVals[i][1],
        prize: rVals[i][2]
      });
    }
  }
  
  return { success: true, matches: matches };
}

function uploadDraw(data) {
   const ss = SpreadsheetApp.openById(SHEET_ID);
   const drawSheet = ss.getSheetByName('Draws');
   const resSheet = ss.getSheetByName('DrawResults');
   const date = new Date().toISOString();
   
   drawSheet.appendRow([data.drawNumber, data.drawDate, date, 'admin', date, 'admin']);
   
   data.results.forEach(res => {
     resSheet.appendRow([data.drawNumber, res.num, res.prize, date, 'admin', date, 'admin']);
   });
   
   return { success: true, message: `Draw ${data.drawNumber} uploaded successfully.`};
}

// ----------------------------------------------------
// Setup Function (Run this once to create the database)
// ----------------------------------------------------
function setupDatabase() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tables = [
    { name: 'Users', headers: ['ID', 'EmailOrMobile', 'Password', 'Role', 'Status', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'UserProfiles', headers: ['UserId', 'FullName', 'DOB', 'Address', 'Profession', 'MobileNumber', 'EmailAddress', 'ProfilePhoto', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'PrizeBonds', headers: ['UserId', 'BondNumber', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'Draws', headers: ['DrawNumber', 'DrawDate', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'DrawResults', headers: ['DrawNumber', 'BondNumber', 'PrizeLevel', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'WinningMatches', headers: ['UserId', 'DrawNumber', 'BondNumber', 'PrizeLevel', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'Tickets', headers: ['TicketId', 'UserId', 'Name', 'Category', 'Description', 'Status', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'TicketReplies', headers: ['ReplyId', 'TicketId', 'SenderRole', 'Message', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'SupportSettings', headers: ['SettingKey', 'SettingValue', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'AuditLogs', headers: ['LogId', 'UserId', 'Action', 'Details', 'created_at', 'created_by', 'updated_at', 'updated_by'] },
    { name: 'RolesPermissions', headers: ['Role', 'Permissions', 'created_at', 'created_by', 'updated_at', 'updated_by'] }
  ];

  tables.forEach(table => {
    let sheet = ss.getSheetByName(table.name);
    if (!sheet) {
      sheet = ss.insertSheet(table.name);
      sheet.appendRow(table.headers);
      sheet.getRange(1, 1, 1, table.headers.length).setFontWeight("bold");
    }
  });
  
  // Seed Support Settings if empty
  const supportSheet = ss.getSheetByName('SupportSettings');
  if (supportSheet.getLastRow() <= 1) {
    supportSheet.appendRow(['WhatsApp', '+8801234567890']);
    supportSheet.appendRow(['Email', 'support@easybond.com']);
  }

  // Ensure default Admin exists
  const userSheet = ss.getSheetByName('Users');
  const users = userSheet.getDataRange().getValues();
  let adminExists = false;
  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === 'admin') {
      adminExists = true;
      break;
    }
  }
  
  if (!adminExists) {
    const timestamp = new Date().toISOString();
    userSheet.appendRow(['admin', 'admin@easybond.com', 'admin', 'admin', 'active', timestamp, 'system', timestamp, 'system']);
    const profileSheet = ss.getSheetByName('UserProfiles');
    profileSheet.appendRow(['admin', 'Super Admin', '', 'HQ', 'Administrator', '', 'admin@easybond.com', '', timestamp, 'system', timestamp, 'system']);
  }
}

// ----------------------------------------------------
// Authentication Backend Logic
// ----------------------------------------------------

function registerUser(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('UserProfiles');
  
  const users = userSheet.getDataRange().getValues();
  const targetId = String(data.id).trim();
  const cleanTargetId = targetId.replace(/^0+/, '');
  
  // Check if user exists (case-insensitive and leading-zero tolerant string check)
  for (let i = 1; i < users.length; i++) {
    const dbId = String(users[i][0]).trim();
    const dbEmailOrMobile = String(users[i][1]).trim();
    
    if (dbId === targetId || dbEmailOrMobile === targetId || 
        dbId.replace(/^0+/, '') === cleanTargetId || 
        dbEmailOrMobile.replace(/^0+/, '') === cleanTargetId) {
      return { success: false, message: 'User ID already registered.' };
    }
  }
  
  const timestamp = new Date().toISOString();
  
  // Insert into Users. Prefix user ID with single quote to force Google Sheets to store it as text (preserving leading zeros)
  userSheet.appendRow(["'" + targetId, "'" + targetId, data.password, 'user', 'active', timestamp, targetId, timestamp, targetId]);
  
  // Insert into UserProfiles
  const mobile = data.type === 'mobile' ? targetId : '';
  const email = data.type === 'email' ? targetId : '';
  profileSheet.appendRow(["'" + targetId, data.name, '', '', '', mobile ? "'" + mobile : '', email, '', timestamp, targetId, timestamp, targetId]);
  
  return { success: true, message: 'Registration successful' };
}

function loginUser(userid, password) {
  let targetId = userid;
  let targetPass = password;
  
  // Support single object parameter (for doPost requests)
  if (typeof userid === 'object' && userid !== null) {
    targetId = userid.userid || userid.id || userid.username;
    targetPass = userid.password || userid.pass;
  }
  
  targetId = String(targetId).trim();
  targetPass = String(targetPass).trim();
  const cleanTargetId = targetId.replace(/^0+/, '');
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const profileSheet = ss.getSheetByName('UserProfiles');
  
  const users = userSheet.getDataRange().getValues();
  const profiles = profileSheet.getDataRange().getValues();
  
  for (let i = 1; i < users.length; i++) {
    const dbId = String(users[i][0]).trim();
    const dbEmailOrMobile = String(users[i][1]).trim();
    const dbPass = String(users[i][2]).trim();
    const dbStatus = String(users[i][4]).trim();
    const dbRole = String(users[i][3]).trim();
    
    // Check match (standard string match or numeric match stripping leading zeros)
    if ((dbId === targetId || dbEmailOrMobile === targetId || 
         dbId.replace(/^0+/, '') === cleanTargetId || 
         dbEmailOrMobile.replace(/^0+/, '') === cleanTargetId) && dbPass === targetPass) {
         
      if (dbStatus !== 'active') {
        return { success: false, message: 'Account is disabled.' };
      }
      
      // Get profile info
      let profile = { name: '', dob: '', address: '', profession: '', phone: '', email: '' };
      for (let j = 1; j < profiles.length; j++) {
        if (String(profiles[j][0]).trim() === dbId) {
          profile = {
            name: profiles[j][1],
            dob: profiles[j][2],
            address: profiles[j][3],
            profession: profiles[j][4],
            phone: profiles[j][5],
            email: profiles[j][6]
          };
          break;
        }
      }
      
      return { 
        success: true, 
        user: {
          id: dbId,
          role: dbRole,
          ...profile
        }
      };
    }
  }
  
  return { success: false, message: 'Invalid credentials.' };
}

function updateProfile(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const profileSheet = ss.getSheetByName('UserProfiles');
  const profiles = profileSheet.getDataRange().getValues();
  
  const timestamp = new Date().toISOString();
  
  for (let i = 1; i < profiles.length; i++) {
    if (profiles[i][0] === data.userId) {
      // Update row
      // Headers: ['UserId', 'FullName', 'DOB', 'Address', 'Profession', 'MobileNumber', 'EmailAddress', 'ProfilePhoto', 'created_at', 'created_by', 'updated_at', 'updated_by']
      const rowIndex = i + 1;
      profileSheet.getRange(rowIndex, 2).setValue(data.name);
      profileSheet.getRange(rowIndex, 3).setValue(data.dob || '');
      profileSheet.getRange(rowIndex, 4).setValue(data.address || '');
      profileSheet.getRange(rowIndex, 5).setValue(data.profession || '');
      profileSheet.getRange(rowIndex, 6).setValue(data.phone || '');
      profileSheet.getRange(rowIndex, 7).setValue(data.email || '');
      profileSheet.getRange(rowIndex, 11).setValue(timestamp); // updated_at
      profileSheet.getRange(rowIndex, 12).setValue(data.userId); // updated_by
      
      return { success: true, message: 'Profile updated successfully' };
    }
  }
  return { success: false, message: 'User profile not found' };
}

function getAdminStats() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const userSheet = ss.getSheetByName('Users');
  const bondsSheet = ss.getSheetByName('PrizeBonds');
  const ticketsSheet = ss.getSheetByName('Tickets');
  const supportSheet = ss.getSheetByName('SupportSettings');
  
  const users = userSheet.getDataRange().getValues();
  const bonds = bondsSheet.getDataRange().getValues();
  const tickets = ticketsSheet.getDataRange().getValues();
  const support = supportSheet.getDataRange().getValues();
  
  // Exclude header row
  const totalUsers = Math.max(0, users.length - 1);
  const activeUsers = users.filter((u, idx) => idx > 0 && u[3] === 'user' && u[4] === 'active').length;
  const totalBonds = Math.max(0, bonds.length - 1);
  const openTickets = tickets.filter((t, idx) => idx > 0 && t[5] === 'open').length;
  
  let wa = '';
  let email = '';
  for(let i=1; i<support.length; i++) {
    if(support[i][0] === 'WhatsApp') wa = support[i][1];
    if(support[i][0] === 'Email') email = support[i][1];
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
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const supportSheet = ss.getSheetByName('SupportSettings');
  const support = supportSheet.getDataRange().getValues();
  const timestamp = new Date().toISOString();
  
  for(let i=1; i<support.length; i++) {
    const row = i + 1;
    if(support[i][0] === 'WhatsApp') {
      supportSheet.getRange(row, 2).setValue(data.whatsapp);
    }
    if(support[i][0] === 'Email') {
      supportSheet.getRange(row, 2).setValue(data.email);
    }
  }
  return { success: true, message: 'Support settings saved successfully.' };
}

// ----------------------------------------------------
// Support Ticket System Functions
// ----------------------------------------------------

function createTicket(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const ticketSheet = ss.getSheetByName('Tickets');
  
  const timestamp = new Date().toISOString();
  const ticketId = 'TKT' + Math.floor(100000 + Math.random() * 900000);
  const userId = String(data.userId).trim();
  
  // Prefix ticketId and userId with ' to preserve leading zeros in sheets
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
  
  return { success: true, message: 'Ticket created successfully.', ticketId: ticketId };
}

function getUserTickets(userId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const ticketSheet = ss.getSheetByName('Tickets');
  const values = ticketSheet.getDataRange().getValues();
  const list = [];
  
  const targetUserId = String(userId).trim();
  const cleanTargetUserId = targetUserId.replace(/^0+/, '');
  
  for (let i = 1; i < values.length; i++) {
    const dbUserId = String(values[i][1]).trim();
    if (dbUserId === targetUserId || dbUserId.replace(/^0+/, '') === cleanTargetUserId) {
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
  
  // Sort by created_at descending
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { success: true, tickets: list };
}

function getTicketDetails(ticketId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const ticketSheet = ss.getSheetByName('Tickets');
  const repliesSheet = ss.getSheetByName('TicketReplies');
  
  const tValues = ticketSheet.getDataRange().getValues();
  const rValues = repliesSheet.getDataRange().getValues();
  
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
        updated_at: tValues[i][8]
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
  
  // Sort replies by created_at ascending (chronological thread)
  replies.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  return { success: true, ticket: ticket, replies: replies };
}

function addTicketReply(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const ticketSheet = ss.getSheetByName('Tickets');
  const repliesSheet = ss.getSheetByName('TicketReplies');
  
  const ticketId = String(data.ticketId).trim();
  const senderId = String(data.senderId).trim();
  const timestamp = new Date().toISOString();
  const replyId = 'RPY' + Math.floor(100000 + Math.random() * 900000);
  
  // Append reply. Prefix replyId and ticketId with '
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
  
  // Update Tickets updated_at and updated_by
  const tValues = ticketSheet.getDataRange().getValues();
  for (let i = 1; i < tValues.length; i++) {
    if (String(tValues[i][0]).trim() === ticketId) {
      const row = i + 1;
      ticketSheet.getRange(row, 9).setValue(timestamp); // updated_at
      ticketSheet.getRange(row, 10).setValue(senderId); // updated_by
      break;
    }
  }
  
  return { success: true, message: 'Reply sent successfully.' };
}

function adminGetTickets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const ticketSheet = ss.getSheetByName('Tickets');
  const profileSheet = ss.getSheetByName('UserProfiles');
  
  const tValues = ticketSheet.getDataRange().getValues();
  const pValues = profileSheet.getDataRange().getValues();
  const list = [];
  
  for (let i = 1; i < tValues.length; i++) {
    const ticketId = String(tValues[i][0]).trim();
    const userId = String(tValues[i][1]).trim();
    
    // Lookup user name
    let userName = 'N/A';
    for (let j = 1; j < pValues.length; j++) {
      if (String(pValues[j][0]).trim() === userId) {
        userName = pValues[j][1] || 'N/A';
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
  
  // Sort by updated_at descending
  list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return { success: true, tickets: list };
}

function adminUpdateTicketStatus(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const ticketSheet = ss.getSheetByName('Tickets');
  const tValues = ticketSheet.getDataRange().getValues();
  const ticketId = String(data.ticketId).trim();
  const timestamp = new Date().toISOString();
  const adminId = String(data.adminId).trim();
  
  for (let i = 1; i < tValues.length; i++) {
    if (String(tValues[i][0]).trim() === ticketId) {
      const row = i + 1;
      ticketSheet.getRange(row, 6).setValue(data.status); // Status
      ticketSheet.getRange(row, 9).setValue(timestamp); // updated_at
      ticketSheet.getRange(row, 10).setValue(adminId); // updated_by
      return { success: true, message: 'Ticket status updated to ' + data.status + '.' };
    }
  }
  return { success: false, message: 'Ticket not found.' };
}
