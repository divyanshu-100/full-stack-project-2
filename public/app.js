const $ = (s) => document.querySelector(s);
const app = $('#app');
let token = localStorage.getItem('token'), me = localStorage.getItem('me');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString();

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.id);
  toast.id = setTimeout(() => (t.hidden = true), 2500);
}

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) logout();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function logout() {
  localStorage.clear(); token = me = null;
  render();
}

// ---------- Views ----------
function postHTML(p) {
  return `<article class="card" data-id="${p.id}">
    <a class="user" href="#/u/${esc(p.username)}">@${esc(p.username)}</a><time>${when(p.created_at)}</time>
    <p>${esc(p.content)}</p>
    <div class="actions">
      <button data-act="like" class="${p.liked ? 'on' : ''}">${p.liked ? '♥' : '♡'} ${p.likes}</button>
      <button data-act="comments">💬 ${p.comments}</button>
      ${p.username === me ? '<button data-act="delete">Delete</button>' : ''}
    </div>
    <div class="comments" hidden></div>
  </article>`;
}

function authView() {
  app.innerHTML = `<form id="authForm" class="card"><h2>Welcome</h2>
    <input name="username" placeholder="Username" required>
    <input name="password" type="password" placeholder="Password (6+ characters)" required>
    <button value="login">Log in</button><button value="register" class="alt">Sign up</button></form>`;
}

async function feedView(scope) {
  const posts = await api('/feed?scope=' + scope);
  app.innerHTML = `<form id="postForm" class="card">
      <textarea maxlength="280" placeholder="What's happening?" required></textarea><button>Post</button></form>
    <div class="tabs"><a href="#/" class="${scope === 'following' ? 'on' : ''}">Following</a>
      <a href="#/all" class="${scope === 'all' ? 'on' : ''}">Everyone</a></div>`
    + (posts.map(postHTML).join('') || '<p class="muted">Nothing here yet. Follow people or switch to Everyone.</p>');
}

async function profileView(name) {
  const u = await api('/users/' + encodeURIComponent(name));
  const action = u.isMe
    ? `<form id="bioForm"><input maxlength="160" value="${esc(u.bio)}" placeholder="Write a short bio"><button>Save</button></form>`
    : `<button data-act="follow" data-user="${esc(u.username)}" class="${u.isFollowing ? 'on' : ''}">${u.isFollowing ? 'Following' : 'Follow'}</button>`;
  app.innerHTML = `<section class="card"><h2>@${esc(u.username)}</h2>
    <p>${esc(u.bio) || '<span class="muted">No bio yet</span>'}</p>
    <p class="muted"><b>${u.followers}</b> followers · <b>${u.following}</b> following · <b>${u.posts.length}</b> posts</p>
    ${action}</section>` + u.posts.map(postHTML).join('');
}

async function toggleComments(card, forceOpen) {
  const box = card.querySelector('.comments');
  box.hidden = forceOpen ? false : !box.hidden;
  if (box.hidden) return;
  const list = await api(`/posts/${card.dataset.id}/comments`);
  card.querySelector('[data-act=comments]').textContent = '💬 ' + list.length;
  box.innerHTML = list.map((c) => `<p><a href="#/u/${esc(c.username)}">@${esc(c.username)}</a> ${esc(c.content)}</p>`).join('')
    + '<form class="commentForm"><input maxlength="200" placeholder="Write a comment…" required><button>Send</button></form>';
}

async function render() {
  $('#nav').hidden = !token;
  if (!token) return authView();
  $('#me').href = '#/u/' + me;
  const [, page, arg] = location.hash.split('/');
  try {
    if (page === 'u') await profileView(decodeURIComponent(arg || ''));
    else await feedView(page === 'all' ? 'all' : 'following');
  } catch (e) {
    app.innerHTML = `<p class="card">${esc(e.message)}</p>`;
  }
}

// ---------- Events ----------
app.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const card = b.closest('.card');
  try {
    if (b.dataset.act === 'like') {
      const r = await api(`/posts/${card.dataset.id}/like`, 'POST');
      b.textContent = `${r.liked ? '♥' : '♡'} ${r.likes}`;
      b.classList.toggle('on', r.liked);
    } else if (b.dataset.act === 'comments') {
      await toggleComments(card);
    } else if (b.dataset.act === 'delete' && confirm('Delete this post?')) {
      await api('/posts/' + card.dataset.id, 'DELETE');
      render();
    } else if (b.dataset.act === 'follow') {
      await api(`/users/${encodeURIComponent(b.dataset.user)}/follow`, 'POST');
      render();
    }
  } catch (err) { toast(err.message); }
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, val = f.querySelector('input, textarea').value;
  try {
    if (f.id === 'authForm') {
      const d = await api('/' + e.submitter.value, 'POST', { username: f.username.value.trim(), password: f.password.value });
      token = d.token; me = d.username;
      localStorage.setItem('token', token); localStorage.setItem('me', me);
      location.hash = '#/';
      render();
    } else if (f.id === 'postForm') {
      await api('/posts', 'POST', { content: val });
      render();
    } else if (f.id === 'bioForm') {
      await api('/me', 'PUT', { bio: val });
      toast('Bio saved');
    } else if (f.classList.contains('commentForm')) {
      const card = f.closest('.card');
      await api(`/posts/${card.dataset.id}/comments`, 'POST', { content: val });
      await toggleComments(card, true);
    }
  } catch (err) { toast(err.message); }
});

$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  location.hash = '#/u/' + encodeURIComponent(e.target.querySelector('input').value.trim());
  e.target.reset();
});
$('#logout').addEventListener('click', logout);
addEventListener('hashchange', render);
render();
