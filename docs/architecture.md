# ArtSpace Architecture

## System overview

ArtSpace is a server-rendered social media platform focused on visual art. The application uses a single Node.js process with SQLite as the persistence layer, EJS templates for the UI, and static asset support for CSS, JavaScript, and uploaded artwork.

## Core components

### 1. Web application layer

- Express app with route handlers for pages and actions
- EJS templates with reusable partials for headers, footers, and cards
- Theme toggle and lightweight client-side behaviors via a shared script

### 2. Persistence layer

- Aiven MySQL database with relational tables for users, content, engagement, and moderation
- Tables are created automatically with `CREATE TABLE IF NOT EXISTS` on app startup
- Seed data creates categories and a demo artist/admin setup

### 3. Media upload layer

- Multer handles multipart uploads
- Sharp resizes and optimizes uploaded files for web delivery
- Stored files are served from the `uploads` directory

### 4. Security layer

- bcrypt password hashing
- Express session authentication
- middleware-based route protection
- rate limiting and content validation

## Database schema

```sql
users (
  id, name, username, email, password, avatar, bio,
  role, status, email_verified_at, created_at, updated_at
)

categories (
  id, name, slug, description, sort_order, created_at, updated_at
)

artworks (
  id, user_id, category_id, title, description, tags,
  image_url, thumbnail_url, visibility, is_published, status,
  created_at, updated_at
)

comments (
  id, user_id, artwork_id, body, created_at, updated_at
)

likes (
  id, user_id, artwork_id, created_at
)

bookmarks (
  id, user_id, artwork_id, created_at
)

follows (
  id, follower_id, following_id, created_at
)

notifications (
  id, user_id, actor_id, type, artwork_id, message, is_read, created_at
)

password_reset_tokens (
  id, user_id, token_hash, expires_at, used_at, created_at
)
```

## Functional modules

- Authentication
- Profile management
- Artwork publishing
- Search and filtering
- Engagement actions
- Dashboard and analytics
- Moderation and admin tools

## Execution plan

1. Scaffold the app and database
2. Implement secure authentication
3. Ship the gallery and artwork pages
4. Add upload, likes, follows, and comments
5. Build dashboards and admin tooling
6. Finalize UI polish and responsive styling

## Security considerations

- Protect admin-only routes and role-sensitive actions
- Restrict uploads to approved formats and sizes
- Prevent duplicate likes/follows via unique constraints
- Normalize user input before storing or displaying it
- Use environment variables for session and app secrets
