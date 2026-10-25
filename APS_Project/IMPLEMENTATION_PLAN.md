# SANDVIORA AVIOSOLUTION — ENTERPRISE HRM & WORKFORCE MANAGEMENT
## Comprehensive Implementation Plan & Technical Blueprint
### Google Apps Script (GAS) Backend & Google Sheets Database Architecture with Vanilla HTML/CSS/JS Frontend

---

## 📌 Last Modification & Architectural Fixes Log (Active System Status)

### 1. Universal Record Edit & Update Fix across All View Forms & Tables
- **Root Cause Identified**: 
  1. Record editing was failing due to self-duplicate collisions in `Database.checkDuplicate()`. When an existing row was edited, `isCurrent(r)` failed to recognize the record being edited because `excludeRowNumber` was not passed, causing the system to falsely flag the record as an identical duplicate of itself.
  2. `Database.update()` strictly expected `headers.indexOf(pkColumn.toLowerCase())` to be an exact match. If casing, aliases, or column naming differed (e.g. `setup_id` vs `id` vs `#1`), an unhandled exception `"Primary key column ... not found"` or `"Record with ID ... not found"` was thrown.
  3. `Router.api_update` routed employee updates through `HrmService.saveEmployee()`, which strictly required `staff_id` and `emp_name` and wiped all non-provided columns with empty strings, causing partial edits or view-form edits to crash.
- **Architectural Fixes Implemented**:
  - **Self-Duplicate Bypass via Row Number (`targetRow`)**: `Database.update` now passes the verified `targetRow` as `excludeRowNumber` to `checkDuplicate()`. In-memory verification instantly identifies the active record being modified and ignores it during collision checks while still validating against all other table rows.
  - **Multi-Strategy Primary Key & Row Locator**: `Database.update()` and `Database.deleteRow()` now employ a 3-tier resolution strategy:
    1. Case- and punctuation-insensitive match on `pkColumn` and common aliases (`id`, `tableName_id`).
    2. Primary key column scan followed by Column 1 scan fallback.
    3. Explicit sheet row number fallback (`#rowNumber` and integer parsing).
  - **Universal Partial Update for Employees**: `api_update` now utilizes `Database.update()` directly for `employees`, preserving all existing profile fields, auto-calculating statutory retirement date when `dob` is modified, and eliminating the brittle `saveEmployee` crash.
  - **Flexible Client-Side Edit Record Resolution**: Both `ViewOrg.html` and `ViewHrm.html` now locate records in client cache flexibly using type-coerced case-insensitive matching across `schema.pk`, `id`, and `_rowNumber`.
  - **Duplicate Modal Interception on Edit**: If an edit truly collides with another distinct record, the user receives the rich `Components.showDuplicateModal` alert instead of a silent failure.

### 2. Duty Pattern (`duty_pattern`) vs. Operational Shift (`shift_name`) Separation & Shifts Station Decoupling
- **Architectural Shift & Domain Distinction**:
  1. **Workforce Setup (`workforce_setup`) — Macro Budgeting Domain**:
     - Manages approved establishment posts per Department / Section and Pay Group.
     - Shift requirement is now formally captured as **`duty_pattern`** (`General (Office Timing)`, `4-Shift (24/7 Roster)`, `3-Shift (Day/Evening/Night)`, `2-Shift (Day/Night)`, `Roster / Variable`).
     - Decoupled from concrete operational shift teams (`Shift-A`, `Shift-B`) so that a single sanctioned row (e.g. 4 Deputy Managers for 4 shifts) cleanly represents the post's operational schedule pattern without duplicate row inflation.
     - Backward compatibility guaranteed via automatic syncing between `duty_pattern` and legacy `shift_type`.
  2. **Shifts Master (`shifts`) — Operational Rostering Domain**:
     - Removed `station_code` and `station_id` from the `shifts` table definition, input forms, and uniqueness validation. Shifts are now bounded to Department / Unit and Section, removing artificial station coupling.
     - Added optional `duty_pattern` classifier to shifts (`shifts.duty_pattern`), bridging operational shift teams (`4-Shift-A`, `4-Shift-B`) with their parent duty pattern (`4-Shift`).
     - Added automatic column migration (`Database.cleanObsoleteShiftColumns()` and `Router.api_clean_obsolete_shift_columns()`) to drop obsolete `station_code`, `station_id`, and `dep_id` columns from Google Sheets.
  3. **HRM Placements (`placements`) — Operational Scheduling Domain**:
     - Retains concrete `shift_name` (linked to `shifts` master) to record the exact roster team assignment (`4-Shift-A`, `4-Shift-B`, `General Shift`) for active employees.
  4. **Workforce Sanction vs. Actual Report (`HrmService.getWorkforceSetupReport`)**:
     - Updated to display `Duty Pattern` and aggregate active employees placed across shift teams (`4-Shift-A`, `B`, `C`, `D`) against the budgeted `4-Shift` post.
     - Live vacancy calculation accurately highlights shift-level deficits.

---

## 1. Executive Summary & Architectural Shift

This implementation plan establishes the architectural and technical specification for the **SANDVIORA AVIOSOLUTION** Human Resource Management (HRM), Organization (ORG), Training Quality & Compliance (TQC), and Workforce Management platform.

### Requirement Update: Pay Groups, Designations, Hierarchy & Workforce

Maintain `pay_groups` and `designations` as separate master tables. `pay_groups` contains `pg_id` (PK), unique `pg_category`, unique `pay_group`, integer `rank_level`, status, and audit fields. Its input form captures Level Name/Category (e.g. Admin, Tech, IT), Pay Group (e.g. PG-1, PG-10), Rank Level, and Active/Inactive status. `designations` contains `deg_id` (PK), `unit_id` (FK to `organization_units.unit_id`), `pg_category` (FK to `pay_groups.pg_category`), `pay_group`, `designation`, `designation_short`, status, and audit fields (`created_at`, `created_by`, `updated_at`, `updated_by`, `is_deleted`); its input form captures Department (dropdown showing `unit_name` from departments only, saved as `unit_id`), Pay Group Category (dropdown from `pg_category`), Pay Group (dropdown from `pay_group`), Designation (placeholder `' '`), Short Designation (placeholder `' '`), and Status (Active/Inactive).

Use the recursive `organization_units` tree as the source of truth for MD & CEO -> Directorate -> Department/Division -> Wing/Section/Unit/Team. Explicit hierarchy type and parent linkage allow administrators to manage the complete supplied organization structure without hardcoded branches. Employee home unit and current placement unit are separate. `workforce_setup` records sanctioned posts for a unit, designation/pay group, station, and optional duty position; actual active headcount is computed from employee assignments. Reports should show sanctioned, actual, vacancy, and over-strength counts per unit and roll up descendants to directorates. Reject self-parenting/cycles and deactivate referenced units instead of deleting them.

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
11. **Strict Input Field Label Consistency (Relational Label Symmetry & User Experience Standard)**:
    - When a data attribute or relational foreign key represents the same underlying entity across multiple modules or forms (e.g., Station, Work Location, Organization Unit, Pay Group, Designation, Duty Position, Shift Assignment, Section/Wing, Staff ID, Employee Type, City, Effective From/To, Reference Number), its display label (`label`) MUST be 100% IDENTICAL across all input forms, view tables, and edit dialogs.
    - Identical labeling gives users immediate cognitive recognition that two fields are relationally linked and share the exact same entity origin.
    - **Standardized Unified Labels**:
      - `Station (Airport Base)`: Used universally across Placements, Postings, Workforce Setup, Shifts, Organization Units, Sections, and Work Locations.
      - `Work Location`: Used universally across Placements, Postings, Organization Units, Sections, and Work Locations.
      - `Organization Unit`: Used universally across Placements, Employees, Workforce Setup, Shifts, Pay Groups, Courses, Organization Units, and Sections.
      - `Pay Group`: Used universally across Employees, Extensions, Additional Charges, Acting Assignments, Workforce Setup, Pay Groups, and Promotions.
      - `Designation`: Used universally across Employees, Additional Charges, Acting Assignments, Workforce Setup, and Pay Groups.
      - `Duty Position`: Used universally across Placements, Workforce Setup, and Positions.
      - `Shift Assignment`: Used universally across Placements and Shifts.
      - `Section / Wing Letter Code`: Used universally across Placements, Shifts, Organization Units, Directorates, Departments, and Sections.
      - `City`: Used universally across Postings, Stations, and Work Locations.
      - `Staff ID`: Used universally across all employee transactional forms (Placements, Postings, Promotions, Extensions, Additional Charges, Acting, Separation, Migrations, Actions, Trainings, Disciplinary Cases).
      - `Employee Type`: Used universally across Employee Types, Employees, and Employee Migrations.
      - `Effective From` & `Effective To`: Used universally for all assignment commencement and conclusion dates across Placements (`placement_date`), Postings (`effective_from`), Extensions, Additional Charges, Acting Assignments, and Employee Actions.
      - `Reference Number`: Used universally across Promotions, Employee Migrations, and Employee Actions.
      - `Remarks`: Used universally across all forms requiring explanatory commentary.
    - **Dropdown Option Display Standards**:
      - `Parent Unit (Organization Unit)` dropdown options display strictly the clean full entity title (e.g., `Directorate of Flight Operations`) without bracketed hierarchy tags (`[DIRECTORATE]`) or unit code suffixes (`(DIR-FO)`).
      - `Work Location` dropdown options display strictly the clean full premises name (e.g., `Head Office`, `Balaka Bhaban`, `Hangar Complex`) without station bracket prefixes (`[DAC]`) or parenthesized city tags.
12. **End-to-End Cross-File Synchronization Protocol**:
    - Architectural and schema modifications must NEVER be applied in isolation to a single sheet or isolated script file.
    - Any change to fields, labels, relationships, or business logic must be simultaneously and consistently updated across all affected components:
      - Front-end Schemas (`Schemas.html`)
      - Backend Data Definitions (`Database.gs`)
      - Business Logic and Aggregation Services (`HrmService.gs`, `OrgService.gs`, `TqcService.gs`, `Utils.gs`, `Router.gs`)
      - View Modules and Grid Renderers (`ViewOrg.html`, `ViewHrm.html`, `ViewTqc.html`)
      - System Architecture Blueprint (`IMPLEMENTATION_PLAN.md`)

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
|  [persons]              |      |                                                                   |
|      |                  |      |                                                                   |
|      +-- [staff_identities]    |                                                                   |
|      |          |              |                                                                   |
|      +-- [employees]           |                                                                   |
|      |          |              |                                                                   |
|      +-- [placements] ---------+                                                                   |
|      +-- [postings] -----------+                                                                   |
|      +-- [promotion_references] <---+                                                              |
|      +-- [promotions] --------------+                                                              |
|      +-- [extensions]                                                                              |
|      +-- [additional_charges]                                                                      |
|      +-- [acting_assignments]                                                                      |
|      +-- [retirement_events]                                                                       |
|      +-- [employee_migrations]                                                                     |
|      +-- [seniority_overrides]                                                                     |
|      +-- [acr_records] & [disciplinary_cases]                                                      |
|      +-- [courses] & [training_records]                                                            |
|      +-- [payroll_calculations] & [audit_logs]                                                     |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

### 3.1 Organization Master Sheets (ORG) — Normalized 3NF Architecture

#### 1. Sheet: `organization_units`
Stores the complete recursive multi-tiered corporate hierarchy for all **9 Directorates** (Directorates, Divisions, Departments, Wings, Sections, Sub-sections, Cells, Teams) driven purely by `parent_unit_id`.
- `unit_id` (PK, String: `OU-CSD-001`): Unique identifier.
- `unit_code` (String, Unique): e.g., `DIR-CS`, `DEP-AS`, `WING-AW`, `SEC-RAMP`.
- `unit_name` (String): e.g., "Customer Services Directorate", "Airport Services Department", "Above Wing", "Ramp Control".
- `parent_unit_id` (FK -> `organization_units.unit_id`, Nullable): Immediate superior unit for recursive corporate organogram tree nesting. Apex entities (`MD & CEO` or Root Directorates) have `NULL`/empty. Dynamically displays a clean indented tree (`↳ Unit Name`) without redundant type tags.
- `station_id` (FK -> `stations.station_code`, Nullable): Associated airport flight station if station-specific (e.g., `DAC`, `CGP`, `CXB`). Displays strictly the clean 3-letter IATA code.
- `location_id` (FK -> `work_locations.location_id`, Nullable): Physical workplace premises.
- `letter_code` (String): e.g., `CSD`, `AS`, `AW`, `LM`.
- `status` (String): `ACTIVE` / `INACTIVE`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

> [!IMPORTANT]
> **Consolidated 3NF Table Architecture & Legacy Cleanup**:
> Legacy tables `directorates`, `departments`, and `sections` have been completely removed from active database operations and schemas. All organizational hierarchy levels are unified under `organization_units`. In all dropdown selectors across the entire application (ORG, HRM, TQC):
> 1. All controls strictly display **a single clean piece of data** (e.g. clean Shift Name without timings, clean Pay Group code without designations, clean Designation without unit tags, clean 3-letter Station code).
> 2. Whenever Pay Group is rendered in ANY dropdown (create forms, edit modals, cascading filters, spreadsheet filters, promo filters), duplicate pay group codes (e.g. repeated `PG-10`, `PG-9`, `PG-6`) are **strictly eliminated**. Each statutory Pay Group code appears **exactly once**, sorted in standard statutory precedence (`PG-1`, `PG-3(2)`, `PG-4`, `PG-5`, `PG-6`, `PG-7`, `PG-8`, `PG-9`, `PG-10`, `PG-11`, `PG-12`, `LOCAL`). Relational database integrity is preserved: database columns store normalized foreign keys (`sourceKey`) while UI components cleanly render display labels.

#### 2. Sheet: `positions` (Functional Roles & In-Charge Duty Titles)
Decouples operational leadership roles, duty titles, and in-charge responsibilities from static pay groups and substantive designations.
- `position_id` (PK, String: `POS-001`): Primary identifier.
- `position_title` (String, Unique): e.g., "Station Manager", "District Manager", "Country Manager", "Regional Manager", "In-charge Above Wing", "In-charge Below Wing", "Turn Around Coordinator (Red Cap)", "Ramp Controller", "Duty Manager".
- `position_code` (String, Unique): e.g., `POS-SM`, `POS-DM`, `POS-IC-AW`, `POS-RED-CAP`.
- `position_category` (String): `Head of Station`, `Functional Head`, `Shift In-Charge`, `Operational Duty`, `Technical / Maintenance`, `Administrative`.
- `min_pg_id` (String, FK -> `pay_groups.pay_group`, Nullable): Minimum permissible pay grade (e.g., `PG-6`). Dropdowns display strictly the single Pay Group code.
- `max_pg_id` (String, FK -> `pay_groups.pay_group`, Nullable): Maximum permissible pay grade (e.g., `PG-8`). Dropdowns display strictly the single Pay Group code.
- `description` (String, Nullable): Duty responsibilities and terms of reference.
- `status` (String): `ACTIVE` / `INACTIVE`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 3. Sheet: `pay_groups` (Statutory Scale, Designation & Reporting Boss Hierarchy Master)
Unified master combining statutory compensation scale, substantive cadre designation, short code, seniority precedence, organizational unit linkage, and immediate supervisory reporting lines.
- `pg_id` (PK, String: `PGR-0001`): Primary identifier.
- `unit_id` (String, FK -> `organization_units.unit_id`, Nullable): Department or Directorate to which this designation belongs. If left empty/null, applies organization-wide.
- `pay_group` (String, NOT NULL): Pay grade scale (`PG-1`, `PG-3(2)`, `PG-4`, `PG-5`, `PG-6`, `PG-7`, `PG-8`, `PG-9`, `PG-10`, `PG-11`, `PG-12`, `LOCAL`).
- `designation` (String, NOT NULL): Official substantive title, e.g., "Passenger Service Officer", "Assistant Manager", "Deputy General Manager", "General Manager".
- `designation_short` (String, Nullable): Acronym/short code, e.g., `PSO`, `AM`, `MGR`, `DGM`, `GM`.
- `reports_to_pg_id` (String, FK -> `pay_groups.pg_id`, Nullable): Immediate Reporting Boss. Dropdown displays strictly the clean single Designation title.
- `rank_level` (Integer, Nullable): Numeric precedence rank (`12` down to `1`). Auto-filled based on statutory Pay Group.
- `status` (String): `ACTIVE` / `INACTIVE`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 4. Sheet: `designations` (Substantive Designations Master)
Maintains department-specific and corporate substantive designations linked to pay groups and departmental hierarchy.
- `deg_id` (PK, String: `DEG-0001`): Unique designation identifier.
- `unit_id` (FK -> `organization_units.unit_id`): Department to which this designation belongs. Dropdown presents only departments (`unit_name`) and stores `unit_id`. Shown in view forms and grids as department name.
- `pg_category` (FK -> `pay_groups.pg_category`): Category of the pay group (e.g., Admin, Tech, IT).
- `pay_group` (String): Associated pay scale grade (e.g., `PG-1`, `PG-10`).
- `designation` (String, NOT NULL): Official designation title.
- `designation_short` (String, Nullable): Abbreviated designation title.
- `status` (String, NOT NULL): `Active` / `Inactive`.
- `created_at`, `created_by`, `updated_at`, `updated_by`, `is_deleted`.

#### 5. Sheet: `workforce_setup` (Sanctioned Workforce Establishment)
Defines approved organogram quotas, sanctioned posts, and shift patterns across stations and organizational units.
- `setup_id` (PK, String: `SET-0001`): Unique identifier.
- `unit_id` (FK -> `organization_units.unit_id`): Department, Wing, Section, or Directorate Unit.
- `station_code` / `station_id` (FK -> `stations.station_code`, Nullable): Operating airport flight station (`DAC`, `CGP`, `LHR`). Left blank for Corporate Head Office posts.
- `position_id` (FK -> `positions.position_title`, Nullable): Approved duty role. Optional (defaults to Designation).
- `pay_group` (FK -> `pay_groups.pay_group`): Sanctioned remuneration grade.
- `designation` (String, NOT NULL): Substantive designation title.
- `sanctioned_posts` (Integer): Total sanctioned post quota.
- `staff_number` / `set_up` (Integer): Backward-compatible mirrors of `sanctioned_posts`.
- `shift_type` (String, Nullable): Duty Shift Name dynamically loaded from `shifts` table.
- `remarks` (String, Nullable): Organogram approval manual reference.
- `dir_id`, `dep_id`: Ancestral Directorate and Department auto-resolved upon insert/update.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 6. Sheet: `stations` (Operational Flight Stations & Airport Bases)
Maintains IATA airport codes, domestic bases, and international flight stations.
- `station_id` (PK, String: `STN-0001`): Primary identifier.
- `station_code` (String, Unique, NOT NULL): 3-letter IATA code (`DAC`, `CGP`, `ZYL`, `CXB`, `DXB`, `LHR`).
- `station_icao` (String, Nullable): ICAO airport identifier (`VGHS`, `EGLL`).
- `station_name` (String, NOT NULL): Official airport title.
- `station_type` (String, NOT NULL): `Base`, `Home`, `Foreign Station`, `Foreign Station (Offline)`.
- `stn_ops_type` (String, NOT NULL): `Domestic` / `International`.
- `city` (String, NOT NULL): Host city (`Dhaka`, `Chattogram`, `London`).
- `status` (String, NOT NULL): `Active` / `Inactive`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 7. Sheet: `work_locations` (Physical Premises, Terminals & Corporate Facilities)
Registers physical workplace buildings, airport offices, and corporate premises.
- `location_id` (PK, String: `LOC-0001`): Primary unique identifier.
- `location_code` (String, Unique, NOT NULL): e.g., `101`, `102`.
- `location_name` (String, NOT NULL): e.g., "Balaka Bhaban", "Terminal 1 (HSIA)".
- `location_type` (String, NOT NULL): `Head Office`, `Airport Terminal`, `City Office`, etc.
- `station_id` (FK -> `stations.station_code`, Nullable): Associated airport flight station.
- `city` (String, FK -> `stations.city`, NOT NULL): Physical city.
- `region` (String, Nullable): Territory options.
- `country` (String, Nullable): Sovereign nation.
- `status` (String, NOT NULL): `Active` / `Inactive`.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

#### 8. Sheet: `shifts` (Operational Work Shifts & Duty Rosters)
Defines operational duty shifts per station and department.
- `shift_id` (PK, String: `SHF-0001`): Primary identifier.
- `unit_id` (FK -> `organization_units.unit_id`): Department or Wing managing the shift.
- `station_code` (FK -> `stations.station_code`): Operating airport station.
- `shift_code` (Number): Shift code number.
- `shift_name` (String): Clean shift name (e.g., `Morning`, `Night`, `General`, `A`, `B`).
- `shift_description` (String, Nullable): Shift timings and details.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

---

### 3.2 Human Resource Master Sheets (HRM)

#### 8. Sheet: `persons`
Decouples biological human data from changing staff numbers or contracts.
- `person_id` (PK, String: `PER-000001`).
- `full_name` (String): Complete legal name.
- `dob` (Date String: `YYYY-MM-DD`).
- `gender` (String, NOT NULL): Gender.
- `contact_primary` (String, NOT NULL): Primary contact number.
- `contact_alternate` (String, Nullable): Secondary contact number.
- `contact_family` (String, Nullable): Family contact number.
- `email` (String, Nullable): Work or personal email.
- `home_district` (String, Nullable): Home district.
- `picture_drive_id` (String, Nullable): Google Drive File ID for employee photo.
- `remarks` (String, Nullable): Notes on special status or suspension.
- `created_at`, `updated_at` (ISO String).

#### 9. Sheet: `staff_identities`
Allows seamless transition from Casual to Permanent staff IDs without losing history.
- `identity_id` (PK, String: `IDN-0001`).
- `person_id` (FK -> `persons.person_id`).
- `staff_id` (String, Unique): e.g., `C-1024` or `B-5588`.
- `identity_type` (String): `PERMANENT` / `CASUAL` / `CONTRACT`.
- `is_primary` (Boolean): Current operational identity.
- `valid_from` (Date String: `YYYY-MM-DD`).
- `valid_to` (Date String, Nullable).

#### 10. Sheet: `employee_types`
- `emp_type_id` (PK, String: `TYP-001`).
- `type_code` (String, Unique): e.g., `PERM`, `CASUAL`, `CONT`.
- `emp_type` (String): Human readable name.
- `description` (String): Description.

#### 11. Sheet: `employees` (Core Profile)
- `emp_id` (PK, String: `EMP-0001`).
- `staff_id` (String, Unique): Primary active 5-digit Staff ID.
- `emp_name` (String): Full employee name.
- `gender` (String): `Male` / `Female` / `Other`.
- `dep_id` (String, FK -> `organization_units.unit_id`): Home organizational unit identifier.
- `department_code` (String, FK -> `organization_units.unit_code`): Home Organization (Directorate / Department).
- `emp_type` (String, FK -> `employee_types.emp_type`): Service classification (Permanent, Contractual, Casual, Trainee).
- `emp_type_id` (String, FK -> `employee_types.emp_type_id`).
- `pay_group` (String, FK -> `pay_groups.pay_group`): Pay scale grade (e.g. `PG-7`).
- `designation` (String): Official substantive designation title tied to the employee's department.
- `contact_primary` (String): Primary telephone number.
- `contact_secondary`, `contact_family` (String, Nullable).
- `official_email`, `personal_email`, `email` (String).
- `dob` (Date String: `YYYY-MM-DD` / `DDMMYYYY`).
- `joining_date` (Date String: `YYYY-MM-DD` / `DDMMYYYY`).
- `retirement_date` (Date String: `YYYY-MM-DD`): Calculated statutory retirement date.
- `home_district` (String, Nullable).
- `picture_url` (String, Nullable): Base64 or Drive photo link.
- `remarks` (String, Nullable).
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.
- **Dynamic Form Cascading Rule**: In the Employee input and edit forms, `Designation` is presented as a dropdown menu populated with `pay_groups` data filtered dynamically by the Directorate or Department selected in `Organization Unit`. The dropdown displays **only the full designation name** (e.g., "Passenger Service Officer"). Selecting a designation automatically assigns the corresponding `pay_group`, or selecting a `pay_group` narrows the designations to only roles under that pay scale in that Directorate/Department.

#### 12. Sheet: `placements`
Records operational duty position, organizational unit assignment, workplace, and shift roster.
- `placement_id` (PK, String: `PLC-0001`): Primary identifier.
- `staff_id` (String, FK -> `employees.staff_id`): 5-digit employee ID.
- `location_id` (String, FK -> `work_locations.location_id`): Physical workplace premises.
- `organization_unit_id` (String, FK -> `organization_units.unit_id`): Assigned organizational unit (Dept, Wing, Section).
- `position_id` (String, FK -> `positions.position_title`): Duty position / role in-charge.
- `shift_name` (String, Nullable, FK -> `shifts.shift_name`): Shift roster assignment.
- `placement_date` (Date String: `YYYY-MM-DD` / `DDMMYYYY`): Effective placement date.
- `created_at`, `updated_at`, `created_by`, `updated_by`, `is_deleted`.

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
- `migration_id` (PK, String: `MIG-0001`).
- `previous_staff_id` (String): Old Casual/Previous ID.
- `present_staff_id` (String): New Permanent/Current ID.
- `migration_type` (String, FK -> `employee_types.emp_type`).
- `migration_date` (Date String: `YYYY-MM-DD`).
- `remarks` (String, Nullable).
- `created_at` (ISO String).

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

### 3.5 Multi-Station & 9-Directorate Enterprise Organogram Blueprint

The organizational setup is modeled on the official corporate organogram manuals of Biman Bangladesh Airlines Ltd., normalized into a universal schema that dynamically accommodates all **9 Directorates** and all **Domestic and Foreign Stations**.

#### 1. Domestic Stations Set-Up (Organogram Manual Chp 12, Issue 02, Rev 0)
- **Top Authority**: District Manager (`VII` in major stations like Chittagong, Sylhet, Jessore, Barisal, Cox's Bazar; `VI / VII` in Saidpur; `VI` in Rajshahi).
- **Core Stations Summary**:
  | Station | Head of Station | Pay-Group | Approx Posts | Key Sections / Sub-Units |
  |---|---|---|---|---|
  | Chittagong (CGP) | District Manager | VII | ~250 | Counter & Resv, Sales Promo, Finance, Station Ops, Engineering, GSE, Security, MT |
  | Sylhet (ZYL) | District Manager | VII | ~70 | Sales Promotion, Counter Sales, Finance, Station Ops, Security, GSE, Engineering |
  | Cox's Bazar (CXB) | District Manager | VII | 31 | Counter Sales (5), Station Manager (5), Security (5), Accounts (1), Ops/Engg (14) |
  | Saidpur (SPD) | District Manager | VI / VII | 18 | Counter Sales (3), Station Manager (5), Engg (2), Security (4), Finance (2) |
  | Rajshahi (RJH) | District Manager | VI | 16 | Counter Sales (3), Station Manager (5), Engg (2), Security (4), Finance (1) |
  | Jessore (JSR) | District Manager | VII | 16 | Counter Sales (3), Station Manager (5), Engg (2), Security (4), Finance (1) |
  | Barisal (BZL) | District Manager | VII | 15 | Counter Sales (3), Station Manager (4), Engg (2), Security (3), Finance (1) |

#### 2. Set-Up of Foreign Stations (Online & Offline Stations — 152 Posts)
- **Classification**:
  - **18 Online Stations** (143 Posts): Abu Dhabi, Bangkok, Dammam, Kathmandu, Kolkata, Kuala Lumpur, Kuwait, London, Muscat, Doha, Dubai, Jeddah, Riyadh, Singapore, Yangon, Delhi, Guangzhou, Medina, Chennai.
  - **2 Offline Stations** (9 Posts): Hong Kong (1 post - Cargo based), Manchester (8 posts).
- **Multi-Cadre Structure**:
  - **Expatriate Bangladesh Cadre**: Regional Manager (`IX / VIII / VII`), Country Manager (`VIII / VII`), District Manager (`VII`), Station Manager (`VII / VI`), Manager Finance (`VII / VI / V`), Manager Operations (`VII / VI`), GSO/JGSO (`VI / V`).
  - **Locally Recruited Staff (`LOCAL` Pay Group)**: Local secretaries, receptionists, ticketing assistants, traffic/cargo assistants, drivers, and cleaning personnel.
- **Station-Specific Rank Variations**:
  - *Jeddah*: Regional Manager (Western Province KSA) holds the highest foreign rank: Pay Group **IX**.
  - *London*: Largest foreign station (16 posts), headed by Country Manager [VIII] with Station Manager [VII], Manager Finance [VII], Duty Officer [VI], and local clerks.
  - *Abu Dhabi & Saidpur*: Station Manager is Pay Group **VI**, while in *London & Chittagong* it is Pay Group **VII**.

#### 3. Customer Services Directorate (CSD) Hierarchy Schema
- **Executive Leadership**: Director (Customer Services) [`SPL`] — 1 post.
  - Admin Cell (5 posts: Dy. Mgr [VII], Jr. Officer [V], Admin Supv [IV], Admin Asst [3(II)], MLSS [I]).
  - Director Office (2 posts: Dy. Mgr [VII], MLSS [I]).
  - General Manager (Customer Services) [`X`] — 1 post:
    - DGM (Ground Services) [`IX`] -> Manager GS Handling Agreement [`VIII`] (6 posts) + Manager System Ops, Rules & Standards [`VIII`] (6 posts) + Foreign Station Managers (38 posts).
    - DGM (Flight Services) [`IX`].
  - General Manager (Airport Services) [`X`] — 1 post (Airport Services Division: 75 posts total).
    - DGM (Airport Services) [`IX`] -> Manager Customer Airlines Relations [`VIII`].
    - DGM (Ground Handling) [`IX`] -> Operational Divisions:
      - **Above Wing Section (728 posts)**: 4x Manager (Above Wing) [`VIII`] (Shift-based), 8x Dy. Manager / Shift In-Charge [`VII`], 52x Asst. Manager [`VI`], 52x JGSO [`V`], 160x GSS [`IV`], 208x GSA [`3(II)`], 236x Traffic Helper [`I`], 4x Admin Supv [`IV`], 4x MLSS [`I`].
      - **Below Wing Section (888 posts)**: 4x Manager (Below Wing) [`VIII`] (Shift-based), 12x Dy. Manager / Shift In-Charge [`VII`], 40x Asst. Manager [`VI`], 56x Jr. Officer [`V`], 72x GSS [`IV`], 92x GSA [`3(II)`], 604x Traffic Helper [`I`], 4x Admin Supv [`IV`], 4x MLSS [`I`].
      - **Domestic Wing, HSIA Section (91 posts)**: 1x Manager (Domestic Terminal HSIA) [`VIII`], 2x Dy. Manager (2 Shifts) [`VII`], 2x Asst. Manager [`VI`], 4x Jr. Officer [`V`], 14x GSS [`IV`], 20x GSA [`3(II)`], 46x Traffic Helper [`I`], 1x Admin Supv [`IV`], 1x MLSS [`I`].
  - General Manager (GSE) [`X`] — 1 post.

#### 4. Universal 9-Directorate Enterprise Architecture & Cross-Module Integrity Strategy

> [!IMPORTANT]
> **Core Strategic Architectural Directive**:
> The sample organograms provided earlier (Customer Services Directorate, Domestic Station sets, Foreign Online/Offline stations) serve strictly as **illustrative benchmark models** demonstrating structural depth and operational variation. The system is **NOT** built around or restricted to any single Directorate, Division, or Station.
>
> The core database engine and application logic are fundamentally designed to universally support **ALL 9 Corporate Directorates** and any arbitrary multi-level hierarchy branch without structural alteration, schema branching, or hardcoded fallbacks.

##### 1. The 9 Corporate Directorates of the Airline:
1. **Directorate of Customer Services (CSD)**: Passenger handling, ramp supervision, baggage service, transit hubs, domestic & foreign station handling.
2. **Directorate of Flight Operations (DFO)**: Flight safety, cockpit crew administration, cabin crew division, flight dispatch, flight technical operations, fleet management.
3. **Directorate of Engineering & Material Management (DEMM)**: Line maintenance, base maintenance, avionics, powerplant, workshops, quality assurance, technical stores.
4. **Directorate of Marketing & Sales (DMS)**: Commercial sales, cargo marketing, international reservations, passenger revenue, pricing & scheduling, city sales offices (CTO).
5. **Directorate of Finance (DF)**: Corporate accounts, revenue audit, expenditure control, budget, station finance, staff payroll.
6. **Directorate of Administration & Human Resources (DAHR)**: Personnel management, recruitment, legal affairs, general administration, protocol, welfare, training academy (BATC).
7. **Directorate of Planning (DP)**: Corporate strategy, route analysis, aircraft acquisition & leasing, corporate economics.
8. **Directorate of Procurement & Logistics Support (DPLS)**: Inflight service procurement, catering contracts, central store, motor transport (MT).
9. **Directorate of Aviation Security (AVSEC)**: Airport security, passenger screening intelligence, security inspection, anti-smuggling, station security cells.

##### 2. The Universal Multi-Tier Recursive Hierarchy Tree:
Every organizational entity across all 9 Directorates is managed through the centralized, normalized `organization_units` master sheet in the **ORG** module:
- **Level 1 — Directorate (`DIRECTORATE`)**: Top-level executive authority (Root node, `parent_unit_id = NULL`).
- **Level 2 — Division (`DIVISION`)**: Major administrative or operational segment under a Directorate.
- **Level 3 — Department (`DEPARTMENT`)**: Functional operational unit.
- **Level 4 — Wing (`WING`)**: Specialized wing or fleet grouping under a Department.
- **Level 5 — Section (`SECTION`)**: Tactical duty section (e.g., Line Maintenance, Ramp Control, Cabin Services, Reservation Counter).
- **Level 6 — Sub-Section / Cell / Unit / Team (`SUB_SECTION`, `CELL`, `UNIT`)**: Ground duty teams or administrative cells.

##### 3. Cross-Module Data Integrity & Zero-Mismatch Strategy:
1. **ORG as the Single Source of Truth**:
   - Master organizational units, stations, work locations, shifts, substantive designations, and pay groups are configured strictly in the **ORG** tab.
2. **Strict Hierarchy Linkage in HRM & TQC**:
   - **Employees (`employees`)**: Every employee profile links directly to their formal `Organization Unit` (`department_code` / `dep_id`). Selecting this unit dynamically resolves their parent Department and root Directorate, while cascading only the valid substantive designations and pay groups applicable to that unit or its parent hierarchy.
   - **Placements (`placements`)**: Micro operational duty assignments link to an `Organization Unit` (Section/Wing), physical `Work Location`, operating `Station (Airport Base)`, functional `Duty Position`, and `Shift Assignment`.
   - **Postings (`postings`)**: Macro administrative station postings link to `Station (Airport Base)` and `Work Location`.
   - **Workforce Setup (`workforce_setup`)**: Sanctioned establishment quotas are strictly budgeted by `Organization Unit` (at any Directorate/Dept/Section tier) + `Station (Airport Base)` + `Duty Position` + `Pay Group` + `Designation`.
   - **Operational Shifts (`shifts`)**: Roster timings belong strictly to an `Organization Unit` and `Station (Airport Base)`.
   - **Employee Actions (`employee_actions`)**: Inter-directorate and inter-departmental transfers strictly preserve from/to `Organization Unit` foreign keys.
   - **Aviation Courses (`courses`) in TQC**: Curriculums link directly to sponsoring `Organization Unit` (or organization-wide mandatory status).
3. **Dynamic Multi-Tier Ancestry Resolution Engine (`resolveUnitHierarchy`)**:
   - The backend service and front-end cascade listeners traverse all ancestral parent units from the leaf section up to the root Directorate.
   - Eliminates all hardcoded directorate fallbacks, ensuring seamless operation for any directorate, department, or station now and in the future.

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
   - `api_get_workforce_setup_report`: Computes dynamic Sanctioned vs Existing vs Deficit across Station, Unit, Position, and Pay Group.
   - `api_seed_organogram_masters`: Initializes and synchronizes standard Pay Groups (SPL to LOCAL), Substantive Designations, Duty Positions (Station Manager, In-charge Above/Below Wing, Red Cap), Corporate Headquarters (HQ), 8 Domestic Stations, 18 Foreign Online Stations, 2 Foreign Offline Stations, and standard Work Locations.
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
- Pulls all historical assignments: `joining_date`, `placements`, `postings`, `promotions`, `acting_assignments`, `additional_charges`.
- Sorts events chronologically ascending by start date.
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
  - **Spreadsheet-Style Grid & Compact Layout Standard (All View Forms Across ORG, HRM, TQC)**:
    - All data tables (`.standard-data-table`) across all "View Form" tabs are engineered to look and feel like dense, professional Google Sheets / Excel spreadsheets:
      - **Automatic Cell Width Adjustment Based on Data**: Tables utilize `width: max-content !important` and `table-layout: auto !important`. All headers (`th`) and data cells (`td`) have `width: auto !important`, `white-space: nowrap !important`, and `max-width: none !important`. Column widths dynamically auto-fit and hug the exact width of their cell contents and header labels without artificial stretching, empty gaps, or hardcoded pixel constraints.
      - **Minimal Cell Padding**: Table cells (`td`) have compact padding of `2px 5px !important`, row height of `22px`, and `line-height: 1.25 !important` with clean `#e2e8f0` grid borders and `border-collapse: separate; border-spacing: 0`.
      - **Header Compactness**: Table headers (`th`) styled with `3px 6px !important` padding, height `24px`, soft grey background `#f1f5f9`, and `#1e293b` text.
      - **Dense Action Controls**: Row action buttons (`.btn-table-edit`, `.btn-table-delete`) reduced to `1px 5px !important`, height `20px !important`, and font size `10.5px !important`.
      - **Font Sizing**: Base table font calibrated to `11px !important` with pure dark readable text (`color: #0f172a !important`).
  - **ORG Units View Form Navigation, Category Sequence & Accurate Sub-Units Calculation**:
    - **View Form Title & Labeling**: The view form header displays cleanly as `ORG Units - Records View` (removing any verbose "Hierarchy" branding), with the toolbar filter labeled as `Category:`.
    - **Full Hierarchical Category Sequence (Including Divisions)**: Category filter buttons in `ViewOrg.html` and hierarchy sorting strictly reflect the 7-tier organizational structure:
      `[All Units]`, `[Corporate]`, `[Directorates]`, `[Divisions]`, `[Departments]`, `[Wing]`, `[Section]`, `[Unit]`.
    - **Dynamic Null / Zero-Count Suppression**: Category filter pills that have zero records (or null categories) are automatically hidden (`display: none`), ensuring only active categories with records are presented to the user alongside `[All Units]`.
    - **Accurate Sub-Units Counting Engine**:
      - Parent-child linkages are resolved across canonical parent identifiers (`unit_id`, `unit_code`, and `unit_name`) with case-insensitive and whitespace trimming.
      - Soft-deleted rows (`is_deleted` or `status === 'DELETED'`) are strictly excluded from sub-unit counts and parent ancestry chains.
      - Child units are deduplicated by unique identifier, ensuring 100% accurate sub-unit counts displayed as interactive pills (`X Sub-unit(s)`) with hover tooltips detailing child unit names and tiers.
    - **Null Value Cell Guard**: Table cells with `null`, undefined, empty, or string `'NULL'` values render clean `-` placeholders instead of literal `"NULL"` badges.
    - **Unit Code 3-Letter Prefix & Type Tier Detection**: Hierarchy tiers are automatically determined by `unit_type` or the first 3 capital letters of `unit_code` / `letter_code` (e.g. `DIR` $\rightarrow$ Directorate, `DIV` $\rightarrow$ Division, `DEP` $\rightarrow$ Department, `WIN` $\rightarrow$ Wing, `SEC` $\rightarrow$ Section, `UNI`/`UNT` $\rightarrow$ Unit, `COR`/`CEO` $\rightarrow$ Corporate).
    - Tabular records and options are dynamically sorted and rendered according to canonical hierarchy priority:
      `CORPORATE` (Priority 1) $\rightarrow$ `DIRECTORATE` (Priority 2) $\rightarrow$ `DIVISION` (Priority 3) $\rightarrow$ `DEPARTMENT` (Priority 4) $\rightarrow$ `WING` (Priority 5) $\rightarrow$ `SECTION` (Priority 6) $\rightarrow$ `UNIT` (Priority 7).
    - **High-Contrast Color Accessibility**: Corporate in crimson (`#fee2e2`/`#991b1b`), Directorate in orange (`#ffedd5`/`#9a3412`), Division in warm amber (`#fef3c7`/`#92400e`), Department in emerald (`#dcfce7`/`#166534`), Wing in indigo (`#e0e7ff`/`#3730a3`), Section in purple (`#f3e8ff`/`#6b21a8`), Unit in teal (`#ccfbf1`/`#0f766e`).
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

1. **Title & Naming Convention Standard**:
   - Redundant `"Form"` suffix is strictly eliminated from all module and schema titles (e.g., "Placements", "Employees", "Postings", "Workforce Set Up").
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
     - **Directorates** (`.kpi-card`: label `0.825rem`, value `1.85rem`, subtext `0.825rem`, icon box `46px x 46px` teal).
     - **Departments** (`.kpi-card`: green).
     - **Stations** (`.kpi-card`: amber).
     - **Workforce Setups** (`.kpi-card`: purple).
   - Master Data & Corporate Structure Content Card (`.content-card`: title `0.975rem`, paragraph `0.925rem`).
2. **Input Records View**:
   - Selectable list linking to uniform input forms: Directorates, Departments, Sections, Stations, Work Locations, Shifts, Pay Groups, Designations, Workforce Set Up.
3. **Work Locations Management**:
   - Full master data CRUD for physical buildings and city offices with airport station linkages (`station_id`) and parent-child location nesting (`parent_location_id`).
4. **View Forms Data Grid**:
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
  - User selects one of the 11 forms from the list and clicks **OK**.
  - The chosen form renders inside the same div.
  - Every form follows an identical visual format, compact labels, and concise placeholders.
  - System metadata (`created_at`, `updated_at`, `created_by`, `updated_by`) are excluded from form fields.
  - Base of form contains a primary **Save** button. Continuous entry is supported: after saving, a stylized success toast appears, the form resets, and the user can enter another record without exiting.

#### 1. Placement Form
- **Fields**:
  - `Staff ID` (Text with lookup: 5-digit employee ID).
  - `Work Location` (Select from `work_locations.location_id`: physical workplace premises).
  - `Station (Airport Base)` (Select from `stations.station_code`: auto-resolved from Work Location or selectable).
  - `Organization Unit` (Select from `organization_units.unit_id`: department/wing/section).
  - `Section / Wing Letter Code` (Text: e.g., AW, BW, RMP).
  - `Duty Position` (Select from `positions.position_title`: operational duty role).
  - `Shift Assignment` (Select from `shifts.shift_name`: dependable dropdown filtered by Station and Organization Unit).
  - `Effective From` (Universal 8-digit date input, formatted to `DD-MMM-YYYY`, stored as `placement_date`).
- **Action**: Saves to `placements` sheet; updates active placement indicator.

#### 2. Employee Types Form
- **Fields**:
  - `Type Code` (Text: e.g., `EMT-01`, `PERM`).
  - `Employee Type` (Text: e.g., "Permanent", "Casual", "Contract", "Trainee").
  - `Description` (Text: brief cadre description).
- **Action**: Saves to `employee_types` sheet.

#### 3. Employees Form
- **Fields**:
  - `Staff ID` (Text, NOT NULL, Unique 5-digit ID).
  - `Full Name` (Text, NOT NULL).
  - `Gender` (Select: `Male`, `Female`, `Other`).
  - `Date of Birth` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Organization Unit` (Select from `organization_units`: home department/directorate).
  - `Employee Type` (Select from `employee_types.emp_type`).
  - `Pay Group` (Select from `pay_groups.pay_group`: dynamically cascaded by home Organization Unit).
  - `Designation` (Text: official substantive title auto-populated from pay group).
  - `Joining Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Primary Contact` (Text: primary telephone number).
  - `Alternate Contact` (Text, Nullable).
  - `Family Contact` (Text, Nullable: emergency family phone).
  - `Official Email` (Email format, Nullable).
  - `Personal Email` (Email format, NOT NULL).
  - `Home District` (Text, Nullable).
  - `Employee Photo` (Image upload field with Drive preview, Nullable).
  - `Remarks` (Text, Nullable).
- **Action**:
  - Creates an `employees` record.
  - Auto-calculates statutory retirement date (`DOB + 59 years - 1 day`).

#### 4. Posting Form
- **Fields**:
  - `Staff ID` (Text with lookup).
  - `Station (Airport Base)` (Select from `stations.station_code`: auto-resolved from Work Location or selectable).
  - `Work Location` (Select from `work_locations.location_id`).
  - `City` (Text: auto-resolved from Work Location / Station).
  - `Effective From` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Effective To` (Universal 8-digit date input -> `DD-MMM-YYYY`, Nullable).
  - `Status` (Select: `Active`, `Inactive`).
- **Action**: Saves to `postings` sheet; establishes official administrative station posting.

#### 5. Promotion Form (Single & Bulk "Multiple Employees")
- **Standard Single Promotion Form**:
  - `Reference Number` (Text: official order letter string, e.g., `BG.HR.PROM.2026.08871`).
  - `Staff ID` (Text: 5-digit employee ID).
  - `Sequence No` (Number: auto-assigned or manual sequence rank).
  - `Present Pay Group` (Select from `pay_groups.pay_group`).
  - `Promoted Pay Group` (Select from `pay_groups.pay_group`).
  - `Promotion Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Multiple Entry Checkbox` (Toggle switch).
- **"Multiple Employees" Bulk Entry Mode** (When Checkbox is checked):
  - Transitioned bulk layout:
    - `Reference Number` (Text).
    - `Present Pay Group` (Uniform for the entire batch).
    - `Promoted Pay Group` (Uniform for the entire batch).
    - `Promotion Date` (Uniform for the entire batch).
    - `Multiple Staff ID` (Textarea accepting comma-separated Staff IDs, e.g., `2011, 2015, 2044, 2098`).
- **Backend Batch Processing Engine**:
  1. Resolves `Reference Number` into `ref_id` inside `promotion_references` sheet.
  2. Parses the comma-separated Staff IDs into an ordered array.
  3. Iterates through the list, assigning sequential sequence numbers (`1, 2, 3...`) based strictly on input position.
  4. Commits all records to `promotions` sheet in a single batch operation.

#### 6. Extension Form
- **Fields**:
  - `Staff ID` (Text with lookup).
  - `Effective From` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Pay Group` (Select from `pay_groups.pay_group`).
  - `Effective To` (Universal 8-digit date input -> `DD-MMM-YYYY`).
- **Action**: Saves to `extensions` sheet; updates employee status to `Extension`.

#### 7. Additional Charge Form
- **Fields**:
  - `Staff ID` (Text with lookup).
  - `Effective From` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Pay Group` (Select from `pay_groups.pay_group`).
  - `Designation` (Select from `pay_groups.designation`).
  - `Effective To` (Universal 8-digit date input -> `DD-MMM-YYYY`, Nullable; blank indicates continuing charge).
  - `Default Continue` (Checkbox: default `TRUE`).
- **Action**: Saves to `additional_charges` sheet.

#### 8. Acting / In-charge Form
- **Fields**:
  - `Staff ID` (Text with lookup).
  - `Effective From` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Pay Group` (Select from `pay_groups.pay_group`).
  - `Designation` (Select from `pay_groups.designation`).
  - `Effective To` (Universal 8-digit date input -> `DD-MMM-YYYY`, Nullable; blank indicates continuing appointment).
  - `Default Continue` (Checkbox: default `TRUE`).
- **Action**: Saves to `acting_assignments` sheet.

#### 9. Separation (Self-Retirement / Resignation / Left Job) Form
- **Fields**:
  - `Staff ID` (Text with lookup).
  - `Event Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Event Type` (Select: `Self Retirement`, `Resignation`, `Left Job`).
  - `Remarks` (Text: separation grounds and reference).
- **Action**: Saves to `self_retirements` sheet; updates employee status to `Retired`.

#### 10. Employee Migration Form
- **Fields**:
  - `Reference Number` (Text: official cadre change resolution reference).
  - `Previous Staff ID` (Text: old casual/temporary ID).
  - `Present Staff ID` (Text: new permanent ID).
  - `Employee Type` (Select from `employee_types.emp_type`).
  - `Migration Date` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Remarks` (Text).
- **Action**: Saves to `employee_migrations` sheet.

#### 11. Employee Actions Form (Transfers, Downgrades, Redesignations)
- **Fields**:
  - `Reference Number` (Text: administrative office order reference).
  - `Staff ID` (Text with lookup).
  - `Action Type` (Select: `TRANSFER`, `DOWNGRADE`, `REDESIGNATION`, `OTHER`).
  - `From Organization Unit` (Select from `organization_units.unit_id`: auto-detected).
  - `To Organization Unit` (Select from `organization_units.unit_id`: target unit).
  - `From Pay Group` (Select from `pay_groups.pay_group`: auto-detected).
  - `To Pay Group` (Select from `pay_groups.pay_group`).
  - `From Designation` (Dynamic select from `pay_groups.designation`: filtered strictly by `From Organization Unit` hierarchy, displays only full designation name, auto-detected upon Staff ID entry, auto-syncs with `From Pay Group`).
  - `To Designation` (Dynamic select from `pay_groups.designation`: filtered strictly by `To Organization Unit` hierarchy, displays only full designation name, auto-syncs with `To Pay Group`).
  - `Effective From` (Universal 8-digit date input -> `DD-MMM-YYYY`).
  - `Disciplinary Case Ref` (Select from `disciplinary_cases.case_id`, optional for downgrades).
  - `Remarks` (Text).
- **Action**: Saves to `employee_actions` sheet; automatically updates employee home unit, pay group, and designation in `employees`.

#### 12. Workforce Setup Form (Normalized Sanctioned Headcount Allocation)
- **Fields**:
  - `Organization Unit` (Select from `organization_units.unit_id`).
  - `Station (Airport Base)` (Select from `stations.station_code`, optional/blank for Corporate Head Office posts).
  - `Duty Position` (Select from `positions.position_title`).
  - `Pay Group` (Select from `pay_groups.pay_group`).
  - `Designation` (Text: substantive title).
  - `Sanctioned Posts` (Number: approved post quota).
  - `Shift Pattern` (Select: `General (Day)`, `2-Shift Roster`, `3-Shift Roster`, `4-Shift Roster`, `Continuous / 24-7`, `Non-Shift`).
  - `Remarks` (Text: organogram manual chapter/issue reference).
- **Action**: Saves to `workforce_setup` sheet.

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
  1. **Details List** (Default active view)
  2. **Precise List**
  3. **On Job**
  4. **Retired**
  5. **Officer & Sup**
  6. **TH**
  7. **Pay Group** (Dynamic selection menu)

#### 1. "Details List" Table Structure
- **Active Personnel Only**: Strictly filters out and does not show any retired employees (`status !== 'Retired'`). Retired personnel are housed exclusively in the dedicated "Retired" tab.
- `SL`: Sequential row index (auto-generated 1, 2, 3...).
- `Name`: Employee full name from `persons`.
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
  - Groups data across Station, Unit / Wing, Position / Role, and Pay Group.
  - Columns:
    - `Station`, `Unit / Wing`, `Position / Role`, `Pay Group`, `Shift Roster`, `Sanctioned (Setup)`, `Existing (Active Personnel)`, `Required (Deficit = Sanctioned - Existing)`.
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
    - `Basic Pay` (Input field, entered during salary calculation; used to compute overtime rate $\text{Rate} = \frac{\text{Basic Pay}}{200} \times 1.5$ for PG-1 to PG-5 and gross monthly salary).
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
  ├── Build HrmService.gs (Persons, Employees, Migrations)
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

### 8. Universal Label Consistency & End-to-End Synchronization
- [ ] 100% of shared relational fields carry identical display labels (`label`) across all input forms, view tables, and edit dialogs (`Station (Airport Base)`, `Work Location`, `Organization Unit`, `Pay Group`, `Designation`, `Duty Position`, `Shift Assignment`, `Section / Wing Letter Code`, `City`, `Staff ID`, `Employee Type`, `Effective From`, `Effective To`, `Reference Number`, `Remarks`).
- [ ] Schema configurations (`Schemas.html`), backend table structures (`Database.gs`), service handlers (`HrmService.gs`), and view templates (`ViewOrg.html`, `ViewHrm.html`, `ViewTqc.html`) operate in full synchronization.
- [ ] Architecture blueprint (`IMPLEMENTATION_PLAN.md`) comprehensively documents all structural, functional, and relational specifications.

### 9. Full-Screen View Forms, Zero Padding & Dynamic Layout Standard (ORG, HRM, TQC)
- [x] **Zero Outer Padding Across View & Input Stages**: All container divs housing "View Forms" and "Input Records" across ORG, HRM, and TQC modules render with zero margin and zero padding (`width: 100%; height: 100%; padding: 0; margin: 0; overflow: hidden; display: flex; flex-direction: column;`).
- [x] **Full-Screen Edge-to-Edge Form Expansion**: Dynamic forms and edit forms (`.form-shell-container`) span 100% full width and 100% full height edge-to-edge (`width: 100%; min-width: 100%; max-width: 100%; margin: 0; padding: 0; border: none; border-radius: 0; box-shadow: none; flex: 1; display: flex; flex-direction: column;`). The legacy 860px box constraint and centering margins have been completely eliminated.
- [x] **Responsive Multi-Column Field Grid**: Form fields layout (`.form-two-column-grid`) adapts responsively to desktop and widescreen viewports using `display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem 1.25rem;` providing optimal spacing without squeezing inputs.
- [x] **Natural Dynamic Footer (`.form-shell-footer`)**: Form footers dynamically flow to the bottom of the form (`margin-top: auto; position: static !important; box-shadow: none; padding: 1rem 1.5rem !important; display: flex; justify-content: space-between; align-items: center;`). As the form fields expand downward, the footer sits naturally below all inputs; when the user scrolls down, all fields and action buttons ("Cancel", "Save Changes", "Delete") remain 100% accessible with zero cut off or overlapping overlays.
- [x] **Unconstrained Table & Grid Scrolling**: Spreadsheet table containers (`.table-container`) utilize unconstrained flex height (`flex: 1; min-height: 0; overflow: auto; border: none;`) eliminating artificial `max-height: calc(100vh - 220px)` clamping. Native horizontal and vertical scrollbars (navigation bars) engage automatically whenever data exceeds viewport dimensions.
- [x] **Clean Unit Code Display Rule**: In tabular records (`ViewOrg.html`), the Unit Code column displays strictly the clean, normalized code (e.g. `DIR-CS`, `DEP-AS`) without any attached bracketed tier badges (such as `[DIRECTORATE]`, `[DEPARTMENT]`).
- [x] **Standard Airline Multi-Tier Management Role Architecture**:
  - Administrative Tier: Managed via `organization_units` (e.g. `Airport Services Department`, `Ground Services Department`).
  - Statutory Pay Group / Rank: Managed via `pay_groups` (e.g. `PG-9` for DGM, `PG-8` for Manager, `PG-7` for Asst Manager).
  - Functional Duty Role: Managed via `positions` (e.g. `DGM - Airport Services`, `DGM - Ground Handling`, `Manager - Above Wing`, `Station Manager - CGP`, `Country Manager / SM - LHR`).
  - Station Linkage: Linked via `stations` (`DAC`, `CGP`, `LHR`).
  - Workforce Headcount & Deployment: Configured via `workforce_setup` (approved organogram) and `placements` / `postings` (individual officer deployment).

### 10. Pay Groups Architecture & Departmental Cadre Linkage (`unit_id`)
- [x] **Departmental Cadre Association for Pay Groups & Designations**:
  - `pay_groups` table and form explicitly support `unit_id` (`Department / Unit`) to enable department-specific / directorate-specific cadres and designations, alongside common cadre designations (`-- All Units (Common Cadre) --`).
  - **Pay Groups Schema**:
    1. `unit_id` (Select: `organization_units`, optional — defaults to All Units/Common Cadre)
    2. `pay_group` (Select: `PG-1`, `PG-3(2)`, ... `PG-12`, `LOCAL`)
    3. `designation` (Text: e.g. `Deputy General Manager`, `Manager`)
    4. `designation_short` (Text: e.g. `DGM`, `MGR`, `AM`)
    5. `rank_level` (Number: Auto-fills with Pay Group)
    6. `status` (Select: `ACTIVE` / `INACTIVE`)
  - **Eliminated Erroneous Reporting Box**: The non-functional `Reports To (Superior)` and supervisory hierarchy dashed preview box have been cleanly removed, keeping the form focused and streamlined.
  - **Relational Cascading**: In `workforce_setup`, when a Department/Unit is selected, Pay Groups and Designations cascade and filter dynamically to show only the designations linked to that unit or common cadre.
  - **Auto-Fill Rank Level**: Selection of Pay Group (e.g. `PG-9`) automatically calculates and populates the statutory numerical rank level (`10`), while allowing manual override if required.

### 11. Designations Master Table & Form Implementation (`designations`)
- [x] **Relational Schema**:
  - `deg_id` (PK), `unit_id` (FK -> `organization_units.unit_id`), `pg_category` (FK -> `pay_groups.pg_category`), `pay_group`, `designation`, `designation_short`, `status`, `created_at`, `created_by`, `updated_at`, `updated_by`, `is_deleted`.
- [x] **Input Form Architecture**:
  - `Department`: Select dropdown populated strictly with departments from `organization_units` (filtering out directorates, sections, wings, and units using tier detection). Displays clean `unit_name` and saves `unit_id`.
  - `Pay Group Category`: Dynamic select dropdown populated with distinct `pg_category` from `pay_groups`.
  - `Pay Group`: Dynamic select dropdown filtered by selected `pg_category` from `pay_groups`.
  - `Designation`: Text input with placeholder `' '`, required.
  - `Short Designation`: Text input with placeholder `' '`, optional.
  - `Status`: Select dropdown (`Active`, `Inactive`, default `Active`).
- [x] **Grid & View Display Rule**:
  - In all tabular records and edit/detail views, the Department column automatically resolves `unit_id` against `organization_units` and displays the clean Department Name (`unit_name`).
- [x] **Edit Modal & Cascading**:
  - Fully supports edit mode with department selection (clean `unit_name`), preselected `unit_id`, and responsive dynamic cascading between `pg_category` and `pay_group`.


