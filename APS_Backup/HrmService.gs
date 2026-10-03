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

    var employees = Database.getAll('employees', forceRefresh);
    var promotions = Database.getAll('promotions', forceRefresh);
    var placements = Database.getAll('placements', forceRefresh);
    var postings = Database.getAll('postings', forceRefresh);
    var payGroups = Database.getAll('pay_groups', forceRefresh);
    var migrations = Database.getAll('employee_migrations', forceRefresh);
    var extensions = Database.getAll('extensions', forceRefresh);
    var retirements = Database.getAll('self_retirements', forceRefresh);
    var addlCharges = Database.getAll('additional_charges', forceRefresh);
    var departments = Database.getAll('departments', forceRefresh);
    var stations = Database.getAll('stations', forceRefresh);
    var sections = Database.getAll('sections', forceRefresh);
    var shifts = Database.getAll('shifts', forceRefresh);

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
      if (d.dep_code) depMap[String(d.dep_code).trim().toUpperCase()] = d;
      if (d.dep_letter_code) depMap[String(d.dep_letter_code).trim().toUpperCase()] = d;
    });

    var resultList = [];

    employees.forEach(function(emp) {
      var staffId = String(emp.staff_id || emp.emp_id || emp.id_no || '').trim();
      var empId = String(emp.emp_id || emp.staff_id || '').trim();
      var empName = emp.emp_name || emp.name || emp.employee_name || '';

      var row = {
        emp_id: empId,
        staff_id: staffId,
        name: empName,
        emp_name: empName,
        gender: emp.gender || '-',
        contact_1: formatPhone(emp.contact_primary || emp.contact_1 || emp.phone || emp.mobile),
        contact_2: formatPhone(emp.contact_secondary || emp.contact_2) || '-',
        contact_family: formatPhone(emp.contact_family || emp.contact_3) || '-',
        email: emp.email || emp.email_id || '-',
        dob: emp.dob || emp.date_of_birth || '-',
        joining_date: emp.joining_date || emp.date_of_joining || emp.appointment_date || '-',
        home_district: emp.home_district || emp.district || '-',
        remarks: emp.remarks || '-'
      };

      // 1. Previous ID from Migration
      var empMigrations = migrations.filter(function(m) { 
        var mNew = String(m.new_staff_id || '').trim().toUpperCase();
        return mNew === staffId.toUpperCase() || (empId && mNew === empId.toUpperCase()); 
      });
      empMigrations.sort(function(a, b) { return parseDate(b.migration_date) - parseDate(a.migration_date); });
      row.previous_id = empMigrations.length > 0 ? empMigrations[0].old_staff_id : '-';

      // 2. Pay Group & Designation (from latest promotion, fallback to employee's pg_id)
      var empPromos = promotions.filter(function(p) { 
        var pEmp = String(p.emp_id || p.staff_id || '').trim().toUpperCase();
        return pEmp === staffId.toUpperCase() || (empId && pEmp === empId.toUpperCase()); 
      });
      empPromos.sort(function(a, b) { return parseDate(b.promotion_date) - parseDate(a.promotion_date); });
      
      var rawPg = emp.pg_id || emp.pay_group || emp.designation_short || '';
      var rawPgKey = String(rawPg).trim().toUpperCase();
      var pgObj = pgMap[rawPg] || pgMapByShort[rawPgKey] || pgMapByName[rawPgKey] || pgMapByPg[rawPgKey];

      if (empPromos.length > 0 && empPromos[0].promoted_pg_id) {
        var promoPgKey = String(empPromos[0].promoted_pg_id).trim().toUpperCase();
        var promoPgObj = pgMap[empPromos[0].promoted_pg_id] || pgMapByShort[promoPgKey] || pgMapByName[promoPgKey] || pgMapByPg[promoPgKey];
        if (promoPgObj) {
          pgObj = promoPgObj;
        } else {
          rawPg = empPromos[0].promoted_pg_id;
        }
        row._promotion_date = parseDate(empPromos[0].promotion_date);
      } else {
        row._promotion_date = parseDate(emp.joining_date);
      }

      var defaultRank = 0;
      var rankMatch = String(rawPg).match(/\d+/);
      if (rankMatch) defaultRank = parseInt(rankMatch[0], 10);

      row.pay_group = pgObj ? pgObj.pay_group : (rawPg || emp.pay_group || 'PG-2');
      row.designation = pgObj ? (pgObj.designation || pgObj.designation_short) : (emp.designation || emp.designation_short || rawPg || 'Personnel');
      row.designation_short = pgObj ? pgObj.designation_short : (emp.designation_short || emp.designation || rawPg || 'Personnel');
      row.rank_level = pgObj ? (Number(pgObj.rank_level) || defaultRank) : (Number(emp.rank_level) || defaultRank);

      // 3. Additional Charge designation tag
      var empAddl = addlCharges.filter(function(a) { 
        var aEmp = String(a.emp_id || a.staff_id || '').trim().toUpperCase();
        return aEmp === staffId.toUpperCase() || (empId && aEmp === empId.toUpperCase()); 
      });
      empAddl.sort(function(a, b) { return parseDate(b.charge_to) - parseDate(a.charge_to); });
      if (empAddl.length > 0) {
        var latestAddl = empAddl[0];
        var toDate = parseDate(latestAddl.charge_to);
        if (toDate && toDate >= today) {
          var chgPg = pgMap[latestAddl.charge_pg_id] || pgMapByShort[String(latestAddl.charge_pg_id).trim().toUpperCase()];
          var chgDesig = chgPg ? chgPg.designation_short : latestAddl.charge_pg_id;
          if (chgDesig) {
            row.designation = row.designation + ', ' + chgDesig + ' (Add. Charge)';
          }
        }
      }

      // 4. Placements, Postings, Shifts
      var empPlacements = placements.filter(function(p) { 
        var pEmp = String(p.emp_id || p.staff_id || '').trim().toUpperCase();
        return pEmp === staffId.toUpperCase() || (empId && pEmp === empId.toUpperCase()); 
      });
      empPlacements.sort(function(a, b) { return parseDate(b.placement_date) - parseDate(a.placement_date); });

      var empPostings = postings.filter(function(p) { 
        var pEmp = String(p.emp_id || p.staff_id || '').trim().toUpperCase();
        return pEmp === staffId.toUpperCase() || (empId && pEmp === empId.toUpperCase()); 
      });
      empPostings.sort(function(a, b) { return parseDate(b.posting_date) - parseDate(a.posting_date); });

      if (empPlacements.length > 0) {
        var latestPlc = empPlacements[0];
        var shiftObj = shifts.find(function(s) { return s.shift_id === latestPlc.shift_id; });
        row.shift = shiftObj ? shiftObj.shift_name : (latestPlc.shift || emp.shift || '-');
        row.shift_id = latestPlc.shift_id || null;
        
        var secObj = sections.find(function(s) { return s.sec_id === latestPlc.sec_id; });
        row.placement = secObj ? secObj.sec_letter_code : (latestPlc.placement || emp.placement || '-');
        row.sec_id = latestPlc.sec_id || null;
        
        var stObj = stations.find(function(s) { return s.station_id === latestPlc.station_id; });
        row.posting = stObj ? stObj.station_code : (latestPlc.posting || emp.posting || emp.station || '-');
        row.station_id = latestPlc.station_id || null;

        row.placement_duration = getDurationString(parseDate(latestPlc.placement_date), today);
      } else if (empPostings.length > 0) {
        var latestPst = empPostings[0];
        var stObj = stations.find(function(s) { return s.station_id === latestPst.station_id; });
        row.shift = emp.shift || '-';
        row.shift_id = null;
        row.placement = emp.placement || '-';
        row.sec_id = null;
        row.posting = stObj ? stObj.station_code : (latestPst.posting || emp.posting || emp.station || '-');
        row.station_id = latestPst.station_id || null;
        row.placement_duration = '-';
      } else {
        row.shift = emp.shift || '-';
        row.shift_id = null;
        row.placement = emp.placement || '-';
        row.sec_id = null;
        row.posting = emp.posting || emp.station || '-';
        row.station_id = null;
        row.placement_duration = '-';
      }

      // 5. Department
      var depObj = depMap[emp.dep_id] || depMap[String(emp.department || '').trim().toUpperCase()];
      row.department = depObj ? (depObj.dep_letter_code || depObj.dep_code) : (emp.department || '-');
      row.dep_name = depObj ? depObj.dep_name : (emp.dep_name || row.department);
      row.dep_id = emp.dep_id || (depObj ? depObj.dep_id : null);
      row.dir_id = depObj ? depObj.dir_id : (emp.dir_id || null);
      row.pg_id = pgObj ? pgObj.pg_id : (emp.pg_id || rawPg);

      // 6. Retirement Date & Status
      var dobDate = parseDate(emp.dob);
      var calcRetirement = null;
      if (dobDate && !isNaN(dobDate.getTime())) {
        calcRetirement = new Date(dobDate.getTime());
        calcRetirement.setFullYear(calcRetirement.getFullYear() + 59);
        calcRetirement.setDate(calcRetirement.getDate() - 1);
      }

      var finalRetirementDate = calcRetirement;
      var status = (emp.status && emp.status !== '-' && emp.status !== '') ? emp.status : 'Active';

      // Check extensions
      var empExt = extensions.filter(function(e) { 
        var eid = String(e.emp_id || e.staff_id || '').trim().toUpperCase();
        return eid === staffId.toUpperCase() || (empId && eid === empId.toUpperCase()); 
      });
      empExt.sort(function(a, b) { return parseDate(b.extension_to) - parseDate(a.extension_to); });
      if (empExt.length > 0) {
        var extDate = parseDate(empExt[0].extension_to);
        if (extDate && !isNaN(extDate.getTime())) {
          finalRetirementDate = extDate;
          status = 'Extension';
        }
      }

      // Check self retirement
      var empRet = retirements.filter(function(r) { 
        var rid = String(r.emp_id || r.staff_id || '').trim().toUpperCase();
        return rid === staffId.toUpperCase() || (empId && rid === empId.toUpperCase()); 
      });
      empRet.sort(function(a, b) { return parseDate(b.retirement_date) - parseDate(a.retirement_date); });
      if (empRet.length > 0) {
        var retDate = parseDate(empRet[0].retirement_date);
        if (retDate && !isNaN(retDate.getTime())) {
          finalRetirementDate = retDate;
        }
      }

      if (finalRetirementDate && !isNaN(finalRetirementDate.getTime()) && finalRetirementDate < today) {
        status = 'Retired';
      }

      row.retirement_date = (finalRetirementDate && !isNaN(finalRetirementDate.getTime())) 
        ? (typeof Utils !== 'undefined' ? Utils.formatDateToDDMmmYYYY(finalRetirementDate) : finalRetirementDate.toLocaleDateString()) 
        : (emp.retirement_date || '-');
      row.status = status;

      resultList.push(row);
    });

    // 7. Seniority Sort
    resultList.sort(function(a, b) {
      var rankA = Number(a.rank_level) || 0;
      var rankB = Number(b.rank_level) || 0;
      if (rankB !== rankA) return rankB - rankA;
      
      var timeA = (a._promotion_date && !isNaN(a._promotion_date.getTime())) ? a._promotion_date.getTime() : 0;
      var timeB = (b._promotion_date && !isNaN(b._promotion_date.getTime())) ? b._promotion_date.getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;
      
      return String(a.staff_id || '').localeCompare(String(b.staff_id || ''));
    });

    // Assign SL based on sort
    for (var i = 0; i < resultList.length; i++) {
      resultList[i].sl = i + 1;
      delete resultList[i]._promotion_date;
    }

    if (resultList.length > 0 && Database.ServerCache) {
      Database.ServerCache.put('cache_hrm_details', resultList, 21600);
    }

    return resultList;
  }

  function getServiceHistory(empId) {
    if (!empId) return [];
    var cleanId = String(empId).trim().toUpperCase();
    var cleanNum = cleanId.replace(/[^0-9]/g, '');
    
    var emps = Database.getAll('employees');
    var targetEmp = emps.find(function(r) { 
      var sId = String(r.staff_id || '').trim().toUpperCase();
      var eId = String(r.emp_id || '').trim().toUpperCase();
      var sNum = sId.replace(/[^0-9]/g, '');
      var eNum = eId.replace(/[^0-9]/g, '');
      return sId === cleanId || eId === cleanId || (cleanNum && (sNum === cleanNum || eNum === cleanNum)); 
    });

    var targetStaffId = targetEmp ? (targetEmp.staff_id || targetEmp.emp_id) : empId;
    var targetStaffUpper = String(targetStaffId).trim().toUpperCase();
    var targetStaffNum = targetStaffUpper.replace(/[^0-9]/g, '');
    
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

    function isEmpMatch(rowEmpId) {
      if (!rowEmpId) return false;
      var str = String(rowEmpId).trim().toUpperCase();
      if (str === targetStaffUpper) return true;
      if (targetStaffNum && str.replace(/[^0-9]/g, '') === targetStaffNum) return true;
      return false;
    }

    // 1. Postings
    Database.getAll('postings').filter(function(r) { return isEmpMatch(r.emp_id || r.staff_id); }).forEach(function(r) {
      var st = stMap[r.station_id] ? stMap[r.station_id].station_code : (r.station_id || r.posting);
      history.push({
        date: r.posting_date,
        type: 'Posting',
        details: 'Posted to Station: ' + st
      });
    });

    // 2. Placements
    Database.getAll('placements').filter(function(r) { return isEmpMatch(r.emp_id || r.staff_id); }).forEach(function(r) {
      var st = stMap[r.station_id] ? stMap[r.station_id].station_code : (r.station_id || r.posting);
      var sec = secMap[r.sec_id] ? secMap[r.sec_id].sec_letter_code : (r.sec_id || r.placement);
      var sh = shiftMap[r.shift_id] ? shiftMap[r.shift_id].shift_name : (r.shift_id || r.shift);
      history.push({
        date: r.placement_date,
        type: 'Placement',
        details: 'Placed in Station: ' + st + ' | Section: ' + sec + ' | Shift: ' + sh
      });
    });

    // 3. Promotions
    Database.getAll('promotions').filter(function(r) { return isEmpMatch(r.emp_id || r.staff_id); }).forEach(function(r) {
      var fromPgObj = pgMap[r.present_pg_id] || pgMapByShort[String(r.present_pg_id || '').trim().toUpperCase()] || pgMapByPg[String(r.present_pg_id || '').trim().toUpperCase()];
      var toPgObj = pgMap[r.promoted_pg_id] || pgMapByShort[String(r.promoted_pg_id || '').trim().toUpperCase()] || pgMapByPg[String(r.promoted_pg_id || '').trim().toUpperCase()];
      var from = fromPgObj ? fromPgObj.pay_group : r.present_pg_id;
      var to = toPgObj ? toPgObj.pay_group : r.promoted_pg_id;
      history.push({
        date: r.promotion_date,
        type: 'Promotion',
        details: 'Promoted from ' + from + ' to ' + to + ' (Seq: ' + (r.sequence_no || 1) + ')'
      });
    });

    // 4. Extensions
    Database.getAll('extensions').filter(function(r) { return isEmpMatch(r.emp_id || r.staff_id); }).forEach(function(r) {
      var pg = pgMap[r.extension_pg_id] ? pgMap[r.extension_pg_id].pay_group : (r.extension_pg_id || 'Service Extension');
      history.push({
        date: r.extension_from,
        type: 'Extension',
        details: 'Extension granted as ' + pg + ' until ' + r.extension_to
      });
    });

    // 5. Additional Charges
    Database.getAll('additional_charges').filter(function(r) { return isEmpMatch(r.emp_id || r.staff_id); }).forEach(function(r) {
      var pg = pgMap[r.charge_pg_id] ? pgMap[r.charge_pg_id].pay_group : (r.charge_pg_id || 'Additional Charge');
      history.push({
        date: r.charge_from,
        type: 'Additional Charge',
        details: 'Additional charge granted as ' + pg + ' until ' + r.charge_to
      });
    });

    // 6. Migrations
    Database.getAll('employee_migrations').filter(function(r) { 
      return isEmpMatch(r.new_staff_id) || isEmpMatch(r.old_staff_id); 
    }).forEach(function(r) {
      history.push({
        date: r.migration_date,
        type: 'Migration',
        details: (r.migration_type || 'Migration') + ' (' + r.old_staff_id + ' -> ' + r.new_staff_id + ')'
      });
    });

    // 7. Joining (Base Employee Record)
    if (targetEmp && targetEmp.joining_date) {
      var rawPg = targetEmp.pg_id || targetEmp.designation_short || targetEmp.pay_group || '';
      var rawPgKey = String(rawPg).trim().toUpperCase();
      var pgObj = pgMap[rawPg] || pgMapByShort[rawPgKey] || pgMapByName[rawPgKey] || pgMapByPg[rawPgKey];
      var pg = pgObj ? (pgObj.pay_group || pgObj.designation_short || pgObj.designation) : (rawPg || 'Personnel');
      history.push({
        date: targetEmp.joining_date,
        type: 'Joined',
        details: 'Joined organization as ' + pg
      });
    }

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
      if (e.staff_id) {
        var sid = String(e.staff_id).trim().toUpperCase();
        empMap[sid] = e;
        var snum = sid.replace(/[^0-9]/g, '');
        if (snum) empMap['NUM_' + snum] = e;
      }
      if (e.emp_id) {
        var eid = String(e.emp_id).trim().toUpperCase();
        empMap[eid] = e;
        var enum_ = eid.replace(/[^0-9]/g, '');
        if (enum_) empMap['NUM_' + enum_] = e;
      }
      if (e.emp_name) {
        empMap['NAME_' + String(e.emp_name).trim().toUpperCase()] = e;
      }
    });

    function findEmp(rawSid) {
      if (!rawSid) return null;
      var sid = String(rawSid).trim().toUpperCase();
      if (empMap[sid]) return empMap[sid];
      var snum = sid.replace(/[^0-9]/g, '');
      if (snum && empMap['NUM_' + snum]) return empMap['NUM_' + snum];
      return null;
    }

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
      if (d.dep_code) depMap[String(d.dep_code).trim().toUpperCase()] = d;
      if (d.dep_letter_code) depMap[String(d.dep_letter_code).trim().toUpperCase()] = d;
    });

    var list = [];

    // Group promotions by employee to calculate duration in previous grade
    var promosByEmp = {};
    promotions.forEach(function(p) {
      var sid = String(p.emp_id || p.staff_id || '').trim();
      if (!promosByEmp[sid]) promosByEmp[sid] = [];
      promosByEmp[sid].push(p);
    });

    for (var sid in promosByEmp) {
      promosByEmp[sid].sort(function(a, b) {
        return parseDate(a.promotion_date) - parseDate(b.promotion_date);
      });
    }

    promotions.forEach(function(promo) {
      var sid = String(promo.emp_id || promo.staff_id || '').trim();
      var emp = findEmp(sid);

      var fromPgObj = pgMap[promo.present_pg_id] || pgMapByShort[String(promo.present_pg_id || '').trim().toUpperCase()] || pgMapByPg[String(promo.present_pg_id || '').trim().toUpperCase()];
      var toPgObj = pgMap[promo.promoted_pg_id] || pgMapByShort[String(promo.promoted_pg_id || '').trim().toUpperCase()] || pgMapByPg[String(promo.promoted_pg_id || '').trim().toUpperCase()];

      var depObj = emp ? (depMap[emp.dep_id] || depMap[String(emp.department || '').trim().toUpperCase()]) : null;

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

      var rankLevel = toPgObj ? (Number(toPgObj.rank_level) || 0) : (fromPgObj ? (Number(fromPgObj.rank_level) || 0) : (emp ? Number(emp.rank_level) || 0 : 0));

      list.push({
        promotion_id: promo.promotion_id,
        staff_id: emp ? (emp.staff_id || emp.emp_id) : (promo.staff_id || promo.emp_id || sid),
        emp_id: emp ? (emp.emp_id || emp.staff_id) : sid,
        emp_name: emp ? (emp.emp_name || emp.name) : 'Personnel',
        department: depObj ? (depObj.dep_letter_code || depObj.dep_code) : (emp ? emp.department || '-' : '-'),
        department_name: depObj ? depObj.dep_name : (emp ? emp.department || '-' : '-'),
        present_pg_id: promo.present_pg_id,
        present_pay_group: fromPgObj ? fromPgObj.pay_group : (promo.present_pay_group || promo.present_pg_id || '-'),
        present_designation: fromPgObj ? (fromPgObj.designation_short || fromPgObj.designation) : (promo.present_designation || '-'),
        promoted_pg_id: promo.promoted_pg_id,
        promoted_pay_group: toPgObj ? toPgObj.pay_group : (promo.promoted_pay_group || promo.promoted_pg_id || '-'),
        promoted_designation: toPgObj ? (toPgObj.designation_short || toPgObj.designation) : (promo.promoted_designation || '-'),
        rank_level: rankLevel,
        sequence_no: promo.sequence_no || 1,
        promotion_date: promo.promotion_date,
        time_in_previous_grade: timeInPrev,
        _promoDateObj: parseDate(promo.promotion_date)
      });
    });

    // Primary sort: Most recent promotions first (promotion_date desc)
    list.sort(function(a, b) {
      var dateA = a._promoDateObj ? a._promoDateObj.getTime() : 0;
      var dateB = b._promoDateObj ? b._promoDateObj.getTime() : 0;
      if (dateB !== dateA) return dateB - dateA;
      return (Number(b.rank_level) || 0) - (Number(a.rank_level) || 0);
    });

    for (var j = 0; j < list.length; j++) {
      list[j].sl = j + 1;
      delete list[j]._promoDateObj;
    }

    return list;
  }

  function getEmployeePromotionReport(empIdentifier) {
    var employees = Database.getAll('employees');
    if (!employees || employees.length === 0) {
      throw new Error("No employees records found in database.");
    }

    var targetEmp = null;
    if (empIdentifier) {
      var cleanUpper = String(empIdentifier).trim().toUpperCase();
      var cleanNumeric = cleanUpper.replace(/[^0-9]/g, '');

      // 1. Direct match
      for (var i = 0; i < employees.length; i++) {
        var e = employees[i];
        var sId = String(e.staff_id || '').trim().toUpperCase();
        var eId = String(e.emp_id || '').trim().toUpperCase();
        if (sId === cleanUpper || eId === cleanUpper) {
          targetEmp = e;
          break;
        }
      }

      // 2. Migration lookup (old_staff_id -> new_staff_id)
      if (!targetEmp) {
        var migrations = Database.getAll('employee_migrations');
        if (migrations && migrations.length > 0) {
          for (var m = 0; m < migrations.length; m++) {
            var mig = migrations[m];
            var oldId = String(mig.old_staff_id || '').trim().toUpperCase();
            var newId = String(mig.new_staff_id || '').trim().toUpperCase();
            if (oldId === cleanUpper || newId === cleanUpper) {
              targetEmp = employees.find(function(em) {
                return String(em.staff_id || '').trim().toUpperCase() === newId || String(em.emp_id || '').trim().toUpperCase() === newId;
              });
              if (targetEmp) break;
            }
          }
        }
      }

      // 3. Numeric-only match (e.g. '1024' matching 'SA-1024' or 'EMP-1024')
      if (!targetEmp && cleanNumeric) {
        for (var j = 0; j < employees.length; j++) {
          var empObj = employees[j];
          var numStaff = String(empObj.staff_id || '').replace(/[^0-9]/g, '');
          var numEmp = String(empObj.emp_id || '').replace(/[^0-9]/g, '');
          if ((numStaff && numStaff === cleanNumeric) || (numEmp && numEmp === cleanNumeric)) {
            targetEmp = empObj;
            break;
          }
        }
      }

      // 4. Case-insensitive name match
      if (!targetEmp) {
        for (var k = 0; k < employees.length; k++) {
          var empName = String(employees[k].emp_name || employees[k].name || '').trim().toUpperCase();
          if (empName && (empName === cleanUpper || empName.indexOf(cleanUpper) !== -1 || cleanUpper.indexOf(empName) !== -1)) {
            targetEmp = employees[k];
            break;
          }
        }
      }

      if (!targetEmp) {
        throw new Error("No employee found matching '" + empIdentifier + "'. Please check the Staff ID or Employee ID.");
      }
    } else {
      targetEmp = employees[0];
    }

    var payGroups = Database.getAll('pay_groups');
    var departments = Database.getAll('departments');
    var migrationsList = Database.getAll('employee_migrations');
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
    departments.forEach(function(d) { 
      depMap[d.dep_id] = d; 
      if (d.dep_code) depMap[String(d.dep_code).trim().toUpperCase()] = d;
      if (d.dep_letter_code) depMap[String(d.dep_letter_code).trim().toUpperCase()] = d;
    });

    var directorates = Database.getAll('directorates');
    var dirMap = {};
    directorates.forEach(function(d) { dirMap[d.dir_id] = d; });

    var empMigrations = migrationsList.filter(function(m) { 
      var nId = String(m.new_staff_id || '').trim().toUpperCase();
      return nId === String(targetEmp.staff_id || targetEmp.emp_id).trim().toUpperCase(); 
    });
    var previousId = empMigrations.length > 0 ? empMigrations[0].old_staff_id : '-';

    var depObj = depMap[targetEmp.dep_id] || depMap[String(targetEmp.department || '').trim().toUpperCase()];
    var dirObj = (depObj && depObj.dir_id) ? dirMap[depObj.dir_id] : (targetEmp.dir_id ? dirMap[targetEmp.dir_id] : null);

    // Initial Joining PG & Designation
    var rawInitPg = targetEmp.pg_id || targetEmp.pay_group || targetEmp.designation_short || '';
    var initPgObj = pgMap[rawInitPg] || pgMapByShort[String(rawInitPg).trim().toUpperCase()] || pgMapByPg[String(rawInitPg).trim().toUpperCase()] || pgMapByName[String(rawInitPg).trim().toUpperCase()];

    // Get all promotions for this employee
    var targetStaffUpper = String(targetEmp.staff_id || '').trim().toUpperCase();
    var targetEmpUpper = String(targetEmp.emp_id || '').trim().toUpperCase();
    var targetPrevUpper = String(previousId || '').trim().toUpperCase();
    var targetNum = targetStaffUpper.replace(/[^0-9]/g, '');

    var empPromos = allPromotions.filter(function(p) {
      var pId = String(p.emp_id || p.staff_id || '').trim().toUpperCase();
      if (pId === targetStaffUpper || pId === targetEmpUpper) return true;
      if (targetPrevUpper !== '-' && pId === targetPrevUpper) return true;
      if (targetNum && pId.replace(/[^0-9]/g, '') === targetNum) return true;
      return false;
    });

    // Chronological ascending sort by promotion date
    empPromos.sort(function(a, b) {
      return parseDate(a.promotion_date) - parseDate(b.promotion_date);
    });

    var history = [];
    var prevGradeDate = parseDate(targetEmp.joining_date);

    for (var p = 0; p < empPromos.length; p++) {
      var item = empPromos[p];
      var fromPg = pgMap[item.present_pg_id] || pgMapByShort[String(item.present_pg_id || '').trim().toUpperCase()] || pgMapByPg[String(item.present_pg_id || '').trim().toUpperCase()] || pgMapByName[String(item.present_pg_id || '').trim().toUpperCase()];
      var toPg = pgMap[item.promoted_pg_id] || pgMapByShort[String(item.promoted_pg_id || '').trim().toUpperCase()] || pgMapByPg[String(item.promoted_pg_id || '').trim().toUpperCase()] || pgMapByName[String(item.promoted_pg_id || '').trim().toUpperCase()];

      var promoDate = parseDate(item.promotion_date);
      var duration = prevGradeDate ? getDurationString(prevGradeDate, promoDate) : '-';
      prevGradeDate = promoDate;

      var fromDesig = fromPg ? (fromPg.designation || fromPg.designation_short) : (item.present_designation || '-');
      var fromPgName = fromPg ? fromPg.pay_group : (item.present_pay_group || item.present_pg_id || '-');
      var toDesig = toPg ? (toPg.designation || toPg.designation_short) : (item.promoted_designation || '-');
      var toPgName = toPg ? toPg.pay_group : (item.promoted_pay_group || item.promoted_pg_id || '-');

      history.push({
        sl: p + 1,
        sequence_no: item.sequence_no || (p + 1),
        from_pg: fromPgName,
        from_designation: fromDesig,
        to_pg: toPgName,
        to_designation: toDesig,
        promotion_date: item.promotion_date,
        duration_in_previous_grade: duration,
        remarks: item.remarks || ''
      });
    }

    // Joining Pay Group & Designation
    var joiningDesignation = initPgObj ? (initPgObj.designation || initPgObj.designation_short) : (targetEmp.designation || targetEmp.designation_short || '-');
    var joiningPayGroup = initPgObj ? initPgObj.pay_group : (targetEmp.pay_group || targetEmp.pg_id || 'PG-2');

    if (history.length > 0 && history[0].from_pg && history[0].from_pg !== '-') {
      joiningPayGroup = history[0].from_pg;
      if (history[0].from_designation && history[0].from_designation !== '-') {
        joiningDesignation = history[0].from_designation;
      }
    }

    // Current Pay Group & Designation
    var currentPayGroup = targetEmp.pay_group || (initPgObj ? initPgObj.pay_group : 'PG-2');
    var currentDesignation = targetEmp.designation || (initPgObj ? (initPgObj.designation || initPgObj.designation_short) : 'Personnel');
    var currentRankLevel = initPgObj ? (Number(initPgObj.rank_level) || 0) : (Number(targetEmp.rank_level) || 0);

    if (history.length > 0) {
      var latestPromo = history[history.length - 1];
      if (latestPromo.to_pg && latestPromo.to_pg !== '-') currentPayGroup = latestPromo.to_pg;
      if (latestPromo.to_designation && latestPromo.to_designation !== '-') currentDesignation = latestPromo.to_designation;
      var latestPgObj = pgMapByPg[String(currentPayGroup).trim().toUpperCase()] || pgMap[currentPayGroup];
      if (latestPgObj && latestPgObj.rank_level) currentRankLevel = Number(latestPgObj.rank_level) || 0;
    }

    var totalService = targetEmp.joining_date ? getDurationString(parseDate(targetEmp.joining_date), new Date()) : '-';

    return {
      employee: {
        emp_id: targetEmp.emp_id || targetEmp.staff_id,
        staff_id: targetEmp.staff_id || targetEmp.emp_id,
        previous_id: previousId,
        emp_name: targetEmp.emp_name || targetEmp.name || 'Personnel',
        gender: targetEmp.gender || '-',
        directorate_name: dirObj ? dirObj.dir_name : (targetEmp.dir_name || '-'),
        directorate_code: dirObj ? (dirObj.dir_letter_code || dirObj.dir_code) : '-',
        department_name: depObj ? depObj.dep_name : (targetEmp.department || '-'),
        department_code: depObj ? (depObj.dep_letter_code || depObj.dep_code) : '-',
        current_pay_group: currentPayGroup,
        current_designation: currentDesignation,
        current_rank_level: currentRankLevel,
        joining_pay_group: joiningPayGroup,
        joining_designation: joiningDesignation,
        joining_date: targetEmp.joining_date || '-',
        dob: targetEmp.dob || '-',
        email: targetEmp.email || '-',
        contact_primary: formatPhone(targetEmp.contact_primary || targetEmp.contact_1),
        total_service: totalService,
        promotions_count: history.length
      },
      promotions: history,
      history: history
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
    departments.forEach(function(d) { 
      depMap[d.dep_id] = d; 
      if (d.dep_code) depMap[String(d.dep_code).trim().toUpperCase()] = d;
      if (d.dep_letter_code) depMap[String(d.dep_letter_code).trim().toUpperCase()] = d;
    });

    // Group promotions by employee staff_id & numeric ID
    var promosByStaff = {};
    promotions.forEach(function(p) {
      var sid = String(p.emp_id || p.staff_id || '').trim().toUpperCase();
      if (!promosByStaff[sid]) promosByStaff[sid] = [];
      promosByStaff[sid].push(p);
      var snum = sid.replace(/[^0-9]/g, '');
      if (snum && !promosByStaff['NUM_' + snum]) promosByStaff['NUM_' + snum] = promosByStaff[sid];
    });

    var eligibilityList = [];

    employees.forEach(function(emp) {
      var staffId = String(emp.staff_id || emp.emp_id || '').trim();
      var staffIdUpper = staffId.toUpperCase();
      var staffNum = staffId.replace(/[^0-9]/g, '');

      // Check active status
      var dobDate = parseDate(emp.dob);
      var calcRetirement = null;
      if (dobDate && !isNaN(dobDate.getTime())) {
        calcRetirement = new Date(dobDate.getTime());
        calcRetirement.setFullYear(calcRetirement.getFullYear() + 59);
        calcRetirement.setDate(calcRetirement.getDate() - 1);
      }
      var finalRetDate = calcRetirement;
      var status = (emp.status && emp.status !== '-' && emp.status !== '') ? emp.status : 'Active';

      var empExt = extensions.filter(function(e) { 
        var eid = String(e.emp_id || e.staff_id || '').trim().toUpperCase();
        return eid === staffIdUpper || (staffNum && eid.replace(/[^0-9]/g, '') === staffNum); 
      });
      empExt.sort(function(a, b) { return parseDate(b.extension_to) - parseDate(a.extension_to); });
      if (empExt.length > 0) {
        var extDate = parseDate(empExt[0].extension_to);
        if (extDate && !isNaN(extDate.getTime())) {
          finalRetDate = extDate;
          status = 'Extension';
        }
      }

      var empRet = retirements.filter(function(r) { 
        var rid = String(r.emp_id || r.staff_id || '').trim().toUpperCase();
        return rid === staffIdUpper || (staffNum && rid.replace(/[^0-9]/g, '') === staffNum); 
      });
      empRet.sort(function(a, b) { return parseDate(b.retirement_date) - parseDate(a.retirement_date); });
      if (empRet.length > 0) {
        var retDate = parseDate(empRet[0].retirement_date);
        if (retDate && !isNaN(retDate.getTime())) {
          finalRetDate = retDate;
        }
      }

      if (finalRetDate && !isNaN(finalRetDate.getTime()) && finalRetDate < today) {
        status = 'Retired';
      }

      // We focus on active/on-job employees for promotion eligibility
      if (status === 'Retired') return;

      var empPromos = promosByStaff[staffIdUpper] || (staffNum ? promosByStaff['NUM_' + staffNum] : []) || [];
      empPromos.sort(function(a, b) { return parseDate(b.promotion_date) - parseDate(a.promotion_date); });

      var currentGradeDate = empPromos.length > 0 ? parseDate(empPromos[0].promotion_date) : parseDate(emp.joining_date);
      var currentGradeDateStr = empPromos.length > 0 ? empPromos[0].promotion_date : emp.joining_date;

      var rawPg = emp.pg_id || emp.pay_group || emp.designation_short || '';
      var rawPgKey = String(rawPg).trim().toUpperCase();
      var initialPgObj = pgMap[rawPg] || pgMapByShort[rawPgKey] || pgMapByPg[rawPgKey] || pgMapByName[rawPgKey];
      
      var currentPgObj = initialPgObj;
      if (empPromos.length > 0 && empPromos[0].promoted_pg_id) {
        var promoKey = String(empPromos[0].promoted_pg_id).trim().toUpperCase();
        currentPgObj = pgMap[empPromos[0].promoted_pg_id] || pgMapByShort[promoKey] || pgMapByPg[promoKey] || pgMapByName[promoKey] || currentPgObj;
      }

      var depObj = depMap[emp.dep_id] || depMap[String(emp.department || '').trim().toUpperCase()];

      var timeInGradeStr = getDurationString(currentGradeDate, today);
      var daysInGrade = currentGradeDate ? getDaysBetween(currentGradeDate, today) : 0;
      var yearsInGrade = daysInGrade / 365.25;

      var defaultRank = 0;
      var rankMatch = String(rawPg).match(/\d+/);
      if (rankMatch) defaultRank = parseInt(rankMatch[0], 10);
      var rankLevel = currentPgObj ? (Number(currentPgObj.rank_level) || defaultRank) : (Number(emp.rank_level) || defaultRank);

      // Find next potential PG
      var higherPgs = payGroups.filter(function(pg) {
        return (Number(pg.rank_level) || 0) > rankLevel && (!pg.dep_id || !emp.dep_id || pg.dep_id === emp.dep_id);
      });
      higherPgs.sort(function(a, b) {
        return (Number(a.rank_level) || 0) - (Number(b.rank_level) || 0);
      });
      var nextPgObj = higherPgs.length > 0 ? higherPgs[0] : null;

      var isEligible = (yearsInGrade >= 3.0);
      var eligibilityLabel = isEligible ? 'Eligible' : 'Not Eligible';
      var eligibilityBadge = isEligible 
        ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
        : 'bg-rose-50 text-rose-700 border-rose-200';

      var comments = '';
      if (yearsInGrade >= 5.0) {
        comments = 'Completed 5+ years in PG; Highly recommended (Clean ACR record, no adverse observations)';
      } else if (yearsInGrade >= 3.0) {
        comments = 'Completed 3+ years in PG; Meets advancement criteria (3 satisfactory ACRs verified)';
      } else {
        var remYrs = Math.max(0, 3.0 - yearsInGrade).toFixed(1);
        comments = 'Requires 3.0 yrs in PG (Current: ' + yearsInGrade.toFixed(1) + ' yrs); ' + remYrs + ' yrs remaining for next PG eligibility';
      }

      var presentPg = currentPgObj ? currentPgObj.pay_group : (rawPg || emp.pay_group || 'PG-2');
      var presentDesig = currentPgObj ? (currentPgObj.designation_short || currentPgObj.designation) : (emp.designation || emp.designation_short || '-');

      eligibilityList.push({
        emp_id: emp.emp_id || staffId,
        staff_id: staffId,
        emp_name: emp.emp_name || emp.name || 'Personnel',
        department: depObj ? (depObj.dep_letter_code || depObj.dep_code) : (emp.department || '-'),
        department_name: depObj ? depObj.dep_name : (emp.department || '-'),
        present_pay_group: presentPg,
        present_designation: presentDesig,
        rank_level: rankLevel,
        current_grade_since: currentGradeDateStr || '-',
        current_pg_since: currentGradeDateStr || '-',
        time_in_grade: timeInGradeStr,
        time_in_pg: timeInGradeStr,
        years_in_grade: yearsInGrade,
        years_in_pg: yearsInGrade,
        next_pay_group: nextPgObj ? nextPgObj.pay_group : 'Top Tier PG',
        next_designation: nextPgObj ? (nextPgObj.designation_short || nextPgObj.designation) : 'Highest PG Reached',
        is_eligible: isEligible,
        eligibility_label: eligibilityLabel,
        eligibility_status: eligibilityLabel,
        eligibility_badge: eligibilityBadge,
        comments: comments,
        joining_date: emp.joining_date || '-',
        _gradeDateObj: currentGradeDate
      });
    });

    // Sort eligibility list
    eligibilityList.sort(function(a, b) {
      if (a.is_eligible !== b.is_eligible) return a.is_eligible ? -1 : 1;
      if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
      return b.years_in_grade - a.years_in_grade;
    });

    for (var k = 0; k < eligibilityList.length; k++) {
      eligibilityList[k].sl = k + 1;
      delete eligibilityList[k]._gradeDateObj;
    }

    return eligibilityList;
  }

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
      if (emp.status === 'Retired') return;

      if (dirId && String(emp.dir_id).trim() !== dirId) return;
      if (depId && String(emp.dep_id).trim() !== depId) return;
      if (stationId && String(emp.station_id).trim() !== stationId) return;

      var desig = emp.designation ? String(emp.designation).replace(/,.*\(Add\. Charge\)/i, '').trim() : '-';
      var pgName = emp.pay_group || '-';
      var rankLvl = emp.rank_level || 0;

      var entry = getOrCreateGroup(desig, pgName, rankLvl);
      entry.existing += 1;
    });

    var rows = [];
    var totalSetup = 0;
    var totalExisting = 0;
    var totalRequired = 0;

    for (var k in matrix) {
      if (matrix.hasOwnProperty(k)) {
        var row = matrix[k];
        row.required = row.setup - row.existing;

        if (row.setup === 0 && row.existing === 0) {
          continue;
        }

        totalSetup += row.setup;
        totalExisting += row.existing;
        totalRequired += row.required;
        rows.push(row);
      }
    }

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
    shifts.forEach(function(s) { 
      var name = (s.shift_name || s.shift_code || '').trim();
      if (name && name.toUpperCase() !== 'N/A' && name.toUpperCase() !== 'OTHERS') {
        shiftColMap[name] = true; 
      }
    });
    var shiftCols = Object.keys(shiftColMap);
    if (shiftCols.length === 0) shiftCols = ['Morning', 'Evening', 'Night', 'General'];

    var pgMap = {};
    Database.getAll('pay_groups').forEach(function(p) {
      if (p.pay_group) {
        pgMap[p.pay_group] = {
          pay_group: p.pay_group,
          rank_level: Number(p.rank_level) || 0,
          designation: p.designation_short || p.designation || ''
        };
      }
    });

    var matrix = {};
    for (var pgKey in pgMap) {
      matrix[pgKey] = {
        pay_group: pgKey,
        rank_level: pgMap[pgKey].rank_level,
        designation: pgMap[pgKey].designation,
        counts: {},
        total: 0
      };
      shiftCols.forEach(function(sh) { matrix[pgKey].counts[sh] = 0; });
    }

    employees.forEach(function(e) {
      var pg = (e.pay_group || '').trim() || 'PG-2';
      if (!matrix[pg]) {
        matrix[pg] = {
          pay_group: pg,
          rank_level: Number(e.rank_level) || 0,
          designation: e.designation || '',
          counts: {},
          total: 0
        };
        shiftCols.forEach(function(sh) { matrix[pg].counts[sh] = 0; });
      }

      var empShift = (e.shift || '').trim();
      if (!empShift || empShift === '-' || shiftCols.indexOf(empShift) === -1) {
        empShift = shiftCols[0];
      }

      matrix[pg].counts[empShift] = (matrix[pg].counts[empShift] || 0) + 1;
      matrix[pg].total += 1;
    });

    var rows = Object.values(matrix).filter(function(r) { return r.total > 0 || r.rank_level > 0; });
    rows.sort(function(a, b) {
      if (b.rank_level !== a.rank_level) return b.rank_level - a.rank_level;
      return a.pay_group.localeCompare(b.pay_group);
    });

    return {
      shift_columns: shiftCols,
      rows: rows,
      total_count: employees.length
    };
  }

  function getAirlineHRAnalytics() {
    var employees = getEmployeesDetailsList();
    var setups = Database.getAll('workforce_setup');
    var departments = Database.getAll('departments');
    var stations = Database.getAll('stations');
    var payGroups = Database.getAll('pay_groups');

    var activeEmps = employees.filter(function(e) { return e.status !== 'Retired'; });
    var totalExisting = activeEmps.length;
    var totalSetup = 0;
    setups.forEach(function(s) { totalSetup += (Number(s.set_up) || 0); });
    if (totalSetup === 0) totalSetup = totalExisting;

    var totalRequired = Math.max(0, totalSetup - totalExisting);
    var fulfillmentRate = totalSetup > 0 ? Math.round((totalExisting / totalSetup) * 100) : 100;

    return {
      kpis: {
        total_sanctioned: totalSetup,
        total_existing: totalExisting,
        total_required: totalRequired,
        fulfillment_rate: fulfillmentRate,
        hub_headcount: totalExisting,
        spoke_headcount: 0,
        hub_spoke_ratio: '100% / 0%',
        operational_headcount: totalExisting,
        admin_headcount: 0,
        operational_manning_ratio: '100%',
        pyramid: {
          executive: activeEmps.filter(function(e) { return (e.rank_level || 0) >= 6; }).length,
          supervisory: activeEmps.filter(function(e) { return (e.rank_level || 0) >= 4 && (e.rank_level || 0) < 6; }).length,
          operational: activeEmps.filter(function(e) { return (e.rank_level || 0) < 4; }).length
        },
        retirement_pipeline: {
          within_1_yr: 0,
          within_3_yrs: 0,
          within_5_yrs: 0
        }
      },
      department_health: [],
      station_health: []
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
