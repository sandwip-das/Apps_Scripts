/**
 * ============================================================================
 * SANDVIORA AVIOSOLUTION - Enterprise Human Resource Management (HRM) Service
 * ============================================================================
 * File: HrmService.gs
 * Architectural Role: Core HR Business Logic, Relational Aggregator & Analytics
 * 
 * Description:
 * Serves as the central business logic controller for the entire human resources
 * domain. Resolves complex relational entity networks (employees, promotions,
 * transfers, acting roles, additional charges, placement durations, and certifications).
 * 
 * Core Subsystems & Engines:
 * 1. Canonical Employee Read Model (`getEmployeesDetailsList`):
 *    Single unified aggregator powering all 7 employee spreadsheet sub-views
 *    (All Employees, Precise List, On Job, Retired, Officer & Sup, TH, Pay Group).
 * 2. Dynamic Seniority Hierarchy Engine (`sortEmployeesBySeniority`):
 *    Applies strict aviation seniority precedence (Date > Sequence No > Staff ID).
 * 3. Promotion Reference Normalization & Batch Grouping (`getPromotionBatches`):
 *    Groups individual promotions under official ministry/board circular orders.
 * 4. Bulk Promotion Parser (`savePromotion`):
 *    Parses comma-separated Staff IDs and automatically generates sequence ranks.
 * 5. Employment Lifecycle & Statutory Retirement (`saveEmployee`):
 *    Computes DOB + 59 years - 1 day, automatically managing retirement milestones.
 * 6. Dynamic Career Service History (`getServiceHistory`):
 *    Chronological event timeline with computed end-dates and longest-service analytics.
 * 7. Promotion Progression & Letter Generator (`getEmployeePromotionReport`):
 *    Generates career progression reports for promotion board review.
 * 8. 3-Year Promotion Eligibility Engine (`getPromotionEligibilityList`):
 *    Evaluates active personnel against tenure (3 years in grade), ACRs, and conduct.
 * 9. Workforce Sanction vs Actual Deficit Engine (`getWorkforceSetupReport`):
 *    Calculates sanctioned workforce headcount against actual active staffing.
 * 10. Geographical Workforce Distribution Matrix (`getWorkforceDistribution`):
 *    Station-to-section deployment headcount aggregator.
 * 11. Airline HR Statistical Analytics (`getAirlineHRAnalytics`):
 *    Generates gender diversity, turnover rate, and executive ratios.
 * 12. Monthly Attendance & Overtime Allowance Engine (`calculateAllowance`).
 * ============================================================================
 */

var HrmService = (function() {

  /**
   * Helper to sanitize and normalize phone numbers for table display.
   * @private
   * @param {*} val - Raw phone input.
   * @returns {string} Sanitized string or '-'.
   */
  function formatPhone(val) {
    if (!val || val === '-' || val === 'null' || val === 'undefined') return '-';
    var str = String(val).replace(/['"]/g, '').trim();
    return str || '-';
  }

  /**
   * Universal Date Formatter Proxy (delegates to Utils.formatDateToDDMmmYYYY).
   * @private
   * @param {*} val - Raw date input.
   * @returns {string} Formatted "DD-MMM-YYYY" string.
   */
  function formatDate(val) {
    return Utils.formatDateToDDMmmYYYY(val);
  }

  /**
   * Canonical Employee Read Model
   * Single unified backend query powering all 7 employee list views.
   * Joins 16 distinct database tables in memory to provide 0ms relational rendering.
   * 
   * @param {boolean} [forceRefresh=false] - Bypasses memory cache if true.
   * @returns {Array<Object>} Fully hydrated employee read model objects.
   */
  function getEmployeesDetailsList(forceRefresh) {
    var employees = Database.getAll('employees', forceRefresh);
    var promotions = Database.getAll('promotions', forceRefresh);
    var placements = Database.getAll('placements', forceRefresh);
    var postings = Database.getAll('postings', forceRefresh);
    var payGroups = Database.getAll('pay_groups', forceRefresh);
    var migrations = Database.getAll('employee_migrations', forceRefresh);
    var extensions = Database.getAll('extensions', forceRefresh);
    var retirements = Database.getAll('self_retirements', forceRefresh);
    var addlCharges = Database.getAll('additional_charges', forceRefresh);
    var actingList = Database.getAll('acting_assignments', forceRefresh);
    var stations = Database.getAll('stations', forceRefresh);
    var workLocations = Database.getAll('work_locations', forceRefresh);
    var shifts = Database.getAll('shifts', forceRefresh);
    var orgUnits = Database.getAll('organization_units', forceRefresh);
    var employeeActions = Database.getAll('employee_actions', forceRefresh);

    var today = new Date();

    // 1. Pay Group Map & Rank Map
    var pgMap = {};
    var pgRankMap = {};
    payGroups.forEach(function(pg) {
      var pgKey = String(pg.pay_group || pg.pg_id || '').trim().toUpperCase();
      pgMap[pgKey] = pg;
      pgRankMap[pgKey] = parseInt(pg.rank_level || 0, 10);
    });

    // 1.1 Directorate Map & 2. Department Map (Synthesized from centralized 3NF organization_units)
    var dirMap = {};
    var depMap = {};
    var unitMap = {};
    if (orgUnits && orgUnits.length > 0) {
      orgUnits.forEach(function(u) {
        var uType = String(u.unit_type || '').toUpperCase();
        var uId = String(u.unit_id || '').trim().toUpperCase();
        var uCode = String(u.unit_code || '').trim().toUpperCase();
        var uName = String(u.unit_name || '').trim().toUpperCase();
        var uLetter = String(u.letter_code || '').trim().toUpperCase();

        if (uId) unitMap[uId] = u;
        if (uCode) unitMap[uCode] = u;

        if (uType === 'DIRECTORATE' || uType === 'HEADQUARTER' || (!u.parent_unit_id && uType !== 'SECTION' && uType !== 'DEPARTMENT')) {
          var dObj = { dir_id: u.unit_id, dir_code: u.unit_code || u.unit_id, dir_name: u.unit_name, dir_letter_code: u.letter_code || '', location_id: u.location_id || '' };
          if (uId) dirMap[uId] = dObj;
          if (uCode) dirMap[uCode] = dObj;
          if (uName) dirMap[uName] = dObj;
          if (uLetter) dirMap[uLetter] = dObj;
        } else if (uType === 'DEPARTMENT' || uType === 'DIVISION') {
          var dpObj = { dep_id: u.unit_id, dep_code: u.unit_code || u.unit_id, dep_name: u.unit_name, dir_id: u.parent_unit_id || '', location_id: u.location_id || '' };
          if (uId) depMap[uId] = dpObj;
          if (uCode) depMap[uCode] = dpObj;
          if (uName) depMap[uName] = dpObj;
        }
      });
    }

    // 2.1 Work Locations Map (Keyed by location_id and location_code)
    var locMap = {};
    workLocations.forEach(function(l) {
      var lId = String(l.location_id || '').trim().toUpperCase();
      var lCode = String(l.location_code || '').trim().toUpperCase();
      if (lId) locMap[lId] = l;
      if (lCode) locMap[lCode] = l;
    });

    // 3. Station Map
    var stnMap = {};
    stations.forEach(function(s) {
      var sCode = String(s.station_code || '').trim().toUpperCase();
      var sId = String(s.station_id || '').trim().toUpperCase();
      if (sCode) stnMap[sCode] = s;
      if (sId) stnMap[sId] = s;
    });

    // 4. Migrations Map (old_staff_id for previous ID)
    var migrationMap = {};
    migrations.forEach(function(m) {
      if (m.new_staff_id) {
        migrationMap[String(m.new_staff_id).trim().toUpperCase()] = m.old_staff_id || '';
      }
    });

    // 5. Extensions Map
    var extensionMap = {};
    extensions.forEach(function(ext) {
      var sid = String(ext.staff_id || '').trim().toUpperCase();
      if (!extensionMap[sid] || new Date(ext.extension_to) > new Date(extensionMap[sid].extension_to)) {
        extensionMap[sid] = ext;
      }
    });

    // 6. Retirements Map (Self-Retirement, Resignation, Left Job)
    var retirementMap = {};
    retirements.forEach(function(ret) {
      var sid = String(ret.staff_id || '').trim().toUpperCase();
      if (!retirementMap[sid] || new Date(ret.retirement_date) > new Date(retirementMap[sid].retirement_date)) {
        retirementMap[sid] = ret;
      }
    });

    // 7. Additional Charges & Acting Assignments (for combined designations)
    var addlChargeMap = {};
    addlCharges.forEach(function(chg) {
      var sid = String(chg.staff_id || '').trim().toUpperCase();
      var toDate = Utils.parseDate(chg.charge_to);
      // Active if no to_date, default_continue is true, or toDate >= today
      var isActive = !toDate || chg.default_continue === true || chg.default_continue === 'true' || toDate >= today;
      if (isActive) {
        if (!addlChargeMap[sid]) addlChargeMap[sid] = [];
        var desig = chg.designation || chg.pay_group || 'Add. Charge';
        addlChargeMap[sid].push(desig + ' (Add. Charge)');
      }
    });

    var actingMap = {};
    actingList.forEach(function(act) {
      var sid = String(act.staff_id || '').trim().toUpperCase();
      var toDate = Utils.parseDate(act.acting_to);
      var isActive = !toDate || act.default_continue === true || act.default_continue === 'true' || toDate >= today;
      if (isActive) {
        if (!actingMap[sid]) actingMap[sid] = [];
        var desig = act.designation || act.pay_group || 'Acting';
        actingMap[sid].push(desig + ' (Acting)');
      }
    });

    // 8. Placements Map (latest by placement_date)
    var placementMap = {};
    placements.forEach(function(plc) {
      var sid = String(plc.staff_id || '').trim().toUpperCase();
      var plcDate = Utils.parseDate(plc.placement_date);
      if (!placementMap[sid] || (plcDate && plcDate > Utils.parseDate(placementMap[sid].placement_date))) {
        placementMap[sid] = plc;
      }
    });

    // 9. Postings Map (latest by effective_from or posting_date)
    var postingMap = {};
    postings.forEach(function(pst) {
      var sid = String(pst.staff_id || '').trim().toUpperCase();
      var pstDate = Utils.parseDate(pst.effective_from || pst.posting_date);
      var existingDate = postingMap[sid] ? Utils.parseDate(postingMap[sid].effective_from || postingMap[sid].posting_date) : null;
      if (!postingMap[sid] || (pstDate && existingDate && pstDate > existingDate) || (pstDate && !existingDate)) {
        postingMap[sid] = pst;
      }
    });

    // 10. Promotions Map (latest by promotion_date)
    var promoMap = {};
    promotions.forEach(function(prm) {
      var sid = String(prm.staff_id || '').trim().toUpperCase();
      var prmDate = Utils.parseDate(prm.promotion_date);
      if (!promoMap[sid] || (prmDate && prmDate > Utils.parseDate(promoMap[sid].promotion_date))) {
        promoMap[sid] = prm;
      }
    });

    // 10.1 Employee Actions Map (latest by effective_date)
    var actionMap = {};
    if (employeeActions && employeeActions.length > 0) {
      employeeActions.forEach(function(act) {
        var sid = String(act.staff_id || '').trim().toUpperCase();
        var actDate = Utils.parseDate(act.effective_date);
        var existingDate = actionMap[sid] ? Utils.parseDate(actionMap[sid].effective_date) : null;
        if (!actionMap[sid] || (actDate && existingDate && actDate > existingDate) || (actDate && !existingDate)) {
          actionMap[sid] = act;
        }
      });
    }

    // 11. Process all employees
    var processedList = [];

    employees.forEach(function(emp) {
      var sid = String(emp.staff_id || '').trim().toUpperCase();
      if (!sid) return;

      var latestPromo = promoMap[sid];
      var latestAction = actionMap[sid];
      var latestPlacement = placementMap[sid];
      var latestPosting = postingMap[sid];
      var extension = extensionMap[sid];
      var retirementEvent = retirementMap[sid];

      // Pay Group & Designation resolution: Reconcile between Promotion and Administrative Action
      var currentPg = '';
      var latestPromoDate = null;
      var seqNo = '';

      var promoDateObj = latestPromo ? Utils.parseDate(latestPromo.promotion_date) : null;
      var actDateObj = (latestAction && latestAction.effective_date) ? Utils.parseDate(latestAction.effective_date) : null;

      if (latestAction && latestAction.to_pay_group_id && (!promoDateObj || (actDateObj && actDateObj >= promoDateObj))) {
        currentPg = latestAction.to_pay_group_id;
        latestPromoDate = latestAction.effective_date;
        if (latestPromo) {
          seqNo = latestPromo.sequence_no || '';
        }
      } else if (latestPromo) {
        currentPg = latestPromo.promoted_pg_id || latestPromo.present_pg_id || emp.pay_group || '';
        latestPromoDate = latestPromo.promotion_date;
        seqNo = latestPromo.sequence_no || '';
      } else {
        currentPg = emp.pay_group || '';
      }

      var pgObj = pgMap[String(currentPg).trim().toUpperCase()] || {};
      var baseDesignation = (latestAction && latestAction.to_designation && (!promoDateObj || (actDateObj && actDateObj >= promoDateObj)))
        ? latestAction.to_designation
        : (pgObj.designation_short || pgObj.designation || currentPg || '-');

      // Combined Designation: base designation + Add. Charge + Acting
      var desigParts = [baseDesignation];
      if (addlChargeMap[sid] && addlChargeMap[sid].length > 0) {
        desigParts.push(addlChargeMap[sid].join(', '));
      }
      if (actingMap[sid] && actingMap[sid].length > 0) {
        desigParts.push(actingMap[sid].join(', '));
      }
      var combinedDesignation = desigParts.join(', ');

      // Retirement Date & Status
      var statutoryRetDate = Utils.calculateStatutoryRetirementDate(emp.dob);
      var effectiveRetDate = statutoryRetDate;
      var status = 'Active';

      if (extension && extension.extension_to) {
        var extTo = Utils.parseDate(extension.extension_to);
        if (extTo && extTo >= today) {
          effectiveRetDate = extTo;
          status = 'Extension';
        }
      }

      if (retirementEvent && retirementEvent.retirement_date) {
        var retDate = Utils.parseDate(retirementEvent.retirement_date);
        effectiveRetDate = retDate;
        status = 'Retired';
      } else if (effectiveRetDate && effectiveRetDate <= today && status !== 'Extension') {
        status = 'Retired';
      } else if (statutoryRetDate && statutoryRetDate <= today && status !== 'Extension') {
        status = 'Retired';
      } else if (emp.status === 'Retired' || emp.status === 'RETIRED') {
        status = 'Retired';
      }

      // Calculate days to retirement for active employees (due in <= 180 days)
      var daysToRetire = null;
      var isRetiringSoon = false;
      if (effectiveRetDate && status !== 'Retired') {
        var diffMs = effectiveRetDate.getTime() - today.getTime();
        daysToRetire = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (daysToRetire >= 0 && daysToRetire <= 180) {
          isRetiringSoon = true;
        }
      }

      // If remarks indicate resignation/suspension
      var remarks = emp.remarks || '';
      if (retirementEvent && retirementEvent.remarks) {
        remarks = (remarks ? remarks + '; ' : '') + retirementEvent.remarks;
      }

      // Placement, Workplace & Operating Station Resolution:
      // Final Architectural Hierarchy: STATION -> WORK LOCATION (station_id) -> EMPLOYEE PLACEMENT (location_id, organization_unit_id, position_id)
      var placementDateStr = latestPlacement ? latestPlacement.placement_date : '';
      var placementDuration = Utils.calculatePlacementDuration(placementDateStr, today);
      var shiftName = latestPlacement ? (latestPlacement.shift_name || '-') : '-';

      var workLocObj = null;
      var postingStn = '-';
      var workLocName = '-';
      var placementUnit = '-';
      var placementPosition = combinedDesignation;

      if (latestPlacement) {
        var pLocId = String(latestPlacement.location_id || '').trim().toUpperCase();
        workLocObj = locMap[pLocId];
        if (workLocObj) {
          workLocName = workLocObj.location_name || workLocObj.location_code || '-';
          var stnId = String(workLocObj.station_id || '').trim().toUpperCase();
          var matchedStn = stnMap[stnId];
          postingStn = matchedStn ? (matchedStn.station_code || matchedStn.station_name) : (workLocObj.station_id || latestPlacement.station_code || '-');
        } else if (latestPlacement.station_code) {
          postingStn = latestPlacement.station_code;
        }

        if (latestPlacement.organization_unit_id) {
          var uObj = unitMap[String(latestPlacement.organization_unit_id).trim().toUpperCase()];
          placementUnit = uObj ? (uObj.unit_name || uObj.unit_code) : latestPlacement.organization_unit_id;
        } else if (latestPlacement.sec_letterCode) {
          placementUnit = latestPlacement.sec_letterCode;
        }

        if (latestPlacement.position_id) {
          placementPosition = latestPlacement.position_id;
        }
      } else if (latestPosting) {
        var pstLocId = String(latestPosting.location_id || '').trim().toUpperCase();
        workLocObj = locMap[pstLocId];
        if (workLocObj) {
          workLocName = workLocObj.location_name || workLocObj.location_code || '-';
          var stnId2 = String(workLocObj.station_id || '').trim().toUpperCase();
          var matchedStn2 = stnMap[stnId2];
          postingStn = matchedStn2 ? (matchedStn2.station_code || matchedStn2.station_name) : (workLocObj.station_id || latestPosting.station_code || '-');
        } else {
          postingStn = latestPosting.station_code || '-';
        }
      }

      // Placement display string: e.g. "Head Office (HR)" or "HSIA Airport (Ground Services)"
      var placementDisplay = workLocName !== '-' ? workLocName : (placementUnit !== '-' ? placementUnit : '-');
      if (workLocName !== '-' && placementUnit !== '-') {
        placementDisplay = workLocName + ' (' + placementUnit + ')';
      }

      // Home Organization: Employee's formal home ownership (Directorate / Department)
      var depCode = emp.department_code || emp.dep_id || '';
      if (latestAction && latestAction.to_org_unit_id && (!promoDateObj || (actDateObj && actDateObj >= promoDateObj))) {
        depCode = latestAction.to_org_unit_id;
      }
      var homeOrgUnit = unitMap[String(depCode).trim().toUpperCase()];
      var depObj = depMap[String(depCode).trim().toUpperCase()];
      var homeOrgDisplay = homeOrgUnit ? (homeOrgUnit.unit_name || homeOrgUnit.unit_code) : (depObj ? (depObj.dep_name || depObj.dep_letter_code || depObj.dep_code) : (depCode || '-'));
      var depLetter = homeOrgUnit ? (homeOrgUnit.letter_code || homeOrgUnit.unit_code) : (depObj ? (depObj.dep_letter_code || depObj.dep_code) : (depCode || '-'));
      var dirId = (depObj && depObj.dir_id) ? depObj.dir_id : (emp.dir_id || (homeOrgUnit && homeOrgUnit.parent_unit_id ? homeOrgUnit.parent_unit_id : ''));
      var dirObj = dirMap[String(dirId).trim().toUpperCase()];
      var dirName = dirObj ? (dirObj.dir_name || dirObj.dir_code || dirId) : (dirId || 'Airport Services Division');

      processedList.push({
        name: emp.emp_name || emp.full_name || '-',
        staff_id: emp.staff_id,
        gender: emp.gender || '-',
        previous_id: migrationMap[sid] || '-',
        pay_group: currentPg || '-',
        rank_level: (pgRankMap[String(currentPg).trim().toUpperCase()] && pgRankMap[String(currentPg).trim().toUpperCase()] > 1)
          ? pgRankMap[String(currentPg).trim().toUpperCase()]
          : Utils.parsePayGroupRank(currentPg),
        designation: combinedDesignation,
        base_designation: baseDesignation,
        sequence_no: seqNo,
        latest_promotion_date: latestPromoDate,
        joining_date: emp.joining_date,
        joining_pg: emp.joining_pay_group || emp.joining_pg || emp.pay_group || '',
        joining_designation: emp.joining_designation || baseDesignation || '',
        contact_primary: formatPhone(emp.contact_primary),
        contact_secondary: formatPhone(emp.contact_secondary),
        contact_family: formatPhone(emp.contact_family),
        official_email: emp.official_email || emp.email || '-',
        personal_email: emp.personal_email || '-',
        email: emp.official_email || emp.personal_email || emp.email || '-',
        shift: shiftName,
        placement: placementDisplay,
        work_location: workLocName,
        placement_unit: placementUnit,
        placement_position: placementPosition,
        placement_duration: placementDuration,
        posting: postingStn,
        station: postingStn,
        department: homeOrgDisplay,
        department_name: homeOrgDisplay,
        home_organization: homeOrgDisplay,
        directorate: dirName || '-',
        dob: emp.dob,
        dob_formatted: formatDate(emp.dob),
        joining_date_formatted: formatDate(emp.joining_date),
        retirement_date: effectiveRetDate,
        retirement_date_formatted: formatDate(effectiveRetDate),
        days_to_retire: daysToRetire,
        is_retiring_soon: isRetiringSoon,
        home_district: emp.home_district || '-',
        status: status,
        remarks: remarks,
        picture_url: emp.picture_url || ''
      });
    });

    // 13. Dynamic Seniority Hierarchy Calculation
    // Critical Rule: Retired employees DO NOT hold seniority!
    // When a senior employee retires, they move to the retired category and lose active seniority status.
    // The seniority of existing active employees in that pay group recalculates automatically and dynamically.
    var activeList = [];
    var retiredList = [];

    processedList.forEach(function(item) {
      if (item.status === 'Retired') {
        item.seniority = '';
        item.sequence_no = '';
        retiredList.push(item);
      } else {
        activeList.push(item);
      }
    });

    // Group active employees by Normalized Pay Group
    // Unifies all variants of Pay Group 1 (PG-1, PG-01, 1, TH) into the exact same seniority ranking pool
    var pgGroups = {};
    activeList.forEach(function(item) {
      var groupKey = String(item.pay_group || '').trim().toUpperCase();
      if (Utils.isPayGroup1(item)) {
        groupKey = 'PG-1';
      } else {
        var parsedR = Utils.parsePayGroupRank(item.pay_group);
        if (parsedR === 3.2) groupKey = 'PG-3(2)';
        else if (parsedR === 3.1) groupKey = 'PG-3(1)';
        else if (parsedR === 2.0) groupKey = 'PG-2';
      }
      if (!pgGroups[groupKey]) pgGroups[groupKey] = [];
      pgGroups[groupKey].push(item);
    });

    var finalActiveSorted = [];

    // Sort pay groups descending by rank_level
    var sortedPgs = Object.keys(pgGroups).sort(function(a, b) {
      var rankA = Utils.parsePayGroupRank(a) || pgRankMap[a.toUpperCase()] || 0;
      var rankB = Utils.parsePayGroupRank(b) || pgRankMap[b.toUpperCase()] || 0;
      return rankB - rankA;
    });

    sortedPgs.forEach(function(pg) {
      var group = pgGroups[pg];
      Utils.sortEmployeesBySeniority(group, overrideMap);
      // Assign auto-calculated seniority sequence "01", "02"... strictly to active employees
      group.forEach(function(empItem, index) {
        var rankNum = index + 1;
        empItem.seniority = ('0' + rankNum).slice(-2);
        finalActiveSorted.push(empItem);
      });
    });

    // Sort retired employees descending by retirement date (most recent retirement first)
    retiredList.sort(function(a, b) {
      var dA = a.retirement_date ? (Utils.parseDate(a.retirement_date) || new Date(a.retirement_date)) : 0;
      var dB = b.retirement_date ? (Utils.parseDate(b.retirement_date) || new Date(b.retirement_date)) : 0;
      var tA = dA ? (dA.getTime ? dA.getTime() : new Date(dA).getTime()) : 0;
      var tB = dB ? (dB.getTime ? dB.getTime() : new Date(dB).getTime()) : 0;
      return tB - tA;
    });

    var finalSorted = finalActiveSorted.concat(retiredList);

    // Assign sequential SL
    finalSorted.forEach(function(item, idx) {
      item.sl = idx + 1;
    });

    return finalSorted;
  }

  /**
   * Service History Engine (Section Wise & Station Wise)
   * Dynamically calculates ending dates as day before next assignment.
   * Calculates longest service summary.
   */
  function getServiceHistory(staffId, mode) {
    if (!staffId) throw new Error("Staff ID is required.");
    var cleanId = String(staffId).trim().toUpperCase();

    var employees = Database.getAll('employees');
    var emp = employees.find(function(e) {
      return String(e.staff_id || '').trim().toUpperCase() === cleanId;
    });
    if (!emp) throw new Error("Employee with Staff ID '" + staffId + "' was not found.");

    var placements = Database.getAll('placements').filter(function(p) {
      return String(p.staff_id || '').trim().toUpperCase() === cleanId;
    });
    var postings = Database.getAll('postings').filter(function(p) {
      return String(p.staff_id || '').trim().toUpperCase() === cleanId;
    });
    var promotions = Database.getAll('promotions').filter(function(p) {
      return String(p.staff_id || '').trim().toUpperCase() === cleanId;
    });
    var employeeActions = Database.getAll('employee_actions').filter(function(a) {
      return String(a.staff_id || '').trim().toUpperCase() === cleanId;
    });
    var actingList = Database.getAll('acting_assignments').filter(function(a) {
      return String(a.staff_id || '').trim().toUpperCase() === cleanId;
    });

    var orgUnits = Database.getAll('organization_units');
    var unitLookup = {};
    if (orgUnits && orgUnits.length > 0) {
      orgUnits.forEach(function(u) {
        if (u.unit_id) unitLookup[String(u.unit_id).trim().toUpperCase()] = u;
        if (u.unit_code) unitLookup[String(u.unit_code).trim().toUpperCase()] = u;
      });
    }

    // Collect all chronological milestones
    var timeline = [];

    // 1. Initial Joining
    timeline.push({
      event: 'Initial Joining',
      start_date: emp.joining_date,
      department: emp.department_code || emp.dep_id || '-',
      section: '-',
      station: '-',
      shift: '-',
      pay_group: emp.pay_group || '-',
      designation: 'Initial Appointment'
    });

    // 2. Postings
    postings.forEach(function(pst) {
      timeline.push({
        event: 'Posting',
        start_date: pst.effective_from || pst.posting_date,
        effective_to: pst.effective_to || '',
        department: emp.department_code || '-',
        section: '-',
        station: pst.station_code || '-',
        work_location: pst.location_city || pst.location_id || '-',
        shift: '-',
        pay_group: emp.pay_group || '-',
        designation: '-'
      });
    });

    // 3. Placements
    placements.forEach(function(plc) {
      timeline.push({
        event: 'Placement',
        start_date: plc.placement_date,
        department: emp.department_code || '-',
        section: plc.sec_letterCode || '-',
        station: plc.station_code || '-',
        shift: plc.shift_name || '-',
        pay_group: emp.pay_group || '-',
        designation: '-'
      });
    });

    // 4. Promotions
    promotions.forEach(function(prm) {
      timeline.push({
        event: 'Promotion',
        start_date: prm.promotion_date,
        department: emp.department_code || '-',
        section: '-',
        station: '-',
        shift: '-',
        pay_group: prm.promoted_pg_id || prm.present_pg_id || '-',
        designation: 'Promoted'
      });
    });

    // 5. Acting
    actingList.forEach(function(act) {
      timeline.push({
        event: 'Acting Assignment',
        start_date: act.acting_from,
        department: emp.department_code || '-',
        section: '-',
        station: '-',
        shift: '-',
        pay_group: act.pay_group || '-',
        designation: act.designation || 'Acting'
      });
    });

    // 6. Administrative Actions (Transfers, Downgrades, Redesignations)
    employeeActions.forEach(function(act) {
      var uObj = act.to_org_unit_id ? unitLookup[String(act.to_org_unit_id).trim().toUpperCase()] : null;
      var deptName = uObj ? (uObj.unit_name || uObj.unit_code) : (act.to_org_unit_id || emp.department_code || '-');
      timeline.push({
        event: 'Action (' + (act.action_type || 'ADMIN') + ')',
        start_date: act.effective_date,
        department: deptName,
        section: '-',
        station: '-',
        shift: '-',
        pay_group: act.to_pay_group_id || emp.pay_group || '-',
        designation: act.to_designation || act.action_type || 'Administrative Action',
        reference_no: act.reference_no || '',
        remarks: act.remarks || ''
      });
    });

    // Sort ascending by start_date
    timeline.sort(function(a, b) {
      var dA = Utils.parseDate(a.start_date);
      var dB = Utils.parseDate(b.start_date);
      return (dA ? dA.getTime() : 0) - (dB ? dB.getTime() : 0);
    });

    var today = new Date();
    var durationSummary = {
      departments: {},
      stations: {},
      sections: {},
      pay_groups: {}
    };

    // Calculate dynamic ending dates
    for (var i = 0; i < timeline.length; i++) {
      var curr = timeline[i];
      var next = (i < timeline.length - 1) ? timeline[i + 1] : null;

      var startDate = Utils.parseDate(curr.start_date);
      var endDate = null;

      if (next && next.start_date) {
        var nextDate = Utils.parseDate(next.start_date);
        if (nextDate) {
          endDate = new Date(nextDate.getTime() - (24 * 60 * 60 * 1000)); // 1 day before
        }
      } else {
        endDate = today;
      }

      curr.sl = i + 1;
      curr.start_date_formatted = formatDate(curr.start_date);
      curr.ending_date_formatted = next ? formatDate(endDate) : 'Present';
      curr.duration = Utils.calculatePlacementDuration(startDate, endDate);

      // Accumulate days for longest duration calculation
      var days = startDate && endDate ? Math.max(1, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24))) : 0;

      if (curr.department && curr.department !== '-') {
        durationSummary.departments[curr.department] = (durationSummary.departments[curr.department] || 0) + days;
      }
      if (curr.station && curr.station !== '-') {
        durationSummary.stations[curr.station] = (durationSummary.stations[curr.station] || 0) + days;
      }
      if (curr.section && curr.section !== '-') {
        durationSummary.sections[curr.section] = (durationSummary.sections[curr.section] || 0) + days;
      }
      if (curr.pay_group && curr.pay_group !== '-') {
        durationSummary.pay_groups[curr.pay_group] = (durationSummary.pay_groups[curr.pay_group] || 0) + days;
      }
    }

    // Helper to find key with max days
    function findLongest(dict) {
      var maxKey = '-';
      var maxDays = 0;
      for (var k in dict) {
        if (dict[k] > maxDays) {
          maxDays = dict[k];
          maxKey = k;
        }
      }
      if (maxDays === 0) return { name: '-', duration: '-' };
      var yrs = Math.floor(maxDays / 365);
      var mos = Math.floor((maxDays % 365) / 30);
      return {
        name: maxKey,
        duration: yrs + ' Years, ' + mos + ' Months'
      };
    }

    return {
      employee: {
        staff_id: emp.staff_id,
        name: emp.emp_name || emp.full_name || '-',
        joining_date: formatDate(emp.joining_date),
        current_pg: emp.pay_group || '-'
      },
      timeline: timeline,
      longest: {
        department: findLongest(durationSummary.departments),
        station: findLongest(durationSummary.stations),
        section: findLongest(durationSummary.sections),
        pay_group: findLongest(durationSummary.pay_groups)
      }
    };
  }

  /**
   * Promotion Module: Batch Cards & Details
   */
  function getPromotionBatches() {
    var promotions = Database.getAll('promotions');
    var refs = Database.getAll('promotion_references');
    var employees = Database.getAll('employees');

    var empMap = {};
    employees.forEach(function(e) {
      empMap[String(e.staff_id || '').toUpperCase()] = e.emp_name || e.full_name || e.staff_id;
    });

    var refMap = {};
    refs.forEach(function(r) {
      refMap[r.ref_id] = r;
      if (r.reference_number) refMap[String(r.reference_number).trim()] = r;
    });

    // Group promotions by ref_id
    var batches = {};
    promotions.forEach(function(prm) {
      var refKey = prm.ref_id || 'UNKNOWN_REF';
      if (!batches[refKey]) {
        var refObj = refMap[refKey] || {};
        batches[refKey] = {
          ref_id: refKey,
          reference_number: refObj.reference_number || refKey,
          publication_date: refObj.publication_date || prm.promotion_date || '',
          promotion_date: prm.promotion_date || '',
          promotion_date_formatted: formatDate(prm.promotion_date || refObj.publication_date),
          present_pay_group: prm.present_pg_id || '-',
          promoted_pay_group: prm.promoted_pg_id || '-',
          count: 0,
          records: []
        };
      }

      batches[refKey].count++;
      batches[refKey].records.push({
        promotion_id: prm.promotion_id,
        staff_id: prm.staff_id,
        employee_name: empMap[String(prm.staff_id || '').toUpperCase()] || prm.staff_id,
        sequence_no: prm.sequence_no || '-',
        present_pg_id: prm.present_pg_id || '-',
        promoted_pg_id: prm.promoted_pg_id || '-',
        promotion_date: formatDate(prm.promotion_date)
      });
    });

    var batchList = Object.keys(batches).map(function(k) {
      return batches[k];
    });

    // Reverse chronological order
    batchList.sort(function(a, b) {
      var dA = Utils.parseDate(a.promotion_date || a.publication_date);
      var dB = Utils.parseDate(b.promotion_date || b.publication_date);
      return (dB ? dB.getTime() : 0) - (dA ? dA.getTime() : 0);
    });

    return batchList;
  }

  /**
   * Promotion: Individual Report Generator Data (Matching Executive Design)
   */
  function getEmployeePromotionReport(staffId) {
    if (!staffId) throw new Error("Staff ID is required.");
    var cleanId = String(staffId).trim().toUpperCase();

    // 1. Direct targeted employee lookup (ultra-fast, bypasses whole workforce iteration)
    var employees = Database.getAll('employees');
    var rawEmp = null;
    for (var eIdx = 0; eIdx < employees.length; eIdx++) {
      if (String(employees[eIdx].staff_id || '').trim().toUpperCase() === cleanId) {
        rawEmp = employees[eIdx];
        break;
      }
    }
    if (!rawEmp) throw new Error("Employee with Staff ID '" + staffId + "' was not found.");

    // 2. Resolve Employee Full Name
    var empName = rawEmp.emp_name || rawEmp.full_name || ('Staff ' + cleanId);

    // 3. Promotions strictly for this employee
    var promotions = Database.getAll('promotions').filter(function(p) {
      return String(p.staff_id || '').trim().toUpperCase() === cleanId;
    });

    var refs = Database.getAll('promotion_references');
    var refMap = {};
    refs.forEach(function(r) { refMap[r.ref_id] = r.reference_number; });

    var payGroups = Database.getAll('pay_groups');
    var pgMap = {};
    payGroups.forEach(function(pg) {
      var pgKey = String(pg.pay_group || pg.pg_id || '').trim().toUpperCase();
      pgMap[pgKey] = pg;
    });

    var designations = Database.getAll('designations');
    var desigMap = {};
    designations.forEach(function(d) {
      var k = String(d.design_code || d.designation_id || '').trim().toUpperCase();
      desigMap[k] = d.designation_name || d.design_code;
    });

    // 4. Resolve Placements for Directorate & Department
    var placements = Database.getAll('placements');
    var latestPlc = null;
    for (var plIdx = 0; plIdx < placements.length; plIdx++) {
      var plc = placements[plIdx];
      if (String(plc.staff_id || '').trim().toUpperCase() === cleanId) {
        var pDate = Utils.parseDate(plc.placement_date);
        if (!latestPlc || (pDate && pDate > Utils.parseDate(latestPlc.placement_date))) {
          latestPlc = plc;
        }
      }
    }

    var depCode = rawEmp.department_code || rawEmp.dep_id || (latestPlc ? (latestPlc.department_code || latestPlc.dep_id) : '');
    var departments = Database.getAll('departments');
    var orgUnits = Database.getAll('organization_units');
    var depObj = null;
    for (var dIdx = 0; dIdx < departments.length; dIdx++) {
      var d = departments[dIdx];
      if (String(d.dep_code || d.dep_id || '').trim().toUpperCase() === String(depCode).trim().toUpperCase()) {
        depObj = d;
        break;
      }
    }
    if (!depObj && orgUnits) {
      for (var ouIdx = 0; ouIdx < orgUnits.length; ouIdx++) {
        var ou = orgUnits[ouIdx];
        if (String(ou.unit_id || ou.unit_code || '').trim().toUpperCase() === String(depCode).trim().toUpperCase()) {
          depObj = { dep_id: ou.unit_id, dep_code: ou.unit_code || ou.unit_id, dep_name: ou.unit_name, dir_id: ou.parent_unit_id };
          break;
        }
      }
    }
    var depName = depObj ? (depObj.dep_name || depObj.dep_code) : (depCode || '-');

    var dirId = (depObj && depObj.dir_id) ? depObj.dir_id : (rawEmp.dir_id || (latestPlc ? latestPlc.dir_id : ''));
    var dirObj = null;
    if (orgUnits) {
      for (var ou2 = 0; ou2 < orgUnits.length; ou2++) {
        var ouD = orgUnits[ou2];
        if (String(ouD.unit_id || ouD.unit_code || '').trim().toUpperCase() === String(dirId).trim().toUpperCase()) {
          dirObj = { dir_id: ouD.unit_id, dir_code: ouD.unit_code || ouD.unit_id, dir_name: ouD.unit_name };
          break;
        }
      }
    }
    var dirName = dirObj ? (dirObj.dir_name || dirObj.dir_code) : (dirId || 'Airport Services Division');

    // 5. Retirement Status Resolution
    var today = new Date();
    var statutoryRetDate = Utils.calculateStatutoryRetirementDate(rawEmp.dob);
    var effectiveRetDate = statutoryRetDate;
    var status = rawEmp.status || 'Active';

    var selfR = Database.getAll('self_retirements');
    for (var srIdx = 0; srIdx < selfR.length; srIdx++) {
      if (String(selfR[srIdx].staff_id || '').trim().toUpperCase() === cleanId && selfR[srIdx].retirement_date) {
        effectiveRetDate = Utils.parseDate(selfR[srIdx].retirement_date);
        status = 'Retired';
        break;
      }
    }
    if (effectiveRetDate && effectiveRetDate <= today && status !== 'Extension') {
      status = 'Retired';
    }

    promotions.sort(function(a, b) {
      return (Utils.parseDate(a.promotion_date) || 0) - (Utils.parseDate(b.promotion_date) || 0);
    });

    var history = [];
    for (var i = 0; i < promotions.length; i++) {
      var p = promotions[i];
      var nextP = (i < promotions.length - 1) ? promotions[i + 1] : null;
      var startDate = Utils.parseDate(p.promotion_date);
      var endDate = nextP ? Utils.parseDate(nextP.promotion_date) : new Date();

      var prevPg = p.present_pg_id || p.present_pay_group || '-';
      var promPg = p.promoted_pg_id || p.promoted_pay_group || '-';

      var prevDesig = '';
      if (p.present_desig_code && desigMap[String(p.present_desig_code).trim().toUpperCase()]) {
        prevDesig = desigMap[String(p.present_desig_code).trim().toUpperCase()];
      } else if (pgMap[String(prevPg).trim().toUpperCase()]) {
        prevDesig = pgMap[String(prevPg).trim().toUpperCase()].designation || pgMap[String(prevPg).trim().toUpperCase()].designation_short || '';
      }

      var promDesig = '';
      if (p.desig_code && desigMap[String(p.desig_code).trim().toUpperCase()]) {
        promDesig = desigMap[String(p.desig_code).trim().toUpperCase()];
      } else if (pgMap[String(promPg).trim().toUpperCase()]) {
        promDesig = pgMap[String(promPg).trim().toUpperCase()].designation || pgMap[String(promPg).trim().toUpperCase()].designation_short || '';
      }

      var prevPgDisplay = prevDesig ? (prevDesig + ', ' + prevPg) : prevPg;
      var promPgDisplay = promDesig ? (promDesig + ', ' + promPg) : promPg;

      var slFormatted = ('0' + (i + 1)).slice(-2);
      var effectiveDateFormatted = startDate ? (Utils.formatDateToDDMmmYYYY(startDate) || '').replace(/-/g, ' ') : (p.promotion_date || '-');
      var rawDuration = Utils.calculatePlacementDuration(startDate, endDate);
      var formattedDuration = rawDuration.replace(/(\d{2})D$/, '$1 D');

      history.push({
        sl: slFormatted,
        reference_no: refMap[p.ref_id] || p.ref_id || '-',
        present_pg: prevPg,
        promoted_pg: promPg,
        previous_pg_display: prevPgDisplay,
        promoted_pg_display: promPgDisplay,
        effective_date: effectiveDateFormatted,
        promotion_date: effectiveDateFormatted,
        sequence_no: p.sequence_no || '-',
        seniority: p.sequence_no || ('0' + (i + 1)).slice(-2),
        duration_in_pg: formattedDuration,
        remarks: p.remarks || '-'
      });
    }

    var latestPromo = promotions.length > 0 ? promotions[promotions.length - 1] : null;
    var currentPg = latestPromo ? (latestPromo.promoted_pg_id || latestPromo.present_pg_id || rawEmp.pay_group) : (rawEmp.pay_group || '-');
    var currentDesig = '';
    if (latestPromo && latestPromo.desig_code && desigMap[String(latestPromo.desig_code).trim().toUpperCase()]) {
      currentDesig = desigMap[String(latestPromo.desig_code).trim().toUpperCase()];
    } else if (pgMap[String(currentPg).trim().toUpperCase()]) {
      currentDesig = pgMap[String(currentPg).trim().toUpperCase()].designation_short || pgMap[String(currentPg).trim().toUpperCase()].designation || '';
    } else {
      currentDesig = rawEmp.designation || '-';
    }

    var joiningPg = rawEmp.joining_pay_group || rawEmp.joining_pg || (history.length > 0 ? history[0].present_pg : rawEmp.pay_group) || '-';
    var joiningDesig = '';
    if (history.length > 0 && history[0].previous_pg_display && history[0].previous_pg_display.indexOf(',') !== -1) {
      joiningDesig = history[0].previous_pg_display.split(',')[0].trim();
    } else if (pgMap[String(joiningPg).trim().toUpperCase()]) {
      joiningDesig = pgMap[String(joiningPg).trim().toUpperCase()].designation || pgMap[String(joiningPg).trim().toUpperCase()].designation_short || '';
    } else {
      joiningDesig = rawEmp.joining_designation || rawEmp.designation || '';
    }

    var joiningPgDisplay = joiningDesig ? ('"' + joiningDesig + '", "' + joiningPg + '"') : ('"' + joiningPg + '"');
    var rawJoiningDate = Utils.parseDate(rawEmp.joining_date);
    var joiningDateFormatted = rawJoiningDate ? (Utils.formatDateToDDMmmYYYY(rawJoiningDate) || '').replace(/-/g, ' ') : (rawEmp.joining_date || '-');
    var rawServiceLength = Utils.calculatePlacementDuration(rawEmp.joining_date, new Date());
    var formattedServiceLength = rawServiceLength.replace(/(\d{2})D$/, '$1 D');

    var cleanNameForId = (empName || 'Employee').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    var reportIdentifier = cleanNameForId + '_' + rawEmp.staff_id;

    return {
      name: empName,
      staff_id: rawEmp.staff_id,
      report_id: reportIdentifier,
      directorate: dirName || 'AIRPORT SERVICES DIVISION',
      department: depName || '-',
      joining_date: joiningDateFormatted,
      current_pg: currentPg,
      current_designation: currentDesig || '-',
      joining_pg: joiningPg,
      joining_designation: joiningDesig,
      joining_pg_display: joiningPgDisplay,
      service_length: formattedServiceLength,
      is_retired: status === 'Retired',
      status: status,
      history: history
    };
  }

  /**
   * Comprehensive list of all promotions with reference numbers, duration, and seniority
   */
  function getAllPromotionsDetailed() {
    var promotions = Database.getAll('promotions');
    var refs = Database.getAll('promotion_references');
    var refMap = {};
    refs.forEach(function(r) { refMap[r.ref_id] = r.reference_number; });

    var payGroups = Database.getAll('pay_groups');
    var pgRankMap = {};
    payGroups.forEach(function(pg) {
      var pgKey = String(pg.pay_group || pg.pg_id || '').trim().toUpperCase();
      pgRankMap[pgKey] = parseInt(pg.rank_level || 0, 10);
    });

    // Sort chronologically descending, secondary rank_level descending
    promotions.sort(function(a, b) {
      var dateA = Utils.parseDate(a.promotion_date) || 0;
      var dateB = Utils.parseDate(b.promotion_date) || 0;
      if (dateB !== dateA) return dateB - dateA;
      var rankA = pgRankMap[String(a.promoted_pg_id || '').trim().toUpperCase()] || 0;
      var rankB = pgRankMap[String(b.promoted_pg_id || '').trim().toUpperCase()] || 0;
      return rankB - rankA;
    });

    return promotions.map(function(p, idx) {
      var startDate = Utils.parseDate(p.promotion_date);
      var duration = startDate ? Utils.calculatePlacementDuration(startDate, new Date()).replace(/(\d{2})D$/, '$1 D') : '-';
      var formattedDate = startDate ? (Utils.formatDateToDDMmmYYYY(startDate) || '').replace(/-/g, ' ') : (p.promotion_date || '-');

      return {
        sl: ('0' + (idx + 1)).slice(-2),
        reference_no: refMap[p.ref_id] || p.ref_id || '-',
        staff_id: p.staff_id,
        present_pg: p.present_pg_id || '-',
        promoted_pg: p.promoted_pg_id || '-',
        promotion_date: formattedDate,
        seniority: p.sequence_no || ('0' + (idx + 1)).slice(-2),
        sequence_number: p.sequence_no || '-',
        duration_in_pg: duration,
        remarks: p.remarks || '-'
      };
    });
  }

  /**
   * Promotion Eligibility Engine
   * Rules:
   * - Only active employees who have completed at least 3 years in their existing pay group are eligible.
   * - ACR records and Disciplinary cases are explicitly excluded from eligibility criteria.
   * - Pay Group 1 recruitment is policy-restricted from promotion.
   * - Retired employees are strictly filtered out.
   */
  function getPromotionEligibilityList(filters) {
    var allDetails = getEmployeesDetailsList();
    var payGroups = Database.getAll('pay_groups');

    // Sort pay groups by rank_level ascending to determine target next pay group
    var sortedPgs = payGroups.slice().sort(function(a, b) {
      return (parseInt(a.rank_level || 0, 10)) - (parseInt(b.rank_level || 0, 10));
    });

    var today = new Date();
    var list = [];

    allDetails.forEach(function(emp) {
      // 1. Policy exclusion: Retired employees
      if (emp.status === 'Retired') return;

      // 2. Policy exclusion: Pay Group 1
      var pgNormalized = String(emp.pay_group || '').toUpperCase().replace(/[\s\-_]+/g, '');
      var isPg1 = (pgNormalized === 'PG1' || pgNormalized === 'PAYGROUP1' || pgNormalized === 'GRADE1');

      // 3. Determine start date in existing pay group (latest promotion date or joining date)
      var effectiveDateVal = emp.latest_promotion_date || emp.joining_date;
      var startDate = Utils.parseDate(effectiveDateVal);
      var serviceYears = 0;
      var durationDisplay = '-';

      if (startDate) {
        serviceYears = (today - startDate) / (1000 * 60 * 60 * 24 * 365.25);
        durationDisplay = Utils.calculatePlacementDuration(startDate, today);
      }

      // 4. Resolve Target Pay Group
      var currPgNorm = String(emp.pay_group || '').trim().toUpperCase();
      var currIdx = -1;
      for (var p = 0; p < sortedPgs.length; p++) {
        var pName = String(sortedPgs[p].pay_group || '').trim().toUpperCase();
        if (pName === currPgNorm) {
          currIdx = p;
          break;
        }
      }
      var targetPayGroup = '-';
      if (currIdx !== -1) {
        if (currIdx + 1 < sortedPgs.length) {
          targetPayGroup = sortedPgs[currIdx + 1].pay_group;
        } else {
          targetPayGroup = 'Maximum Rank Reached';
        }
      } else {
        targetPayGroup = 'Next Grade';
      }

      // 5. Evaluate Eligibility (Single Criterion: Completed 3 years in existing pay group)
      var completed3Years = (serviceYears >= 3.0);
      var eligible = false;
      var reasons = [];

      if (isPg1) {
        eligible = false;
        reasons.push("Policy: Employees in Pay Group 1 (PG-1) are policy-restricted from promotion.");
      } else if (completed3Years) {
        eligible = true;
        reasons.push("Eligible: Completed " + serviceYears.toFixed(1) + " years (" + durationDisplay + ") in " + (emp.pay_group || 'current pay group') + ".");
      } else {
        eligible = false;
        var remaining = Math.max(0, 3.0 - serviceYears).toFixed(1);
        reasons.push("Ineligible: Served " + serviceYears.toFixed(1) + " years (" + durationDisplay + ") in existing pay group (Minimum 3.0 years required; " + remaining + " yrs remaining).");
      }

      var formattedEffectiveDate = '-';
      if (startDate) {
        formattedEffectiveDate = Utils.formatDateToDDMmmYYYY(startDate);
      } else if (effectiveDateVal) {
        formattedEffectiveDate = effectiveDateVal;
      }

      list.push({
        staff_id: emp.staff_id,
        name: emp.name,
        pay_group: emp.pay_group,
        target_pay_group: targetPayGroup,
        effective_date: formattedEffectiveDate,
        service_years: serviceYears.toFixed(1) + ' Years',
        duration_display: durationDisplay,
        eligible: eligible ? 'YES' : 'NO',
        comments: reasons.join(' ')
      });
    });

    return list;
  }

  /**
   * Workforce Setup (Sanctioned vs Existing vs Required Deficit)
   * Excludes retired personnel.
   * Auto-excludes groups with 0 assigned personnel and 0 setup.
   */
  function getWorkforceSetupReport(filters) {
    var setupRecords = Database.getAll('workforce_setup');
    var allDetails = getEmployeesDetailsList();

    // Filter out retired personnel from active headcount
    var activeEmployees = allDetails.filter(function(e) {
      return e.status !== 'Retired';
    });

    // Group active employees by Station, Pay Group, Designation
    var existingCounts = {};
    activeEmployees.forEach(function(e) {
      var stn = String(e.posting || '').toUpperCase().trim();
      var pg = String(e.pay_group || '').toUpperCase().trim();
      var key = stn + '|' + pg;
      existingCounts[key] = (existingCounts[key] || 0) + 1;
    });

    var rows = [];

    setupRecords.forEach(function(set) {
      var stn = String(set.station_code || set.station_id || '').toUpperCase().trim();
      var pg = String(set.pay_group || '').toUpperCase().trim();
      var desig = set.designation || '-';
      var sanctioned = parseInt(set.set_up || set.staff_number || 0, 10);

      var key = stn + '|' + pg;
      var existing = existingCounts[key] || 0;
      var required = Math.max(0, sanctioned - existing);

      // Auto exclude rows with 0 sanctioned and 0 existing
      if (sanctioned === 0 && existing === 0) return;

      rows.push({
        directorate: set.dir_id || '-',
        department: set.dep_id || '-',
        station: stn || '-',
        pay_group: pg || '-',
        designation: desig,
        sanctioned: sanctioned,
        existing: existing,
        required: required
      });
    });

    return rows;
  }

  /**
   * Workforce Distribution Matrix
   */
  function getWorkforceDistribution(filters) {
    var allDetails = getEmployeesDetailsList();
    var activeList = allDetails.filter(function(e) { return e.status !== 'Retired'; });

    var byStation = {};
    var byShift = {};
    var byDepartment = {};

    activeList.forEach(function(e) {
      var stn = e.posting || 'Unassigned';
      byStation[stn] = (byStation[stn] || 0) + 1;

      var shf = e.shift || 'General';
      byShift[shf] = (byShift[shf] || 0) + 1;

      var dep = e.department || 'Unassigned';
      byDepartment[dep] = (byDepartment[dep] || 0) + 1;
    });

    return {
      total_active: activeList.length,
      by_station: byStation,
      by_shift: byShift,
      by_department: byDepartment
    };
  }

  /**
   * Airline HR Analytics Model
   */
  function getAirlineHRAnalytics() {
    var allDetails = getEmployeesDetailsList();
    var today = new Date();

    var totalActive = 0;
    var totalExtension = 0;
    var totalRetired = 0;
    var upcomingRetirements1Yr = 0;
    var upcomingRetirements3Yr = 0;
    var pgDist = {};

    allDetails.forEach(function(e) {
      if (e.status === 'Active') totalActive++;
      else if (e.status === 'Extension') totalExtension++;
      else if (e.status === 'Retired') totalRetired++;

      var pg = e.pay_group || 'Other';
      pgDist[pg] = (pgDist[pg] || 0) + 1;

      // Retirement forecast
      if (e.status !== 'Retired' && e.retirement_date) {
        var ret = new Date(e.retirement_date);
        var diffYrs = (ret - today) / (1000 * 60 * 60 * 24 * 365.25);
        if (diffYrs > 0 && diffYrs <= 1) upcomingRetirements1Yr++;
        if (diffYrs > 0 && diffYrs <= 3) upcomingRetirements3Yr++;
      }
    });

    return {
      total_workforce: allDetails.length,
      total_active: totalActive,
      total_extension: totalExtension,
      total_retired: totalRetired,
      retirements_1_year: upcomingRetirements1Yr,
      retirements_3_years: upcomingRetirements3Yr,
      pay_group_distribution: pgDist
    };
  }

  /**
   * Save Promotion (Single & Bulk "Multiple Employees" Entry)
   */
  function savePromotion(data) {
    if (!data.present_pg_id || !data.promoted_pg_id || !data.promotion_date) {
      throw new Error("Present Pay Group, Promoted Pay Group, and Promotion Date are required.");
    }

    var refNumber = String(data.reference_no || data.reference_number || '').trim();
    if (!refNumber) {
      refNumber = 'REF-PROM-' + formatDate(data.promotion_date).replace(/\-/g, '');
    }

    // 1. Resolve or create promotion_references surrogate key
    var refs = Database.getAll('promotion_references');
    var existingRef = refs.find(function(r) {
      return String(r.reference_number || '').trim().toLowerCase() === refNumber.toLowerCase();
    });

    var refId = '';
    if (existingRef) {
      refId = existingRef.ref_id;
    } else {
      var newRef = Database.insert('promotion_references', {
        reference_number: refNumber,
        publication_date: data.promotion_date,
        remarks: data.remarks || 'Corporate Promotion Order'
      }, 'REF', 'ref_id');
      refId = newRef.ref_id;
    }

    // 2. Parse Multiple Staff IDs if bulk entry
    var staffIds = [];
    if (data.multiple_staff_id) {
      staffIds = String(data.multiple_staff_id).split(/[,;\n\r]+/).map(function(s) {
        return s.trim();
      }).filter(function(s) { return s.length > 0; });
    } else if (data.staff_id) {
      staffIds = [String(data.staff_id).trim()];
    }

    if (staffIds.length === 0) {
      throw new Error("At least one Staff ID is required.");
    }

    // Duplicate promotion prevention
    var existingPromotions = Database.getAll('promotions');
    for (var dIdx = 0; dIdx < staffIds.length; dIdx++) {
      var checkStaff = staffIds[dIdx];
      var isDup = existingPromotions.find(function(p) {
        return String(p.staff_id || '').trim().toUpperCase() === checkStaff.toUpperCase() &&
               String(p.promoted_pg_id || '').trim().toUpperCase() === String(data.promoted_pg_id).trim().toUpperCase() &&
               String(p.promotion_date || '').trim() === String(data.promotion_date).trim();
      });
      if (isDup) {
        var err = new Error("A promotion record for Staff ID '" + checkStaff + "' to " + data.promoted_pg_id + " on " + data.promotion_date + " already exists.");
        err.isDuplicate = true;
        throw err;
      }
    }

    // 3. Sequential sequence number assignment in entry order
    var recordsToInsert = [];
    for (var i = 0; i < staffIds.length; i++) {
      var sId = staffIds[i];
      var seq = (data.sequence_no && staffIds.length === 1) ? parseInt(data.sequence_no, 10) : (i + 1);

      recordsToInsert.push({
        ref_id: refId,
        staff_id: sId,
        sequence_no: seq,
        present_pg_id: data.present_pg_id,
        promoted_pg_id: data.promoted_pg_id,
        promotion_date: data.promotion_date
      });
    }

    return Database.insertBatch('promotions', recordsToInsert, 'PRM', 'promotion_id');
  }

  /**
   * Monthly Allowance Calculation
   * Rules:
   * - Overtime allowance is calculated strictly based on the specified Pay Group.
   * - Overtime allowance is applicable ONLY to employees in Groups 1 through 5.
   * - Employees above Group 5 are strictly NOT eligible for overtime allowance.
   */
  function calculateAllowance(data) {
    if (!data || !data.staff_id) throw new Error("Staff ID is required.");
    var cleanId = String(data.staff_id).trim().toUpperCase();

    var allDetails = getEmployeesDetailsList();
    var emp = allDetails.find(function(e) {
      return String(e.staff_id || '').toUpperCase() === cleanId;
    });
    if (!emp) throw new Error("Employee with Staff ID '" + data.staff_id + "' not found.");

    // Specified Pay Group (from form input or employee's active pay group)
    var payGroupSpecified = String(data.pay_group || emp.pay_group || '').trim();
    if (!payGroupSpecified) {
      payGroupSpecified = 'PG-1';
    }

    var payGroups = Database.getAll('pay_groups');
    var pg = payGroups.find(function(p) {
      return String(p.pay_group || '').trim().toUpperCase() === payGroupSpecified.toUpperCase();
    });

    var basicPay = pg ? parseFloat(pg.basic_pay || 0) : 50000;
    var attendanceDays = parseFloat(data.attendance_days || 0);
    var mealDays = parseFloat(data.meal_days || 0);
    var overtimeHours = parseFloat(data.overtime_hours || 0);

    var mealRatePerDay = 300;
    var mealAllowance = mealDays * mealRatePerDay;

    // Overtime allowance is applicable ONLY to employees in Groups 1 through 5.
    // Employees above Group 5 are strictly NOT eligible.
    var pgMatch = payGroupSpecified.match(/(?:PG|GROUP|PAY\s*GROUP)?[\s\-_]*0*([1-9]\d*)/i);
    var groupNum = pgMatch ? parseInt(pgMatch[1], 10) : 999;
    var isOtEligible = (groupNum >= 1 && groupNum <= 5);

    var otRate = 0;
    var overtimeAmount = 0;
    if (isOtEligible) {
      // Standard overtime formula: (Basic / 200) * 1.5 * hours
      otRate = (basicPay / 200) * 1.5;
      overtimeAmount = Math.round(otRate * overtimeHours);
    } else {
      // Employees above Group 5 are not eligible
      overtimeAmount = 0;
    }

    var grossSalary = Math.round(basicPay + mealAllowance + overtimeAmount);

    var record = {
      staff_id: emp.staff_id,
      employee_name: emp.name,
      pay_group: payGroupSpecified,
      period: data.period || 'Current',
      basic_pay: basicPay,
      attendance_days: attendanceDays,
      meal_allowance: mealAllowance,
      overtime_hours: isOtEligible ? overtimeHours : 0,
      overtime_amount: overtimeAmount,
      gross_salary: grossSalary,
      overtime_eligible: isOtEligible,
      overtime_note: isOtEligible ? ('Eligible (Group ' + groupNum + ')') : ('Ineligible: Overtime allowance is restricted to Groups 1-5 (Employee in ' + payGroupSpecified + ')')
    };

    try {
      Database.insert('payroll_calculations', record, 'PAY', 'payroll_id');
    } catch (e) {
      console.warn("Payroll calculation insert notice:", e);
    }

    return record;
  }

  /**
   * Save Employee directly into `employees` table.
   * Statutory retirement date is calculated automatically from Date of Birth (DOB + 59 years).
   */
  function saveEmployee(data) {
    if (!data.staff_id || !data.emp_name) {
      throw new Error("Staff ID and Employee Name are required.");
    }

    var staffId = String(data.staff_id).trim();
    var empName = String(data.emp_name || data.full_name || '').trim();
    var gender = String(data.gender || '').trim();
    var dob = data.dob || '';
    var joiningDate = data.joining_date || '';

    // Automatically calculate statutory retirement date from DOB (59 years)
    var retDate = '';
    if (dob) {
      var calcRet = Utils.calculateStatutoryRetirementDate(dob);
      if (calcRet) {
        retDate = typeof calcRet === 'string' ? calcRet : Utils.formatDateToISO(calcRet);
      }
    }

    // Resolve existing employee by staff_id or emp_id
    var employees = Database.getAll('employees');
    var isUpdate = !!(data.emp_id && String(data.emp_id).trim());

    var existingByStaff = employees.find(function(e) {
      return String(e.staff_id || '').trim().toUpperCase() === staffId.toUpperCase() &&
             (!isUpdate || String(e.emp_id || '').trim().toUpperCase() !== String(data.emp_id).trim().toUpperCase());
    });

    if (existingByStaff) {
      var err = new Error("An employee with Staff ID '" + staffId + "' already exists in the system.");
      err.isDuplicate = true;
      throw err;
    }

    var empPayload = {
      staff_id: staffId,
      emp_name: empName,
      gender: gender,
      department_code: data.department_code || '',
      dep_id: data.dep_id || '',
      emp_type: data.emp_type || '',
      emp_type_id: data.emp_type_id || '',
      pay_group: data.pay_group || '',
      contact_primary: data.contact_primary || '',
      contact_secondary: data.contact_secondary || data.contact_alternate || '',
      contact_family: data.contact_family || '',
      official_email: data.official_email || data.email_official || data.email || '',
      personal_email: data.personal_email || data.email_personal || '',
      email: data.official_email || data.email || data.personal_email || '',
      dob: dob,
      joining_date: joiningDate,
      retirement_date: retDate,
      home_district: data.home_district || '',
      picture_url: data.picture_url || data.picture_drive_id || '',
      remarks: data.remarks || ''
    };

    var savedEmp = null;
    if (isUpdate) {
      savedEmp = Database.update('employees', 'emp_id', data.emp_id, empPayload);
    } else {
      savedEmp = Database.insert('employees', empPayload, 'EMP', 'emp_id');
    }

    Database.invalidateCache('employees');
    return savedEmp;
  }

  return {
    getEmployeesDetailsList: getEmployeesDetailsList,
    getServiceHistory: getServiceHistory,
    getPromotionBatches: getPromotionBatches,
    getEmployeePromotionReport: getEmployeePromotionReport,
    getAllPromotionsDetailed: getAllPromotionsDetailed,
    getPromotionEligibilityList: getPromotionEligibilityList,
    getWorkforceSetupReport: getWorkforceSetupReport,
    getWorkforceDistribution: getWorkforceDistribution,
    getAirlineHRAnalytics: getAirlineHRAnalytics,
    savePromotion: savePromotion,
    saveEmployee: saveEmployee,
    calculateAllowance: calculateAllowance
  };
})();
