/**
 * ============================================================================
 * SANDVIORA AVIOSOLUTION - Training & Quality Control (TQC) Service
 * ============================================================================
 * File: TqcService.gs
 * Architectural Role: Aviation Training & Certification Intelligence
 * 
 * Description:
 * Manages complex relational cross-table joins between training courses,
 * employee placements, and active staffing rosters. Computes training
 * validity windows, certification expiration dates, and provides structured
 * views for compliance auditing and recurrent training forecasting.
 * ============================================================================
 */

var TqcService = (function() {

  /**
   * Safely parses multiple date representations into native Date objects.
   * Delegates to universal Utils.parseDate if available.
   * 
   * @private
   * @param {string|number|Date} d - Raw date value.
   * @returns {Date|null} Native JavaScript Date or null if invalid.
   */
  function parseDate(d) {
    if (!d) return null;
    if (typeof Utils !== 'undefined' && Utils.parseDate) {
      return Utils.parseDate(d);
    }
    var dt = new Date(d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  /**
   * Calendar month arithmetic helper.
   * Accurately advances a date by a given number of months.
   * 
   * @private
   * @param {Date} date - Baseline date.
   * @param {number} months - Number of months to add.
   * @returns {Date|null} Adjusted Date object.
   */
  function addMonths(date, months) {
    if (!date) return null;
    var d = new Date(date.valueOf());
    d.setMonth(d.getMonth() + Number(months));
    return d;
  }

  /**
   * Retrieves and cross-joins all employee training records with course metadata.
   * 
   * Joins:
   * - `trainings`: Core event logs (staff_id, course_code, start_date, end_date)
   * - `courses`: Course definitions (course_name, course_validity in months)
   * - `employeesDetails`: Resolved employee read model (Name, Designation, Shift, Placement, Posting)
   * 
   * Calculations:
   * - Certification Expiry Date = Training End Date + Course Validity Months
   * 
   * @returns {Array<Object>} Enriched training compliance records sorted by end_date descending.
   */
  function getTrainingRecords() {
    var trainings = Database.getAll('trainings');
    var courses = Database.getAll('courses');
    
    // Leverage the canonical read model from HrmService to retrieve active employee operational assignments
    var employeesDetails = HrmService.getEmployeesDetailsList();
    
    // Build quick lookup dictionaries for O(1) in-memory resolution
    var courseMap = {};
    courses.forEach(function(c) { courseMap[c.course_code] = c; });

    var empMap = {};
    employeesDetails.forEach(function(e) { empMap[e.staff_id] = e; });

    var records = [];

    // Synthesize enriched training records
    trainings.forEach(function(t) {
      var course = courseMap[t.course_code];
      var emp = empMap[t.staff_id];

      // Exclude orphaned records where employee is no longer registered
      if (!emp) return;

      var endDate = parseDate(t.end_date);
      var validityMonths = course ? (Number(course.course_validity) || 0) : 0;
      var expireDate = validityMonths > 0 ? addMonths(endDate, validityMonths) : null;

      records.push({
        staff_id: emp.staff_id,
        name: emp.name,
        designation: emp.designation,
        shift: emp.shift,
        placement: emp.placement,
        posting: emp.posting,
        course_code: t.course_code,
        course_name: course ? course.course_name : t.course_code,
        start_date: t.start_date,
        end_date: t.end_date,
        expire_date: expireDate ? (typeof Utils !== 'undefined' ? Utils.formatDateToDDMmmYYYY(expireDate) : expireDate.toISOString()) : '-',
        status: emp.status // Retained to allow filtering out retired personnel
      });
    });

    // Default sorting: Most recent training completions appear at the top
    records.sort(function(a, b) {
      return parseDate(b.end_date) - parseDate(a.end_date);
    });

    return records;
  }

  return {
    /**
     * Public method exposed to Router.gs for frontend TQC views.
     */
    getTrainingRecords: getTrainingRecords
  };
})();
