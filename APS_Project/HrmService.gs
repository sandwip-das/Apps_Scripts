/**
 * HRM Business Logic Service
 * Handles complex cross-table joins, dynamic date calculations, and seniority logic.
 */

var HrmService = (function() {

  // Helper to parse DDMMYYYY or ISO to Date object safely
  function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    var d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
    
  function formatPhone(val) {
    if (!val || val === '-') return '-';
    val = String(val);
    if (val.indexOf('-') > -1) {
      var parts = val.split('-');
      if (parts.length >= 2) {
        var numStr = parts.slice(1).join('').replace(/[^0-9]/g, '');
        if (numStr.length > 4) {
          return parts[0] + ' ' + numStr.substring(0,4) + '-' + numStr.substring(4);
        }
        return parts[0] + ' ' + numStr;
      }
    } else {
      var num = val.replace(/[^\+0-9]/g, '');
      if (num.startsWith('+') && num.length > 4) {
        var cc = num.substring(0, 4);
        var rest = num.substring(4);
        if (rest.length > 4) return cc + ' ' + rest.substring(0,4) + '-' + rest.substring(4);
        return cc + ' ' + rest;
      } else if (num.length > 4) {
        return '+880 ' + num.substring(0,4) + '-' + num.substring(4);
      }
    }
    return val;
  }

  // Calculate days between two dates
  function getDaysBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    var diffTime = Math.abs(d2 - d1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  // Calculate duration string e.g. "04Y 10M 15D"
  function getDurationString(startDate, endDate) {
    if (!startDate) return '-';
    var end = endDate || new Date();
    
    var y = end.getFullYear() - startDate.getFullYear();
    var m = end.getMonth() - startDate.getMonth();
    var d = end.getDate() - startDate.getDate();
    
    if (d < 0) {
      m--;
      d += new Date(end.getFullYear(), end.getMonth(), 0).getDate();
    }
    if (m < 0) {
      y--;
      m += 12;
    }
    
    if (y < 0) return '-';
    
    var pad = function(n) { return n < 10 ? '0' + n : n; };
    return pad(y) + 'Y ' + pad(m) + 'M ' + pad(d) + 'D';
  }

  function getEmployeesDetailsList() {
    var employees = Database.getAll('employees');
    var promotions = Database.getAll('promotions');
    var placements = Database.getAll('placements');
    var payGroups = Database.getAll('pay_groups');
    var migrations = Database.getAll('employee_migrations');
    var extensions = Database.getAll('extensions');
    var retirements = Database.getAll('self_retirements');
    var addlCharges = Database.getAll('additional_charges');
    var departments = Database.getAll('departments');
    var stations = Database.getAll('stations');
    var sections = Database.getAll('sections');
    var shifts = Database.getAll('shifts');

    var today = new Date();
    
    // Map data for fast lookup
    var pgMap = {};
    var pgMapByShort = {};
    payGroups.forEach(function(p) { 
      pgMap[p.pg_id] = p; 
      pgMapByShort[p.designation_short] = p;
    });

    var depMap = {};
    departments.forEach(function(d) { depMap[d.dep_id] = d; });

    var resultList = [];

    employees.forEach(function(emp) {
      var row = {
        emp_id: emp.emp_id,
        staff_id: emp.staff_id,
        name: emp.emp_name,
        gender: emp.gender || '-',
        contact_1: formatPhone(emp.contact_primary),
        contact_2: formatPhone(emp.contact_secondary) || '-',
        contact_family: formatPhone(emp.contact_family) || '-',
        email: emp.email,
        dob: emp.dob,
        joining_date: emp.joining_date,
        home_district: emp.home_district,
        remarks: emp.remarks || '-'
      };

      // 1. Previous ID from Migration
      var empMigrations = migrations.filter(function(m) { return String(m.new_staff_id) === String(emp.staff_id); });
      empMigrations.sort(function(a, b) { return parseDate(b.migration_date) - parseDate(a.migration_date); });
      row.previous_id = empMigrations.length > 0 ? empMigrations[0].old_staff_id : '-';

      // 2. Pay Group & Designation (from latest promotion)
      var empPromos = promotions.filter(function(p) { return String(p.emp_id) === String(emp.staff_id); });
      empPromos.sort(function(a, b) { return parseDate(b.promotion_date) - parseDate(a.promotion_date); });
      
      var initialPgId = emp.designation_short ? (pgMapByShort[emp.designation_short] ? pgMapByShort[emp.designation_short].pg_id : null) : emp.pg_id;
      var currentPgId = empPromos.length > 0 ? empPromos[0].promoted_pg_id : initialPgId;
      var pgObj = pgMap[currentPgId];
      
      row.pay_group = pgObj ? pgObj.pay_group : '-';
      row.rank_level = pgObj ? Number(pgObj.rank_level) || 0 : 0;
      var designation = pgObj ? (pgObj.designation_short || pgObj.designation || '-') : '-';
      
      // Seniority calculation relies on promotion date
      row._promotion_date = empPromos.length > 0 ? parseDate(empPromos[0].promotion_date) : parseDate(emp.joining_date);

      // 3. Additional Charge
      var activeCharges = addlCharges.filter(function(c) {
        return String(c.emp_id) === String(emp.staff_id) && 
               parseDate(c.charge_from) <= today && 
               parseDate(c.charge_to) >= today;
      });
      if (activeCharges.length > 0) {
        var chargePg = pgMap[activeCharges[0].charge_pg_id];
        if (chargePg) {
          designation += ', ' + chargePg.designation_short + ' (Add. Charge)';
        }
      }
      row.designation = designation;

      // 4. Shift, Placement, Posting
      var empPlacements = placements.filter(function(p) { return String(p.emp_id) === String(emp.staff_id); });
      empPlacements.sort(function(a, b) { return parseDate(b.placement_date) - parseDate(a.placement_date); });
      
      if (empPlacements.length > 0) {
        var latestPlc = empPlacements[0];
        
        // Find shift name
        var shiftObj = shifts.find(function(s) { return s.shift_id === latestPlc.shift_id; });
        row.shift = shiftObj ? shiftObj.shift_name : '-';
        
        // Find section letter code
        var secObj = sections.find(function(s) { return s.sec_id === latestPlc.sec_id; });
        row.placement = secObj ? secObj.sec_letter_code : '-';
        
        // Find station code
        var stObj = stations.find(function(s) { return s.station_id === latestPlc.station_id; });
        row.posting = stObj ? stObj.station_code : '-';

        row.placement_duration = getDurationString(parseDate(latestPlc.placement_date), today);
      } else {
        row.shift = '-';
        row.placement = '-';
        row.posting = '-';
        row.placement_duration = '-';
      }

      // 5. Department
      var depObj = depMap[emp.dep_id];
      row.department = depObj ? depObj.dep_letter_code : '-';

      // 6. Retirement Date & Status
      var dobDate = parseDate(emp.dob);
      var calcRetirement = new Date(dobDate);
      if (dobDate) {
        calcRetirement.setFullYear(calcRetirement.getFullYear() + 59); // DOB + 59 years
        calcRetirement.setDate(calcRetirement.getDate() - 1); // Minus 1 day
      }

      var finalRetirementDate = calcRetirement;
      var status = 'Active';

      // Check extensions
      var empExt = extensions.filter(function(e) { return String(e.emp_id) === String(emp.staff_id); });
      empExt.sort(function(a, b) { return parseDate(b.extension_to) - parseDate(a.extension_to); });
      if (empExt.length > 0) {
        finalRetirementDate = parseDate(empExt[0].extension_to);
        status = 'Extension';
      }

      // Check self retirement
      var empRet = retirements.filter(function(r) { return String(r.emp_id) === String(emp.staff_id); });
      empRet.sort(function(a, b) { return parseDate(b.retirement_date) - parseDate(a.retirement_date); });
      if (empRet.length > 0) {
        finalRetirementDate = parseDate(empRet[0].retirement_date);
      }

      if (finalRetirementDate < today) {
        status = 'Retired';
      }

      row.retirement_date = finalRetirementDate ? finalRetirementDate.toISOString() : null;
      row.status = status;

      resultList.push(row);
    });

    // 7. Seniority Sort
    // Descending by Pay Group rank_level, then Ascending by Promotion Date, then Ascending by Emp ID
    resultList.sort(function(a, b) {
      if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
      if (a._promotion_date && b._promotion_date && a._promotion_date.getTime() !== b._promotion_date.getTime()) {
        return a._promotion_date - b._promotion_date;
      }
      return String(a.staff_id).localeCompare(String(b.staff_id));
    });

    // Assign SL based on sort
    for (var i = 0; i < resultList.length; i++) {
      resultList[i].sl = i + 1;
      // Clean up internal fields before sending to client
      delete resultList[i]._promotion_date;
    }

    return resultList;
  }

  function getServiceHistory(empId) {
    if (!empId) return [];
    
    var emps = Database.getAll('employees').filter(function(r) { return r.emp_id === empId; });
    var targetStaffId = '';
    if (emps.length > 0) {
      targetStaffId = emps[0].staff_id;
    }
    
    var history = [];
    
    // Lookups
    var pgMap = {};
    var pgMapByShort = {};
    Database.getAll('pay_groups').forEach(function(p) { 
      pgMap[p.pg_id] = p; 
      pgMapByShort[p.designation_short] = p;
    });
    var stMap = {}; Database.getAll('stations').forEach(function(s) { stMap[s.station_id] = s; });
    var secMap = {}; Database.getAll('sections').forEach(function(s) { secMap[s.sec_id] = s; });
    var shiftMap = {}; Database.getAll('shifts').forEach(function(s) { shiftMap[s.shift_id] = s; });

    // 1. Postings
    Database.getAll('postings').filter(function(r) { return String(r.emp_id) === String(targetStaffId); }).forEach(function(r) {
      var st = stMap[r.station_id] ? stMap[r.station_id].station_code : r.station_id;
      history.push({
        date: r.posting_date,
        type: 'Posting',
        details: 'Posted to Station: ' + st
      });
    });

    // 2. Placements
    Database.getAll('placements').filter(function(r) { return String(r.emp_id) === String(targetStaffId); }).forEach(function(r) {
      var st = stMap[r.station_id] ? stMap[r.station_id].station_code : r.station_id;
      var sec = secMap[r.sec_id] ? secMap[r.sec_id].sec_letter_code : r.sec_id;
      var sh = shiftMap[r.shift_id] ? shiftMap[r.shift_id].shift_name : r.shift_id;
      history.push({
        date: r.placement_date,
        type: 'Placement',
        details: 'Placed in Station: ' + st + ' | Section: ' + sec + ' | Shift: ' + sh
      });
    });

    // 3. Promotions
    Database.getAll('promotions').filter(function(r) { return String(r.emp_id) === String(targetStaffId); }).forEach(function(r) {
      var from = pgMap[r.present_pg_id] ? pgMap[r.present_pg_id].pay_group : r.present_pg_id;
      var to = pgMap[r.promoted_pg_id] ? pgMap[r.promoted_pg_id].pay_group : r.promoted_pg_id;
      history.push({
        date: r.promotion_date,
        type: 'Promotion',
        details: 'Promoted from ' + from + ' to ' + to + ' (Seq: ' + r.sequence_no + ')'
      });
    });

    // 4. Extensions
    Database.getAll('extensions').filter(function(r) { return String(r.emp_id) === String(targetStaffId); }).forEach(function(r) {
      var pg = pgMap[r.extension_pg_id] ? pgMap[r.extension_pg_id].pay_group : r.extension_pg_id;
      history.push({
        date: r.extension_from,
        type: 'Extension',
        details: 'Extension granted as ' + pg + ' until ' + r.extension_to
      });
    });

    // 5. Additional Charges
    Database.getAll('additional_charges').filter(function(r) { return String(r.emp_id) === String(targetStaffId); }).forEach(function(r) {
      var pg = pgMap[r.charge_pg_id] ? pgMap[r.charge_pg_id].pay_group : r.charge_pg_id;
      history.push({
        date: r.charge_from,
        type: 'Additional Charge',
        details: 'Additional charge granted as ' + pg + ' until ' + r.charge_to
      });
    });

    // 7. Joining (Base Employee Record)
    if (emps.length > 0) {
      var emp = emps[0];
      var initialPgId = emp.designation_short ? (pgMapByShort[emp.designation_short] ? pgMapByShort[emp.designation_short].pg_id : null) : emp.pg_id;
      var pg = pgMap[initialPgId] ? pgMap[initialPgId].pay_group : initialPgId;
      history.push({
        date: emp.joining_date,
        type: 'Joined',
        details: 'Joined as ' + pg
      });
    }

    // 6. Migrations
    Database.getAll('employee_migrations').filter(function(r) { return String(r.new_staff_id) === String(targetStaffId); }).forEach(function(r) {
      history.push({
        date: r.migration_date,
        type: 'Migration',
        details: r.migration_type + ' (' + r.old_staff_id + ' -> ' + r.new_staff_id + ')'
      });
    });

    // Sort chronologically (descending)
    history.sort(function(a, b) {
      return parseDate(b.date) - parseDate(a.date);
    });

    return history;
  }

  return {
    getEmployeesDetailsList: getEmployeesDetailsList,
    getServiceHistory: getServiceHistory
  };
})();
