# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**clan-node** is a family tree / genealogy management system built as a directed graph application. Users can interactively build family relationships through drag-and-drop nodes, with dynamic Chinese kinship title calculations (e.g., "伯父", "叔叔", "阿姨").

## Architecture

The application is designed around the **Cloudflare serverless stack**:

| Component | Technology |
|-----------|------------|
| Frontend | React + React Flow (deployed to Cloudflare Pages) |
| Backend API | Cloudflare Workers (TypeScript with Hono framework) |
| Database | Cloudflare D1 (SQLite) |
| Media Storage | Cloudflare R2 (for avatars) |

### Core Data Model

The system stores **absolute relationships** only (parent-child, spouse), not relative titles. Titles are computed dynamically via graph pathfinding from a "center" person (ego) to target nodes.

**Tables:**
- `people`: id (UUID), name, gender (M/F/O), dob, avatar_url, created_at
- `relationships`: id, from_person_id, to_person_id, type (parent_child/spouse), meta

### Kinship Algorithm

The key algorithm:
1. Use BFS to find shortest path from "me" to target person
2. Map path to Chinese kinship title based on genders and ages along the path
3. Example path: `me → father → brother` = `堂兄弟` or `表兄弟` depending on genders

Optional: The kinship calculation can be implemented in Rust and compiled to WASM for use in Workers.

## Development Commands

```bash
# Initialize Cloudflare Workers project
npm create cloudflare@latest

# Run local development server
npx wrangler dev

# Deploy to Cloudflare
npx wrangler deploy

# Run D1 database migrations
npx wrangler d1 execute <DATABASE_NAME> --file=./schema.sql

# Query D1 locally
npx wrangler d1 execute <DATABASE_NAME> --local --command="SELECT * FROM people"
```

## API Endpoints

- `POST /api/person` - Create a new person
- `POST /api/link` - Create a relationship between two people
- `GET /api/graph?center={id}` - Get graph data centered on a person

## Mobile Interaction Strategy

React Flow supports touch gestures. For mobile link creation:
- Desktop: Drag from node edge to target node
- Mobile: Tap source node → tap "link" button → tap target node (to avoid drag precision issues)

## Project Status

This is a greenfield project. Implementation planning is tracked in `.auto-claude/specs/` (gitignored).
