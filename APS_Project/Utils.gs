/**
 * Utility Functions
 */

var Utils = (function() {
  
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var monthsLower = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  /**
   * Safely parses any date representation (Date object, DDMMYYYY, DD MMM YYYY, DD-Mon-YYYY, ISO) into a JS Date.
   */
  function parseDate(dateVal) {
    if (!dateVal || dateVal === '-' || dateVal === 'null' || dateVal === 'undefined') return null;
    if (Object.prototype.toString.call(dateVal) === '[object Date]') {
      return isNaN(dateVal.getTime()) ? null : dateVal;
    }
    if (typeof dateVal === 'number') {
      if (dateVal >= 10000000 && dateVal <= 99999999) {
        var sNum = String(dateVal);
        var dNum = parseInt(sNum.substring(0, 2), 10);
        var mNum = parseInt(sNum.substring(2, 4), 10) - 1;
        var yNum = parseInt(sNum.substring(4, 8), 10);
        return new Date(yNum, mNum, dNum);
      } else if (dateVal > 10000 && dateVal < 100000) {
        var ms = Math.round((dateVal - 25569) * 86400 * 1000);
        var dtNum = new Date(ms);
        return isNaN(dtNum.getTime()) ? null : dtNum;
      }
    }
    var s = String(dateVal).trim();
    if (s.startsWith("'")) s = s.substring(1).trim();
    if (!s || s === '-') return null;

    // 8-digit DDMMYYYY (e.g., "20102022")
    if (/^\d{8}$/.test(s)) {
      var day = parseInt(s.substring(0, 2), 10);
      var month = parseInt(s.substring(2, 4), 10) - 1;
      var year = parseInt(s.substring(4, 8), 10);
      return new Date(year, month, day);
    }

    // "DD MMM YYYY" or "DD-MMM-YYYY" (e.g. "20 Oct 2022" or "20-Oct-2022")
    var m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{4})$/);
    if (m) {
      var d = parseInt(m[1], 10);
      var mStr = m[2].toLowerCase();
      var y = parseInt(m[3], 10);
      var mIdx = monthsLower.indexOf(mStr);
      if (mIdx !== -1) {
        return new Date(y, mIdx, d);
      }
    }

    var dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  }

  /**
   * Formats any valid Date object or date string to "dd mmm yyyy" format.
   * Example: Date(2022, 9, 20) -> "20 Oct 2022"
   */
  function formatDateToDDMmmYYYY(dateVal) {
    if (!dateVal || dateVal === '-' || dateVal === 'null' || dateVal === 'undefined') return '';
    var d = parseDate(dateVal);
    if (!d || isNaN(d.getTime())) return String(dateVal);
    var day = String(d.getDate());
    if (day.length === 1) day = '0' + day;
    var month = months[d.getMonth()];
    var year = d.getFullYear();
    return day + ' ' + month + ' ' + year;
  }

  return {
    parseDate: parseDate,
    parseDateDDMMYYYY: function(dateStr) {
      return parseDate(dateStr);
    },
    formatDateToDDMmmYYYY: formatDateToDDMmmYYYY,
    formatDateToDDMonYYYY: function(dateObj) {
      return formatDateToDDMmmYYYY(dateObj);
    }
  };
})();
