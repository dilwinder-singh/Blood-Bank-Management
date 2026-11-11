# Blood Bank Management System

A web app that connects blood donors, hospitals and blood labs in one place. Donors register and track their donations, hospitals request blood when they need it, labs manage stock and camps, and an admin makes sure only verified facilities get access.

I built this because finding blood in an emergency usually means a lot of phone calls. The idea here is simple: keep stock, requests and donors in one system so nobody has to guess who has what.

## Who uses it

The app has four kinds of users, and each one gets their own dashboard.

**Donor**
- Sign up and manage a personal profile (blood group, city, contact details)
- See their donation history and whether they are currently eligible to donate again
- Browse upcoming blood camps

**Hospital**
- Register the hospital and wait for admin approval
- Check blood stock available at labs
- Raise blood requests and follow their status
- Search the donor directory and keep a log of who was contacted

**Blood lab**
- Maintain the blood inventory (add or remove units by blood group)
- Accept or reject incoming hospital requests
- Search donors and record a donation when someone donates
- Create, edit and delete blood donation camps

**Admin**
- Review new hospitals and labs and approve or reject them
- View all registered donors and facilities
- Keep an eye on overall numbers from the dashboard

## Tech stack

| Part | What I used |
| --- | --- |
| Frontend | React 19, Vite, Tailwind CSS, React Router, Axios |
| Backend | Node.js, Express 5 |
| Database | MySQL 8 |
| Auth | JWT tokens, passwords hashed with bcrypt |
| Extras | Docker Compose setup (optional) |

## Project structure

```
blood-bank-management-system/
├── backend/
│   ├── config/          # database connection
│   ├── sql/             # schema and upgrade scripts
│   ├── server.js        # all API routes
│   ├── seedAdmin.js     # creates the first admin account
│   └── .env.example
├── frontend/
│   └── src/
│       ├── pages/       # admin, donor, hospital, bloodlab, auth
│       └── components/
├── docker-compose.yml
└── README-MYSQL-SETUP.md
```

The database has eight tables: `users`, `donors`, `facilities`, `blood_inventory`, `blood_requests`, `blood_camps`, `donation_history` and `donor_contact_logs`.

## Running it on your machine

You will need Node.js 18 or newer and MySQL 8 installed.

**1. Clone the repo**
```bash
git clone https://github.com/dilwinder-singh/Blood-Bank-Management.git
cd Blood-Bank-Management
```

**2. Set up the database**

Open MySQL Workbench (or the MySQL CLI) and run `backend/sql/schema.sql`. This creates the `blood_bank_management` database and all the tables.

**3. Configure the backend**
```bash
cd backend
cp .env.example .env
```
Open `.env` and put in your own MySQL password and a long random `JWT_SECRET`. You can also change the default admin email and password here.

**4. Start the backend**
```bash
npm install
npm run seed:admin   # creates the admin account
npm start            # runs on http://localhost:5000
```

**5. Start the frontend** (in a new terminal)
```bash
cd frontend
npm install
npm run dev          # runs on http://localhost:5173
```

Open http://localhost:5173 and you are good to go. Log in as admin with the email and password from your `.env`.

### Prefer Docker?

If you have Docker installed, this one command starts the database, backend and frontend together:

```bash
docker compose up --build
```

The site will be at http://localhost:8080 and the API at http://localhost:5000.

More detailed Windows and MySQL Workbench steps are in [README-MYSQL-SETUP.md](README-MYSQL-SETUP.md).

## How it works, quickly

1. A donor signs up and can use the app straight away.
2. A hospital or lab signs up and stays pending until the admin approves it.
3. Labs add their blood stock and record donations as they happen.
4. Hospitals send a request to a lab. The lab approves or rejects it, and stock updates accordingly.
5. Labs can organise camps, which donors can see in their dashboard.

## A few things to know

- Change the default admin password and the `JWT_SECRET` before putting this anywhere public.
- Never commit your `.env` file. It is already in `.gitignore`.
- If you already have an older version of the database, run `backend/sql/upgrade_mysql8_existing.sql` once instead of dropping everything.

## Things I would like to add

- Email or SMS alerts for urgent blood requests
- Search donors by distance
- Charts for stock levels over time
- Tests for the API

## Contributing

Suggestions and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

Released under the MIT License. See [LICENSE](LICENSE) for details.

## Author

Dilwinder Singh · [@dilwinder-singh](https://github.com/dilwinder-singh)
