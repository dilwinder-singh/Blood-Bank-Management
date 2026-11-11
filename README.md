# Blood Bank Management System

A role-based blood bank management application with a React/Vite frontend, Express backend and MySQL 8.0 database.

## Main modules

- **Admin:** overview, facility verification and donor/facility directories.
- **Donor:** registration, profile management, donation history, donor eligibility summary and blood-camp directory.
- **Hospital:** facility profile, blood inventory, donor search/contact log, blood requests and request history.
- **Blood lab:** facility profile, stock management, donor search and donation recording, camp CRUD/status management, and hospital blood-request processing.

## Quick start

Read [README-MYSQL-SETUP.md](README-MYSQL-SETUP.md) for the complete Windows + MySQL Workbench setup, database scripts, environment variables and admin seeding steps.

1. Execute `backend/sql/schema.sql` in MySQL Workbench (fresh install).
2. Configure `backend/.env` from `backend/.env.example`.
3. In `backend`, run `npm install`, `npm run seed:admin`, then `npm start`.
4. In `frontend`, run `npm install`, then `npm run dev`.
5. Open `http://localhost:5173`.

For an existing database from the earlier MySQL build, use `backend/sql/upgrade_mysql8_existing.sql` once rather than dropping the database. The optional Docker stack is documented in `README-MYSQL-SETUP.md`.
