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

  function getUserRole() {
    var email = Session.getActiveUser().getEmail();
    var users = Database.getAll('users');
    var user = users.find(function(u) { return u.email === email; });
    
    // Default to Super Admin for local testing / initial setup
    return user ? user.role_name : 'SUPER_ADMIN'; 
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
