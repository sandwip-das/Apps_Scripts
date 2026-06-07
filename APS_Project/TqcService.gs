/**
 * TQC Business Logic Service
 * Handles complex cross-table joins for Training Records, Course expiries, and pivoting.
 */

var TqcService = (function() {

  function parseDate(d) {
    if (!d) return null;
    var dt = new Date(d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  function addMonths(date, months) {
    if (!date) return null;
    var d = new Date(date.valueOf());
    d.setMonth(d.getMonth() + Number(months));
    return d;
  }

  function getTrainingRecords() {
    var trainings = Database.getAll('trainings');
    var courses = Database.getAll('courses');
    
    // We reuse the logic from HrmService to get current employee details (Designation, Shift, Placement, Posting)
    var employeesDetails = HrmService.getEmployeesDetailsList();
    
    var courseMap = {};
    courses.forEach(function(c) { courseMap[c.course_code] = c; });

    var empMap = {};
    employeesDetails.forEach(function(e) { empMap[e.staff_id] = e; });

    var records = [];

    trainings.forEach(function(t) {
      var course = courseMap[t.course_code];
      var emp = empMap[t.staff_id];

      if (!emp) return; // Skip if employee doesn't exist

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
        expire_date: expireDate ? expireDate.toISOString() : '-',
        status: emp.status // Needed to filter out "Retired"
      });
    });

    // Sort by end_date descending by default
    records.sort(function(a, b) {
      return parseDate(b.end_date) - parseDate(a.end_date);
    });

    return records;
  }

  return {
    getTrainingRecords: getTrainingRecords
  };
})();
