# ✈️ ULD Inventory Management System (Google Apps Script)

A high-performance, secure, mobile-responsive, and lightweight Unit Load Device (ULD) Inventory Management Application powered by **Google Apps Script** and **Google Sheets**.

---

## 🌟 Key Features

1. **Integrated Database & Table Management**:
   - Google Sheets database consisting of 4 dedicated sheets: `USERS`, `ULD_PREFIXES`, `INVENTORY_TRANSACTIONS`, `AUDIT_LOGS`.
   - Automatic database initialization creates required tables and default admin account on first launch.

2. **Dynamic Registration & Category Separation**:
   - Select ULD prefix (e.g., AKE, ALF, PAG) from dropdown and type a 5-digit number adjacent to form full registration codes (e.g., `AKE02587`).
   - **Container** and **Palette** types are strictly divided into separate groups, with distinct stock calculations and reporting.
   - Admin can configure and add custom ULD prefixes via the Admin Panel.

3. **User Authentication & OTP Management**:
   - Admin can create user accounts and issue initial One-Time Passwords (OTP).
   - Mandatory password change prompt enforced when logging in with an OTP for the first time.

4. **Stock Calculation & Dynamic Reporting**:
   - Automated live stock calculation based on **ULD In** and **ULD Out** transactions.
   - Dynamic **Daily**, **Weekly**, and **Monthly** reports generation with category summaries.

5. **Audit Trail & Security Metadata**:
   - Automatic metadata tracking on every transaction (`created_by`, `created_at`, `updated_by`, `updated_at`).
   - Exclusive Audit Trail log view reserved for System Administrators.

6. **Lightweight Vanilla UI (Fast Loading)**:
   - Built using Vanilla HTML5, CSS3, and JavaScript without heavy external frameworks to ensure minimal loading latency in Google Apps Script.
   - Mobile-responsive layout featuring a 250px sidebar, top navbar with user profile dropdown, and adaptive screen scaling.

---

## 📂 Project Structure

- `Code.gs`: Google Apps Script backend server code (Database handlers, Auth, SHA-256 Hashing, Transactions, Reports, Audit Logs).
- `Index.html`: Single Page Application (SPA) HTML layout template.
- `Styles.html`: Modern Vanilla CSS styling and mobile responsiveness rules.
- `JavaScript.html`: Client-side state management, form validation, and `google.script.run` RPC functions.
- `appsscript.json`: Google Apps Script project manifest.

---

## 🚀 How to Deploy to Google Apps Script

### Step 1: Create a Google Sheet
1. Open Google Drive and create a new **Google Sheet**.
2. Click **Extensions > Apps Script** from the top menu.

### Step 2: Copy Project Files
In the Apps Script editor, create the following 5 files:
1. **`Code.gs`**: Replace the contents with `Code.gs`.
2. **`Index.html`**: Click **(+) > HTML** and name it `Index`, then paste the content.
3. **`Styles.html`**: Click **(+) > HTML** and name it `Styles`, then paste the content.
4. **`JavaScript.html`**: Click **(+) > HTML** and name it `JavaScript`, then paste the content.
5. **`appsscript.json`**: Enable `Show "appsscript.json" manifest file in editor` in Project Settings and paste the manifest configuration.

### Step 3: Web App Deployment
1. Click **Deploy > New deployment** in the top right corner.
2. Select **Web app** as the deployment type.
3. Set configuration:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone` (or `Anyone within organization`)
4. Click **Deploy** and grant required authorization permissions.
5. Open the generated **Web App URL** in your browser.

---

## 🔑 Default Administrator Credentials

When launching for the first time, the system automatically initializes the database and creates a default administrator:

- **Email**: `admin@system.local`
- **OTP Password**: `Admin123!`

> ⚠️ **Note**: Logging in for the first time will trigger a mandatory password reset modal to set a new permanent password.
