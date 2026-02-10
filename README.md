# Orchestro

A minimalist, modern, and open-source Vercel alternative for container deployments.

## Features
- **Fast**: Go-powered backend for container orchestration.
- **Modern UI**: AMOLED dark mode with Instrument Serif titles.
- **Git Integration**: Clone and build from public repositories.
- **Minimalist**: Designed for single-VPS setups.

## Tech Stack
- **Backend**: Go (Gin, Docker SDK, GORM)
- **Frontend**: Next.js (React, Tailwind CSS v4)
- **Database**: SQLite
- **Orchestration**: Docker

## Getting Started

### Prerequisites
- Docker & Docker Compose
- Git

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
