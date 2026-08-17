# F5R Project Setup Guide

## Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)

## Quick Start

### 1. Install Dependencies

```bash
cd f5s-connect
npm install
```

### 2. Set Up Environment Variables

Create a `.env` file in the `f5s-connect` directory with the following variables:

```env
# Required for JWT authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Required for encrypting sensitive data (must be exactly 32 bytes)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef

# Optional: Database path (defaults to .data/app.sqlite)
# DB_PATH=.data/app.sqlite

# Optional: Server port (defaults to 8787)
# PORT=8787

# Optional: Demo password for test accounts (defaults to "demo1234")
# DEMO_PASSWORD=demo1234

# Optional: Disable background workers (set to "0" to disable)
# WORKERS_ENABLED=1

# Optional: Public URL of the Node backend
# BASE_PUBLIC_URL=https://backend.example.com

# Optional: Put the public Salla webhook endpoint on WordPress.
# When set, F5R registers/displays https://your-wordpress.com/wp-json/f5r/v1/salla/<publicId>
# WORDPRESS_PUBLIC_URL=https://your-wordpress.com
```

**Quick way to generate ENCRYPTION_KEY:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Run the Project

#### Option A: Run Both Frontend and Backend Together (Recommended)

```bash
npm run dev:full
```

This starts:
- **Backend server** on `http://localhost:8787`
- **Frontend dev server** on `http://localhost:8080` (proxies API calls to backend)

#### Option B: Run Separately

**Terminal 1 - Backend:**
```bash
npm run server:dev
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

### 4. Access the Application

- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:8787/api
- **Health Check**: http://localhost:8787/api/health

## Login Credentials

### Admin Account
- **Email**: `admin@f5s.sa`
- **Password**: `demo1234` (or your `DEMO_PASSWORD` env var)

### Seller Account
- **Email**: `seller@f5s.sa`
- **Password**: `demo1234` (or your `DEMO_PASSWORD` env var)

> **Note**: Demo accounts are automatically created in development mode (when `NODE_ENV !== "production"`).

## Production Build

### Build for Production

```bash
npm run build
```

### Run Production Server

```bash
npm start
```

The production server will:
- Serve the built frontend from `dist/`
- Run the Express API
- Use port 8787 (or your `PORT` env var)

### Run Database Migrations

```bash
npm run migrate
```

## Project Structure

```
f5s-connect/
├── src/              # React frontend (Vite)
├── server/           # Express backend
│   ├── db/          # Database migrations & repositories
│   ├── routes/      # API routes
│   ├── lib/         # Utilities (JWT, encryption, etc.)
│   └── workers/     # Background workers
├── public/          # Static assets
└── dist/            # Production build output
```

## Troubleshooting

### Port Already in Use

If port 8787 or 8080 is already in use:
- Change `PORT` in `.env` for backend
- Change port in `vite.config.ts` for frontend

### Database Issues

- Database is created automatically at `.data/app.sqlite`
- To reset: delete `.data/app.sqlite` and restart the server
- Migrations run automatically on startup

### Missing Environment Variables

If you see errors about `JWT_SECRET` or `ENCRYPTION_KEY`:
- Make sure `.env` file exists in `f5s-connect/` directory
- Check that `ENCRYPTION_KEY` is exactly 32 bytes (64 hex characters or 44 base64 characters)

## Development Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Start frontend dev server only |
| `npm run dev:full` | Start both frontend and backend |
| `npm run server:dev` | Start backend with auto-reload |
| `npm run server:start` | Start backend (production mode) |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run migrate` | Run database migrations |
| `npm test` | Run tests |
| `npm run lint` | Run linter |

## Additional Notes

- The frontend uses Vite with HMR (Hot Module Replacement) for fast development
- The backend uses `tsx` for TypeScript execution
- SQLite database is used (no separate database server needed)
- Background workers handle order fulfillment and webhook processing
