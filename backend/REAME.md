# Backend setup

This backend is an Express API connected to MySQL 8.0 through `mysql2/promise`.

From this directory:

```powershell
npm install
Copy-Item .env.example .env
# Set DB_PASSWORD and JWT_SECRET in .env
npm run seed:admin
npm start
```

The API listens on port `5000` by default. See the project-level `README-MYSQL-SETUP.md` for schema setup, existing-database migration and role workflows.
