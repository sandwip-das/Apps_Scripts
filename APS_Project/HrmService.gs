/**
 * HRM Business Logic Service
 * Handles complex cross-table joins, dynamic date calculations, and seniority logic.
 */

var HrmService = (function() {

  // Helper to parse DDMMYYYY, DD MMM YYYY, or ISO to Date object safely
  function parseDate(dateStr) {
    if (!dateStr || dateStr === '-') return null;
    if (typeof Utils !== 'undefined' && Utils.parseDate) {
      return Utils.parseDate(dateStr);
    }
    var d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
    
  function formatPhone(val) {
    if (!val || val === '-' || val === 'null' || val === 'undefined') return '-';
    var str = String(val).replace(/['"]/g, '').trim();
    if (!str) return '-';
    var digits = str.replace(/[^\+0-9]/g, '');
    if (digits.startsWith('+880') && digits.length >= 14) {
      return digits.substring(0, 8) + '-' + digits.substring(8);
    } else if (digits.startsWith('+880') && digits.length > 8) {
      return digits.substring(0, 8) + '-' + digits.substring(8);
    } else if (digits.startsWith('+') && digits.length > 7) {
      return digits.substring(0, digits.length - 6) + '-' + digits.substring(digits.length - 6);
    } else if (digits.length === 11 && digits.startsWith('01')) {
      return '+880' + digits.substring(1, 5) + '-' + digits.substring(5);
    }
    return str;
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

  function getEmployeesDetailsList(forceRefresh) {
    if (!forceRefresh && Database.ServerCache) {
      var cached = Database.ServerCache.get('cache_hrm_details');
      if (cached && Array.isArray(cached) && cached.length > 0) {
        return cached;
      }
    }

    var employees = Database.getAll('employees');
    var promotions = Database.getAll('promotions');
    var placements = Database.getAll('placements');
    var postings = Database.getAll('postings');
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
    var pgMapByName = {};
    var pgMapByPg = {};
    payGroups.forEach(function(p) { 
      pgMap[p.pg_id] = p; 
      if (p.designation_short) pgMapByShort[String(p.designation_short).trim().toUpperCase()] = p;
      if (p.designation) pgMapByName[String(p.designation).trim().toUpperCase()] = p;
      if (p.pay_group) pgMapByPg[String(p.pay_group).trim().toUpperCase()] = p;
    });

    var depMap = {};
    departments.forEach(function(d) { 
      depMap[d.dep_id] = d; 
      if (d.dep_code) depMap[d.dep_code] = d;
      if (d.dep_letter_code) depMap[d.dep_letter_code] = d;
    });

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

      // 2. Pay Group & Designation (from latest promotion, fallback to employee's pg_id)
      var empPromos = promotions.filter(function(p) { return String(p.emp_id) === String(emp.staff_id); });
      empPromos.sort(function(a, b) { return parseDate(b.promotion_date) - parseDate(a.promotion_date); });
      
      var rawPg = emp.pg_id || emp.designation_short || '';
      var rawPgKey = String(rawPg).trim().toUpperCase();
      var pgObj = null;

      if (empPromos.length > 0) {
        var promoPg = empPromos[0].promoted_pg_id;
        var promoPgKey = String(promoPg).trim().toUpperCase();
        pgObj = pgMap[promoPg] || pgMapByShort[promoPgKey] || pgMapByName[promoPgKey] || pgMapByPg[promoPgKey];
      }

      if (!pgObj && rawPg) {
        pgObj = pgMap[rawPg] || pgMapByShort[rawPgKey] || pgMapByName[rawPgKey] || pgMapByPg[rawPgKey];
      }
      
      row.pay_group = pgObj ? pgObj.pay_group : (rawPg || '-');
      row.rank_level = pgObj ? (Number(pgObj.rank_level) || 0) : 0;
      var designation = pgObj ? (pgObj.designation_short || pgObj.designation || rawPg || '-') : (rawPg || '-');
      
      // Seniority calculation relies on promotion date
      row._promotion_date = empPromos.length > 0 ? parseDate(empPromos[0].promotion_date) : parseDate(emp.joining_date);

      // 3. Additional Charge
      var activeCharges = addlCharges.filter(function(c) {
        return String(c.emp_id) === String(emp.staff_id) && 
               parseDate(c.charge_from) <= today && 
               parseDate(c.charge_to) >= today;
      });
      if (activeCharges.length > 0) {
        var chgKey = String(activeCharges[0].charge_pg_id).trim().toUpperCase();
        var chargePg = pgMap[activeCharges[0].charge_pg_id] || pgMapByShort[chgKey] || pgMapByName[chgKey];
        if (chargePg) {
          designation += ', ' + (chargePg.designation_short || chargePg.designation) + ' (Add. Charge)';
        }
      }
      row.designation = designation;

      // 4. Shift, Placement, Posting
      var empPlacements = placements.filter(function(p) { return String(p.emp_id) === String(emp.staff_id); });
      empPlacements.sort(function(a, b) { return parseDate(b.placement_date) - parseDate(a.placement_date); });
      
      var empPostings = postings.filter(function(p) { return String(p.emp_id) === String(emp.staff_id); });
      empPostings.sort(function(a, b) { return parseDate(b.posting_date) - parseDate(a.posting_date); });

      if (empPlacements.length > 0) {
        var latestPlc = empPlacements[0];
        
        // Find shift name
        var shiftObj = shifts.find(function(s) { return s.shift_id === latestPlc.shift_id; });
        row.shift = shiftObj ? shiftObj.shift_name : '-';
        row.shift_id = latestPlc.shift_id || null;
        
        // Find section letter code
        var secObj = sections.find(function(s) { return s.sec_id === latestPlc.sec_id; });
        row.placement = secObj ? secObj.sec_letter_code : '-';
        row.sec_id = latestPlc.sec_id || null;
        
        // Find station code
        var stObj = stations.find(function(s) { return s.station_id === latestPlc.station_id; });
        row.posting = stObj ? stObj.station_code : '-';
        row.station_id = latestPlc.station_id || null;

        row.placement_duration = getDurationString(parseDate(latestPlc.placement_date), today);
      } else if (empPostings.length > 0) {
        var latestPst = empPostings[0];
        var stObj = stations.find(function(s) { return s.station_id === latestPst.station_id; });
        row.shift = '-';
        row.shift_id = null;
        row.placement = '-';
        row.sec_id = null;
        row.posting = stObj ? stObj.station_code : '-';
        row.station_id = latestPst.station_id || null;
        row.placement_duration = '-';
      } else {
        row.shift = '-';
        row.shift_id = null;
        row.placement = '-';
        row.sec_id = null;
        row.posting = '-';
        row.station_id = null;
        row.placement_duration = '-';
      }

      // 5. Department
      var depObj = depMap[emp.dep_id];
      row.department = depObj ? depObj.dep_letter_code : '-';
      row.dep_name = depObj ? depObj.dep_name : '-';
      row.dep_id = emp.dep_id || (depObj ? depObj.dep_id : null);
      row.dir_id = depObj ? depObj.dir_id : null;
      row.pg_id = pgObj ? pgObj.pg_id : emp.pg_id;

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

      row.retirement_date = finalRetirementDate ? (typeof Utils !== 'undefined' ? Utils.formatDateToDDMmmYYYY(finalRetirementDate) : finalRetirementDate.toISOString()) : null;
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

    if (Database.ServerCache) {
      Database.ServerCache.put('cache_hrm_details', resultList, 21600);
    }

    return resultList;
  }

  function getServiceHistory(empId) {
    if (!empId) return [];
    
    var emps = Database.getAll('employees').filter(function(r) { 
      return String(r.emp_id) === String(empId) || String(r.staff_id) === String(empId); 
    });
    var targetStaffId = '';
    if (emps.length > 0) {
      targetStaffId = emps[0].staff_id;
    }
    
    var history = [];
    
    // Lookups
    var pgMap = {};
    var pgMapByShort = {};
    var pgMapByName = {};
    var pgMapByPg = {};
    Database.getAll('pay_groups').forEach(function(p) { 
      pgMap[p.pg_id] = p; 
      if (p.designation_short) pgMapByShort[String(p.designation_short).trim().toUpperCase()] = p;
      if (p.designation) pgMapByName[String(p.designation).trim().toUpperCase()] = p;
      if (p.pay_group) pgMapByPg[String(p.pay_group).trim().toUpperCase()] = p;
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
      var rawPg = emp.pg_id || emp.designation_short || '';
      var rawPgKey = String(rawPg).trim().toUpperCase();
      var pgObj = pgMap[rawPg] || pgMapByShort[rawPgKey] || pgMapByName[rawPgKey] || pgMapByPg[rawPgKey];
      var pg = pgObj ? (pgObj.pay_group || pgObj.designation_short || pgObj.designation) : (rawPg || 'Employee');
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

  function getAllPromotionsDetailed() {
    var promotions = Database.getAll('promotions');
    var employees = Database.getAll('employees');
    var payGroups = Database.getAll('pay_groups');
    var departments = Database.getAll('departments');

    // Fast lookups
    var empMap = {};
    employees.forEach(function(e) {
      if (e.staff_id) empMap[String(e.staff_id).trim()] = e;
      if (e.emp_id) empMap[String(e.emp_id).trim()] = e;
    });

    var pgMap = {};
    var pgMapByShort = {};
    var pgMapByName = {};
    var pgMapByPg = {};
    payGroups.forEach(function(p) {
      pgMap[p.pg_id] = p;
      if (p.designation_short) pgMapByShort[String(p.designation_short).trim().toUpperCase()] = p;
      if (p.designation) pgMapByName[String(p.designation).trim().toUpperCase()] = p;
      if (p.pay_group) pgMapByPg[String(p.pay_group).trim().toUpperCase()] = p;
    });

    var depMap = {};
    departments.forEach(function(d) {
      depMap[d.dep_id] = d;
      if (d.dep_code) depMap[d.dep_code] = d;
      if (d.dep_letter_code) depMap[d.dep_letter_code] = d;
    });

    var list = [];

    // Group promotions by employee to calculate duration in previous grade
    var promosByEmp = {};
    promotions.forEach(function(p) {
      var sid = String(p.emp_id || '').trim();
      if (!promosByEmp[sid]) promosByEmp[sid] = [];
      promosByEmp[sid].push(p);
    });

    for (var sid in promosByEmp) {
      promosByEmp[sid].sort(function(a, b) {
        return parseDate(a.promotion_date) - parseDate(b.promotion_date);
      });
    }

    promotions.forEach(function(promo) {
      var sid = String(promo.emp_id || '').trim();
      var emp = empMap[sid];

      var fromPgObj = pgMap[promo.present_pg_id] || pgMapByShort[String(promo.present_pg_id).trim().toUpperCase()] || pgMapByPg[String(promo.present_pg_id).trim().toUpperCase()];
      var toPgObj = pgMap[promo.promoted_pg_id] || pgMapByShort[String(promo.promoted_pg_id).trim().toUpperCase()] || pgMapByPg[String(promo.promoted_pg_id).trim().toUpperCase()];

      var depObj = emp ? depMap[emp.dep_id] : null;

      // Find time in previous grade
      var empPromos = promosByEmp[sid] || [];
      var promoIdx = empPromos.indexOf(promo);
      var prevDate = null;
      if (promoIdx > 0) {
        prevDate = parseDate(empPromos[promoIdx - 1].promotion_date);
      } else if (emp && emp.joining_date) {
        prevDate = parseDate(emp.joining_date);
      }
      var timeInPrev = prevDate ? getDurationString(prevDate, parseDate(promo.promotion_date)) : '-';

      var rankLevel = toPgObj ? (Number(toPgObj.rank_level) || 0) : (fromPgObj ? (Number(fromPgObj.rank_level) || 0) : 0);

      list.push({
        promotion_id: promo.promotion_id,
        staff_id: emp ? emp.staff_id : promo.emp_id,
        emp_id: emp ? emp.emp_id : '',
        emp_name: emp ? emp.emp_name : 'Unknown Employee',
        department: depObj ? depObj.dep_letter_code : '-',
        department_name: depObj ? depObj.dep_name : '-',
        present_pg_id: promo.present_pg_id,
        present_pay_group: fromPgObj ? fromPgObj.pay_group : promo.present_pg_id,
        present_designation: fromPgObj ? (fromPgObj.designation_short || fromPgObj.designation) : '-',
        promoted_pg_id: promo.promoted_pg_id,
        promoted_pay_group: toPgObj ? toPgObj.pay_group : promo.promoted_pg_id,
        promoted_designation: toPgObj ? (toPgObj.designation_short || toPgObj.designation) : '-',
        rank_level: rankLevel,
        sequence_no: promo.sequence_no || 1,
        promotion_date: promo.promotion_date,
        time_in_previous_grade: timeInPrev,
        _promoDateObj: parseDate(promo.promotion_date)
      });
    });

    // Primary sort: Most recent promotions first (promotion_date desc)
    // Secondary sort: Rank level of pay group descending (higher rank on top)
    list.sort(function(a, b) {
      var dateA = a._promoDateObj ? a._promoDateObj.getTime() : 0;
      var dateB = b._promoDateObj ? b._promoDateObj.getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
      return (Number(b.sequence_no) || 0) - (Number(a.sequence_no) || 0);
    });

    for (var i = 0; i < list.length; i++) {
      list[i].sl = i + 1;
      delete list[i]._promoDateObj;
    }

    return list;
  }

  function getEmployeePromotionReport(empIdentifier) {
    if (!empIdentifier) throw new Error("Please enter a valid Employee ID or Staff ID.");

    var cleanId = String(empIdentifier).trim().toUpperCase();
    var employees = Database.getAll('employees');
    var targetEmp = null;

    for (var i = 0; i < employees.length; i++) {
      var e = employees[i];
      if (String(e.emp_id || '').trim().toUpperCase() === cleanId || 
          String(e.staff_id || '').trim().toUpperCase() === cleanId) {
        targetEmp = e;
        break;
      }
    }

    if (!targetEmp) {
      throw new Error("No employee found with ID '" + empIdentifier + "'. Please check the ID and try again.");
    }

    var payGroups = Database.getAll('pay_groups');
    var departments = Database.getAll('departments');
    var migrations = Database.getAll('employee_migrations');
    var allPromotions = Database.getAll('promotions');

    var pgMap = {};
    var pgMapByShort = {};
    var pgMapByName = {};
    var pgMapByPg = {};
    payGroups.forEach(function(p) {
      pgMap[p.pg_id] = p;
      if (p.designation_short) pgMapByShort[String(p.designation_short).trim().toUpperCase()] = p;
      if (p.designation) pgMapByName[String(p.designation).trim().toUpperCase()] = p;
      if (p.pay_group) pgMapByPg[String(p.pay_group).trim().toUpperCase()] = p;
    });

    var depMap = {};
    departments.forEach(function(d) { depMap[d.dep_id] = d; });

    var directorates = Database.getAll('directorates');
    var dirMap = {};
    directorates.forEach(function(d) { dirMap[d.dir_id] = d; });

    var empMigrations = migrations.filter(function(m) { 
      return String(m.new_staff_id).trim() === String(targetEmp.staff_id).trim(); 
    });
    var previousId = empMigrations.length > 0 ? empMigrations[0].old_staff_id : '-';

    var depObj = depMap[targetEmp.dep_id];
    var dirObj = (depObj && depObj.dir_id) ? dirMap[depObj.dir_id] : (targetEmp.dir_id ? dirMap[targetEmp.dir_id] : null);

    // Initial Joining PG
    var rawInitPg = targetEmp.pg_id || targetEmp.designation_short || '';
    var initPgObj = pgMap[rawInitPg] || pgMapByShort[String(rawInitPg).trim().toUpperCase()] || pgMapByPg[String(rawInitPg).trim().toUpperCase()];

    // Get all promotions for this employee
    var empPromos = allPromotions.filter(function(p) {
      return String(p.emp_id).trim() === String(targetEmp.staff_id).trim() || 
             String(p.emp_id).trim() === String(targetEmp.emp_id).trim();
    });

    // Chronological ascending sort
    empPromos.sort(function(a, b) {
      return parseDate(a.promotion_date) - parseDate(b.promotion_date);
    });

    var history = [];
    var prevGradeDate = parseDate(targetEmp.joining_date);

    for (var p = 0; p < empPromos.length; p++) {
      var item = empPromos[p];
      var fromPg = pgMap[item.present_pg_id] || pgMapByShort[String(item.present_pg_id).trim().toUpperCase()] || pgMapByPg[String(item.present_pg_id).trim().toUpperCase()];
      var toPg = pgMap[item.promoted_pg_id] || pgMapByShort[String(item.promoted_pg_id).trim().toUpperCase()] || pgMapByPg[String(item.promoted_pg_id).trim().toUpperCase()];

      var promoDate = parseDate(item.promotion_date);
      var duration = prevGradeDate ? getDurationString(prevGradeDate, promoDate) : '-';
      prevGradeDate = promoDate;

      history.push({
        sl: p + 1,
        sequence_no: item.sequence_no || (p + 1),
        from_pg: fromPg ? fromPg.pay_group : item.present_pg_id,
        from_designation: fromPg ? (fromPg.designation_short || fromPg.designation) : '-',
        to_pg: toPg ? toPg.pay_group : item.promoted_pg_id,
        to_designation: toPg ? (toPg.designation_short || toPg.designation) : '-',
        promotion_date: item.promotion_date,
        duration_in_previous_grade: duration,
        remarks: 'Regular Promotion'
      });
    }

    // Current Pay Group & Designation
    var currentPgObj = empPromos.length > 0 ? 
      (pgMap[empPromos[empPromos.length - 1].promoted_pg_id] || pgMapByShort[String(empPromos[empPromos.length - 1].promoted_pg_id).trim().toUpperCase()]) :
      initPgObj;

    var totalService = targetEmp.joining_date ? getDurationString(parseDate(targetEmp.joining_date), new Date()) : '-';

    return {
      employee: {
        emp_id: targetEmp.emp_id,
        staff_id: targetEmp.staff_id,
        previous_id: previousId,
        emp_name: targetEmp.emp_name,
        gender: targetEmp.gender || '-',
        directorate_name: dirObj ? dirObj.dir_name : (targetEmp.dir_name || '-'),
        directorate_code: dirObj ? (dirObj.dir_letter_code || dirObj.dir_code) : '-',
        department_name: depObj ? depObj.dep_name : '-',
        department_code: depObj ? depObj.dep_letter_code : '-',
        current_pay_group: currentPgObj ? currentPgObj.pay_group : '-',
        current_designation: currentPgObj ? (currentPgObj.designation_short || currentPgObj.designation) : '-',
        current_rank_level: currentPgObj ? (Number(currentPgObj.rank_level) || 0) : 0,
        joining_pay_group: initPgObj ? initPgObj.pay_group : '-',
        joining_designation: initPgObj ? (initPgObj.designation_short || initPgObj.designation) : '-',
        joining_date: targetEmp.joining_date,
        dob: targetEmp.dob,
        email: targetEmp.email || '-',
        contact_primary: formatPhone(targetEmp.contact_primary),
        total_service: totalService,
        promotions_count: history.length
      },
      promotions: history
    };
  }

  function getPromotionEligibilityList() {
    var employees = Database.getAll('employees');
    var promotions = Database.getAll('promotions');
    var payGroups = Database.getAll('pay_groups');
    var departments = Database.getAll('departments');
    var extensions = Database.getAll('extensions');
    var retirements = Database.getAll('self_retirements');

    var today = new Date();

    var pgMap = {};
    var pgMapByShort = {};
    var pgMapByName = {};
    var pgMapByPg = {};
    payGroups.forEach(function(p) {
      pgMap[p.pg_id] = p;
      if (p.designation_short) pgMapByShort[String(p.designation_short).trim().toUpperCase()] = p;
      if (p.designation) pgMapByName[String(p.designation).trim().toUpperCase()] = p;
      if (p.pay_group) pgMapByPg[String(p.pay_group).trim().toUpperCase()] = p;
    });

    var depMap = {};
    departments.forEach(function(d) { depMap[d.dep_id] = d; });

    // Group promotions by employee staff_id
    var promosByStaff = {};
    promotions.forEach(function(p) {
      var sid = String(p.emp_id || '').trim();
      if (!promosByStaff[sid]) promosByStaff[sid] = [];
      promosByStaff[sid].push(p);
    });

    var eligibilityList = [];

    employees.forEach(function(emp) {
      // Check active status
      var dobDate = parseDate(emp.dob);
      var calcRetirement = new Date(dobDate);
      if (dobDate) {
        calcRetirement.setFullYear(calcRetirement.getFullYear() + 59);
        calcRetirement.setDate(calcRetirement.getDate() - 1);
      }
      var finalRetDate = calcRetirement;
      var status = 'Active';

      var empExt = extensions.filter(function(e) { return String(e.emp_id) === String(emp.staff_id); });
      empExt.sort(function(a, b) { return parseDate(b.extension_to) - parseDate(a.extension_to); });
      if (empExt.length > 0) {
        finalRetDate = parseDate(empExt[0].extension_to);
        status = 'Extension';
      }

      var empRet = retirements.filter(function(r) { return String(r.emp_id) === String(emp.staff_id); });
      empRet.sort(function(a, b) { return parseDate(b.retirement_date) - parseDate(a.retirement_date); });
      if (empRet.length > 0) {
        finalRetDate = parseDate(empRet[0].retirement_date);
      }

      if (finalRetDate && finalRetDate < today) {
        status = 'Retired';
      }

      // We focus on active/on-job employees for promotion eligibility
      if (status === 'Retired') return;

      var empPromos = promosByStaff[String(emp.staff_id).trim()] || [];
      empPromos.sort(function(a, b) { return parseDate(b.promotion_date) - parseDate(a.promotion_date); });

      var currentGradeDate = empPromos.length > 0 ? parseDate(empPromos[0].promotion_date) : parseDate(emp.joining_date);
      var currentGradeDateStr = empPromos.length > 0 ? empPromos[0].promotion_date : emp.joining_date;

      var rawPg = emp.pg_id || emp.designation_short || '';
      var initialPgObj = pgMap[rawPg] || pgMapByShort[String(rawPg).trim().toUpperCase()] || pgMapByPg[String(rawPg).trim().toUpperCase()];
      var currentPgObj = empPromos.length > 0 ? 
        (pgMap[empPromos[0].promoted_pg_id] || pgMapByShort[String(empPromos[0].promoted_pg_id).trim().toUpperCase()] || pgMapByPg[String(empPromos[0].promoted_pg_id).trim().toUpperCase()]) :
        initialPgObj;

      var depObj = depMap[emp.dep_id];

      var timeInGradeStr = getDurationString(currentGradeDate, today);
      var daysInGrade = currentGradeDate ? getDaysBetween(currentGradeDate, today) : 0;
      var yearsInGrade = daysInGrade / 365.25;

      var rankLevel = currentPgObj ? (Number(currentPgObj.rank_level) || 0) : 0;

      // Find next potential PG (higher rank_level in the same department or general)
      var higherPgs = payGroups.filter(function(pg) {
        return (Number(pg.rank_level) || 0) > rankLevel && (!pg.dep_id || !emp.dep_id || pg.dep_id === emp.dep_id);
      });
      higherPgs.sort(function(a, b) {
        return (Number(a.rank_level) || 0) - (Number(b.rank_level) || 0); // nearest higher
      });
      var nextPgObj = higherPgs.length > 0 ? higherPgs[0] : null;

      var eligibilityStatus = 'Under Regular Service (<2 Yrs)';
      var eligibilityBadge = 'bg-gray-100 text-gray-700';

      if (yearsInGrade >= 5) {
        eligibilityStatus = 'Highly Eligible (5+ Yrs)';
        eligibilityBadge = 'bg-green-100 text-green-800 border-green-300';
      } else if (yearsInGrade >= 3) {
        eligibilityStatus = 'Eligible (3+ Yrs)';
        eligibilityBadge = 'bg-blue-100 text-blue-800 border-blue-300';
      } else if (yearsInGrade >= 2) {
        eligibilityStatus = 'Approaching (2+ Yrs)';
        eligibilityBadge = 'bg-yellow-100 text-yellow-800 border-yellow-300';
      }

      eligibilityList.push({
        emp_id: emp.emp_id,
        staff_id: emp.staff_id,
        emp_name: emp.emp_name,
        department: depObj ? depObj.dep_letter_code : '-',
        department_name: depObj ? depObj.dep_name : '-',
        present_pay_group: currentPgObj ? currentPgObj.pay_group : '-',
        present_designation: currentPgObj ? (currentPgObj.designation_short || currentPgObj.designation) : '-',
        rank_level: rankLevel,
        current_grade_since: currentGradeDateStr,
        time_in_grade: timeInGradeStr,
        years_in_grade: yearsInGrade,
        next_pay_group: nextPgObj ? nextPgObj.pay_group : 'Top Tier Grade',
        next_designation: nextPgObj ? (nextPgObj.designation_short || nextPgObj.designation) : 'Highest Grade Reached',
        eligibility_status: eligibilityStatus,
        eligibility_badge: eligibilityBadge,
        joining_date: emp.joining_date,
        _gradeDateObj: currentGradeDate
      });
    });

    // Sort by rank_level descending, then years_in_grade descending
    eligibilityList.sort(function(a, b) {
      if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
      return b.years_in_grade - a.years_in_grade;
    });

    for (var k = 0; k < eligibilityList.length; k++) {
      eligibilityList[k].sl = k + 1;
      delete eligibilityList[k]._gradeDateObj;
    }

    return eligibilityList;
  }

  /**
   * Generates dynamic Workforce Setup Report aggregated by Designation & Pay Group.
   * Compares Sanctioned Setup vs Active Existing Headcount and calculates Required Deficit.
   * Matches the visual standard of the provided reference image.
   */
  function getWorkforceSetupReport(filters) {
    filters = filters || {};
    var dirId = filters.dir_id && filters.dir_id !== 'ALL' ? String(filters.dir_id).trim() : null;
    var depId = filters.dep_id && filters.dep_id !== 'ALL' ? String(filters.dep_id).trim() : null;
    var stationId = filters.station_id && filters.station_id !== 'ALL' ? String(filters.station_id).trim() : null;

    var setups = Database.getAll('workforce_setup');
    var payGroups = Database.getAll('pay_groups');
    var employees = getEmployeesDetailsList();
    var departments = Database.getAll('departments');
    var directorates = Database.getAll('directorates');
    var stations = Database.getAll('stations');

    // Create fast lookup maps
    var pgMap = {};
    payGroups.forEach(function(pg) {
      pgMap[pg.pg_id] = pg;
      if (pg.designation_short) pgMap[String(pg.designation_short).trim().toUpperCase()] = pg;
      if (pg.pay_group) pgMap[String(pg.pay_group).trim().toUpperCase()] = pg;
    });

    var depMap = {};
    departments.forEach(function(d) {
      depMap[d.dep_id] = d;
      if (d.dep_letter_code) depMap[String(d.dep_letter_code).trim().toUpperCase()] = d;
    });

    var matrix = {};

    function getGroupKey(desig, pgName) {
      return (String(desig || '-').trim().toUpperCase()) + '|' + (String(pgName || '-').trim().toUpperCase());
    }

    function getOrCreateGroup(desig, pgName, rankLvl) {
      var key = getGroupKey(desig, pgName);
      if (!matrix[key]) {
        matrix[key] = {
          designation: desig || '-',
          pay_group: pgName || '-',
          rank_level: Number(rankLvl) || 0,
          setup: 0,
          existing: 0,
          required: 0
        };
      }
      return matrix[key];
    }

    // 1. Process Sanctioned Setups from workforce_setup
    setups.forEach(function(s) {
      if (dirId && String(s.dir_id).trim() !== dirId) return;
      if (depId && String(s.dep_id).trim() !== depId) return;
      if (stationId && String(s.station_id).trim() !== stationId) return;

      var pgObj = pgMap[s.pay_group_id] || pgMap[s.designation_id];
      var desigObj = pgMap[s.designation_id] || pgObj;

      var desig = desigObj ? (desigObj.designation_short || desigObj.designation) : (s.designation_id || '-');
      var pgName = pgObj ? pgObj.pay_group : (s.pay_group_id || '-');
      var rankLvl = pgObj ? pgObj.rank_level : (desigObj ? desigObj.rank_level : 0);

      var entry = getOrCreateGroup(desig, pgName, rankLvl);
      entry.setup += (Number(s.set_up) || 0);
    });

    // 2. Process Active Personnel
    employees.forEach(function(emp) {
      if (emp.status === 'Retired') return; // Exclude retired employees

      if (dirId && String(emp.dir_id).trim() !== dirId) return;
      if (depId && String(emp.dep_id).trim() !== depId) return;
      if (stationId && String(emp.station_id).trim() !== stationId) return;

      var desig = emp.designation ? String(emp.designation).replace(/,.*\(Add\. Charge\)/i, '').trim() : '-';
      var pgName = emp.pay_group || '-';
      var rankLvl = emp.rank_level || 0;

      var entry = getOrCreateGroup(desig, pgName, rankLvl);
      entry.existing += 1;
    });

    // 3. Compute Required Deficit and apply dynamic exclusion
    var rows = [];
    var totalSetup = 0;
    var totalExisting = 0;
    var totalRequired = 0;

    for (var k in matrix) {
      if (matrix.hasOwnProperty(k)) {
        var row = matrix[k];
        row.required = row.setup - row.existing;

        // Dynamic exclusion: Any department or group without currently assigned personnel or setup is excluded
        if (row.setup === 0 && row.existing === 0) {
          continue;
        }

        totalSetup += row.setup;
        totalExisting += row.existing;
        totalRequired += row.required;
        rows.push(row);
      }
    }

    // 4. Sort rows descending by rank_level, then by designation
    rows.sort(function(a, b) {
      if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
      return a.designation.localeCompare(b.designation);
    });

    return {
      filters: { dir_id: dirId || 'ALL', dep_id: depId || 'ALL', station_id: stationId || 'ALL' },
      rows: rows,
      total_setup: totalSetup,
      total_existing: totalExisting,
      total_required: totalRequired
    };
  }

  /**
   * Generates consolidated multi-variable workforce distribution reports.
   * Cross-tabulates headcount across operational shifts, designations, sections, and stations.
   */
  function getWorkforceDistribution(filters) {
    filters = filters || {};
    var dirId = filters.dir_id && filters.dir_id !== 'ALL' ? String(filters.dir_id).trim() : null;
    var depId = filters.dep_id && filters.dep_id !== 'ALL' ? String(filters.dep_id).trim() : null;
    var stationId = filters.station_id && filters.station_id !== 'ALL' ? String(filters.station_id).trim() : null;

    var employees = getEmployeesDetailsList().filter(function(e) {
      if (e.status === 'Retired') return false;
      if (dirId && String(e.dir_id).trim() !== dirId) return false;
      if (depId && String(e.dep_id).trim() !== depId) return false;
      if (stationId && String(e.station_id).trim() !== stationId) return false;
      return true;
    });

    var shifts = Database.getAll('shifts');
    var shiftColMap = {};
    shifts.forEach(function(s) { if (s.shift_name) shiftColMap[s.shift_name] = true; });
    var shiftCols = Object.keys(shiftColMap);
    if (shiftCols.indexOf('General') === -1) shiftCols.push('General');
    if (shiftCols.indexOf('Others') === -1) shiftCols.push('Others');

    // 1. By Shift: Department x Shift Matrix
    var depShiftMatrix = {};
    employees.forEach(function(e) {
      var dep = e.department || 'Unknown';
      if (!depShiftMatrix[dep]) {
        depShiftMatrix[dep] = { department: dep, dep_name: e.dep_name || dep, total: 0 };
        shiftCols.forEach(function(col) { depShiftMatrix[dep][col] = 0; });
      }
      var sh = e.shift && shiftCols.indexOf(e.shift) !== -1 ? e.shift : 'Others';
      depShiftMatrix[dep][sh] = (depShiftMatrix[dep][sh] || 0) + 1;
      depShiftMatrix[dep].total += 1;
    });
    var byShiftRows = Object.values(depShiftMatrix);

    // 2. By Section: Department x Section Breakdown
    var secMatrix = {};
    employees.forEach(function(e) {
      var dep = e.department || 'Unknown';
      var sec = e.placement && e.placement !== '-' ? e.placement : 'General Section';
      var key = dep + '|' + sec;
      if (!secMatrix[key]) {
        secMatrix[key] = { department: dep, dep_name: e.dep_name || dep, section: sec, headcount: 0 };
      }
      secMatrix[key].headcount += 1;
    });
    var bySectionRows = Object.values(secMatrix);
    bySectionRows.sort(function(a, b) {
      if (a.department !== b.department) return a.department.localeCompare(b.department);
      return b.headcount - a.headcount;
    });

    // 3. By Designation & Rank
    var desigMatrix = {};
    employees.forEach(function(e) {
      var desig = e.designation ? String(e.designation).replace(/,.*\(Add\. Charge\)/i, '').trim() : '-';
      var key = desig + '|' + (e.pay_group || '-');
      if (!desigMatrix[key]) {
        desigMatrix[key] = {
          designation: desig,
          pay_group: e.pay_group || '-',
          rank_level: e.rank_level || 0,
          headcount: 0
        };
      }
      desigMatrix[key].headcount += 1;
    });
    var byDesigRows = Object.values(desigMatrix);
    byDesigRows.sort(function(a, b) {
      if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
      return b.headcount - a.headcount;
    });

    // 4. By Station
    var stnMatrix = {};
    employees.forEach(function(e) {
      var stn = e.posting && e.posting !== '-' ? e.posting : 'Unassigned';
      stnMatrix[stn] = (stnMatrix[stn] || 0) + 1;
    });
    var byStationRows = Object.keys(stnMatrix).map(function(k) {
      return { station_code: k, headcount: stnMatrix[k] };
    });
    byStationRows.sort(function(a, b) { return b.headcount - a.headcount; });

    return {
      shift_columns: shiftCols,
      by_shift: byShiftRows,
      by_section: bySectionRows,
      by_designation: byDesigRows,
      by_station: byStationRows,
      total_headcount: employees.length
    };
  }

  /**
   * Contemporary Enterprise Airline HR Analytics Model.
   * Computes operational manning health, station network coverage, succession/retirement horizons, and pay group pyramid distributions.
   */
  function getAirlineHRAnalytics() {
    var setups = Database.getAll('workforce_setup');
    var employees = getEmployeesDetailsList();
    var stations = Database.getAll('stations');
    var departments = Database.getAll('departments');

    var activeEmps = employees.filter(function(e) { return e.status !== 'Retired'; });
    var totalSetup = setups.reduce(function(sum, s) { return sum + (Number(s.set_up) || 0); }, 0);
    var totalExisting = activeEmps.length;
    var totalRequired = totalSetup - totalExisting;
    var fulfillmentRate = totalSetup > 0 ? Math.round((totalExisting / totalSetup) * 100) : 100;

    // Station lookups
    var hubStations = stations.filter(function(s) {
      var type = String(s.station_type || '').toLowerCase();
      var code = String(s.station_code || '').toUpperCase();
      return type === 'hub' || code === 'DAC' || code === 'HSIA';
    }).map(function(s) { return String(s.station_code).toUpperCase(); });

    var hubCount = 0;
    var spokeCount = 0;
    activeEmps.forEach(function(e) {
      var stnCode = String(e.posting || '').toUpperCase();
      if (hubStations.indexOf(stnCode) !== -1) {
        hubCount++;
      } else {
        spokeCount++;
      }
    });

    // Frontline operational vs Corporate/Admin
    var operationalCount = 0;
    var adminCount = 0;
    activeEmps.forEach(function(e) {
      var d = String(e.department || '').toUpperCase();
      if ((e.shift && e.shift !== '-' && e.shift !== 'General') || ['GS', 'TQC', 'OPS', 'SEC', 'ENG', 'RAMP'].indexOf(d) !== -1) {
        operationalCount++;
      } else {
        adminCount++;
      }
    });

    // Pay Group Hierarchy Pyramid
    var execCount = 0;        // PG 9-11 (Executive Leadership)
    var supervisoryCount = 0; // PG 5-8 (Supervisory & Officers)
    var operationalPgCount = 0;// PG 1-4 (Ground Staff, Technicians, Trainees)
    activeEmps.forEach(function(e) {
      var r = e.rank_level || 0;
      if (r >= 9) execCount++;
      else if (r >= 5) supervisoryCount++;
      else operationalPgCount++;
    });

    // Retirement & Succession Horizons
    var now = new Date();
    var oneYr = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    var threeYrs = new Date(now.getFullYear() + 3, now.getMonth(), now.getDate());
    var fiveYrs = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());

    var ret1Yr = 0, ret3Yrs = 0, ret5Yrs = 0;
    activeEmps.forEach(function(e) {
      if (e.retirement_date) {
        var retD = parseDate(e.retirement_date);
        if (retD && retD >= now) {
          if (retD <= oneYr) ret1Yr++;
          if (retD <= threeYrs) ret3Yrs++;
          if (retD <= fiveYrs) ret5Yrs++;
        }
      }
    });

    // Departmental Health
    var depHealth = {};
    departments.forEach(function(d) {
      depHealth[d.dep_id] = {
        dep_id: d.dep_id,
        dep_code: d.dep_letter_code || d.dep_code,
        dep_name: d.dep_name,
        setup: 0,
        existing: 0
      };
    });
    setups.forEach(function(s) {
      if (depHealth[s.dep_id]) {
        depHealth[s.dep_id].setup += (Number(s.set_up) || 0);
      }
    });
    activeEmps.forEach(function(e) {
      if (depHealth[e.dep_id]) {
        depHealth[e.dep_id].existing += 1;
      }
    });
    var depHealthList = Object.values(depHealth).filter(function(d) { return d.setup > 0 || d.existing > 0; });
    depHealthList.forEach(function(d) {
      d.deficit = d.setup - d.existing;
      d.fulfillment = d.setup > 0 ? Math.round((d.existing / d.setup) * 100) : 100;
      if (d.fulfillment >= 90) d.health = 'Optimal';
      else if (d.fulfillment >= 75) d.health = 'Moderate';
      else d.health = 'Critical';
    });

    // Station Health & Manning Matrix
    var stnHealth = {};
    stations.forEach(function(st) {
      stnHealth[st.station_id] = {
        station_id: st.station_id,
        station_code: st.station_code,
        station_name: st.station_name,
        station_type: st.station_type || 'Spoke',
        setup: 0,
        existing: 0
      };
    });
    setups.forEach(function(s) {
      if (stnHealth[s.station_id]) {
        stnHealth[s.station_id].setup += (Number(s.set_up) || 0);
      }
    });
    activeEmps.forEach(function(e) {
      if (stnHealth[e.station_id]) {
        stnHealth[e.station_id].existing += 1;
      }
    });
    var stnList = Object.values(stnHealth).filter(function(s) { return s.setup > 0 || s.existing > 0; });
    stnList.forEach(function(s) {
      s.deficit = s.setup - s.existing;
      s.fulfillment = s.setup > 0 ? Math.round((s.existing / s.setup) * 100) : 100;
      if (s.fulfillment >= 90) s.status = 'Adequate';
      else if (s.fulfillment >= 75) s.status = 'Deficit';
      else s.status = 'Critical';
    });
    stnList.sort(function(a, b) { return b.deficit - a.deficit; });

    return {
      kpis: {
        total_sanctioned: totalSetup,
        total_existing: totalExisting,
        total_required: totalRequired,
        fulfillment_rate: fulfillmentRate,
        hub_headcount: hubCount,
        spoke_headcount: spokeCount,
        hub_spoke_ratio: totalExisting > 0 ? Math.round((hubCount / totalExisting) * 100) + '% / ' + Math.round((spokeCount / totalExisting) * 100) + '%' : '0% / 0%',
        operational_headcount: operationalCount,
        admin_headcount: adminCount,
        operational_manning_ratio: totalExisting > 0 ? Math.round((operationalCount / totalExisting) * 100) + '%' : '0%',
        pyramid: {
          executive: execCount,
          supervisory: supervisoryCount,
          operational: operationalPgCount
        },
        retirement_pipeline: {
          within_1_yr: ret1Yr,
          within_3_yrs: ret3Yrs,
          within_5_yrs: ret5Yrs
        }
      },
      department_health: depHealthList,
      station_health: stnList
    };
  }

  return {
    getEmployeesDetailsList: getEmployeesDetailsList,
    getServiceHistory: getServiceHistory,
    getAllPromotionsDetailed: getAllPromotionsDetailed,
    getEmployeePromotionReport: getEmployeePromotionReport,
    getPromotionEligibilityList: getPromotionEligibilityList,
    getWorkforceSetupReport: getWorkforceSetupReport,
    getWorkforceDistribution: getWorkforceDistribution,
    getAirlineHRAnalytics: getAirlineHRAnalytics
  };
})();
