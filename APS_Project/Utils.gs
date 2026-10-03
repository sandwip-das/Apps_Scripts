/**
 * ============================================================================
 * SANDVIORA AVIOSOLUTION - Core Enterprise Utility Engine
 * ============================================================================
 * File: Utils.gs
 * Architectural Role: Universal Data Processing, Date Math & Aviation Rules
 * 
 * Implements:
 * 1. Universal Date Parser (parseDate):
 *    Handles 8-digit numeric strings (e.g. "20102022"), "DD-MMM-YYYY", ISO formats,
 *    Excel serial numbers, and native Date objects.
 * 2. Universal Date Formatter (formatDateToDDMmmYYYY):
 *    Guarantees strict "DD-MMM-YYYY" display across all reports and tables.
 * 3. Placement Duration Engine (calculatePlacementDuration):
 *    Computes exact calendar duration in strict aviation format "04Y 10M 15D".
 * 4. Statutory Retirement Date Engine (calculateStatutoryRetirementDate):
 *    Statutory formula: DOB + 59 years - 1 day.
 * 5. Pay Group Hierarchy & Rank Resolution (parsePayGroupRank, isOfficerOrSup, isPayGroup1):
 *    Implements national pay group ranking from PG-1 up to PG-15.
 * 6. Seniority Ranking Engine (sortEmployeesBySeniority):
 *    Applies precedence: Earlier Promotion Date > Lower Sequence Number > Staff ID,
 *    with special rules for Pay Group 1 and Administrative Seniority Overrides.
 * ============================================================================
 */

var Utils = (function() {
  
  // Month abbreviation dictionaries for parsing and formatting
  var monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var monthsLower = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // ==========================================================================
  // SECTION 1: Universal Date Parsing & Formatting
  // ==========================================================================

  /**
   * Universal Date Parser
   * Accurately parses diverse date inputs into native JavaScript Date objects:
   * - 8-digit keystroke strings: "20102022" -> 20-Oct-2022
   * - Text-based dates: "20-Oct-2022", "20 Oct 2022", "20/Oct/2022"
   * - ISO 8601 strings: "2022-10-20"
   * - Excel / Google Sheets numeric serial timestamps (e.g. 44854)
   * - Native Date objects
   * 
   * @param {string|number|Date} dateVal - Raw date value to parse.
   * @returns {Date|null} Resolved Date object or null if input is empty or invalid.
   */
  function parseDate(dateVal) {
    if (!dateVal || dateVal === '-' || dateVal === 'null' || dateVal === 'undefined') return null;
    
    // Case 1: Already a valid Date object
    if (Object.prototype.toString.call(dateVal) === '[object Date]') {
      return isNaN(dateVal.getTime()) ? null : dateVal;
    }

    // Case 2: Numeric inputs (either 8-digit DDMMYYYY or spreadsheet serial day offset)
    if (typeof dateVal === 'number') {
      if (dateVal >= 10000000 && dateVal <= 99999999) {
        var sNum = String(dateVal);
        var dNum = parseInt(sNum.substring(0, 2), 10);
        var mNum = parseInt(sNum.substring(2, 4), 10) - 1;
        var yNum = parseInt(sNum.substring(4, 8), 10);
        return new Date(yNum, mNum, dNum);
      } else if (dateVal > 10000 && dateVal < 100000) {
        // Convert Excel / Sheets serial day offset (base date 1899-12-30)
        var ms = Math.round((dateVal - 25569) * 86400 * 1000);
        var dtNum = new Date(ms);
        return isNaN(dtNum.getTime()) ? null : dtNum;
      }
    }

    // Sanitize string
    var s = String(dateVal).trim();
    if (s.startsWith("'")) s = s.substring(1).trim();
    if (!s || s === '-') return null;

    // Case 3: 8-digit DDMMYYYY string (e.g. "20102022")
    if (/^\d{8}$/.test(s)) {
      var day = parseInt(s.substring(0, 2), 10);
      var month = parseInt(s.substring(2, 4), 10) - 1;
      var year = parseInt(s.substring(4, 8), 10);
      return new Date(year, month, day);
    }

    // Case 4: "DD-MMM-YYYY", "DD MMM YYYY", or "DD/MMM/YYYY" (e.g. "20-Oct-2022")
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

    // Case 5: Standard ISO format "YYYY-MM-DD"
    var isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (isoMatch) {
      return new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    }

    // Fallback: Standard JavaScript Date parsing
    var dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  }

  /**
   * Universal Date Formatter
   * Converts any supported date format into canonical "DD-MMM-YYYY" string (e.g. "20-Oct-2022").
   * 
   * @param {string|number|Date} dateVal - Date value to format.
   * @returns {string} Formatted date string, or empty string if input is blank.
   */
  function formatDateToDDMmmYYYY(dateVal) {
    if (!dateVal || dateVal === '-' || dateVal === 'null' || dateVal === 'undefined') return '';
    var d = parseDate(dateVal);
    if (!d || isNaN(d.getTime())) return String(dateVal);
    var day = ('0' + d.getDate()).slice(-2);
    var month = monthsShort[d.getMonth()];
    var year = d.getFullYear();
    return day + '-' + month + '-' + year;
  }

  // ==========================================================================
  // SECTION 2: Placement Duration & Statutory Retirement Math
  // ==========================================================================

  /**
   * Placement Duration Engine
   * Calculates the elapsed calendar duration between two dates in exact "YY" "MM" "DD" segments.
   * Handles variable days in months and leap years accurately.
   * 
   * @param {string|number|Date} startDateVal - Start date of the assignment/placement.
   * @param {string|number|Date} [endDateVal] - Optional end date. Defaults to current date if continuing.
   * @returns {string} Exact duration in standard format: "04Y 10M 15D".
   */
  function calculatePlacementDuration(startDateVal, endDateVal) {
    if (!startDateVal) return '-';
    var start = parseDate(startDateVal);
    if (!start) return '-';
    var end = endDateVal ? parseDate(endDateVal) : new Date();
    if (!end || end < start) return '00Y 00M 00D';

    var y = end.getFullYear() - start.getFullYear();
    var m = end.getMonth() - start.getMonth();
    var d = end.getDate() - start.getDate();

    // Borrow days from previous month if day difference is negative
    if (d < 0) {
      m--;
      var prevMonthDays = new Date(end.getFullYear(), end.getMonth(), 0).getDate();
      d += prevMonthDays;
    }
    // Borrow months from previous year if month difference is negative
    if (m < 0) {
      y--;
      m += 12;
    }

    if (y < 0) return '00Y 00M 00D';

    var pad = function(num) {
      return ('0' + num).slice(-2);
    };

    return pad(y) + 'Y ' + pad(m) + 'M ' + pad(d) + 'D';
  }

  /**
   * Dynamic Statutory Retirement Date Engine
   * Computes mandatory statutory retirement date based on Date of Birth.
   * Formula: DOB + 59 years - 1 day.
   * Example: DOB 20-Oct-1995 -> Retirement Date: 19-Oct-2054.
   * 
   * @param {string|number|Date} dobVal - Employee Date of Birth.
   * @returns {Date|null} Statutory retirement Date object.
   */
  function calculateStatutoryRetirementDate(dobVal) {
    var dob = parseDate(dobVal);
    if (!dob) return null;
    var retYear = dob.getFullYear() + 59;
    var retMonth = dob.getMonth();
    var retDay = dob.getDate() - 1;

    var retDate = new Date(retYear, retMonth, retDay);
    return retDate;
  }

  // ==========================================================================
  // SECTION 3: Pay Group Hierarchy & Rank Normalization
  // ==========================================================================

  /**
   * Pay Group Rank Parsing Engine
   * Normalizes arbitrary pay group strings into numeric ordering ranks:
   * - PG-1 (Traffic Helper / TH) -> 1.0
   * - PG-2 -> 2.0
   * - PG-3(1) / PG-3(I) -> 3.1
   * - PG-3(2) / PG-3(II) -> 3.2 (Supervisory tier starts here)
   * - PG-4 -> 4.0
   * - PG-5 through PG-15 -> 5.0 through 15.0 (Officer tier)
   * 
   * @param {string} pgStr - Raw pay group string (e.g. "PG-03(2)", "TH", "PG-10").
   * @returns {number} Normalized rank score for sorting and comparative evaluation.
   */
  function parsePayGroupRank(pgStr) {
    var s = String(pgStr || '').trim().toUpperCase();
    if (!s) return 0;
    // Match 3(2) or 3(II) or 3-2 or 3.2
    if (/3\s*[\(\-_\.]\s*(2|II)/i.test(s) || /PG\s*0?3\s*[\(\-_\.]\s*(2|II)/i.test(s)) return 3.2;
    // Match 3(1) or 3(I) or 3-1 or 3.1
    if (/3\s*[\(\-_\.]\s*(1|I)/i.test(s) || /PG\s*0?3\s*[\(\-_\.]\s*(1|I)/i.test(s)) return 3.1;
    // Match standalone PG-3 or 3
    if (/^(?:PG[\s\-_]*)?0?3$/i.test(s)) return 3.1;
    // Match PG-1, PG-01, 1, TH, Traffic Helper
    if (/^(?:PG[\s\-_]*)?0?1$/i.test(s) || s === 'TH' || s.indexOf('TRAFFIC HELPER') !== -1) return 1.0;
    // Match PG-2, PG-02, 2
    if (/^(?:PG[\s\-_]*)?0?2$/i.test(s)) return 2.0;
    // Match PG-4, PG-04, 4
    if (/^(?:PG[\s\-_]*)?0?4$/i.test(s)) return 4.0;
    // Match multi-digit PG numbers (e.g. PG-10, PG-11, PG-5...)
    var m = s.match(/(?:PG[\s\-_]*)?(\d+)/i);
    if (m) return parseInt(m[1], 10);
    return 0;
  }

  /**
   * Checks whether an employee or pay group string represents Pay Group 1 (Traffic Helper).
   * 
   * @param {Object|string} empOrPg - Employee object or pay group string.
   * @returns {boolean} True if employee belongs to Pay Group 1.
   */
  function isPayGroup1(empOrPg) {
    var pg = typeof empOrPg === 'string' ? empOrPg : (empOrPg ? empOrPg.pay_group : '');
    var rank = parsePayGroupRank(pg);
    if (rank === 1.0) return true;
    var s = String(pg || '').trim().toUpperCase();
    return s === 'TH' || s.indexOf('TRAFFIC HELPER') !== -1 || /^(?:PG[\s\-_]*)?0?1$/i.test(s);
  }

  /**
   * Determines whether an employee belongs to the Officer & Supervisory tier.
   * Qualification criteria:
   * 1. Belonging to Pay Group 3(2) upwards (Rank >= 3.2), OR
   * 2. Belonging to Pay Groups 4 through 15, OR
   * 3. Holding an explicit supervisory or executive designation keyword
   *    (Supervisor, Officer, Manager, Director, AGM, DGM, GM).
   * 
   * @param {Object|string} empOrPg - Employee object or pay group string.
   * @returns {boolean} True if employee qualifies as Officer/Supervisor.
   */
  function isOfficerOrSup(empOrPg) {
    if (!empOrPg) return false;
    var pg = typeof empOrPg === 'string' ? empOrPg : (empOrPg ? empOrPg.pay_group : '');
    var s = String(pg || '').trim().toUpperCase();
    var desig = (typeof empOrPg === 'object' && empOrPg) ? String(empOrPg.designation || empOrPg.base_designation || '').toUpperCase() : '';
    var rank = (typeof empOrPg === 'object' && empOrPg) ? Number(empOrPg.rank_level || 0) : 0;

    // 1. Check for 3(2) or 3(II) first
    if (
      /3\s*[\(\-_\/\.]\s*(?:2|II)\b/i.test(s) ||
      /3\s*[\(\-_\/\.]\s*2\b/i.test(s) ||
      s.indexOf('3(2)') !== -1 || s.indexOf('3 (2)') !== -1 ||
      s.indexOf('3(II)') !== -1 || s.indexOf('3(ii)') !== -1 ||
      s.indexOf('3/2') !== -1 || s.indexOf('3-2') !== -1 || s.indexOf('3.2') !== -1
    ) {
      return true;
    }

    // 2. Check for PG-4 through PG-15 (or single digits 4..9, 10..15)
    var numMatch = s.match(/(?:PG[\s\-_]*)?(\d+)/i);
    if (numMatch) {
      var n = parseInt(numMatch[1], 10);
      if (n >= 4) return true;
    }

    // 3. Rank level check
    if (rank >= 3.2 || rank >= 4) {
      return true;
    }

    // 4. Designation check (unless they are explicitly PG-1, PG-2, or PG-3(1))
    var isLower = /^(?:PG[\s\-_]*)?0?1$/i.test(s) || s === 'TH' ||
                  /^(?:PG[\s\-_]*)?0?2$/i.test(s) ||
                  /3\s*[\(\-_\/\.]\s*(?:1|I)\b/i.test(s) ||
                  /^(?:PG[\s\-_]*)?0?3$/i.test(s);
    if (!isLower) {
      if (desig.indexOf('SUPERVISOR') !== -1 || desig.indexOf('OFFICER') !== -1 || 
          desig.indexOf('MANAGER') !== -1 || desig.indexOf('DIRECTOR') !== -1 ||
          desig.indexOf('DGM') !== -1 || desig.indexOf('GM') !== -1 || desig.indexOf('AGM') !== -1) {
        return true;
      }
    }

    return false;
  }

  // ==========================================================================
  // SECTION 4: Seniority Sorting & Administrative Overrides
  // ==========================================================================

  /**
   * Seniority Hierarchy Engine
   * Sorts employee records in strict adherence to airline seniority governance rules:
   * 
   * 1. Administrative Overrides:
   *    Explicit manual overrides from `seniority_overrides` table take highest precedence.
   * 
   * 2. Pay Group 1 (Traffic Helpers) Special Rule:
   *    No provision for promotion exists in this tier. Seniority is governed strictly
   *    by Date of Joining. For same-day joiners, resolved by joining sequence or Staff ID.
   * 
   * 3. Pay Groups 2 Upwards:
   *    - Primary: Earlier Promotion Date (or initial joining date if never promoted).
   *    - Secondary: Promotion letter sequence number (lower sequence number = more senior).
   *    - Tertiary: Ascending Staff ID tie-breaker.
   * 
   * @param {Array<Object>} empList - Array of employee records.
   * @param {Object} [overridesMap] - Key-value map of { staff_id: override_sequence_number }.
   * @returns {Array<Object>} Sorted array in order of descending seniority.
   */
  function sortEmployeesBySeniority(empList, overridesMap) {
    var overrides = overridesMap || {};
    return empList.sort(function(a, b) {
      var staffA = String(a.staff_id || '').toUpperCase();
      var staffB = String(b.staff_id || '').toUpperCase();

      // Rule 1: Check Admin Override first
      var oA = overrides[staffA];
      var oB = overrides[staffB];
      if (oA !== undefined && oB !== undefined) return oA - oB;
      if (oA !== undefined) return -1;
      if (oB !== undefined) return 1;

      var isPg1A = isPayGroup1(a);
      var isPg1B = isPayGroup1(b);

      // Rule 2: Pay Group 1 Rule (Strictly Date of Joining)
      if (isPg1A && isPg1B) {
        var dateA = parseDate(a.joining_date);
        var dateB = parseDate(b.joining_date);
        var timeA = dateA ? dateA.getTime() : 0;
        var timeB = dateB ? dateB.getTime() : 0;

        if (timeA !== timeB) {
          return timeA - timeB;
        }

        // For same-day joiners: sequence of joining or Staff ID
        var seqA = (a.sequence_no !== undefined && a.sequence_no !== '' && !isNaN(a.sequence_no)) ? parseInt(a.sequence_no, 10) : 999999;
        var seqB = (b.sequence_no !== undefined && b.sequence_no !== '' && !isNaN(b.sequence_no)) ? parseInt(b.sequence_no, 10) : 999999;

        if (seqA !== seqB) {
          return seqA - seqB;
        }

        return staffA.localeCompare(staffB, undefined, { numeric: true });
      }

      // Rule 3: Pay Groups 2 upwards (Earlier Promotion Date > Sequence Number > Staff ID)
      var dateA = parseDate(a.latest_promotion_date || a.joining_date);
      var dateB = parseDate(b.latest_promotion_date || b.joining_date);
      var timeA = dateA ? dateA.getTime() : 0;
      var timeB = dateB ? dateB.getTime() : 0;

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      // Secondary: Sequence Number from promotion letter (lower is senior)
      var seqA = (a.sequence_no !== undefined && a.sequence_no !== '' && !isNaN(a.sequence_no)) ? parseInt(a.sequence_no, 10) : 999999;
      var seqB = (b.sequence_no !== undefined && b.sequence_no !== '' && !isNaN(b.sequence_no)) ? parseInt(b.sequence_no, 10) : 999999;

      if (seqA !== seqB) {
        return seqA - seqB;
      }

      // Tertiary: Staff ID numerical tie-breaker
      return staffA.localeCompare(staffB, undefined, { numeric: true });
    });
  }

  // ==========================================================================
  // Public Interface Exposure
  // ==========================================================================
  return {
    parseDate: parseDate,
    formatDateToDDMmmYYYY: formatDateToDDMmmYYYY,
    calculatePlacementDuration: calculatePlacementDuration,
    calculateStatutoryRetirementDate: calculateStatutoryRetirementDate,
    parsePayGroupRank: parsePayGroupRank,
    isPayGroup1: isPayGroup1,
    isOfficerOrSup: isOfficerOrSup,
    sortEmployeesBySeniority: sortEmployeesBySeniority
  };
})();
