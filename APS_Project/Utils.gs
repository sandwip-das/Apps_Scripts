/**
 * Utility Functions
 */

var Utils = (function() {
  
  return {
    /**
     * Parses DDMMYYYY string into a JS Date object.
     * Example: "20102022" -> Date(2022, 9, 20)
     */
    parseDateDDMMYYYY: function(dateStr) {
      if (!dateStr || dateStr.length !== 8) return null;
      var day = parseInt(dateStr.substring(0, 2), 10);
      var month = parseInt(dateStr.substring(2, 4), 10) - 1;
      var year = parseInt(dateStr.substring(4, 8), 10);
      return new Date(year, month, day);
    },

    /**
     * Formats a JS Date to "DD-Mon-YYYY"
     * Example: Date(2022, 9, 20) -> "20-Oct-2022"
     */
    formatDateToDDMonYYYY: function(dateObj) {
      if (!dateObj || !(dateObj instanceof Date)) return '';
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var day = String(dateObj.getDate()).padStart(2, '0');
      var month = months[dateObj.getMonth()];
      var year = dateObj.getFullYear();
      return day + '-' + month + '-' + year;
    }
  };
})();
