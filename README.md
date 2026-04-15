# Cloud Kitchen Startup Mode

Responsive full-stack cloud kitchen web app built from your Figma export:

- `Node.js` backend (no external packages) in [server.js](/D:/Cloud Kitchen Startup Mode/server.js)
- Responsive frontend SPA in [public/index.html](/D:/Cloud Kitchen Startup Mode/public/index.html), [public/styles.css](/D:/Cloud Kitchen Startup Mode/public/styles.css), [public/app.js](/D:/Cloud Kitchen Startup Mode/public/app.js)
- Data JSON files in `server/data`
- Figma images mapped in `public/assets`

## Run (JSON mode)

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Default route now serves a unified landing page with two login paths:
- Consumer login -> redirects to `/app.html`
- Admin login -> redirects to `/admin.html`

## Run (PostgreSQL mode)

1. Create `.env` in project root and copy values from [.env.example](/D:/Cloud Kitchen Startup Mode/.env.example):

```env
PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cloud_kitchen
ADMIN_KEY=change-me-in-production
ADMIN_USERNAME=manager
ADMIN_PASSWORD=manager123
```

The app/scripts now auto-load `.env` (no manual PowerShell `$env:` export required).
2. Run migrations and seed:

```bash
npm install
npm run db:migrate
npm run db:seed
```

3. Start Postgres-backed server:

```bash
npm run start:db
```

This mode uses:
- [server.postgres.js](/D:/Cloud Kitchen Startup Mode/server.postgres.js)
- [db/migrations/001_init.sql](/D:/Cloud Kitchen Startup Mode/db/migrations/001_init.sql)
- [db/seeds/001_seed.sql](/D:/Cloud Kitchen Startup Mode/db/seeds/001_seed.sql)
- [scripts/migrate.js](/D:/Cloud Kitchen Startup Mode/scripts/migrate.js)
- [scripts/seed.js](/D:/Cloud Kitchen Startup Mode/scripts/seed.js)

## Admin Dashboard (Kitchen Manager)

- Open [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
- Login from landing page `/` using `ADMIN_USERNAME` + `ADMIN_PASSWORD`.
- Features:
  - Live operations KPIs
  - Full order queue monitoring
  - Assign chef to order
  - Update order status
  - Chef duty toggle and workload visibility

## Features

- Responsive layout for mobile/tablet/desktop
- Menu listing with category + search
- Cart add/update flow connected to backend
- Offer code application and pricing totals
- Auth (register/login) via backend APIs
- Checkout and order placement API

## Production Deploy (Customer + Admin Live)

Deploy in two parts:

1. Backend (`server.postgres.js`) on a Node host (Render/Railway/Fly/EC2).
2. Frontend (landing + customer-react + admin-react) on Netlify.

### 1) Deploy Backend

- Start command: `npm run start:db`
- Required env vars:
  - `DATABASE_URL`
  - `ADMIN_KEY`
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD`
  - `PAYMENT_PROVIDER`
  - `PAYMENT_CURRENCY`
  - `UPI_RECEIVER_VPA`
  - `UPI_RECEIVER_NAME`
- Keep `PORT` managed by the host (Render/Railway auto-provides it).

After deploy, copy your backend public URL (example: `https://ck-backend.onrender.com`).

### 2) Deploy Frontend on Netlify

This repo includes [netlify.toml](/D:/Cloud Kitchen Startup Mode/netlify.toml) configured to:
- build both React apps
- publish from `public`
- support SPA routing for `/customer-react/*` and `/admin-react/*`
- proxy `/api/*` and `/assets/*` to backend

Before deploying, edit [netlify.toml](/D:/Cloud Kitchen Startup Mode/netlify.toml) and replace:
- `https://YOUR-BACKEND-DOMAIN` with your real backend URL

Then push and redeploy.

### 3) Netlify Build Settings

- Build command: from `netlify.toml` (no manual override needed)
- Publish directory: from `netlify.toml` (no manual override needed)

Optional (recommended):
- Set `VITE_API_BASE` in Netlify env to your backend URL. Both React apps can use it directly.

### 4) Go-Live URLs

- Landing: `https://<your-netlify-site>/`
- Customer app: `https://<your-netlify-site>/customer-react/`
- Admin app: `https://<your-netlify-site>/admin-react/`
