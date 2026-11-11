# Blood Bank Management System — MySQL 8.0

This project uses a React + Vite frontend, an Express API and a MySQL 8.0 database. Donor, hospital, blood-lab and admin dashboards all use the same MySQL-backed API.

## 1. Requirements

- Node.js 20.19+ or 22.12+ (Vite 7 requirement)
- MySQL Server 8.0
- MySQL Workbench (recommended)

## 2. Create the database

For a **fresh setup**:

1. Start the `MySQL80` Windows service.
2. Open MySQL Workbench and connect to your local MySQL server.
3. Open `backend/sql/schema.sql` and execute the complete script.
4. Confirm that the `blood_bank_management` database contains the tables `users`, `donors`, `facilities`, `blood_inventory`, `blood_requests`, `blood_camps`, `donation_history` and `donor_contact_logs`.

For an existing database created from an earlier MySQL version of this project, do not drop your data. Execute `backend/sql/upgrade_mysql8_existing.sql` **once** instead. Do not run that upgrade file on a fresh database created using the latest `schema.sql`.

## 3. Configure and start the backend

Open a terminal in the `backend` folder:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `backend/.env` and enter your local MySQL password. Also set a unique long `JWT_SECRET`. The sample local admin values are:

```env
ADMIN_NAME=System Administrator
ADMIN_EMAIL=admin@bloodbank.local
ADMIN_PASSWORD=Admin@12345
```

Create or reset the admin account using the values in `.env`:

```powershell
npm run seed:admin
```

Start the API:

```powershell
npm start
```

Expected startup output includes `MySQL database connected` and `Blood Bank API running at http://localhost:5000`.

## 4. Start the frontend

Open a **second** terminal in the `frontend` folder:

```powershell
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Keep both terminals running while using the application.

## 5. Login roles and access

| Role | Registration | Access |
|---|---|---|
| Admin | Created by `npm run seed:admin` | Admin dashboard, facility approval/rejection, facility directory and donor directory |
| Donor | Public donor registration | Profile, eligibility/status, donation history and blood-camp directory |
| Hospital | Public facility registration | Hospital dashboard, blood inventory view, donor directory/contact log, blood requests and request history |
| Blood lab | Public facility registration | Lab dashboard, blood inventory add/remove, donor search/donation recording, camp management and hospital blood-request processing |

Hospitals and blood labs are created with `pending` status. An admin must approve a facility before it can log in. Donor and admin accounts are active immediately.

## 6. API and database notes

- API health check: `GET http://localhost:5000/api/health`
- Vite proxies `/api` requests to `http://localhost:5000`.
- Donation recording is transactional: it writes donor history, updates the donor's last-donation date and adds the collected units to the lab inventory together.
- Fulfilling a hospital request checks available stock and deducts the requested units in a database transaction.
- The current application eligibility checks use age 18–65, weight at least 45 kg, profile eligibility and a 90-day interval. These are configurable project rules for the demo, not a substitute for clinical screening or local blood-bank regulations.
- Do not publish `.env`, JWT secrets, or production credentials. Change the sample admin password before using the system beyond local testing.

## 7. Troubleshooting

**Admin login fails:** confirm MySQL is running, check `backend/.env`, run `npm run seed:admin` again, then log in using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from that file.

**Facility login says awaiting approval:** log in as admin first and approve the pending facility from `Admin → Verification`.

**Frontend cannot reach the API:** check that the backend terminal says it is listening on port `5000`, and that `frontend/vite.config.js` proxies `/api` to `http://localhost:5000`.

**Database connection error:** verify `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` and that the schema or upgrade SQL was executed successfully.

## 8. Optional Docker setup

The included Compose file starts MySQL 8.0, the API and the web app. From the project root:

```powershell
docker compose up --build -d
docker compose run --rm backend npm run seed:admin
```

Open `http://localhost:8080`. For Docker, set `MYSQL_ROOT_PASSWORD`, `JWT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` in a root-level `.env` before starting the stack. The schema file is imported automatically when the MySQL volume is first created. To initialise the Docker database from scratch again, remove the `mysql-data` volume (this permanently deletes its data).
