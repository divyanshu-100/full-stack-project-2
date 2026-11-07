# Mini Social

Profiles, posts, comments, likes and follows. Express + SQLite backend, plain HTML/CSS/JS frontend.

## Run
```
npm install
npm start        # http://localhost:3000
```
Needs Node 18+. The database file `social.db` is created on first run.
To test follows, open a second browser (or a private window) and sign up as another user.

## Database tables
users, sessions, posts, comments, likes (user_id + post_id), follows (follower_id + followee_id)

## API (all except register/login need `Authorization: Bearer <token>`)
| Method | Route | Purpose |
|---|---|---|
| POST | /api/register, /api/login | Sign up / log in |
| GET | /api/feed?scope=all | Feed (default: you + people you follow) |
| POST / DELETE | /api/posts, /api/posts/:id | Create / delete own post |
| POST | /api/posts/:id/like | Toggle like |
| GET / POST | /api/posts/:id/comments | List / add comments |
| GET | /api/users/:username | Profile with counts and posts |
| POST | /api/users/:username/follow | Toggle follow |
| PUT | /api/me | Update your bio |
