# SANDVIORA AVIOSOLUTION — ENTERPRISE HRM & WORKFORCE MANAGEMENT
## Comprehensive Implementation Plan & Technical Blueprint
### Google Apps Script (GAS) Backend & Google Sheets Database Architecture with Vanilla HTML/CSS/JS Frontend

---

## 1. Executive Summary & Architectural Shift

This implementation plan establishes the architectural and technical specification for the **SANDVIORA AVIOSOLUTION** Human Resource Management (HRM), Organization (ORG), Training Quality & Compliance (TQC), and Workforce Management platform.

### Crucial Technology Transition
As specified, the previous technology stack (Django REST Framework + PostgreSQL + Next.js/React + Tailwind CSS) has been completely redesigned into a modern, resilient, high-performance architecture built strictly for the Google Workspace ecosystem:

1. **Storage / Relational Database Engine**: **Google Sheets**
   - Individual worksheets function as normalized relational tables with strict schemas, unique surrogate primary keys, foreign key references, and transactional integrity mechanisms.
   - Concurrency and ACID-like safety are maintained using Apps Script `LockService`.
   - High-throughput read caching is handled via Apps Script `CacheService` and in-memory indexing.
2. **Backend Application & Service Layer**: **Google Apps Script (GAS)** (`.gs` files)
   - Modular service-oriented architecture: `Database.gs`, `HrmService.gs`, `OrgService.gs`, `TqcService.gs`, `PayrollService.gs`, `ReportService.gs`, `AuditService.gs`, and `Router.gs`.
   - Centralized business logic, seniority calculation, eligibility checks, career interval reconstruction, and dynamic vacancy analytics.
3. **Frontend Application Layer**: **Pure Vanilla HTML5, CSS3, and Modern JavaScript (ES6+)**
   - **Zero External Frameworks**: Strictly **NO** Tailwind CSS, **NO** React, **NO** Next.js, and **NO** external build pipelines.
   - Custom-engineered, ultra-sleek, modern design system using native CSS Custom Properties, glassmorphism, responsive CSS Grid / Flexbox layouts, micro-animations, and full-screen spreadsheet virtualization.
   - Robust client-side state management, asynchronous RPC bridge to Google Apps Script (`google.script.run`), client-side DOM reconciliation, and instant feedback toast/modal systems.

---

## 2. Core Implementation Principles

1. **Database-First Integrity**: The relational structure of the Google Sheets database dictates all workflows. Master data is referenced strictly by relational IDs rather than duplicated text strings.
2. **Single Source of Truth**: Organizational master entities (Directorates, Departments, Sections, Stations, Shifts, Pay Groups, and Designations) belong to ORG master sheets. HRM modules reference these records by foreign keys.
3. **Universal Date Input Standard (No Datepickers)**:
   - All date input fields across every form reject native/third-party datepicker dialogs.
   - The user inputs raw 8-digit numeric strings (`DDMMYYYY`, e.g., `20102022`).
   - Keystroke masking and real-time validation instantly format and display the value as `DD-MMM-YYYY` (e.g., `20-Oct-2022`).
   - Data is stored in ISO `YYYY-MM-DD` / `DD-MMM-YYYY` standard within Google Sheets.
4. **Dynamic Interval Calculation (Zero Artificial Ending Dates)**:
   - The database never stores artificial "Ending Dates" for placements, postings, transfers, or promotions.
   - Programming logic dynamically determines the assignment conclusion as the calendar day immediately preceding the subsequent assignment’s start date (or "Present / Today" for active assignments).
5. **Dynamic Seniority Hierarchy**:
   - Seniority within any pay group is automatically and dynamically calculated:
     - **Pay Group 1 (Traffic Helper / TH)**: Since there is no provision for promotion in Pay Group 1, seniority is determined strictly based on **Date of Joining** (earliest joining date = higher seniority rank `01`, `02`...). For employees who joined on the exact same day, seniority is determined based on **sequence of joining** or ascending **Staff ID**.
     - **Pay Groups 2 and Upwards**:
       - **Primary Criterion**: Earlier Promotion Date (or entry date if not yet promoted).
       - **Secondary Criterion**: Ascending assigned **Sequence Numbers** (1, 2, 3...) from the official promotion letter.
       - **Tertiary Criterion**: Ascending Staff ID order.
     - **Dynamic Recalculation on Retirement**: Retired employees strictly surrender their seniority status and move to the retired category where Seniority and Sequence Number columns are omitted. The seniority ranks (`01`, `02`, `03`...) of remaining active employees in that pay group automatically and dynamically recalculate and shift upward.
     - **Automatic & Dynamic Updates**: Seniority rankings recalculate automatically whenever new joining records, promotions, retirements, or overrides are registered.
     - Manual override capability reserved exclusively for authorized HR / Admin users.
6. **Promotion Normalization & Batch Architecture**:
   - Official promotion letters containing long alphanumeric reference strings (>20 characters) are normalized into a dedicated `promotion_references` sheet with compact surrogate keys (`ref_id`).
   - Promotion records reference `ref_id` as a foreign key to eliminate data redundancy.
   - Bulk "Multiple Employees" promotion entry parses comma-separated Staff IDs and automatically generates sequence numbers based on entry order.
7. **Canonical Read Models**:
   - The Employee List (Details, Precise, On Job, Retired, Officer & Supervisor, TH) is rendered from a single, unified backend query model that dynamically derives current pay group, latest placement, acting/additional designations, and retirement statuses.
8. **Standardized 5-Field Audit & Soft-Delete Architecture**:
   - Every operational and relational worksheet table strictly incorporates 5 standardized audit and lifecycle columns: `created_at`, `updated_at`, `created_by`, `updated_by`, and `is_deleted`.
   - Records are soft-deleted by setting `is_deleted = true` along with modification timestamps and operator emails, preserving full historical integrity.
9. **Zero-Downtime Non-Destructive Migrations Engine**:
   - The backend service provides `Database.ensureAllTablesAndAuditColumns()`. All defined tables in Google Sheets are dynamically checked; missing sheets are auto-created with headers and frozen top rows, and missing columns (including audit headers) are appended to Row 1 without truncating, altering, or dropping existing tabular records.
10. **Enhanced Dashboard Card Legibility & Visual Prominence Standard**:
    - High-visibility typography for all summary, KPI, and analytics cards across all system dashboards (HRM, ORG, TQC):
      - Metric labels (`.kpi-label`): Scaled up to `0.825rem` (`font-weight: 800`, uppercase, `letter-spacing: 0.05em`) for enhanced scannability.
      - Metric values (`.kpi-value`): Prominent headline figures scaled up to `1.85rem` (`font-weight: 800`).
      - Contextual subtext (`.kpi-subtext`): Scaled up to `0.825rem` (`font-weight: 600`).
      - Icon badge frames (`.kpi-icon-box`): Scaled up to `46px x 46px` housing `26px` high-contrast iconography.
      - Content cards (`.content-card`): Base font size increased to `0.925rem` with `1.6` line-height and card titles (`.card-header-title`) increased to `0.975rem` (`font-weight: 800`).
      - Quick action navigation buttons (`.quick-nav-btn`): Scaled to `0.875rem` with `20px` icons.

---

## 3. Google Sheets Relational Database Architecture

The Google Spreadsheet workbook functions as the relational database. Each worksheet represents an entity table. The first row of each sheet contains exact column headers.

```
+----------------------------------------------------------------------------------------------------+
|                                 GOOGLE SHEETS RELATIONAL SCHEMA                                    |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [organization_units] <--------+                                                                   |
|          ^                     |                                                                   |
|          | parent_id           |                                                                   |
|          |                     |                                                                   |
|  [stations] <-----------+      |                                                                   |
|                         |      |                                                                   |
|  [shifts] --------------+------+                                                                   |
|                         |      |                                                                   |
|  [pay_groups] <-----+   |      |                                                                   |
|          ^          |   |      |                                                                   |
|          |          |   |      |                                                                   |
|  [designations] <---+   |      |                                                                   |
|                         |      |                                                                   |
|  [employees] <--------------------+                                                                   |
|      |                                                                                               |
|      +-- [placements] ----------+                                                                   |
|      +-- [postings] -----------+                                                                   |
|      +-- [promotion_references] <---+                                                              |
|      +-- [promotions] --------------+                                                              |
|      +-- [employee_actions] <-------+                                                              |
|      +-- [extensions]                                                                              |
|      +-- [additional_charges]                                                                      |
|      +-- [acting_assignments]                                                                      |
|      +-- [self_retirements]                                                                        |
|      +-- [employee_migrations]                                                                     |
|      +-- [disciplinary_cases]                                                                      |
|      +-- [courses] & [trainings]                                                                   |
|      +-- [payroll_calculations] & [audit_logs] & [users]                                           |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### 3.1 Organization Master Sheets (ORG)

#### 1. Sheet: `organization_units`
Stores the complete multi-tiered hierarchy (Directorates, Divisions, Departments, Sections, Wings, Teams).
- `unit_id` (PK, String: `OU-001`): Unique identifier.
- `unit_code` (String, Unique): e.g., `CSD`, `ASD`, `GH`, `SEC-RAMP`.
- `unit_name` (String): e.g., "Airport Services Division", "Customer Services".
- `unit_type` (String): `HEADQUARTER`, `DIRECTORATE`, `DIVISION`, `DEPARTMENT`, `WING`, `SECTION`, `UNIT`.
- `parent_unit_id` (FK -> `organization_units.unit_id`, Nullable): Parent unit for arbitrary hierarchy nesting.
- `location_id` (FK -> `work_locations.location_id`, Nullable): Work location assignment (e.g., Head Office Balaka, Motijheel Sales Office, HSIA Terminal 1).
- `station_id` (FK -> `stations.station_id`, Nullable): Dependent physical airport station assignment (dynamically populated based on selected work location; stored as `NULL` for standalone non-airport entities).
- `letter_code` (String): e.g., `DEP-GS`, `SEC-AW`.
- `status` (String): `ACTIVE` / `INACTIVE`.
- `created_at`, `updated_at` (ISO String).
- `created_by`, `updated_by` (String).

#### 2. Sheet: `stations`
- `station_id` (PK, String: `STN-01`): Primary identifier.
- `station_code` (String, Unique): Station Code (IATA) e.g., `DAC`, `CXB`, `CGP`, `LHR`, `JED`, `RUH`, `CCU`.
- `station_icao` (String, Nullable): Station Code (ICAO) e.g., `VGHS`, `VGEG`, `VGSY`, `VECC`, `OERK`.
- `station_name` (String): Full formal station / airport name (e.g., "Hazrat Shahjalal International Airport").
- `station_location` (FK -> `work_locations.location_city`): Dependent on Location City in `work_locations`.
- `station_type` (String): Station Type configured as select dropdown: `Base`, `Home`, `Foreign Station`.
- `stn_ops_type` (String): Operational Type configured as select dropdown: `DOM`, `INTL`.
- `status` (String): Configured as select dropdown: `Active`, `Inactive`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 2.1 Sheet: `work_locations`
Represents physical premises, buildings, territories, and cities. Master geographic entity where countries and cities are registered.
- `location_id` (PK, String: `LOC-0001`): Primary unique identifier.
- `location_country` (String): e.g., "Bangladesh", "Saudi Arabia", "India".
- `location_city` (String): e.g., "Dhaka", "Chattogram", "Sylhet", "Riyadh", "Kolkata".
- `location_code` (String, Unique): e.g., `DAC-HO`, `DAC-CSO`, `DAC-APT`, `CGP-CSO`, `RUH-CITY`.
- `location_name` (String): e.g., "Head Office Balaka", "Motijheel Sales Office", "HSIA Terminal 1", "Agrabad Sales Office".
- `parent_location_id` (FK -> `work_locations.location_id`, Nullable): Parent office/location if nested under a regional administrative umbrella.
- `address` (String, Nullable): Physical street or building address.
- `status` (String): `Active` / `Inactive`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 3. Sheet: `employee_types` (Structural Workforce Classification)
Configured under the ORG tab as an organization-level classification defining employee structural types.
- `emp_type_id` (PK, String: `ETY-001`).
- `emp_type_code` (String, Unique): e.g., `PERM`, `CASUAL`, `CONT`.
- `emp_type` (String): Human readable name.
- `description` (String): Description.

#### 4. Sheet: `pay_groups`
- `pay_group_id` (PK, String: `PG-01`): Unique identifier.
- `pay_group` (String, Unique): e.g., `PG-1`, `PG-2`, `PG-3(2)`, `PG-4`, `PG-5`, `PG-6`, `PG-7`, `PG-8`, `PG-9`, `PG-10`, `PG-11`.
- `rank_level` (Integer, Unique): Numeric hierarchy rank (e.g., `1` for PG-1 up to `14` for SPL). Higher rank = senior.
- `basic_pay` (Number): Standard basic salary for payroll calculations.
- `status` (String): `ACTIVE` / `INACTIVE`.

#### 5. Sheet: `designations`
- `designation_id` (PK, String: `DSG-01`): Unique identifier.
- `design_code` (String, Unique): e.g., `MGR`, `DGM`, `AGM`, `OFR`, `SUP`, `SROFR`.
- `designation_name` (String): Full formal title.
- `short_designation` (String): Abbreviated designation.
- `status` (String): `ACTIVE` / `INACTIVE`.

#### 6. Sheet: `pay_group_designations`
Maps designations eligible for each pay group.
- `pg_designation_id` (PK, String: `PGD-01`).
- `pay_group_id` (FK -> `pay_groups.pay_group_id`).
- `designation_id` (FK -> `designations.designation_id`).
- `is_primary` (Boolean): Default `TRUE`.

#### 7. Sheet: `shifts`
- `shift_id` (PK, String: `SHF-001`).
- `dep_id` (String, FK -> `departments.dep_id` or `organization_units.unit_id`): Department binding.
- `shift_name` (String): e.g., `Morning`, `Evening`, `Night`, `Roster A`, `General`.
- `station_code` (String, FK -> `stations.station_code`): Station binding.
- `sec_letter_code` (String, Nullable): Section binding.
- `description` (String): Timing or details.
- `status` (String): `ACTIVE` / `INACTIVE`.

#### 8. Sheet: `position_establishments` (Workforce Set Up)
- `establishment_id` (PK, String: `EST-0001`).
- `directorate_code` (String): Directorate identifier.
- `department_code` (String): Department identifier.
- `station_code` (String, FK -> `stations.station_code`).
- `pay_group` (String, FK -> `pay_groups.pay_group`).
- `design_code` (String, FK -> `designations.design_code`).
- `sanctioned_posts` (Integer): Sanctioned staff count.
- `effective_from` (Date String: `YYYY-MM-DD`).
- `approval_ref` (String): Official sanction reference letter.
- `status` (String): `ACTIVE` / `INACTIVE`.

---

### 3.2 Human Resource Master Sheets (HRM)

#### 9. Sheet: `employees` (Unified Employee Master Sheet)
Single authoritative table storing all biological, personal, and employment details without requiring duplicate entries.
- `emp_id` (PK, String: `EMP-000001`).
- `staff_id` (String, Unique, NOT NULL): Primary active Staff ID (Strict Placeholder Standard: `05 Digits ID`).
- `emp_name` (String, NOT NULL): Full Name.
- `gender` (String, NOT NULL): `Male`, `Female`, `Other` (Input via dropdown).
- `department_code` (String, FK -> `departments.dep_code` or `organization_units.unit_code`).
- `dep_id` (String, Nullable): Foreign key to organization units.
- `dir_id` (String, Nullable): Foreign key to directorate organization units.
- `emp_type` (String, FK -> `employee_types.emp_type`).
- `emp_type_id` (String, Nullable): Foreign key to employee types.
- `pay_group` (String, FK -> `pay_groups.pay_group`): Baseline Pay Group.
- `contact_primary` (String, NOT NULL): Primary contact number.
- `contact_secondary` (String, Nullable): Alternate contact number.
- `contact_family` (String, Nullable): Family contact number.
- `official_email` (String, Nullable): Official airline/organization email ID.
- `personal_email` (String, NOT NULL): Personal email ID.
- `email` (String, Nullable): Universal fallback email address.
- `dob` (Date String: `YYYY-MM-DD`): Date of Birth.
- `joining_date` (Date String: `YYYY-MM-DD`): Joining date.
- `retirement_date` (Date String: `YYYY-MM-DD`): Automatically calculated by the system (`DOB + 59 years - 1 day`) and persisted to the database. **No manual input required.**
- `home_district` (String, Nullable): Home district.
- `picture_url` (String, Nullable): Employee photo / Drive ID.
- `remarks` (String, Nullable): Notes on special status or suspension.
- `status` (String): `ACTIVE`, `EXTENSION`, `RETIRED`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 12. Sheet: `placements`
- `placement_id` (PK, String: `PLC-000001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `station_code` (String, FK -> `stations.station_code`).
- `sec_letter_code` (String): Section letter code matched with station.
- `shift_name` (String): Shift matched with station and section.
- `placement_date` (Date String: `YYYY-MM-DD`).
- `status` (String): `ACTIVE` / `SUPERSEDED`.
- `created_at` (ISO String).

#### 13. Sheet: `postings`
Tracks employee geographic and physical work location transfers. Seamlessly supports both airport station-based staff and non-airport corporate/city office personnel.
- `posting_id` (PK, String: `PST-000001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `location_id` (String, FK -> `work_locations.location_id`): Work location / office.
- `location_city` (String): Denormalized city name from work locations for instant reporting.
- `station_code` (String, FK -> `stations.station_code`, Nullable): Associated airport station. **Dynamic Rule**: If the selected `work_location` is linked to an airport station (`station_id` != NULL), this field is mandatory and auto-populated. If the work location is non-airport (e.g., Head Office Balaka, Motijheel Sales Office), this field is optional/blank.
- `effective_from` (Date String: `YYYY-MM-DD` / `DD-MMM-YYYY`): Posting commencement date (Universal 8-digit input `DDMMYYYY`).
- `effective_to` (Date String, Nullable): Concluding date of posting, facilitating tenure and duration calculations.
- `status` (String): `Active` / `Inactive`.
- `posting_date` (Date String): Legacy synchronization mirror of `effective_from`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 14. Sheet: `promotion_references` (Dedicated Promotion Entity)
Eliminates repeating lengthy (>20 character) official reference strings across hundreds of individual entries.
- `ref_id` (PK, String: `REF-0001`).
- `reference_number` (String, Unique): Full official reference string (e.g., `BG/HR/PROM/2026/08871/DAC`).
- `publication_date` (Date String: `YYYY-MM-DD`): Official letter issue date.
- `remarks` (String, Nullable).
- `created_at` (ISO String).

#### 15. Sheet: `promotions`
- `promotion_id` (PK, String: `PRM-0001`).
- `ref_id` (FK -> `promotion_references.ref_id`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `sequence_number` (Integer): Order in official promotion letter (1, 2, 3...) defining same-date seniority.
- `present_pay_group` (String, FK -> `pay_groups.pay_group`).
- `promoted_pay_group` (String, FK -> `pay_groups.pay_group`).
- `promotion_date` (Date String: `YYYY-MM-DD`).
- `desig_code` (String, Nullable): Designation associated with promoted pay group.
- `created_at` (ISO String).

#### 16. Sheet: `seniority_overrides`
- `override_id` (PK, String: `SNO-0001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `pay_group` (String, FK -> `pay_groups.pay_group`).
- `override_sequence` (Integer): Admin-defined absolute seniority index.
- `reason` (String): Official justification.
- `authorized_by` (String): Admin username.
- `effective_date` (Date String: `YYYY-MM-DD`).

#### 17. Sheet: `extensions`
- `extension_id` (PK, String: `EXT-0001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `extension_from` (Date String: `YYYY-MM-DD`).
- `extension_pay_group` (String, FK -> `pay_groups.pay_group`).
- `extension_to` (Date String: `YYYY-MM-DD`).
- `approval_ref` (String, Nullable).
- `created_at` (ISO String).

#### 18. Sheet: `additional_charges`
- `charge_id` (PK, String: `ADC-0001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `from_date` (Date String: `YYYY-MM-DD`).
- `pay_group` (String, FK -> `pay_groups.pay_group`).
- `design_code` (String, FK -> `designations.design_code`).
- `to_date` (Date String, Nullable).
- `default_continue` (Boolean): Default `TRUE`.
- `created_at` (ISO String).

#### 19. Sheet: `acting_assignments`
- `acting_id` (PK, String: `ACT-0001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `from_date` (Date String: `YYYY-MM-DD`).
- `pay_group` (String, FK -> `pay_groups.pay_group`).
- `design_code` (String, FK -> `designations.design_code`).
- `to_date` (Date String, Nullable).
- `default_continue` (Boolean): Default `TRUE`.
- `created_at` (ISO String).

#### 20. Sheet: `retirement_events`
- `event_id` (PK, String: `RET-0001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `event_type` (String): `SELF_RETIREMENT`, `RESIGNATION`, `TERMINATION`, `STATUTORY`.
- `event_date` (Date String: `YYYY-MM-DD`).
- `remarks` (String, Nullable).
- `created_at` (ISO String).

#### 21. Sheet: `employee_migrations`
Tracks transitions between employment cadences (e.g., Casual to Contractual, Contractual to Permanent).
- `migration_id` (PK, String: `MIG-0001`).
- `reference_no` (String, NOT NULL): Official order / office memo reference number (e.g., `REF/2026/MIG/01`).
- `previous_staff_id` (String): Previous Staff ID (Placeholder: `05 Digits ID`).
- `present_staff_id` (String): Current Staff ID (Placeholder: `05 Digits ID`).
- `migration_type` (String, FK -> `employee_types.emp_type`).
- `migration_date` (Date String: `YYYY-MM-DD` / `DD-MMM-YYYY`): Universal 8-digit input standard `DDMMYYYY`.
- `remarks` (String, Nullable).
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 21.1 Sheet: `employee_actions` (Administrative Career Actions & Transfers)
Dedicated administrative lifecycle sheet managing departmental transfers, disciplinary/performance downgrades, redesignations, and cadre changes.
- **Architectural Isolation**: Work Location and physical workplace desk duties are strictly decoupled and governed exclusively by `work_locations` and `placements`.
- **Directorate Ancestry Resolution**: The user selects the target Department (`to_org_unit_id`). The system automatically queries `organization_units.parent_unit_id` to dynamically resolve the parent Directorate hierarchy without denormalizing or creating duplicate columns.
- **Table Schema**:
  - `action_id` (PK, String: `EAC-000001`): Primary unique identifier.
  - `reference_no` (String, NOT NULL): Official order / office order memo reference number.
  - `staff_id` (String, FK -> `employees.staff_id`): 05-digit Staff ID (Placeholder: `05 Digits ID`).
  - `action_type` (String, NOT NULL): `TRANSFER`, `DOWNGRADE`, `REDESIGNATION`, `OTHER`.
  - `from_org_unit_id` (FK -> `organization_units.unit_id`, Nullable): Current/Previous Department.
  - `to_org_unit_id` (FK -> `organization_units.unit_id`, Nullable): New Target Department.
  - `from_pay_group_id` (FK -> `pay_groups.pay_group_id`, Nullable): Current Pay Group.
  - `to_pay_group_id` (FK -> `pay_groups.pay_group_id`, Nullable): New Pay Group (e.g., in DOWNGRADE).
  - `from_designation` (String, Nullable): Current Designation.
  - `to_designation` (String, Nullable): New Designation (e.g., in REDESIGNATION or DOWNGRADE).
  - `effective_date` (Date String: `YYYY-MM-DD` / `DD-MMM-YYYY`): Universal 8-digit input standard `DDMMYYYY`.
  - `disciplinary_case_id` (FK -> `disciplinary_cases.case_id`, Nullable): Mandatory/Conditional link when `action_type === 'DOWNGRADE'`.
  - `remarks` (String, Nullable): Administrative notes, circular details, or justification.
  - `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.
- **Duplicate Protection**: Enforced in `Database.checkDuplicate` by `staff_id`, `action_type`, and `reference_no`/`effective_date`.
- **UI Integration**:
  - Registered in `HRM_FORM_SEQUENCE` as `{ key: 'employee_actions', name: 'Employee Actions', icon: 'assignment_turned_in' }`.
  - Accessible via dedicated navigation buttons in both **HRM Input Forms** and **HRM View Records** tab ribbons.
  - Auto-fills `from_org_unit_id`, `from_pay_group_id`, and `from_designation` when entering `staff_id`.
  - Displays real-time Directorate ancestry badge (`Directorate ➔ Division ➔ Department`) upon selecting `to_org_unit_id`.
  - Synchronizes changes to active employee records and canonical read models (`getEmployeesDetailsList`, `getServiceHistory`).

#### 22. Sheet: `acr_records` (Annual Confidential Reports)
- `acr_id` (PK, String: `ACR-0001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `acr_year` (Integer): e.g., `2023`, `2024`, `2025`.
- `rating` (String): `OUTSTANDING`, `VERY_GOOD`, `GOOD`, `SATISFACTORY`, `ADVERSE`.
- `is_satisfactory` (Boolean): `TRUE` if satisfactory or higher.
- `has_adverse_observation` (Boolean): `TRUE` if adverse remarks exist.
- `remarks` (String, Nullable).

#### 23. Sheet: `disciplinary_cases`
- `case_id` (PK, String: `DIS-0001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `case_type` (String): `INQUIRY`, `SHOW_CAUSE`, `WARNING`.
- `status` (String): `PENDING`, `DISMISSED`, `PENALTY_AWARDED`.
- `has_adverse_report` (Boolean): `TRUE` if adverse finding upheld.
- `opened_date` (Date String: `YYYY-MM-DD`).
- `closed_date` (Date String, Nullable).

---

### 3.3 Training, Quality & Compliance (TQC) Sheets

#### 24. Sheet: `courses`
- `course_id` (PK, String: `CRS-001`).
- `department_code` (String).
- `course_code` (String, Unique).
- `course_name` (String).
- `course_type` (String): `MANDATORY`, `REFRESHER`, `INITIAL`.
- `duration_days` (Integer).
- `validity_months` (Integer).
- `status` (String): `ACTIVE` / `INACTIVE`.

#### 25. Sheet: `training_records`
- `training_id` (PK, String: `TRN-0001`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `course_code` (String, FK -> `courses.course_code`).
- `start_date` (Date String: `YYYY-MM-DD`).
- `end_date` (Date String: `YYYY-MM-DD`).
- `expire_date` (Date String: `YYYY-MM-DD`): Calculated dynamically as `end_date + validity_months`.
- `result` (String): `PASS`, `FAIL`, `DISTINCTION`.
- `certificate_drive_id` (String, Nullable): Google Drive file ID.
- `status` (String): `VALID`, `EXPIRED`.

---

### 3.4 Payroll, System Audit & Configuration Sheets

#### 26. Sheet: `pay_periods`
- `period_id` (PK, String: `PRD-2026-09`).
- `period_name` (String): e.g., "September 2026".
- `start_date` (Date String: `2026-09-01`).
- `end_date` (Date String: `2026-09-30`).
- `status` (String): `OPEN` / `LOCKED`.

#### 27. Sheet: `payroll_calculations`
- `payroll_id` (PK, String: `PAY-0001`).
- `period_id` (FK -> `pay_periods.period_id`).
- `staff_id` (String, FK -> `employees.staff_id`).
- `pay_group` (String, FK -> `pay_groups.pay_group`): Mandatory pay group governing Overtime allowance eligibility (Groups 1 through 5 only; amount is 0 for groups above 5).
- `basic_pay` (Number).
- `attendance_days` (Integer).
- `meal_allowance` (Number).
- `overtime_hours` (Number).
- `overtime_amount` (Number): Applicable strictly to Groups 1 through 5; 0 for employees in Groups above PG-5.
- `gross_salary` (Number).
- `calculated_at` (ISO String).

#### 28. Sheet: `audit_logs`
- `audit_id` (PK, String: `AUD-0001`).
- `user_email` (String): Active session user.
- `action` (String): `INSERT`, `UPDATE`, `DELETE`, `BULK_PROMOTION`.
- `sheet_name` (String): Target worksheet.
- `record_id` (String): Affected entity primary key.
- `payload_summary` (String): JSON summary of before/after state.
- `timestamp` (ISO String).

---

## 4. Google Apps Script (GAS) Backend Service Architecture

The backend engine resides within `.gs` files executing within the Google Apps Script V8 runtime.

```
Apps Script Execution Engine (V8)
 ├── Router.gs            --> Dispatcher for client google.script.run RPC calls
 ├── Database.gs          --> Relational Sheet ORM, locking, caching, query helpers
 ├── HrmService.gs        --> Complete HRM business workflows, seniority, retirement, batch processing
 ├── OrgService.gs        --> Organizational hierarchy, dependent station/section/shift resolvers
 ├── TqcService.gs        --> Training matrix, course validity calculations
 ├── PayrollService.gs    --> Monthly allowance and salary calculation engine
 ├── ReportService.gs     --> HTML-to-PDF, Google Docs generator, print layouts
 └── AuditService.gs      --> Enterprise activity logging to audit_logs sheet
```

### 4.1 Database Access Layer (`Database.gs`)

1. **Multi-Tiered Spreadsheet Connection Fallback (`getActiveSpreadsheet`)**:
   - Connection resolution follows a resilient 3-tiered fallback sequence:
     1. `SpreadsheetApp.getActiveSpreadsheet()` (bound script context).
     2. `PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')` or `SHEET_ID`.
     3. Dedicated fallback spreadsheet ID (`DEFAULT_SPREADSHEET_ID = '1DyuriDKKaOJQurepbWJrCDnzsaiOnQxfAb-g2t8bjAw'`).
   - Ensures continuous, error-free connectivity whether running bound to a Google Sheet, executed as a standalone Apps Script Web App, or called via RPC.
2. **Transactional Locking (`LockService`)**:
   - Every mutating operation (insert, batch insert, update, soft-delete) acquires a script lock (`LockService.getScriptLock()`) with a 30-second timeout to prevent race conditions during concurrent user submissions.
3. **High-Performance Memory & Headers Cache**:
   - In-memory arrays `memoryCache` and `headersCache` cache sheet records and column mappings during request execution.
   - Master reference datasets are cached in Apps Script `CacheService` to minimize execution time.
   - Any mutating operation (`insert`, `update`, `deleteRow`) immediately invalidates affected caches via `Database.invalidateCache()`.
4. **Zero-Downtime Non-Destructive Migrations (`ensureAllTablesAndAuditColumns`)**:
   - Compares active Google Sheets against all 28 schemas in `TABLE_DEFINITIONS`.
   - Automatically inserts missing worksheets with clean, frozen header rows (bold black typography and strictly no background color).
   - Dynamically inspects existing worksheets and appends any missing columns (including standard audit fields) to Row 1 without modifying, dropping, or truncating existing data rows, while clearing any legacy header background colors.
5. **Universal Soft-Delete Architecture (`deleteRow` / `softDelete`)**:
   - Deletion checks for the presence of the `is_deleted` column.
   - If present, flags `is_deleted = true`, sets `updated_at = new Date().toISOString()`, and sets `updated_by = Session.getActiveUser().getEmail()`.
   - If not present, gracefully performs row removal.
   - Automatically emits audit events via `AuditService.log('DELETE', tableName, id, '', 'Marked deleted')`.
6. **Date Storage Standardization (Single-Quote Guard)**:
   - To eliminate Google Sheets locale-based date mangling, user-entered dates are stored prepended with a single quote: `'DD-MMM-YYYY` (e.g., `'20-Oct-2022`).
   - Timestamps are stored as `'M/d/yyyy H:mm:ss'`.
7. **Name Resolution & Table Tolerance (`TABLE_ALIASES`)**:
   - Robust normalization resolves singular, plural, and space-separated table aliases (e.g., `'workforces'` -> `'workforce_setup'`, `'employee'` -> `'employees'`, `'placement'` -> `'placements'`).

### 4.2 Core Utility & Business Calculation Engine (`Utils.gs`)

1. **Universal Date Masking & Parsing (`parseDate`, `formatDateToDDMmmYYYY`)**:
   - Accepts raw 8-digit numeric strings (`DDMMYYYY`) or ISO date strings.
   - Validates calendar dates and converts to standardized `DD-MMM-YYYY` (e.g., `20-Oct-2022`) format.
2. **Dynamic Placement Duration Engine (`calculatePlacementDuration`)**:
   - Measures exact calendar elapsed time between `startDateVal` and `endDateVal` (or current date if active).
   - Performs full calendar year, month, and day arithmetic accounting for variable days in previous months.
   - Formats strictly as two-digit padded segments: `04Y 10M 15D` (e.g., "02Y 06M 14D").
3. **Statutory Retirement Date Engine (`calculateStatutoryRetirementDate`)**:
   - Encapsulates corporate statutory formula: $\text{Retirement Date} = \text{Date of Birth} + 59\text{ Years} - 1\text{ Day}$.
   - Example: Date of Birth `20-Oct-1995` yields Statutory Retirement Date `19-Oct-2054`.
4. **Pay Group Rank Parsing & Normalization (`parsePayGroupRank`)**:
   - Parses alphanumeric pay group strings into numeric rank levels:
     - `PG-1 (Traffic Helper / TH)` -> `1.0`
     - `PG-2` -> `2.0`
     - `PG-3(1)` or `PG-3` -> `3.1`
     - `PG-3(2)` or `PG-3(II)` -> `3.2` (Supervisor rank begins here)
     - `PG-4` -> `4.0`
     - `PG-5` through `PG-15` -> `5.0` through `15.0` (Officer ranks)
5. **Role Categorization Helpers (`isPayGroup1`, `isOfficerOrSup`)**:
   - `isPayGroup1`: Identifies Pay Group 1 (Traffic Helper) employees strictly.
   - `isOfficerOrSup`: Evaluates Pay Group rank $\ge 3.2$, or titles containing "SUPERVISOR", "OFFICER", "MANAGER", "DIRECTOR", "GM", "DGM", "AGM", while strictly excluding PG-1, PG-2, and PG-3(1).
6. **Seniority Hierarchy Engine (`sortEmployeesBySeniority`)**:
   - Dynamic sorting algorithm:
     1. **Admin Seniority Overrides**: Checks `seniority_overrides` mapping first; manual override takes top priority.
     2. **Pay Group 1 (TH) Rules**: Strictly determined by **Date of Joining** (earliest joining date = rank `01`). Same-day joiners are sorted by sequence of joining or ascending Staff ID.
     3. **Pay Groups 2 and Upward Rules**:
        - **Primary**: Earlier Promotion Date (or entry date if not yet promoted).
        - **Secondary**: Ascending assigned **Sequence Number** from official promotion letter (lower number = more senior).
        - **Tertiary**: Ascending Staff ID order.
     4. **Dynamic Recalculation on Retirement**: Retired employees surrender seniority; remaining active employees in that pay group automatically and dynamically re-index upward (`01`, `02`, `03`...).

### 4.3 Authentication, Authorization & Audit Services (`AuthService.gs`, `AuditService.gs`)

1. **Role-Based Access Control (`AuthService.gs`)**:
   - Inspects `users` table against active session email (`Session.getActiveUser().getEmail()`).
   - Caches resolved role (`cachedRole`) to prevent redundant spreadsheet queries.
   - Graceful fallback: Defaults to `'SUPER_ADMIN'` for local testing, web app execution, and initial system bootstrapping.
2. **Resilient Audit Trail (`AuditService.gs`)**:
   - Connects to `audit_logs` worksheet via `Database.getActiveSpreadsheet()` fallback.
   - Safely retrieves operator email with fallback to `'System'` in headless contexts.
   - Logs `log_id`, `user_id`, `action` (`INSERT`, `UPDATE`, `DELETE`), `table_name`, `record_id`, `old_value`, `new_value`, `timestamp`.

### 4.4 Web App Router & Client RPC Bridge (`Router.gs`)

1. **Single Page Application Dispatcher (`doGet`)**:
   - Evaluates `Index.html` with page title `SANDVIORA AVIOSOLUTION | Enterprise Aviation Platform`.
   - Embeds sub-templates and CSS/JS fragments via `<?!= include('FileName'); ?>` helper.
2. **Normalized CRUD Endpoints**:
   - `api_create(tableName, data)`: Inserts record with auto-generated surrogate ID.
   - `api_read(tableName, forceRefresh)`: Reads records with caching support.
   - `api_update(tableName, pkColumn, id, data)`: Modifies existing record.
   - `api_delete(tableName, pkColumn, id)`: Soft-deletes record.
   - `api_sync_tables_and_audit()`: Invokes non-destructive schema synchronization.
3. **Specialized Business Service Endpoints**:
   - `api_get_hrm_details`: Returns unified employee list with dynamic durations and seniority.
   - `api_get_service_history`: Traces career timeline (Section/Station wise).
   - `api_get_promotion_batches`: Returns promotion reference cards.
   - `api_get_employee_promotion_report`: Produces official single-employee report.
   - `api_get_promotion_eligibility`: Computes eligibility records.
   - `api_get_workforce_setup_report`: Computes Sanctioned vs Existing vs Deficit.
   - `api_get_workforce_distribution`: Generates multi-variable distribution matrices.
   - `api_calculate_allowance`: Computes monthly gross salary, overtime, and allowances.

### 4.5 HRM Business Logic Engine (`HrmService.gs`)

#### 1. Promotion & Seniority Calculation Logic
- **Promotion Letter Reference Architecture**:
  - Upon submission of promotion data, the backend searches `promotion_references` by `reference_number`.
  - If existing, retrieves `ref_id`. If new, creates a new entry with `ref_id = generateId('REF', 'promotion_references')`.
  - Promoted records in `promotions` store `ref_id` instead of the full reference string.
- **Bulk "Multiple Employees" Promotion Parser**:
  - Receives comma-separated Staff IDs (e.g., `1001, 1004, 1025, 1088`).
  - Trims whitespace and validates existence in `employees` table.
  - Automatically assigns ascending sequence numbers `1, 2, 3, 4...` matching the entry sequence.
  - Injects records into `promotions` within a single `LockService` transaction.
- **Combined Seniority Business Logic**:
  - Implemented as a dynamic comparator function for any given Pay Group:
    ```javascript
    function calculateSeniorityOrder(employeeRecords, overrides) {
      return employeeRecords.sort((a, b) => {
        // 1. Check Admin Override
        if (overrides[a.staff_id] && overrides[b.staff_id]) {
          return overrides[a.staff_id] - overrides[b.staff_id];
        }
        if (overrides[a.staff_id]) return -1;
        if (overrides[b.staff_id]) return 1;

        // 2. Primary: Earlier Promotion Date = More Senior
        const dateA = new Date(a.latest_promotion_date || a.joining_date);
        const dateB = new Date(b.latest_promotion_date || b.joining_date);
        if (dateA.getTime() !== dateB.getTime()) {
          return dateA.getTime() - dateB.getTime();
        }

        // 3. Secondary: Lower Sequence Number = More Senior
        const seqA = a.sequence_number || 999999;
        const seqB = b.sequence_number || 999999;
        if (seqA !== seqB) {
          return seqA - seqB;
        }

        // 4. Tertiary: Ascending Staff ID
        return a.staff_id.localeCompare(b.staff_id);
      });
    }
    ```
  - Formats seniority ranks as two-digit strings (`01`, `02`, `03`...).
- **Administrative Career Actions & Canonical Reconciler**:
  - Automatically reconciles an employee's active Pay Group, Designation, and Department between `promotions` and `employee_actions` in the canonical read model (`getEmployeesDetailsList`).
  - **Date Precedence Protocol**: If an employee has an administrative action record (e.g., `DOWNGRADE`, `REDESIGNATION`) with `effective_date >= latest_promotion_date`, the action's `to_pay_group_id` dynamically governs their current active Pay Group, `to_designation` becomes their active base designation, and `to_org_unit_id` updates their home department and resolves their parent directorate.

#### 2. Dynamic Retirement Date & Status Resolution
- **Statutory Formula**:
  - Baseline Retirement Date = `DOB + 59 Years - 1 Day`.
  - Example: `DOB = 1995-10-20` -> `Statutory Retirement = 2054-10-19`.
- **Precedence Overrides**:
  - If a valid record exists in `extensions`:
    - Final displayed Retirement Date = `extension_to`.
    - Calculated Status = `Extension`.
  - If a record exists in `retirement_events` (`SELF_RETIREMENT`, `RESIGNATION`, `TERMINATION`):
    - Final displayed Retirement Date = `event_date`.
    - Calculated Status = `Retired`.
  - Default Status:
    - If `Current Date > Final Retirement Date` -> `Retired`.
    - Otherwise -> `Active`.

#### 3. Dynamic Placement Duration Calculation
- Measures the interval between `Today` and the employee's latest `placement_date`.
- Output format: Strict `04Y 10M 15D` representation.
- Calculated using full calendar year and month date arithmetic without assuming flat 30-day months.

#### 4. Service History Reconstruction Engine
- Pulls all historical assignments: `joining_date`, `placements`, `postings`, `promotions`, `employee_actions`, `acting_assignments`, `additional_charges`.
- Sorts events chronologically ascending by start date.
- Maps administrative actions into distinct milestones: `Action (TRANSFER)`, `Action (DOWNGRADE)`, `Action (REDESIGNATION)`, `Action (OTHER)` with reference numbers, official effective dates, and target departments.
- **Dynamic End Date Rule**:
  - The `end_date` of any assignment $E_i$ is calculated as $StartDate(E_{i+1}) - 1\text{ Day}$.
  - The `end_date` of the latest assignment is evaluated as `Present` (or today's date).
  - No database write is ever made to store an ending date.
- **Longest Service Summary**:
  - Aggregates cumulative duration across distinct Departments, Stations, and Positions.
  - Automatically identifies and highlights the station, section, and pay group where the employee served for the longest cumulative duration.

#### 5. Promotion Eligibility Engine
- Business Rules:
  - **Tenure in Current Pay Group**: Minimum 3 continuous years of service completed in existing pay group (calculated from latest promotion effective date, or original joining date if not yet promoted).
  - **Exclusion of ACR & Disciplinary Records**: `acr_records` (Annual Confidential Reports) and `disciplinary_cases` are explicitly **excluded** from promotion eligibility criteria.
  - **Pay Group 1 Policy Exclusion**: Employees in Pay Group 1 (`PG-1`) are strictly ineligible for promotion.
  - **Retired Workforce Exclusion**: All retired and inactive personnel are strictly filtered out from eligibility assessments.
- Output: Returns list of records with `Eligible: YES/NO` and a detailed `Comments` field articulating reasons for non-eligibility (e.g., "Tenure Deficit: Only 1Y 4M in PG-3(2); minimum 3 years required in existing pay group").

#### 6. Workforce Establishment & Analytics Engine
- **Setup Comparison**:
  - `Sanctioned`: Sum of sanctioned posts from `position_establishments` grouped by Directorate, Department, Station, Pay Group, Designation.
  - `Existing`: Real-time count of active (`status === 'ACTIVE' || status === 'EXTENSION'`), non-retired employees currently assigned.
  - `Required`: Calculated deficit: $\text{Required} = \text{Sanctioned} - \text{Existing}$.
- **Automatic Exclusion**:
  - Departments or groups with zero active personnel and zero sanctioned posts are automatically excluded from dynamic workforce views.

---

## 5. Frontend UI/UX Architecture (Vanilla HTML, CSS, JavaScript)

The entire presentation tier runs inside Google Apps Script `HtmlService`.

```
Index.html (Master Viewport Container)
 ├── Styles.html       --> Pure CSS3 Design Tokens, Glassmorphism, Layouts, Grids
 ├── Components.html   --> Modal Dialogs, Notification Toasts, Custom Dropdowns
 ├── ViewHrm.html      --> All HRM Views (Dashboard, Forms, Grids, Employee List, Promotion)
 ├── ViewOrg.html      --> ORG Setup Views
 └── Api.html          --> Client-side RPC wrappers calling google.script.run
```

### 5.1 CSS3 Design System & Theme (`Styles.html`)

- **Aesthetic Direction**: Ultra-modern corporate airline aesthetic with a deep slate/indigo palette, subtle glassmorphism (`backdrop-filter: blur(12px)`), crisp border accents, and high-contrast typography using Google Font `Inter`.
- **CSS Custom Properties**:
  ```css
  :root {
    --bg-primary: #0f172a;
    --bg-surface: #1e293b;
    --bg-surface-elevated: #334155;
    --border-subtle: rgba(255, 255, 255, 0.08);
    --border-accent: rgba(99, 102, 241, 0.4);
    --primary: #6366f1;
    --primary-hover: #4f46e5;
    --primary-glow: rgba(99, 102, 241, 0.25);
    --accent: #0ea5e9;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --transition-fast: 0.15s ease;
    --transition-normal: 0.25s ease;
  }
  ```
- **UI Compactness & Spacing Standard**:
  - **Reduced Div Padding Across All Pages**: All dashboard shells, KPI cards, analytics grids, content cards, form shells, selectable lists, and modal dialogues use compact, space-efficient padding (`0.75rem` to `1rem`, compared to legacy `1.5rem` - `2rem`).
  - **Button Styling & Padding**: All buttons across the UI (`.nav-pill-btn`, `.btn-primary-action`, `.btn-cancel`, `.sheet-tab-btn`, `.btn-danger-confirm`, `.form-tab-btn`) feature reduced top and bottom padding (`0.15rem` - `0.22rem`) with sleek, reduced border-radii (`var(--radius-sm)` / `4px`) for a compact, modern aesthetic.
  - **Navbar Typography & Branding**:
    - Organization Name font size increased by two steps (`1.15rem`, `font-weight: 900`).
    - Top navigation module buttons (`ORG`, `HRM`, `TQC`) font size increased (`0.95rem`, `font-weight: 700`).
    - "Live Sheets DB" status badge removed from the top navigation bar.
  - **Left-Hand Navigation Sidebar**:
    - Sidebar menu links font size increased by one step (`0.925rem`, `font-weight: 600`) with enlarged iconography (`1.25rem`).
  - **Enhanced Dashboard Card Typography & Spacing Standard**:
    - **KPI Summary Cards (`.kpi-card`)**:
      - Shell: Padding adjusted to `0.95rem 1.15rem` with `border-radius: var(--radius-md)`.
      - Metric Label (`.kpi-label`): Increased to `0.825rem` (`font-weight: 800`, uppercase, `letter-spacing: 0.05em`) for sharp contrast and legibility.
      - Metric Value (`.kpi-value`): Prominent bold headline figure increased to `1.85rem` (`font-weight: 800`, `margin-top: 0.25rem`).
      - Context Subtext (`.kpi-subtext`): Increased to `0.825rem` (`font-weight: 600`, `margin-top: 0.2rem`).
      - Icon Box (`.kpi-icon-box`): Scaled up to `46px x 46px` housing `26px` high-contrast iconography.
      - Grid Container (`.kpi-cards-grid`): Auto-fit columns with `minmax(220px, 1fr)` and `gap: 0.85rem`.
    - **Content Cards (`.content-card`)**:
      - Base typography increased to `0.925rem` with comfortable paragraph `line-height: 1.6`.
      - Card Title (`.card-header-title`): Scaled up to `0.975rem` (`font-weight: 800`, uppercase, `letter-spacing: 0.04em`).
      - Spacing: Header bar margin `0.85rem`, inner padding `1.1rem 1.25rem`.
    - **Quick Action Cards & Navigation Buttons (`.quick-nav-btn`)**:
      - Card navigation buttons scaled to `0.875rem` text and `20px` iconography with `0.6rem 0.85rem` padding.
    - **Service History, Workforce Distribution & Report Hub Cards**:
      - Service History summary headline cards: `1.05rem` bold titles, `0.875rem` teal subtitle identifiers.
      - Workforce Distribution matrix cards: `0.95rem` uppercase section headers, `0.875rem` row metrics.
      - Report Hub cards: `1.25rem` main title, `0.95rem` export titles, `0.825rem` descriptive labels.
  - **Left-Hand Navigation Sidebar (`.app-sidebar-panel`)**:
    - Fixed consistent width of 235px (`width: 235px; min-width: 235px; max-width: 235px;`) eliminating any visual shifting or text-wrapping across all view switches.
    - Sidebar menu links styled with clean icon-to-label alignment, smooth hover transitions, and active teal accents.
  - **Spreadsheet-Style Typography & Pure Black Data**:
    - All employee information displayed in data tables is rendered strictly in pure black text (`color: #000000 !important; font-weight: 400 !important;`) across all table cells.
- **Layout Grid**:
  - Top Navbar: 100% width, height 64px, brand logo on left, primary module switcher (`ORG`, `HRM`, `TQC`) on center/right with compact button styling.
  - Sidebar: Fixed width (235px), `white-space: nowrap`, smooth hover indicators, non-collapsing menu tree.
  - Content Stage (`.app-content-stage`): `flex: 1`, full viewport height with zero overflow clipping.
  - Dynamic Footer: Natural layout positioning with zero overlap on deep reports.

### 5.2 Universal Date Keystroke Mask (`Api.html` / `Components.html`)

An event-driven Vanilla JS input formatter attached to all date input fields:
```javascript
function attachDateInputMask(inputElement) {
  inputElement.setAttribute('placeholder', 'DDMMYYYY (e.g. 20102022)');
  inputElement.setAttribute('maxlength', '11');

  inputElement.addEventListener('input', function(e) {
    let val = this.value.replace(/[^0-9]/g, '');
    if (val.length > 8) val = val.substring(0, 8);

    if (val.length === 8) {
      const day = parseInt(val.substring(0, 2), 10);
      const month = parseInt(val.substring(2, 4), 10);
      const year = parseInt(val.substring(4, 8), 10);

      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 
                      'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        this.value = `${String(day).padStart(2, '0')}-${months[month - 1]}-${year}`;
        this.dataset.isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        this.classList.remove('input-error');
      } else {
        this.classList.add('input-error');
      }
    } else {
      this.value = val;
    }
  });

  inputElement.addEventListener('blur', function() {
    if (this.value && !this.value.includes('-')) {
      alert('Please enter a valid 8-digit date in DDMMYYYY format.');
      this.focus();
    }
  });
}
```

### 5.3 Dynamic Schemas & Form/Grid Engine (`Schemas.html`, `Components.html`)

1. **Professional Data Input Form Header Standard**:
   - Every input form across the entire application features a full, meaningful, professional header title paired with an operational subtitle describing its exact purpose and an enterprise status pill badge (`DATA INPUT FORM`), mirroring high-end enterprise portal standards (e.g., "Employee Duty Placement & Shift Assignment Form", "Employee Master Profile & Bio-Data Registration Form", "Employee Administrative Career Action (Transfer, Downgrade & Redesignation) Form", "Sanctioned Workforce Establishment & Headcount Allocation Form").
   - Concise short titles (`shortTitle` / sequence `name`) are maintained for tab ribbons and navigation pills to prevent excessive wrapping and maintain compact UI aesthetics.
2. **Normalized Lookup Display Standard**:
   - All dropdowns across every form display a single clean value (either the human-readable full name or the short letter code, never concatenating both with parenthetical codes/IDs e.g. `Flight Operations Directorate`, not `Flight Operations Directorate (DIR-01)`) while persisting normalized relational primary keys / codes (`sourceKey`) into the Google Sheets database.
3. **Dependable Dynamic Select Fields (`dependable_select`)**:
   - Supports cascading child dropdowns (e.g., Section Placement and Shift Assignment dynamically filtered by the selected Station).
4. **Universal 8-Digit Keystroke Masking (`Components.attachUniversalDateMask`)**:
   - Applied to all date inputs (`type: 'universal_date'`).
   - Automatically masks keystrokes: user types `20102022`, field displays `20-Oct-2022`, sets `dataset.isoDate = '2022-10-20'`, and visually tints borders (`#10b981` valid, `#ef4444` error).
5. **Reusable Modal & Toast Architecture**:
   - `Components.showModal` and `Components.showConfirmModal` provide stylized, animated overlay dialogues with focus management and backdrop blur.

### 5.4 Organization Module (ORG) Specification (`ViewOrg.html`)

1. **Executive Dashboard**:
   - 4 KPI Summary Cards with enhanced typography:
     - **Directorates** (`.kpi-card`: label `0.825rem`, value `1.85rem`, subtext `0.825rem`, icon box `46px x 46px` teal, dynamically counted from `organization_units` where `unit_type IN ('DIRECTORATE', 'HEADQUARTER')`).
     - **Departments** (`.kpi-card`: green, dynamically counted from `organization_units` where `unit_type IN ('DEPARTMENT', 'DIVISION')`).
     - **Stations** (`.kpi-card`: amber, flight station operations).
     - **Workforce Setups** (`.kpi-card`: purple, sanctioned post allocations).
   - Master Data & Corporate Structure Content Card (`.content-card`: title `0.975rem`, paragraph `0.925rem`).
2. **Third Normal Form (3NF) Centralized Organization Hierarchy**:
   - Eliminates redundant standalone forms for Directorates, Departments, and Sections.
   - All administrative entities are unified in `organization_units` with recursive adjacency (`parent_unit_id`), `unit_type` (`HEADQUARTER`, `DIRECTORATE`, `DIVISION`, `DEPARTMENT`, `WING`, `SECTION`, `UNIT`), `location_id`, and dependent `station_id`.
   - The master table view features an interactive **Hierarchy Tier Filter Bar**:
     `[ All Units ] [ Directorates ] [ Divisions ] [ Departments ] [ Sections / Wings ] [ Units / Teams ]`
     allowing instant single-click filtering without screen reloads or separate tabs.
3. **Streamlined 7 Core ORG Forms Sequence (`ORG_FORM_SEQUENCE`)**:
   1. `organization_units` (ORG Units Hierarchy: Directorates, Departments, Sections)
   2. `shifts` (Operational Rosters & Work Shifts)
   3. `pay_groups` (Pay Groups & Rank Hierarchy)
   4. `employee_types` (Structural Workforce Classification: Permanent, Casual, Contractual)
   5. `stations` (Flight Operational Stations: IATA, ICAO, Location Type, Domestic/International)
   6. `work_locations` (Physical Premises & Corporate Offices with Dependent Station Mapping)
   7. `workforce_setup` (Sanctioned Posts & Organogram Establishment)
4. **Work Locations & Dependent Station Management**:
   - Full master data CRUD for physical buildings and city offices.
   - Decouples physical workplaces (e.g. Balaka Head Office, Motijheel Sales Office) from flight stations.
   - Intelligent UI cascading: When a work location is non-airport, `station_id` is set to `NULL` and dependent station fields are cleanly hidden.
5. **View Forms Data Grid**:
   - Real-time tabular data grids with pagination (20 rows per page), search filtering, row edit modal, and soft-delete protocol.

### 5.5 Training, Quality & Compliance (TQC) Specification (`ViewTqc.html`)

1. **Executive Dashboard**:
   - 3 KPI Summary Cards with enhanced typography:
     - **Aviation Courses** (`.kpi-card`: purple).
     - **Completed Trainings** (`.kpi-card`: teal).
     - **Disciplinary Inquiries** (`.kpi-card`: amber).
   - Regulatory Quality & Flight Safety Standards Content Card (`.content-card`: title `0.975rem`, paragraph `0.925rem`).
2. **Input Records & View Forms**:
   - Form inputs and paginated data grids for Courses, Trainings, and Disciplinary Cases with certificate attachment support and soft-delete verification.

---

## 6. Detailed HRM Module Specifications

### 6.1 HRM Main Menu & Navigation Architecture

```
HRM (Main Menu)
 ├── Dashboard
 ├── Input Records (Single Line Form Tabs -> Instant Form View)
 ├── View Forms (Single Line Form Tabs -> Spreadsheet Table View)
 ├── Employees List (7 Sub-views, Spreadsheet-style Fullscreen)
 ├── Service History (Section Wise / Station Wise, Dynamic Timeline)
 ├── Promotion (Individual Report, All Employees, Promotion Eligibility)
 ├── Workforces (Set Up, Workforce Distribution, Analytics)
 ├── Allowance Calculation (Attendance, Meal, Overtime -> PDF)
 └── Report (Export Hub)
```

---

### 6.2 Submenu 1: Dashboard

- **UI Layout**:
  - Left Sidebar: HRM navigation options (fixed 235px width).
  - Right Stage: Rich interactive executive dashboard displaying high-visibility cards and seniority analytics.
- **Enhanced KPI Summary Cards** (Featuring Updated Typography Scale):
  - **Total Workforce**: Label `0.825rem`, Headline value `1.85rem`, Subtext "Active & Registered" `0.825rem`, Icon Box `46px x 46px` Teal (`groups`).
  - **Active On Job**: Label `0.825rem`, Headline value `1.85rem` Green, Subtext "Full Active Duty / Extension" `0.825rem`, Icon Box Green (`person_pin`).
  - **Retired Personnel**: Label `0.825rem`, Headline value `1.85rem` Amber, Subtext "Statutory & Resigned" `0.825rem`, Icon Box Amber (`person_off`).
  - **Promotion Batches**: Label `0.825rem`, Headline value `1.85rem` Purple, Subtext "Gazetted Orders" `0.825rem`, Icon Box Purple (`trending_up`).
- **Visual Analytics & Submenu Summaries**:
  - **Pay Group Seniority Breakdown Card (`.content-card`)**:
    - Card Title: `0.975rem` uppercase bold.
    - Card Header Subtitle: `0.825rem` muted bold ("Headcount per Pay Group").
    - Dynamic horizontal distribution bars with smooth gradient fills and `0.85rem` - `0.875rem` headcount figures.
  - **Quick Actions Card (`.content-card`)**:
    - Card Title: `0.975rem` uppercase bold.
    - Action item navigation buttons (`.quick-nav-btn`): `0.875rem` bold text with `20px` icons for New Data Input, Employees Spreadsheet, Promotion Intelligence, and Workforce Deficit Setup.
    - Status Footer: `0.8rem` muted indicator ("Database: Connected • Enterprise HRIS").

---

### 6.3 Submenu 2: Input Records

- **Workflow**:
  - Clicking "Input Records" opens a selectable list view in the right div.
  - User selects one of the 12 forms from the list and clicks **OK**.
  - The chosen form renders inside the same div.
  - Every form follows an identical visual format, compact labels, and concise placeholders.
  - System metadata (`created_at`, `updated_at`, `created_by`, `updated_by`) are excluded from form fields.
  - Base of form contains a primary **Save** button. Continuous entry is supported: after saving, a stylized success toast appears, the form resets, and the user can enter another record without exiting.

#### 1. Placement Form
- **Fields**:
  - `Staff ID` (Text with autocomplete lookup displaying Employee Name).
  - `Posting` (Dropdown populated from `station_code` in `stations` table).
  - `Placement` (Dependable dropdown: filters `sec_letterCode` in `organization_units` matching selected `station_code`).
  - `Shift` (Dependable dropdown: filters `shift_name` in `shifts` matching selected `station_code`).
  - `Placement Date` (Universal 8-digit date input, formatted to `DD-MMM-YYYY`).
- **Action**: Saves to `placements` sheet; updates active placement indicator.

#### 2. Employee Types Form
- **Fields**:
  - `Code of Employee Type` (Text, e.g., `PERM`, `CASUAL`).
  - `Employee Type` (Text, e.g., "Permanent", "Casual", "Contract").
  - `Description` (Text).
- **Action**: Saves to `employee_types` sheet.

#### 3. Employees Form
- **Fields**:
  - `Department Code` (Dropdown from `organization_units` / `departments`).
  - `Full Name` (Text, NOT NULL).
  - `Gender` (Dropdown: `Male`, `Female`, `Other`, NOT NULL).
  - `Staff ID` (Text, NOT NULL, Unique, Placeholder: `05 Digits ID`).
  - `Employee Type` (Dropdown from `emp_type` in `employee_types`).
  - `Pay Group` (Dropdown from `pay_group` in `pay_groups`).
  - `Contact Number` (Text, NOT NULL).
  - `Contact Number (Alternate)` (Text, Nullable).
  - `Contact Number (Family)` (Text, Nullable).
  - `Official Email` (Email format, Nullable).
  - `Personal Email` (Email format, NOT NULL).
  - `Email` (Universal fallback email, Nullable).
  - `Date Of Birth` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Joining Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Home District` (Text, Nullable).
  - `Picture` (Image upload field with Drive preview, Nullable).
  - `Remarks` (Text, Nullable).
- **Action**:
  - Saves directly to single `employees` sheet.
  - Automatically calculates statutory retirement date (`DOB + 59 years - 1 day`) and saves it to the database table (no manual input required).

#### 4. Posting Form
- **Fields**:
  - `Staff ID` (Text with autocomplete lookup).
  - `Station Code` (Dropdown from `station_code` in `stations`).
  - `Posting Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
- **Action**: Saves to `postings` sheet.

#### 5. Promotion Form (Single & Bulk "Multiple Employees")
- **Standard Single Promotion Form**:
  - `Reference No` (Text / Combobox: allows selecting existing reference or typing new >20-character official letter string).
  - `Publication Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Staff ID` (Text input).
  - `Present Pay Group` (Text / Autocomplete, no restrictive dropdown).
  - `Promoted Pay Group` (Text / Autocomplete, no restrictive dropdown).
  - `Promotion Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Multiple Entry Checkbox` (Toggle switch).
- **"Multiple Employees" Bulk Entry Mode** (When Checkbox is checked):
  - The form transitions to the bulk entry layout:
    - `Reference No` (Text).
    - `Publication Date` (Universal date input).
    - `Present Pay Group` (Uniform for the entire batch).
    - `Promoted Pay Group` (Uniform for the entire batch).
    - `Promotion Date` (Uniform for the entire batch).
    - `Multiple Staff ID` (Textarea accepting comma-separated Staff IDs, e.g., `2011, 2015, 2044, 2098`).
- **Backend Batch Processing Engine**:
  1. Resolves `Reference No` into `ref_id` inside `promotion_references` sheet.
  2. Parses the comma-separated Staff IDs into an ordered array.
  3. Iterates through the list, assigning sequential sequence numbers (`1, 2, 3...`) based strictly on input position.
  4. Commits all records to `promotions` sheet in a single batch operation.

#### 6. Extension Form
- **Fields**:
  - `Staff ID` (Text with autocomplete).
  - `Extension From` (Universal date input -> `DD-MMM-YYYY`).
  - `Extension Pay Group` (Dropdown from `pay_groups`).
  - `Extension To` (Universal date input -> `DD-MMM-YYYY`).
- **Action**: Saves to `extensions` sheet; updates employee status to `Extension`.

#### 7. Additional Charge Form
- **Fields**:
  - `Staff ID` (Text with autocomplete).
  - `From` (Universal date input -> `DD-MMM-YYYY`).
  - `Pay Group` (Dropdown from `pay_groups`).
  - `Designation` (Dropdown from `designations`).
  - `To` (Universal date input -> `DD-MMM-YYYY`, Nullable, if blank that means the employee continue this position).
  - **Action**: Saves to `additional_charges` sheet.

#### 8. Acting / In-charge Form
- **Fields**:
  - `Staff ID` (Text with autocomplete).
  - `From` (Universal date input -> `DD-MMM-YYYY`).
  - `Pay Group` (Dropdown from `pay_groups`).
  - `Designation` (Dropdown from `designations`).
  - `To` (Universal date input -> `DD-MMM-YYYY`, Nullable, if blank that means the employee continue this position).
- **Action**: Saves to `acting_assignments` sheet.

#### 9. Separation Form
- **Fields**:
  - `Staff ID` (Text with autocomplete).
  - `Date` (Universal date input -> `DD-MMM-YYYY`).
  - `Event Type` (Dropdown: `Self Retirement`, `Resignation`, `Left Job`).
  - `Remarks` (Textarea, e.g., reasons for leaving).
- **Action**: Saves to `retirement_events` sheet; updates employee status to `Retired`.

#### 10. Emp Migrations Form
- **Fields**:
  - `Reference Number` (Text, NOT NULL, e.g. `REF/2026/MIG/01`).
  - `Previous Staff ID` (Text: old casual/temporary ID, Placeholder: `05 Digits ID`).
  - `Present Staff ID` (Text: new permanent ID, Placeholder: `05 Digits ID`).
  - `Migration Type` (Dropdown from `employee_types`).
  - `Migration Date` (Universal date input -> `DD-MMM-YYYY`).
  - `Remarks` (Text).
- **Action**:
  - Saves to `employee_migrations` sheet.
  - Updates `employees` table, linking or transitioning `staff_id`.
  - Preserves complete casual placement, training, and service history.

#### 11. Set Up Form (Workforce Sanction)
- **Fields**:
  - `Station Code` (Dropdown from `stations.station_code`).
  - `Pay Group` (Dropdown from `pay_groups.pay_group`).
  - `Designation` (Dropdown from `designations.design_code`).
  - `Staff Number` (Integer: sanctioned posts).
- **Action**: Saves to `position_establishments` sheet.

#### 12. Employee Actions Form (Administrative Career Events & Transfers)
- **Fields**:
  - `Reference No` (Text, NOT NULL, official order/circular memo number).
  - `Staff ID` (Text, NOT NULL, Placeholder: `05 Digits ID` with dynamic blur auto-population).
  - `Action Type` (Dropdown: `TRANSFER`, `DOWNGRADE`, `REDESIGNATION`, `OTHER`).
  - `Previous Department` (`from_org_unit_id`, auto-populated from active employee profile).
  - `New Department` (`to_org_unit_id`, dropdown with real-time dynamic Directorate ancestry badge: `Directorate ➔ Division ➔ Department`).
  - `Current Pay Group` (`from_pay_group_id`, auto-populated).
  - `New Pay Group` (`to_pay_group_id`, selectable e.g. for Downgrades).
  - `Current Designation` (`from_designation`, auto-populated).
  - `New Designation` (`to_designation`, e.g. for Redesignation or Downgrades).
  - `Effective Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Disciplinary Case` (`disciplinary_case_id`, conditional dropdown dynamically revealed only when `Action Type === 'DOWNGRADE'`).
  - `Remarks` (Textarea).
- **Action**:
  - Saves directly to `employee_actions` sheet via transactional RPC (`api_create`).
  - Automatically updates active employee home department, pay group, and canonical read models (`getEmployeesDetailsList`, `getServiceHistory`).
- **Button Placement**: Dedicated button configured in `HRM_FORM_SEQUENCE` in both **Input Records** and **View Forms** tab ribbons.

---

### 6.4 Submenu 3: View Forms

- **Workflow**:
  - Clicking "View Forms" in the sidebar displays a selectable list view of all form categories.
  - Selecting a category and clicking **OK** opens that specific category's structured Data Grid inside the same div.
- **Top Filter & Search Bar**:
  - Top header row contains:
    - `Search By` dropdown (`Name`, `Staff ID`).
    - Search input box with placeholder "Enter search term...".
    - `Search` button.
    - `Reset` button.
- **Data Grid Features**:
  - Sleek modern table styling with smooth row hover transitions (`var(--bg-surface-elevated)`).
  - Columns display summary fields: Record ID, Creation Date, Staff ID, Employee Name, Key Details.
  - **Action Column**: Fixed on the right side of each row, containing two inline buttons:
    - **View Button**: Opens the record in an inline modal or prepopulated edit view.
    - **Delete Button**: Triggers deletion protocol.
- **Pagination Engine**:
  - Default: 20 rows per page.
  - Page size dropdown selector: `20`, `50`, `100`, `150`, `200`, `300`, `All`.
  - Bottom right: Pagination controls (Previous, Page X of Y, Next).
- **Deletion Protocol & Stylized Confirmation Modal**:
  - Clicking **Delete** opens a custom-styled, professional modal:
    - Warning icon, clear statement: *"Are you sure you want to permanently delete this record? This action cannot be undone."*
    - **Confirm Delete** and **Cancel** buttons.
  - Upon confirmation, deletes record from the sheet, refreshes the grid, and displays an animated toast:
    > **"Data successfully deleted"**
- **Edit & Update Protocol**:
  - Prepopulates form with existing record values.
  - Bottom toolbar provides **Save**, **Delete**, and **Exit** buttons.
  - Clicking **Save** commits modifications to the sheet, logs an audit trail, and displays a stylized notification:
    > **"Data successfully updated"**
  - Clicking **Exit** closes edit mode and returns to the grid.

#### Specialized Batch View for Promotion View Forms
- In the Promotion View, entries are initially sorted in reverse chronological order.
- To prevent row clutter from bulk promotion letters covering hundreds of staff, promotions are grouped into **Horizontal Summary Cards**:
  - Card displays: Official Reference Number, Effective Promotion Date, Originating Pay Group, Target Pay Group, Total Promoted Staff Count.
  - Right Action: **"View Details"** button.
  - Clicking **"View Details"** expands the card into a comprehensive tabular list matching the original input structure, where each individual staff promotion record can be individually reviewed, edited, or deleted.

---

### 6.5 Submenu 4: Employees List (Spreadsheet-Style Engine)

- **Presentation Concept**:
  - Full-screen spreadsheet emulation.
  - Compact padding on all table cells (`padding: 0.25rem 0.5rem`).
  - Auto-fit columns adjusting dynamically to content length.
  - Distinct dark slate header background with crisp contrast.
  - **Clean Non-Bold Solid Black Spreadsheet Typography**: All employee list data is rendered in authentic spreadsheet style in solid black text (`color: #000000 !important; font-weight: 400 !important;`) across all table cells.
  - **Status Formatting (Red for Retired, Green for Active, Text Stays Black)**:
    - Employees set to retire or retired are marked with a soft red badge (`badge-status-retired`) featuring a red indicator dot.
    - Active or extended employees are marked with a soft green badge (`badge-status-active`) featuring a green indicator dot.
    - In accordance with the black text rule, the text color inside the badge remains solid black (`#000000 !important; font-weight: 500`).
  - **180-Day (6 Months) Retirement Alert (Orange)**:
    - Active or employed personnel who are due to retire in 6 months (specifically when there are $\le 180$ days remaining until retirement date) have their retirement date highlighted in soft orange (`badge-retire-soon`, with orange border and indicator dot, text remaining solid black).
  - Single continuous view with vertical and horizontal scrollbars.
  - **Compact Controls & Refined Navigation Typography**:
    - Top and bottom padding in all buttons reduced across the entire application (`0.22rem` for primary/cancel buttons, `0.18rem` for nav pills, `0.16rem` for sheet tabs).
    - "Live Sheets DB" indicator removed from top navbar.
    - Organization brand name font size increased by two steps (`1.15rem`, weight 900).
    - Navbar tab pills font size increased (`0.95rem`, icons `1.15rem`).
    - Left-hand navigation pane options font size increased by one step (`0.925rem`, icons `1.25rem`).
- **Top Header Filter Toolbar**:
  - Filter 1: `Pay Group` dropdown (populates dynamically from `pay_groups`, supports All or specific PG).
  - Filter 2: `Posting` dropdown (populates from `stations.station_code`).
  - Filter 3: Text Search input (instant real-time search across Employee Name and Staff ID).
  - *(Note: The Status dropdown tab is removed from the Employee List toolbar to streamline filtering via dedicated tabs).*
- **7 Functional Sub-view Buttons**:
  1. **All Employees** (Default active view, formerly Details List)
  2. **Precise List**
  3. **On Job**
  4. **Retired**
  5. **Officer & Sup**
  6. **TH**
  7. **Pay Group** (Dynamic selection menu)

#### 1. "All Employees" Table Structure
- **Active Personnel Only**: Strictly filters out and does not show any retired employees (`status !== 'Retired'`). Retired personnel are housed exclusively in the dedicated "Retired" tab.
- `SL`: Sequential row index (auto-generated 1, 2, 3...).
- `Name`: Employee full name from `employees`.
- `Staff ID`: Active primary Staff ID.
- `Previous ID`: Old/Casual staff ID from `employee_migrations` (if applicable).
- `Pay Group`: Latest Pay Group resolved from `promotions` (or `employees.pay_group` if no promotion exists).
- `Designation`: Latest designation from `promotions` / `designations`, merged with any active additional charge or acting designations (e.g., `MGR GS, DGM GS (Add. Charge), DGM GH (Acting)`).
- `Seniority`: Auto-calculated two-digit rank (`01`, `02`...) determined by earlier promotion date and sequence number, or Admin override. Dynamically re-indexes when senior employees retire.
- `Sequence Number`: Sequence number from the promotion letter.
- `Contact Numbers`: Primary contact number (Not Null).
- `Contact Number 02`: Alternate contact number.
- `Contact Number Family`: Family contact number.
- `E-mail`: Email address.
- `Shift`: Latest `shift_name` from `placements`.
- `Placement`: Latest `sec_letterCode` from `placements`.
- `Placement Duration`: Real-time calculated duration in `04Y 10M 15D` format.
- `Posting`: Latest `station_code` from `postings` or `placements`.
- `Department`: Department letter code from `organization_units`.
- `DOB`: Formatted as `DD-MMM-YYYY`.
- `Joining Date`: Formatted as `DD-MMM-YYYY`.
- `Retirement Date`: Calculated date (`DOB + 59 years - 1 day`), or overridden by `extension_to` or `event_date` (Formatted as `DD-MMM-YYYY`).
- `Home District`: District name.
- `Status`: `Active` or `Extension` (Retired employees excluded).
- `Remarks`: Explanatory text (e.g., Resigned, Suspended, Show Caused, Maternity Leave).

#### 2. "Precise List" Table Structure
Contains condensed columns sorted strictly by Seniority (active personnel only):
`SL`, `Name`, `Staff ID`, `Pay Group`, `Designation`, `Contact Numbers`, `E-mail`, `Shift`, `Placement`, `Placement Duration`, `Posting`, `Department`, `Retirement Date`, `Remarks`.

#### 3. "On Job" Table Structure
Filters and displays only employees from the Details List whose status is **Active** or **Extension**. Excludes all retired personnel.

#### 4. "Retired" Table Structure
- Filters and displays only employees whose status is **Retired** (includes statutory retirements, self-retirements, and resignations with original remarks preserved).
- **Seniority & Sequence Number Omission**: There is no need to show the seniority or sequence number of employees who have retired or taken voluntary retirement (no longer active). Both the `Seniority` and `Sequence Number` columns are strictly excluded from the "Retired" table view.
- **Reverse Chronological Sorting**: Employees in the "Retired" tab are automatically sorted in descending order by `retirement_date` so that the most recently retired employee appears at the very top.
- **Dynamic Seniority Reallocation**: When an employee moves to the retired category, they surrender active seniority status. The remaining active employees in that pay group automatically and dynamically shift upward to fill the vacated seniority ranks (`01`, `02`, `03`...).

#### 5. "Officer & Sup" Table Structure
- Filters and displays active employees belonging to pay groups from **3(2) and all pay groups above it** (`PG-3(2)`, `PG-4`, `PG-5`, `PG-6`, `PG-7`, `PG-8`, `PG-9`, `PG-10`, `PG-11`, etc.).
- Strictly excludes lower pay groups (PG-1, PG-2, and PG-3(1)) as well as retired personnel.
- Automatically sorted hierarchically descending by pay group rank, and within each pay group ordered dynamically by seniority.

#### 6. "TH" Table Structure
- Filters and displays **strictly and exclusively Pay Group 1** (`PG-1`, `PG-01`, `1`, `TH`, Traffic Helper) employees.
- Excludes all other pay groups and retired personnel.
- **Dynamic Seniority Ordering**: Since there is no promotion provision in Pay Group 1, seniority is determined strictly by Date of Joining (earliest joining date first), and for employees joining on the same date, by sequence of joining or ascending Staff ID. Seniority numbers (`01`, `02`...) update automatically and dynamically.

#### 7. "Pay Group" Multi-Select Filter
Provides a multi-select dropdown populated from `pay_groups.pay_group` allowing instant isolation of single or multiple pay groups.

---

### 6.6 Submenu 5: Service History

- **Top View Options**:
  - Two toggle buttons on the top left:
    - **“Section Wise”**
    - **“Station Wise”**
- **Search Console**:
  - Input field labeled `Employee ID / Staff ID`, a `Submit` button, and a `Reset` button.
  - Zero default data is displayed until a valid Employee ID is submitted.
- **Dynamic Employment Timeline**:
  - Analyzes the employee's entire lifecycle from joining date to the current date.
  - Chronological table columns:
    - `SL`, `Assignment/Event`, `Department`, `Section`, `Station`, `Shift`, `Pay Group`, `Designation`, `Start Date`, `Ending Date`, `Duration`.
  - **Dynamic Ending Date Calculation**:
    - The ending date of an assignment is automatically determined by programming logic as the day prior to the joining date of the next assignment.
    - Active assignment displays `Present`.
    - Durations are calculated as `XX Years, YY Months, ZZ Days`.
- **Longest Service Analytics Card**:
  - Computes cumulative durations and generates an executive career summary:
    - **Longest Station**: e.g., "DAC - Hazrat Shahjalal Int'l Airport (08 Years, 04 Months)".
    - **Longest Section**: e.g., "Ramp Control (05 Years, 02 Months)".
    - **Longest Pay Group**: e.g., "PG-4 (04 Years, 09 Months)".

---

### 6.7 Submenu 6: Promotion

- **Top Header Action Buttons**:
  1. **“Individual Report”**
  2. **“All Employees”**
  3. **“Promotion Eligibility”**

#### 1. Individual Report Tab
- **Search Bar**: Clean `Employee ID` input field with a `Submit` button to generate the official report.
- **High-Performance Direct Query Architecture**: Direct targeted single-employee record extraction (`<100ms`) bypassing whole-workforce calculation sweeps.
- **Report Presentation (Official Corporate A4 Single-Page Full-Width Layout)**:
  - **Full-Page Sizing & Zero-Blank-Space Design**: Sized for standard A4 portrait (`210mm x 297mm`) spanning the full page width (`width: 100%`) with zero awkward margins or left blank spaces.
  - **Top Corporate Header**:
    - Centered Title: `SANDVIORA AVIOSOLUTION LTD.` (Bold uppercase, `1.5rem`).
    - Centered Subtitle: `HUMAN RESOURCES INFORMATION SYSTEM DIVISION` (Uppercase, `0.85rem`).
    - Report Identifier & Metadata: Left `REPORT ID: [Employee_Name]_[Staff_ID]` (auto-generated based on Staff ID, e.g. `Sandwip_Kumar_Das_52381`), Right `Official Documents` | `Date: [Generation Date]`.
  - **Document Title Banner**: Centered bordered banner `EMPLOYEE PROMOTION & CAREER PROGRESSION REPORT` (Bold uppercase, `1.05rem`).
  - **Section 1: EMPLOYEES BASIC INFORMATION (Balanced 4-Column Full-Width Grid)**:
    - Structured, formally bordered table spanning 100% width, eliminating awkward gaps:
      - Row 1: `FULL NAME:` (Includes red `[RETIRED]` badge if applicable) | `CURRENT PAY GROUP:`
      - Row 2: `STAFF ID:` | `CURRENT DESIGNATION:`
      - Row 3: `DIRECTORATE:` | `JOINING PAY GROUP:`
      - Row 4: `DEPARTMENT:` | `TOTAL SERVICE LENGTH:` (Formatted as `05Y 03M 10 D`)
      - Row 5: `DATE OF JOINING:` (Formatted as `DD MMM YYYY`) | `EMPLOYMENT STATUS:`
  - **Section 2: CHRONOLOGICAL PROMOTION HISTORY (Full-Width Table)**:
    - Formally bordered table spanning 100% width with clean column balance:
      - `SL` (6% width, centered, 2-digit zero padded, e.g., `01`, `02`).
      - `Previous PG & Designation` (33% width, displays designation name and pay group).
      - `Promoted PG & Designation` (33% width, displays promoted designation and pay group).
      - `Effective Date` (14% width, centered, formatted as `DD MMM YYYY`).
      - `Duration in PG` (14% width, centered, formatted as `03Y 11M 07 D`).
  - **Section 3: Bottom-Anchored Signature Block**:
    - Right-aligned signature block anchored to the bottom of the A4 page:
      - `Authorize Signature`
      - `Head Of HRIS`
      - `Sandviora Aviosolution Ltd.`
- **Export & Print Capabilities**:
  - **Save As PDF** button: Generates an official portrait PDF named `[Employee Name]_[Staff ID].pdf` spanning the entire A4 sheet.
  - **Save As Word (.docx)** button: Exports structured document matching the full-width corporate layout.
  - **Print** button: Invokes native browser print dialog with `@page { size: A4 portrait; margin: 12mm 15mm; }` ensuring clean single-page delivery.

#### 2. "All Employees" Tab
- **Tabular Grid**: Comprehensive listing of all promotion entries sorted chronologically with the most recent promotions first.
  - Chronological Promotion History Table:
    - `SL`, `Reference No`, `Previous Pay Group`, `Promoted Pay Group`, `Promotion Date`, `Seniority`, `Sequence Number`, `Duration in Pay Group`, `Remarks`.
- **Hierarchical Ordering**: Secondary sorting follows pay group `rank_level`, placing higher-ranking promotions at the top.
- **Refinement Filters**:
  - `Pay Group` dropdown.
  - `From` Date input (8-digit format -> `DD-MMM-YYYY`).
  - `To` Date input (8-digit format -> `DD-MMM-YYYY`).
  - Combining filters updates the grid in real time.

#### 3. "Promotion Eligibility" Tab
- **Policy Restrictions**:
  - Employees joining or serving in **Pay Group 1 (`PG-1`)** are strictly ineligible.
  - Retired employees are completely excluded from the assessment.
- **Evaluation Criteria**:
  - **Completed minimum 3 years of service in existing pay group** (tenure calculated from latest promotion date or joining date $\ge 3$ years).
  - **Excluded from evaluation**: `acr_records` (Annual Confidential Reports) and `disciplinary_cases` are explicitly excluded from promotion eligibility assessment.
- **Interface Structure**:
  - Top header filter allows selecting `All Employees` or specific Department/Pay Group.
  - Tabular View Columns:
    - `SL`, `Staff ID`, `Employee Name`, `Current Pay Group`, `Target Pay Group`, `Effective Date`, `Duration in PG`, `Eligible (YES/NO Badge)`, `Comments / Non-eligibility Reason`.

---

### 6.8 Submenu 7: Workforces

- **Top Navigation Options**:
  1. **“Set Up”**
  2. **“Workforce Distribution”**
  3. **“Analytics”**

#### 1. "Set Up" Tab (Sanction vs Existing vs Deficit)
- **Top Inter-Linked Dropdown Filters**:
  - `Directorate` (e.g., "All Directorates" or specific Directorate).
  - `Department` (Dynamically updates based on Directorate).
  - `Station` (Dynamically updates based on Department).
- **Dynamic Table Structure**:
  - Groups data by Pay Group and Designation.
  - Columns:
    - `Directorate`, `Department`, `Station`, `Pay Group`, `Designation`, `Sanctioned (Setup)`, `Existing (Active Personnel)`, `Required (Deficit = Sanctioned - Existing)`.
- **Dynamic Exclusion**:
  - Excludes all retired personnel from the `Existing` count.
  - Automatically omits any department or group with zero assigned personnel and zero sanctioned posts.

#### 2. "Workforce Distribution" Tab
- Customizable multi-variable workforce reporting engine:
  - Generates cross-sectional distribution matrices:
    - Staff headcount across operational shifts (`Morning`, `Evening`, `Night`, `Roster`).
    - Sectional headcount breakdown within each department.
    - Station-to-station allocation reports.

#### 3. "Analytics" Tab
- Advanced airline HR analytics model:
  - Sanctioned vs. Occupied vs. Vacancy ratios.
  - Retirement projection model (forecasts upcoming retirements over the next 1, 3, and 5 years based on DOB).
  - Pay group seniority density curves.
  - Station transfer frequency metrics.

---

### 6.9 Submenu 8: Allowance Calculation

- **Business Function**:
  - Calculates monthly gross salary based on basic pay, attendance, meal allowances, and overtime hours.
  - **Pay Group Specification & Overtime Rule**:
    - The `pay_group` must be explicitly specified for each employee calculation.
    - **Overtime allowance is applicable strictly to employees in Groups 1 through 5 (`PG-1` to `PG-5`)**.
    - Employees above Group 5 (e.g., `PG-6` and above) are strictly **not eligible** for overtime allowance (overtime amount is computed as 0.00 BDT).
- **Interactive Calculation Workflow**:
  - Select `Pay Period` (e.g., September 2026).
  - Select `Department` or `Staff ID`.
  - Form displays:
    - `Staff ID` & `Employee Name`.
    - `Pay Group` (Mandatory field, auto-populated from employee profile).
    - `Basic Pay` (Read-only, retrieved from employee's current `pay_groups.basic_pay`).
    - `Attendance Days` (Input).
    - `Meal Allowance Eligible Days` (Input, rate calculated based on corporate policy).
    - `Overtime Hours Worked` (Input).
    - `Overtime Rate` (Calculated automatically from basic pay: $\text{Rate} = \frac{\text{Basic Pay}}{200} \times 1.5$; applicable strictly to PG-1 through PG-5).
    - `Overtime Amount` (Calculated automatically; BDT 0 if Pay Group > 5).
    - `Gross Salary` (Calculated automatically in real time).
- **Reporting & Finalization**:
  - **Save & Finalize** button: Writes record to `payroll_calculations` sheet (including `pay_group`) and locks the pay period.
  - **Auto-Generate PDF** button: Produces an official pay slip and department allowance summary sheet.

---

### 6.10 Submenu 9: Report Hub

- Dedicated reporting portal consolidating exportable registers:
  - Comprehensive Employee Master Register.
  - Annual Seniority List per Pay Group.
  - Promotion Reference Gazette Register.
  - Station Workforce Deficit Report.
  - Formats: High-resolution PDF (with corporate header/footer and page numbers), Google Sheets export, and Print preview.

---

## 7. Phased Implementation Roadmap

```
PHASE 1: WORKBOOK & RELATIONAL SCHEMA SETUP
  ├── Initialize Google Sheets workbook with all 28 entity sheets
  ├── Define exact header rows and data validation rules
  └── Implement LockService and batch I/O helpers in Database.gs
       ↓
PHASE 2: CORE GAS BACKEND SERVICE LAYER
  ├── Build Router.gs and RPC dispatcher
  ├── Implement Utils.gs (8-digit date mask, sequence generators)
  └── Implement OrgService.gs (hierarchies, dependent dropdown resolvers)
       ↓
PHASE 3: HRM BUSINESS ENGINE IMPLEMENTATION
  ├── Build HrmService.gs (Employees, Promotions, Workforce, Analytics)
  ├── Implement Promotion Engine (promotion_references, bulk CSV parser)
  ├── Code Seniority Calculation (Date primary, Sequence secondary, Override)
  └── Code Retirement & Placement Duration engines
       ↓
PHASE 4: VANILLA FRONTEND CORE & DESIGN SYSTEM
  ├── Create Styles.html (custom CSS properties, glassmorphism, responsive grid)
  ├── Build Components.html (Universal date input mask, toasts, custom delete modal)
  └── Construct Topbar, Fixed Sidebar, and Viewport shell
       ↓
PHASE 5: HRM INPUT FORMS & VIEW FORMS MODULES
  ├── Build Input Records selectable list and 11 uniform forms
  ├── Build View Forms data grids, pagination (20-300/All), View/Delete actions
  └── Implement Promotion View batch-processing cards with View Details drawer
       ↓
PHASE 6: SPREADSHEET EMPLOYEES LIST & SPECIALIZED MODULES
  ├── Build fullscreen spreadsheet table (zero padding, auto-fit, 7 sub-views)
  ├── Implement Service History (Section/Station Wise, dynamic end dates, longest duration)
  ├── Implement Promotion Center (Individual Report, All Employees, Eligibility engine)
  ├── Implement Workforce Setup (Sanctioned vs Existing vs Required)
  └── Implement Allowance Calculation & PDF Report Engine
       ↓
PHASE 7: SYSTEM AUDIT, QUALITY ASSURANCE & DEPLOYMENT
  ├── Verify all date fields reject native pickers and format DD-MMM-YYYY
  ├── Test concurrent bulk promotions and sequence number assignments
  ├── Validate that Pay Group 1 and retired employees are excluded from promotion eligibility
  └── Deploy as Google Apps Script Web App (Execute as User / Me)
```

---

## 8. Verification & Acceptance Checklist

### 1. Database & Google Sheets
- [ ] All 28 worksheets exist with correct headers and standard audit fields (`created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`) in Row 1.
- [ ] Concurrency control via `LockService` prevents data collisions during simultaneous saves.
- [ ] Non-destructive schema migration engine (`Database.ensureAllTablesAndAuditColumns()`) verifies and safely synchronizes missing sheets and columns without truncating data.
- [ ] Soft deletion successfully marks `is_deleted = true` with user email and timestamp instead of permanent data loss.
- [ ] Lengthy promotion reference numbers are normalized into `promotion_references` using surrogate `ref_id`.
- [ ] Date persistence stores prepended single quotes (`'DD-MMM-YYYY`) to prevent spreadsheet locale auto-formatting corruption.

### 2. Universal Date Standard
- [ ] Zero datepickers exist in any form or view across the entire application.
- [ ] Inputting `20102022` automatically displays `20-Oct-2022` and stores `2022-10-20`.
- [ ] Invalid calendar dates (e.g., `31022023`) are flagged with an error state.

### 3. Dashboard Card Typography & Visual Legibility
- [ ] All KPI cards across HRM, ORG, and TQC dashboards render with enhanced font sizing:
  - Metric labels styled at `0.825rem` (`font-weight: 800`, uppercase, `letter-spacing: 0.05em`).
  - Metric values prominently bold at `1.85rem` (`font-weight: 800`).
  - Metric subtext styled at `0.825rem` (`font-weight: 600`).
  - Icon boxes expanded to `46px x 46px` housing `26px` icons.
- [ ] All content cards render with `0.925rem` body text, `1.6` line-height, and `0.975rem` uppercase bold card header titles.
- [ ] Quick navigation action buttons feature `0.875rem` bold text with `20px` iconography.
- [ ] Service history cards render with `1.05rem` headline titles and `0.875rem` teal identifiers.
- [ ] Workforce distribution cards render with `0.95rem` section headers and `0.875rem` row metrics.
- [ ] Report Hub cards render with `1.25rem` main title, `0.95rem` export titles, and `0.825rem` descriptions.
- [ ] Navigation sidebar maintains fixed immutable width of `235px` with zero text wrapping.

### 4. Input Records & View Forms
- [ ] All dropdowns display human-readable titles while storing normalized IDs/codes in Google Sheets.
- [ ] Redundant `"Form"` suffix is eliminated from all schema and view titles.
- [ ] Selecting any form from the selectable list and clicking OK opens that form in the right div.
- [ ] Dedicated **"Employee Actions"** button is placed in `HRM_FORM_SEQUENCE` in both Input Records and View Forms tab ribbons.
- [ ] Typing 5-digit Staff ID in Employee Actions form automatically pre-fills previous department, current pay group, and designation.
- [ ] Selecting target department in Employee Actions form displays real-time dynamic Directorate ancestry badge (`Directorate ➔ Division ➔ Department`).
- [ ] Selecting `Action Type === 'DOWNGRADE'` dynamically reveals the conditional `disciplinary_case_id` selector.
- [ ] Employee migrations form features `Reference Number` as first field, with standardized `'05 Digits ID'` placeholder.
- [ ] Saving updates the relevant sheet and leaves the form ready for continuous entry.
- [ ] Pagination operates correctly across 20, 50, 100, 150, 200, 300, and "All".
- [ ] Deletion triggers a stylized confirmation modal and displays "Data successfully deleted".
- [ ] Bulk promotion entry parses comma-separated Staff IDs and assigns sequence numbers (1, 2, 3...) sequentially.
- [ ] Promotion View Forms display consolidated horizontal cards with "View Details" expansion.

### 5. Employees List
- [ ] Full-screen spreadsheet view renders with compact cell padding and auto-fitting columns.
- [ ] All employee table cells render strictly with pure black text (`color: #000000 !important; font-weight: 400 !important;`).
- [ ] Status of employees set to retire or retired appears in red (`badge-status-retired`), while active employees appear in green (`badge-status-active`), with text color strictly remaining black.
- [ ] For employees active or employed due to retire in 6 months ($\le 180$ days remaining), retirement date cell turns orange (`badge-retire-soon`) with black text.
- [ ] Details List strictly excludes retired employees (retired personnel appear exclusively in the Retired tab).
- [ ] Status dropdown tab is removed from the Employee List toolbar.
- [ ] 7 functional buttons ("Details List", "Precise List", "On Job", "Retired", "Officer & Sup", "TH", and "Pay Group") filter accurately.
- [ ] "Officer & Sup" tab displays active employees belonging to pay groups from 3(2) and all pay groups above it (PG-3(2), PG-4, PG-5...) and excludes PG-1, PG-2, and PG-3(1).
- [ ] "TH" tab displays strictly and exclusively Pay Group 1 employees.
- [ ] Dynamic Seniority Shift on Retirement: When a senior employee retires, they surrender seniority and move to the retired category; active employees in that pay group dynamically shift up (`01`, `02`...).
- [ ] Pay Group 1 seniority calculates automatically and dynamically based on Date of Joining (earlier joining date = senior), and for same-day joiners, by sequence of joining or ascending Staff ID.
- [ ] Retired tab strictly omits both "Seniority" and "Sequence Number" columns (no active seniority for retired employees).
- [ ] Retired tab arranges employees with the most recent retirement appearing at the top (sorted by retirement date descending).
- [ ] Seniority for PG-2 and above auto-calculates based on earlier promotion date, then sequence number, with admin override support.
- [ ] Retirement Date calculates as `DOB + 59 years - 1 day` unless adjusted by extension or self-retirement.
- [ ] Placement duration outputs precisely in `04Y 10M 15D` format.

### 6. Service History & Promotion Modules
- [ ] Service history dynamically computes assignment ending dates (no ending dates stored in database).
- [ ] Longest service in station, section, and pay group is accurately calculated.
- [ ] Pay Group 1 employees are strictly excluded from promotion eligibility.
- [ ] Promotion eligibility requires minimum 3 years of service in current pay group; ACR records and disciplinary cases are strictly excluded from eligibility criteria.
- [ ] Individual Promotion Report generates at high speed (<100ms) with direct targeted lookup.
- [ ] Individual Promotion Report spans the entire page on standard A4 portrait without left blank spaces, using a balanced 4-column corporate table, full-width promotion history, and bottom-anchored authorized signature block.
- [ ] Exports PDF/Word named `[Employee Name]_[Staff ID]`.

### 7. Workforce & Allowance Calculation
- [ ] Setup correctly computes `Required = Sanctioned - Existing`.
- [ ] Retired personnel are strictly excluded from active workforce and vacancy calculations.
- [ ] Allowance calculation requires explicit specification of Pay Group.
- [ ] Overtime allowance is applicable strictly to employees in Groups 1 through 5 (`PG-1` to `PG-5`); employees above Group 5 are strictly ineligible (0.00 BDT).
- [ ] Monthly salary calculator accurately factors basic pay, attendance, meal allowance, and overtime into auto-generated PDF pay slips.
- [ ] Frontend consists purely of native HTML, CSS, and JavaScript with zero external frameworks.
- [ ] All page container divs, forms, and cards feature compact spacing; top navigation buttons feature reduced border-radius.
