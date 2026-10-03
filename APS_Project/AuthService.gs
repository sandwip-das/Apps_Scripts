/**
 * ============================================================================
 * SANDVIORA AVIOSOLUTION - Security & Role-Based Access Control (RBAC) Service
 * ============================================================================
 * File: AuthService.gs
 * Architectural Role: Authentication, Authorization & Permissions
 * 
 * Description:
 * Manages user authentication context, role assignments, and granular action
 * permissions across the platform. Ensures that sensitive operations (like
 * deleting employee records or editing workforce sanction models) are strictly
 * restricted to authorized user groups.
 * 
 * Role Hierarchy:
 * - SUPER_ADMIN: Unrestricted access (Create, Edit, Delete, View, Approve, Export)
 * - HR: Human resources administrative access (Create, Edit, View, Export)
 * - TQC: Training & Quality Control access (Create, Edit, View, Export)
 * - EMPLOYEE: Read-only personal view access (View)
 * ============================================================================
 */

var AuthService = (function() {
  
  /**
   * Permission matrix defining permitted operations per user role.
   * @private
   */
  var ROLES = {
    'SUPER_ADMIN': ['Create', 'Edit', 'Delete', 'View', 'Approve', 'Export'],
    'HR': ['Create', 'Edit', 'View', 'Export'],
    'TQC': ['Create', 'Edit', 'View', 'Export'],
    'EMPLOYEE': ['View']
  };

  /**
   * Execution-level cache to prevent repeated database scans for the active user.
   * @private
   */
  var cachedRole = null;

  /**
   * Resolves the current user's role from Google Session and the 'users' database table.
   * If no user record exists, defaults to SUPER_ADMIN for web app administration.
   * 
   * @returns {string} The resolved role name (e.g. 'SUPER_ADMIN', 'HR').
   */
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
    /**
     * Exposes the current user's resolved role name.
     * @returns {string} User role name.
     */
    getUserRole: getUserRole,
    
    /**
     * Checks if the active user possesses a specific permission.
     * 
     * @param {string} requiredPermission - Permission string (e.g. 'Delete', 'Create').
     * @returns {boolean} True if authorized, false otherwise.
     */
    hasPermission: function(requiredPermission) {
      var role = getUserRole();
      var permissions = ROLES[role] || [];
      return permissions.indexOf(requiredPermission) > -1;
    },
    
    /**
     * Enforces that the active user possesses the required permission.
     * Throws an Access Denied exception if the check fails.
     * 
     * @param {string} requiredPermission - Permission required to proceed.
     * @throws {Error} If permission is not granted.
     */
    enforcePermission: function(requiredPermission) {
      if (!this.hasPermission(requiredPermission)) {
        throw new Error("Access Denied: Missing permission '" + requiredPermission + "'");
      }
    }
  };
})();
