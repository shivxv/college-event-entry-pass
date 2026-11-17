# college-event-entry-pass

A secure full-stack entry-pass portal for two college events held on the same day:

- **Fresher’s Party** — junior students
- **Farewell Party** — senior students

There is no online payment gateway. Fees are collected and verified offline at the college counter.

## Features

- Student registration: full name, college ID, email, phone, branch, year, and event type
- Pending payment status by default
- JWT-authenticated admin dashboard with search and payment filters
- Atomic offline payment approval and generation of a 256-bit pass token
- Public **Get My Pass** lookup using college ID plus registered phone
- Printable and downloadable paid passes with QR codes
- JWT-authenticated gate scanner for the administrator
- Atomic first-entry protection: `ENTRY ALLOWED`, `ENTRY ALREADY USED`, or `INVALID PASS — ENTRY DENIED`

## Requirements

- Node.js 18.18 or newer
- npm
- MongoDB Community Server or MongoDB Atlas
- A camera-capable device and HTTPS for mobile camera scanning (localhost works for development)

## Setup

### Quick start

Run these steps from separate PowerShell terminals in the project root:

```powershell
# Terminal 1: MongoDB must already be running
cd backend
Copy-Item .env.example .env
npm install
npm run dev

# Terminal 2
cd frontend
npm install
npm run dev
```

Keep both terminals running while using the website. Configure the required values in `backend/.env` before starting the API.

### 1. Backend environment

```powershell
cd backend
Copy-Item .env.example .env
npm install
```

Edit `backend/.env`:

```dotenv
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/college_event_entry_pass
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters
BOOTSTRAP_ADMIN_TOKEN=replace-with-a-separate-random-secret-at-least-32-characters
EVENT_DATE=2026-11-20
CLIENT_ORIGIN=http://localhost:5173
PUBLIC_API_URL=http://localhost:5000
```

Generate secrets with PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Use a separate result for `JWT_SECRET` and `BOOTSTRAP_ADMIN_TOKEN`. In production, use HTTPS URLs for both `CLIENT_ORIGIN` and `PUBLIC_API_URL`, and clear `BOOTSTRAP_ADMIN_TOKEN` after creating the first admin.

### 2. Start MongoDB and the API

Start MongoDB locally, or set `MONGODB_URI` to an Atlas connection string.

```powershell
cd backend
npm run dev
```

The API runs at `http://localhost:5000`.

### 3. Frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`. The frontend uses `/api` through its development proxy.

To build the frontend:

```powershell
cd frontend
npm run build
```

Set `frontend/.env.local` only when the API uses another origin:

```dotenv
VITE_API_URL=https://api.example.edu
```

### Troubleshooting

- If the API reports `ECONNREFUSED` for MongoDB, verify MongoDB is running and confirm `MONGODB_URI` points to that server.
- If the API reports a missing JWT secret, set a private value of at least 32 characters in `JWT_SECRET` and restart the backend.
- If camera access is unavailable on a phone, open the frontend through HTTPS or your computer’s reachable localhost address, then allow camera permission in the browser.
- If registration works but pass lookup is blocked, confirm the fee has been marked paid from the admin dashboard and the student is entering the exact registered phone number.

## Create the first admin

The bootstrap endpoint is protected by `BOOTSTRAP_ADMIN_TOKEN` and can create the one allowed admin account. Call it once:

```powershell
Invoke-RestMethod -Uri http://localhost:5000/api/auth/bootstrap-admin -Method Post -ContentType 'application/json' -Body '{"bootstrapToken":"YOUR_BOOTSTRAP_ADMIN_TOKEN","username":"admin","password":"a-long-private-password"}'
```

Use the administrator's name as the username and a password of at least 12 characters. Remove the bootstrap token setting after creating the account.

Then sign in through **Staff access** in the website. Only this administrator account can sign in.

Manual password recovery uses a separate private token. Set `ADMIN_RECOVERY_TOKEN` in Render to a strong random value of at least 32 characters; do not share or reuse the bootstrap token. If the administrator forgets the password, select **Forgot password?**, then enter the admin username, recovery token, and new password. Recovery attempts are rate-limited. Changing or resetting a password invalidates existing admin sessions.

The signed-in administrator can choose **Change password** from the navigation. The current password is required, and the new password must be at least 12 characters.

## Student workflow

1. A student registers through the public registration form.
2. The registration defaults to `paymentStatus: pending` and its entry state remains unentered.
3. The administrator collects the fee at the college counter and uses the dashboard to mark the student paid.
4. Payment approval atomically creates one cryptographically random pass token and unlocks the pass.
5. The student opens **Get my pass**, enters the college ID and registered phone, and downloads or prints the pass.

## Gate workflow

1. The administrator signs in through **Staff access**.
2. The administrator opens the gate scanner and permits camera access.
3. The scanned pass is sent with the administrator JWT to the backend.
4. The API atomically changes an unpaid, unknown, or already-used pass into the appropriate result:
   - Valid first scan: `ENTRY ALLOWED`
   - Used pass: `ENTRY ALREADY USED`
   - Unknown or unpaid pass: `INVALID PASS — ENTRY DENIED`

## Important API routes

- `POST /api/registrations` — public student registration
- `POST /api/passes/my-pass` — public paid-pass lookup
- `POST /api/auth/login` — administrator JWT login
- `POST /api/auth/change-password` — change the administrator password
- `POST /api/auth/forgot-password` — reset the administrator password using the private manual recovery token
- `POST /api/auth/bootstrap-admin` — one-time initial admin creation
- `GET /api/admin/students` — authenticated admin registration list/search/filter
- `POST /api/admin/students/approve-payment` — authenticated offline payment approval
- `POST /api/gate/verify` — authenticated atomic pass check-in

Administrator requests require `Authorization: Bearer <JWT>`.

## Security notes

- Students cannot change payment or entry fields through registration routes.
- Pass tokens are 256-bit random values and are not exposed in student lists or public registration responses.
- MongoDB selects pass tokens only for paid-pass retrieval.
- Gate entry uses an atomic conditional `findOneAndUpdate`; this prevents two gates from entering the same pass concurrently.
- JWT signing keys and bootstrap credentials must remain private and should be deployed through environment-specific secrets.
- Keep `PUBLIC_API_URL` on HTTPS outside local development.
