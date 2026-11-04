# ArtSpace Architecture

## System overview

ArtSpace is a server-rendered social media platform focused on visual art. The application uses a single Node.js process with SQLite as the persistence layer, EJS templates for the UI, and static asset support for CSS, JavaScript, and uploaded artwork.

## Core components

### 1. Web application layer

- Express app with route handlers for pages and actions
- EJS templates with reusable partials for headers, footers, and cards
- Theme toggle and lightweight client-side behaviors via a shared script

### 2. Persistence layer

- SQLite database with relational tables for users, content, engagement, and moderation
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
  id, username, email, password_hash, display_name, bio,
  avatar, cover_image, website, instagram, twitter,
  role, is_verified, created_at
)

categories (
  id, name, slug, sort_order
)

artworks (
  id, user_id, category_id, title, description, tags,
  image_url, thumbnail_url, visibility, is_published,
  created_at, updated_at
)

comments (
  id, artwork_id, user_id, parent_id, body, created_at
)

likes (
  id, artwork_id, user_id, created_at
)

bookmarks (
  id, artwork_id, user_id, created_at
)

follows (
  id, follower_id, following_id, created_at
)

notifications (
  id, recipient_id, actor_id, type, message, link, is_read, created_at
)

reports (
  id, reporter_id, target_type, target_id, reason, created_at
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
