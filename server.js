const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

// ---------- Database ----------
const db = new Database(path.join(__dirname, 'social.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
  bio TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS likes(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, post_id));
CREATE TABLE IF NOT EXISTS follows(
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(follower_id, followee_id), CHECK(follower_id != followee_id));
`);

// ---------- Helpers ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const startSession = (userId) => {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?)').run(token, userId);
  return token;
};
const findUser = (name) => db.prepare('SELECT id, username, bio, created_at FROM users WHERE username = ?').get(name);
const postExists = (id) => db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id);

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = db.prepare(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'Please log in' });
  req.user = user;
  next();
}

const POST_SQL = `
  SELECT p.id, p.content, p.created_at, u.username,
    (SELECT COUNT(*) FROM likes WHERE post_id = p.id) AS likes,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) AS comments,
    EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = @me) AS liked
  FROM posts p JOIN users u ON u.id = p.user_id`;

// ---------- Auth ----------
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!/^\w{3,20}$/.test(username || '') || (password || '').length < 6)
    return res.status(400).json({ error: 'Username: 3-20 letters/digits/_. Password: 6+ characters.' });
  if (findUser(username)) return res.status(409).json({ error: 'Username already taken' });
  const salt = crypto.randomBytes(16).toString('hex');
  const id = db.prepare('INSERT INTO users(username, salt, hash) VALUES(?,?,?)')
    .run(username, salt, hashPw(password, salt)).lastInsertRowid;
  res.json({ token: startSession(id), username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(password || '', u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  if (!ok) return res.status(401).json({ error: 'Wrong username or password' });
  res.json({ token: startSession(u.id), username: u.username });
});

// ---------- Posts ----------
app.get('/api/feed', auth, (req, res) => {
  const where = req.query.scope === 'all' ? '' :
    'WHERE p.user_id = @me OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = @me)';
  res.json(db.prepare(`${POST_SQL} ${where} ORDER BY p.id DESC LIMIT 50`).all({ me: req.user.id }));
});

app.post('/api/posts', auth, (req, res) => {
  const content = (req.body.content || '').trim();
  if (!content || content.length > 280) return res.status(400).json({ error: 'Post must be 1-280 characters' });
  db.prepare('INSERT INTO posts(user_id, content) VALUES(?,?)').run(req.user.id, content);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(+req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Post not found' });
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  const id = +req.params.id;
  if (!postExists(id)) return res.status(404).json({ error: 'Post not found' });
  const removed = db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?').run(req.user.id, id);
  if (!removed.changes) db.prepare('INSERT INTO likes VALUES(?,?)').run(req.user.id, id);
  const likes = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(id).c;
  res.json({ liked: !removed.changes, likes });
});

// ---------- Comments ----------
app.get('/api/posts/:id/comments', auth, (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.content, c.created_at, u.username FROM comments c
    JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id`).all(+req.params.id));
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const id = +req.params.id, content = (req.body.content || '').trim();
  if (!postExists(id)) return res.status(404).json({ error: 'Post not found' });
  if (!content || content.length > 200) return res.status(400).json({ error: 'Comment must be 1-200 characters' });
  db.prepare('INSERT INTO comments(post_id, user_id, content) VALUES(?,?,?)').run(id, req.user.id, content);
  res.json({ ok: true });
});

// ---------- Profiles & follows ----------
app.get('/api/users/:username', auth, (req, res) => {
  const u = findUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const count = (sql) => db.prepare(sql).get(u.id).c;
  res.json({
    username: u.username, bio: u.bio, created_at: u.created_at,
    followers: count('SELECT COUNT(*) c FROM follows WHERE followee_id = ?'),
    following: count('SELECT COUNT(*) c FROM follows WHERE follower_id = ?'),
    isFollowing: !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(req.user.id, u.id),
    isMe: u.id === req.user.id,
    posts: db.prepare(`${POST_SQL} WHERE p.user_id = @uid ORDER BY p.id DESC`).all({ me: req.user.id, uid: u.id }),
  });
});

app.post('/api/users/:username/follow', auth, (req, res) => {
  const u = findUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself" });
  const removed = db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user.id, u.id);
  if (!removed.changes) db.prepare('INSERT INTO follows VALUES(?,?)').run(req.user.id, u.id);
  res.json({ following: !removed.changes });
});

app.put('/api/me', auth, (req, res) => {
  const bio = (req.body.bio || '').trim();
  if (bio.length > 160) return res.status(400).json({ error: 'Bio must be 160 characters or fewer' });
  db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mini Social running at http://localhost:${PORT}`));
