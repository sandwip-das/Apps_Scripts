/**
 * Security & Role-Based Access Control (RBAC) Service
 */

var AuthService = (function() {
  
  // Hardcoded for demonstration, but should be mapped from 'users' and 'roles' tables
  var ROLES = {
    'SUPER_ADMIN': ['Create', 'Edit', 'Delete', 'View', 'Approve', 'Export'],
    'HR': ['Create', 'Edit', 'View', 'Export'],
    'TQC': ['Create', 'Edit', 'View', 'Export'],
    'EMPLOYEE': ['View']
  };

  var cachedRole = null;

  function getUserRole() {
    if (cachedRole) return cachedRole;
    var email = '';
    try {
      if (typeof Session !== 'undefined' && Session.getActiveUser) {
        email = Session.getActiveUser().getEmail();
      }
    } catch (e) {}

    var user = null;
    try {
      var usersSheet = Database.getSheet('users');
      if (usersSheet && usersSheet.getLastRow() > 1) {
        var users = Database.getAll('users');
        if (email && users && users.length > 0) {
          user = users.find(function(u) { return u.email === email; });
        }
      }
    } catch (e) {}
    
    // Default to Super Admin for local testing / initial setup / web app access
    cachedRole = user ? user.role_name : 'SUPER_ADMIN';
    return cachedRole;
  }

  return {
    getUserRole: getUserRole,
    
    hasPermission: function(requiredPermission) {
      var role = getUserRole();
      var permissions = ROLES[role] || [];
      return permissions.indexOf(requiredPermission) > -1;
    },
    
    enforcePermission: function(requiredPermission) {
      if (!this.hasPermission(requiredPermission)) {
        throw new Error("Access Denied: Missing permission '" + requiredPermission + "'");
      }
    }
  };
})();
