# ArtSpace

ArtSpace is a modern art-focused social platform built with Express, EJS, Aiven MySQL, and a responsive design system. The goal is to help artists showcase work, build portfolios, discover creators, and interact with a community centered on visual creativity.

## Features

- Responsive home, explore, artwork detail, upload, profile, dashboard, and admin pages
- User authentication with signup/login/logout and session-based access
- Artwork upload with validation and image optimization
- Like, bookmark, follow, and comment interactions
- Search and category filtering
- Light/dark theme support
- Admin dashboard for moderation and oversight

## Project structure

- `server.js` – application bootstrap and route handling
- `src/db/init.js` – SQLite schema and database connection
- `src/db/seed.js` – seed data for categories, demo artists, and sample artworks
- `public` – static CSS and JS assets
- `views` – EJS templates for the UI
- `uploads` – local storage for uploaded artwork files

## Quick start

1. Install dependencies:
   npm install
2. Configure `.env` from `.env.example` (Aiven MySQL + ImageKit + session secret)
3. Create the dedicated database and verify the schema:
   npm run db:create
   npm run db:verify
4. Optionally seed categories and demo content:
   npm run seed
5. Start the app:
   npm start
6. Visit http://localhost:3000 (or the `PORT` set in `.env`)

## Demo credentials

Available only after `npm run seed`:

- Admin: admin@artspace.local / admin123
- Artist: mira@artspace.local / artist123

Change or remove these demo accounts before production use.

## Design and architecture summary

### Requirements analysis

The platform targets art communities that need portfolio visibility, social engagement, and simple discovery workflows. The interface must keep artwork as the primary hero element while still supporting user interaction, moderation, and personal dashboards.

### Database schema

Core tables include:

- `users`
- `categories`
- `artworks`
- `comments`
- `likes`
- `bookmarks`
- `follows`
- `notifications`
- `reports`

This supports a lightweight but scalable social network model for creator discovery and content engagement.

### Application architecture

- Presentation: Express + EJS + responsive CSS
- Data layer: Aiven MySQL for relational metadata and content tracking
- File handling: Multer + Sharp for uploads and thumbnail generation
- Security: bcrypt password hashing, session middleware, rate limiting, and validation
- Deployment: Node.js app running behind standard web server or container

### Development phases

1. Foundation and database setup
2. Authentication and profiles
3. Artwork upload and gallery features
4. Social interactions and notifications
5. Admin moderation and analytics
6. UI polishing and responsive refinement

### Security requirements

- Password hashing with bcrypt
- Session-based authentication
- File type validation for image uploads
- File size limits and storage restrictions
- Role checks for admin-only routes
- Sanitized user-generated content before persistence
- Rate limiting for authentication and upload endpoints

## License

MIT
