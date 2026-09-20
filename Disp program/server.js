const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const sessions = new Map();

const send = (response, status, body, contentType = 'application/json; charset=utf-8', extraHeaders = {}) => {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders
  });
  response.end(body);
};

const readJson = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
const writeJson = async (file, value) => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${file}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(value, null, 2));
  await fs.rename(tempFile, file);
};
const readBody = (request) => new Promise((resolve, reject) => {
  let body = '';
  request.on('data', chunk => {
    body += chunk;
    if (body.length > 2_000_000) request.destroy(new Error('Request body too large'));
  });
  request.on('end', () => resolve(body));
  request.on('error', reject);
});
const parseCookies = request => Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(part => {
  const [name, ...value] = part.trim().split('=');
  return [name, decodeURIComponent(value.join('='))];
}));
const createPasswordHash = password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};
const verifyPassword = (password, stored) => {
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return expected && actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};
const publicUser = user => ({ id: user.id, name: user.name, email: user.email });
const userStateFile = userId => path.join(DATA_DIR, `state-${userId}.json`);
const requireUser = async request => {
  const token = parseCookies(request).xusan_session;
  const userId = token && sessions.get(token);
  if (!userId) return null;
  const users = await readJson(USERS_FILE, []);
  return users.find(user => user.id === userId) || null;
};
const issueSession = (response, user) => {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  response.sessionHeader = `xusan_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
};
const defaultState = { todos: [], habits: [] };

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') return send(response, 204, '');
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return send(response, 200, JSON.stringify({ ok: true, service: 'xusan-backend', auth: true }));
    }

    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      const payload = JSON.parse(await readBody(request));
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      if (name.length < 2 || !email.includes('@') || password.length < 8) return send(response, 400, JSON.stringify({ error: 'Ism, email va kamida 8 belgili parol kerak' }));
      const users = await readJson(USERS_FILE, []);
      if (users.some(user => user.email === email)) return send(response, 409, JSON.stringify({ error: 'Bu email allaqachon ro‘yxatdan o‘tgan' }));
      const user = { id: crypto.randomUUID(), name, email, passwordHash: createPasswordHash(password), createdAt: new Date().toISOString() };
      users.push(user);
      await writeJson(USERS_FILE, users);
      issueSession(response, user);
      return send(response, 201, JSON.stringify({ user: publicUser(user) }), 'application/json; charset=utf-8', { 'Set-Cookie': response.sessionHeader });
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const payload = JSON.parse(await readBody(request));
      const email = String(payload.email || '').trim().toLowerCase();
      const password = String(payload.password || '');
      const users = await readJson(USERS_FILE, []);
      const user = users.find(item => item.email === email);
      if (!user || !verifyPassword(password, user.passwordHash)) return send(response, 401, JSON.stringify({ error: 'Email yoki parol noto‘g‘ri' }));
      issueSession(response, user);
      return send(response, 200, JSON.stringify({ user: publicUser(user) }), 'application/json; charset=utf-8', { 'Set-Cookie': response.sessionHeader });
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const user = await requireUser(request);
      if (!user) return send(response, 401, JSON.stringify({ error: 'Kirish talab qilinadi' }));
      return send(response, 200, JSON.stringify({ user: publicUser(user) }));
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      const token = parseCookies(request).xusan_session;
      if (token) sessions.delete(token);
      return send(response, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8', { 'Set-Cookie': 'xusan_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }

    if (url.pathname === '/api/state' && (request.method === 'GET' || request.method === 'PUT')) {
      const user = await requireUser(request);
      if (!user) return send(response, 401, JSON.stringify({ error: 'Kirish talab qilinadi' }));
      const stateFile = userStateFile(user.id);
      if (request.method === 'GET') return send(response, 200, JSON.stringify({ state: await readJson(stateFile, null) }));
      const payload = JSON.parse(await readBody(request));
      if (!payload || !Array.isArray(payload.todos) || !Array.isArray(payload.habits)) return send(response, 400, JSON.stringify({ error: 'State formati noto‘g‘ri' }));
      await writeJson(stateFile, { ...payload, updatedAt: new Date().toISOString() });
      return send(response, 200, JSON.stringify({ ok: true }));
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await fs.readFile(path.join(ROOT, 'index.html'));
      return send(response, 200, html, 'text/html; charset=utf-8');
    }
    return send(response, 404, JSON.stringify({ error: 'Topilmadi' }));
  } catch (error) {
    console.error(error);
    return send(response, 500, JSON.stringify({ error: 'Server xatosi' }));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Xusan backend: http://localhost:${PORT}`));
