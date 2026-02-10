# Orchestro

A minimalist, modern, and open-source Vercel alternative for container deployments.

### Running Locally
1. Clone the repository.
2. Run `docker-compose up --build`.
3. Open `http://localhost:3000` in your browser.

## Architecture
- `/api`: Go backend handling Docker API and project state.
- `/web`: Next.js dashboard.
- `docker-compose.yml`: Orchestrates the platform itself.

## License
MIT
