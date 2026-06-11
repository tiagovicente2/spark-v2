import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { exec } from 'child_process';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Ensure directories exist
const storageDir = path.join(rootDir, 'storage');
const sitesDir = path.join(storageDir, 'sites');
const uploadsDir = path.join(storageDir, 'uploads');
const tempDir = path.join(storageDir, 'temp');

[storageDir, sitesDir, uploadsDir, tempDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Setup SQLite database using node:sqlite
const dbPath = path.join(storageDir, 'spark.db');
const db = new DatabaseSync(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    site_id TEXT,
    collection_name TEXT,
    data TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT,
    action TEXT,
    details TEXT,
    timestamp TEXT
  );

  CREATE TABLE IF NOT EXISTS profiles (
    email TEXT PRIMARY KEY,
    name TEXT,
    role TEXT,
    team TEXT,
    slack TEXT,
    avatar TEXT,
    updated_at TEXT
  );
`);

// Helper to add logs
function addLog(siteId, action, details) {
  try {
    const stmt = db.prepare('INSERT INTO logs (site_id, action, details, timestamp) VALUES (?, ?, ?, ?)');
    stmt.run(siteId, action, details, new Date().toISOString());
  } catch (err) {
    console.error('Error writing log:', err);
  }
}

// Multer for file uploads (CLI deploys and client storage uploads)
const upload = multer({ dest: tempDir });

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.use(express.json());

// Helper to determine the site context from Host or URL Path
function getSiteContext(req) {
  const host = req.headers.host || '';
  const hostname = host.split(':')[0]; // remove port
  const parts = hostname.split('.');
  
  // 1. Check production base domain from env
  const baseDomain = process.env.SPARK_BASE_DOMAIN || process.env.QUICK_BASE_DOMAIN;
  if (baseDomain && hostname.endsWith(`.${baseDomain}`)) {
    const subdomain = hostname.slice(0, -(baseDomain.length + 1));
    if (subdomain && subdomain !== 'www') {
      return subdomain;
    }
  }
  
  // 2. Check subdomain: e.g. mysite.localhost or mysite.spark.local
  if (parts.length > 1 && (parts[parts.length - 1] === 'localhost' || hostname.endsWith('.local'))) {
    if (parts.length === 2 && parts[1] === 'localhost' && parts[0] !== 'www') {
      return parts[0];
    }
    if (parts.length > 2 && parts[0] !== 'www') {
      return parts[0];
    }
  }
  
  // 3. Check query param or header (for CLI or explicit requests)
  if (req.query.site) {
    return req.query.site;
  }
  if (req.headers['x-spark-site'] || req.headers['x-quick-site']) {
    return req.headers['x-spark-site'] || req.headers['x-quick-site'];
  }
  
  // 4. Check path route /sites/:site/...
  const pathMatch = req.url.match(/^\/sites\/([^/]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }
  
  return null;
}

// --- IDENTITY PROXY & SIMULATION MIDDLEWARE ---
// Resolves identity from Cloudflare Access headers, Google IAP, or fallback cookies
app.use((req, res, next) => {
  req.user = resolveUser(req.headers);
  next();
});

function getDefaultUser() {
  return {
    id: 'user_dev_alex',
    name: 'Alex Beauchamp',
    email: 'alex.beauchamp@spark.engineering',
    role: 'Lead UX Engineer',
    team: 'Platform Exploration & Vibe Coding',
    slack: '@abeauchamp',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80'
  };
}

// --- INSTALLER ENDPOINTS ---
const installScriptPath = path.join(rootDir, 'install.sh');

app.get('/install.sh', (req, res) => {
  const repo = process.env.SPARK_REPO || 'tiagovicente2/spark-v2';
  // Use host header to dynamically discover the active Spark server URL
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const sparkServer = process.env.SPARK_SERVER || `${proto}://${req.headers.host}`;

  try {
    const template = fs.readFileSync(installScriptPath, 'utf8');
    const shebang = '#!/usr/bin/env bash\n';
    let scriptBody = template.startsWith(shebang)
      ? template.slice(shebang.length)
      : template;

    let header = `${shebang}`;
    header += `SPARK_REPO='${repo.replace(/'/g, "'\"'\"'")}'\n`;
    header += `export SPARK_REPO\n`;
    header += `SPARK_SERVER='${sparkServer.replace(/'/g, "'\"'\"'")}'\n`;
    header += `export SPARK_SERVER\n`;

    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(header + scriptBody);
  } catch (err) {
    console.error('Error serving install.sh:', err);
    res.status(500).send('Error reading installer script');
  }
});

// Serve installer on root '/' if requested by curl/wget
app.get('/', (req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('curl') || userAgent.includes('wget') || userAgent.includes('fetch')) {
    return res.redirect('/install.sh');
  }
  next();
});

// --- 1. DEPLOYMENT ENDPOINT (CLI) ---
app.post('/_spark/api/deploy', upload.single('archive'), (req, res) => {
  const siteId = req.query.site;
  if (!siteId || !/^[a-z0-9-]+$/.test(siteId)) {
    return res.status(400).json({ error: 'Invalid site name. Use alphanumeric characters and dashes.' });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'No archive file uploaded.' });
  }
  
  const sitePath = path.join(sitesDir, siteId);
  const zipPath = req.file.path;
  
  // Create site directory
  if (fs.existsSync(sitePath)) {
    // Overwrite behavior: clear old directory (safe cleanup)
    fs.rmSync(sitePath, { recursive: true, force: true });
  }
  fs.mkdirSync(sitePath, { recursive: true });
  
  // Extract zip using system unzip command
  exec(`unzip -o "${zipPath}" -d "${sitePath}"`, (err, stdout, stderr) => {
    // Delete temp zip file
    fs.unlinkSync(zipPath);
    
    if (err) {
      console.error('Extraction error:', err, stderr);
      return res.status(500).json({ error: 'Failed to extract website archive.' });
    }
    
    addLog(siteId, 'deploy', `Website deployed successfully. Size: ${fs.readdirSync(sitePath).length} files.`);
    
    const { domainUrl, pathUrl } = getSiteUrls(req, siteId);
    
    res.json({
      success: true,
      site: siteId,
      urls: {
        domain: domainUrl,
        path: pathUrl
      }
    });
  });
});

function getSiteUrls(req, siteId) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers.host || '';
  const hostParts = host.split(':');
  
  const baseDomain = process.env.SPARK_BASE_DOMAIN || process.env.QUICK_BASE_DOMAIN;
  
  let domainUrl;
  if (baseDomain) {
    const hasPort = hostParts.length > 1;
    const portPart = hasPort ? `:${hostParts[1]}` : '';
    domainUrl = `${proto}://${siteId}.${baseDomain}${portPart}`;
  } else {
    const port = hostParts.length > 1 ? hostParts[1] : (proto === 'https' ? '443' : '80');
    domainUrl = `${proto}://${siteId}.localhost:${port}`;
  }
  
  const pathUrl = `${proto}://${host}/sites/${siteId}/index.html`;
  
  return { domainUrl, pathUrl };
}

function hostPort(req) {
  const host = req.headers.host || '';
  const parts = host.split(':');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return parts.length > 1 ? parts[1] : (proto === 'https' ? '443' : '80');
}

app.get('/_spark/api/debug', (req, res) => {
  res.json({
    env: {
      SPARK_BASE_DOMAIN: process.env.SPARK_BASE_DOMAIN || null,
      QUICK_BASE_DOMAIN: process.env.QUICK_BASE_DOMAIN || null,
      NODE_ENV: process.env.NODE_ENV || null,
      PORT: process.env.PORT || null
    },
    headers: req.headers
  });
});

// --- 2. IDENTITY APIS ---
app.get('/_spark/api/identity', (req, res) => {
  res.json(req.user);
});

app.post('/_spark/api/identity/login', (req, res) => {
  const { name, email, role, team, slack, avatar } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }
  
  const user = {
    id: 'user_' + crypto.createHash('md5').update(email.toLowerCase().trim()).digest('hex').slice(0, 8),
    name,
    email: email.toLowerCase().trim(),
    role: role || 'Explorer',
    team: team || 'Spark Team',
    slack: slack || `@${name.toLowerCase().replace(/\s+/g, '')}`,
    avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=00f2fe&color=000&bold=true`
  };
  
  try {
    const stmt = db.prepare(`
      INSERT INTO profiles (email, name, role, team, slack, avatar, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name=excluded.name,
        role=excluded.role,
        team=excluded.team,
        slack=excluded.slack,
        avatar=excluded.avatar,
        updated_at=excluded.updated_at
    `);
    stmt.run(user.email, user.name, user.role, user.team, user.slack, user.avatar, new Date().toISOString());
  } catch (err) {
    console.error('Error saving profile to DB:', err);
  }
  
  res.cookie('spark_user', JSON.stringify(user), { maxAge: 1000 * 60 * 60 * 24 * 365, path: '/' });
  res.json({ success: true, user });
});

// --- 3. DATABASE APIS (REST + SQLite Document Store) ---
app.get('/_spark/api/db/collections', (req, res) => {
  const siteId = req.query.site;
  if (!siteId) return res.status(400).json({ error: 'Missing site parameter' });
  try {
    const rows = db.prepare('SELECT DISTINCT collection_name FROM documents WHERE site_id = ?').all(siteId);
    res.json(rows.map(r => r.collection_name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/_spark/api/db', (req, res) => {
  const siteId = getSiteContext(req);
  const { collection } = req.query;
  
  if (!siteId || !collection) {
    return res.status(400).json({ error: 'Missing site or collection context' });
  }
  
  try {
    const stmt = db.prepare('SELECT id, data, created_at, updated_at FROM documents WHERE site_id = ? AND collection_name = ? ORDER BY created_at DESC');
    const rows = stmt.all(siteId, collection);
    const docs = rows.map(r => {
      const parsed = JSON.parse(r.data);
      return { id: r.id, ...parsed, created_at: r.created_at, updated_at: r.updated_at };
    });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/_spark/api/db', (req, res) => {
  const siteId = getSiteContext(req);
  const { collection, action, id, data } = req.body;
  
  if (!siteId || !collection || !action) {
    return res.status(400).json({ error: 'Missing parameters' });
  }
  
  const now = new Date().toISOString();
  
  try {
    if (action === 'create') {
      const docId = 'doc_' + crypto.randomBytes(8).toString('hex');
      const docData = { ...data, id: docId };
      const stmt = db.prepare('INSERT INTO documents (id, site_id, collection_name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      stmt.run(docId, siteId, collection, JSON.stringify(docData), now, now);
      
      broadcastDbChange(siteId, collection, 'create', docData);
      return res.json(docData);
    } 
    
    if (action === 'update') {
      if (!id) return res.status(400).json({ error: 'Missing document id' });
      
      // Get existing document first
      const getStmt = db.prepare('SELECT data FROM documents WHERE id = ? AND site_id = ? AND collection_name = ?');
      const row = getStmt.get(id, siteId, collection);
      if (!row) return res.status(404).json({ error: 'Document not found' });
      
      const existing = JSON.parse(row.data);
      const updatedData = { ...existing, ...data, id }; // preserve ID
      
      const stmt = db.prepare('UPDATE documents SET data = ?, updated_at = ? WHERE id = ? AND site_id = ? AND collection_name = ?');
      stmt.run(JSON.stringify(updatedData), now, id, siteId, collection);
      
      broadcastDbChange(siteId, collection, 'update', updatedData);
      return res.json(updatedData);
    }
    
    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'Missing document id' });
      const stmt = db.prepare('DELETE FROM documents WHERE id = ? AND site_id = ? AND collection_name = ?');
      stmt.run(id, siteId, collection);
      
      broadcastDbChange(siteId, collection, 'delete', { id });
      return res.json({ success: true, id });
    }
    
    res.status(400).json({ error: 'Unsupported action' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 4. STORAGE API ---
app.post('/_spark/api/storage', upload.single('file'), (req, res) => {
  const siteId = getSiteContext(req);
  if (!siteId) return res.status(400).json({ error: 'Missing site context' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const siteUploadsDir = path.join(uploadsDir, siteId);
  if (!fs.existsSync(siteUploadsDir)) {
    fs.mkdirSync(siteUploadsDir, { recursive: true });
  }
  
  // Preserve original file extension
  const ext = path.extname(req.file.originalname);
  const fileName = crypto.randomBytes(8).toString('hex') + ext;
  const targetPath = path.join(siteUploadsDir, fileName);
  
  fs.renameSync(req.file.path, targetPath);
  
  const fileUrl = `${req.protocol}://${req.headers.host}/uploads/${siteId}/${fileName}`;
  addLog(siteId, 'storage', `Uploaded file: ${req.file.originalname} -> ${fileName}`);
  
  res.json({ success: true, url: fileUrl });
});

// Serve storage files statically
app.use('/uploads', express.static(uploadsDir));

// --- 5. AI PROXY (GEMINI API / MOCK CO-PILOT) ---
app.post('/_spark/api/ai/chat', async (req, res) => {
  const { messages, options } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (apiKey) {
    try {
      // Map role names if needed (assistant -> model)
      const apiContents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: apiContents })
      });
      
      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.statusText}`);
      }
      
      const result = await response.json();
      const content = result.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI model.';
      return res.json({ content });
    } catch (err) {
      console.error('Gemini API failed, falling back to mock:', err);
      // Fall through to mock
    }
  }
  
  // Mock intelligent response
  const lastUserMsg = messages[messages.length - 1]?.content || '';
  const mockResponse = getMockAIResponse(lastUserMsg);
  res.json({ content: mockResponse });
});

app.post('/_spark/api/ai/image', async (req, res) => {
  const { prompt } = req.body;
  const encodedPrompt = encodeURIComponent(prompt);
  const imageUrl = `https://image.pollinations.ai/p/${encodedPrompt}?width=512&height=512&seed=${Math.floor(Math.random()*1000000)}&nologo=true`;
  res.json({ url: imageUrl });
});

function getMockAIResponse(prompt) {
  const p = prompt.toLowerCase();
  
  if (p.includes('game') || p.includes('play')) {
    return `🎮 **Vibe Coding Game Idea!** 

Here is a quick leaderboard logic template for your game on Spark:
\`\`\`javascript
const lb = spark.db.collection('leaderboard');
// Submit score
await lb.create({ player: spark.identity.name, score: 945 });
// Live leaderboards
lb.subscribe({
  onCreate: (doc) => updateScoreboard(doc),
});
\`\`\`
Spark db has automatic WebSocket synchronization, so multiplayer is ready in minutes!`;
  }
  
  if (p.includes('hello') || p.includes('hi')) {
    return `👋 Hey! I am your AI assistant, proxied through your Spark hosting platform. 
I can help you outline apps, mock database records, or write code templates. 

*Tip: Connect a real \`GEMINI_API_KEY\` in your \`.env\` file on the server to make me act as a live Gemini 2.5 Flash assistant!*`;
  }
  
  if (p.includes('summarize') || p.includes('tasks')) {
    return `📝 **Task Summary:**
- 🚀 Deploy the Spark clone system (In Progress)
- 🧪 Build a real-time guestbook page (Completed)
- 🎨 Design a futuristic glassmorphic dashboard (To Do)

You're doing great! Keep vibing.`;
  }
  
  return `🤖 **Gemini Proxy [Mock Mode]**
Received prompt: "${prompt}"

To activate live Gemini 2.5 Flash, add your API key to the server's \`.env\` file:
\`\`\`
GEMINI_API_KEY=your_key_here
\`\`\`
Currently running in Sandbox Vibe Mode. Let me know if you need help generating HTML templates or writing JS helper routines!`;
}

// --- 6. SERVING THE CLIENT SDK ---
app.get('/_spark/spark.js', (req, res) => {
  const siteId = getSiteContext(req) || 'default';
  res.setHeader('Content-Type', 'application/javascript');
  try {
    const sdkPath = path.join(__dirname, 'sdk.js');
    let sdkCode = fs.readFileSync(sdkPath, 'utf8');
    sdkCode = sdkCode.replace('const SITE_ID = getSiteId();', `const SITE_ID = "${siteId}";`);
    res.send(sdkCode);
  } catch (err) {
    res.status(500).send(`console.error('[Spark SDK] Failed to load SDK:', "${err.message}");`);
  }
});

// --- 7. ADMIN DASHBOARD & LOGIN SERVICES ---
// Serves login page
app.get('/_spark/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'login.html'));
});

// Serves dashboard static files
app.use('/_spark/dashboard', express.static(path.join(__dirname, 'dashboard')));
app.get('/_spark/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
});

// Dashboard metrics API
app.get('/_spark/api/dashboard/metrics', (req, res) => {
  try {
    const totalSites = fs.existsSync(sitesDir) ? fs.readdirSync(sitesDir).length : 0;
    
    // Count docs
    const countRow = db.prepare('SELECT COUNT(*) as count FROM documents').get();
    const totalDocs = countRow ? countRow.count : 0;
    
    // Get distinct site IDs in db
    const sitesRow = db.prepare('SELECT DISTINCT site_id FROM documents').all();
    const dbSitesCount = sitesRow.length;
    
    // Get recent logs
    const logRows = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 20').all();
    
    // Get active sites metadata
    const sitesList = [];
    if (fs.existsSync(sitesDir)) {
      const dirs = fs.readdirSync(sitesDir);
      const port = hostPort(req);
      dirs.forEach(name => {
        const fullPath = path.join(sitesDir, name);
        const stats = fs.statSync(fullPath);
        
        // Count files
        let fileCount = 0;
        function walk(dir) {
          fs.readdirSync(dir).forEach(f => {
            const p = path.join(dir, f);
            if (fs.statSync(p).isDirectory()) walk(p);
            else fileCount++;
          });
        }
        try { walk(fullPath); } catch {}
        
        const { domainUrl, pathUrl } = getSiteUrls(req, name);
        sitesList.push({
          name,
          deployedAt: stats.mtime,
          fileCount,
          urlDomain: domainUrl,
          urlPath: pathUrl
        });
      });
    }
    
    res.json({
      metrics: {
        totalSites,
        totalDocs,
        dbSitesCount,
        activeWebsockets: clients.size
      },
      logs: logRows,
      sites: sitesList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete site deployment
app.delete('/_spark/api/sites/:siteId', (req, res) => {
  const { siteId } = req.params;
  const sitePath = path.join(sitesDir, siteId);
  
  if (fs.existsSync(sitePath)) {
    fs.rmSync(sitePath, { recursive: true, force: true });
    
    // Also delete documents for this site
    db.prepare('DELETE FROM documents WHERE site_id = ?').run(siteId);
    
    addLog(siteId, 'delete', `Site deployment removed from dashboard.`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Site not found' });
  }
});

// --- 8. DYNAMIC SITE SERVING / STATIC ROUTING ---
// Serve sites under path fallback: /sites/[site-name]/...
app.use('/sites/:siteId', (req, res, next) => {
  const siteId = req.params.siteId;
  const sitePath = path.join(sitesDir, siteId);
  
  if (!fs.existsSync(sitePath)) {
    return res.status(404).send(`
      <div style="font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0b0f19; color: #fff; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center;">
        <h1 style="color: #ff2a5f; font-size: 3rem; margin-bottom: 10px;">404 - Site Not Found</h1>
        <p style="color: #94a3b8; font-size: 1.2rem; max-width: 500px;">Site "${siteId}" does not exist on Spark. Use the CLI tool to deploy it!</p>
        <a href="/_spark/dashboard/" style="margin-top: 20px; background: #00f2fe; color: #000; padding: 10px 20px; border-radius: 5px; text-decoration: none; font-weight: bold;">Go to Dashboard</a>
      </div>
    `);
  }
  
  // Serve the static file
  express.static(sitePath)(req, res, next);
});

// Root route handler
app.get('/', (req, res, next) => {
  const siteId = getSiteContext(req);
  
  if (siteId) {
    // We are on a subdomain: serve the site's index.html
    const sitePath = path.join(sitesDir, siteId);
    if (fs.existsSync(sitePath)) {
      return res.sendFile(path.join(sitePath, 'index.html'));
    }
  }
  
  // If no site subdomain is active, redirect to the dashboard
  res.redirect('/_spark/dashboard/');
});

// Generic static serving for subdomain routing
app.use((req, res, next) => {
  const siteId = getSiteContext(req);
  if (siteId) {
    const sitePath = path.join(sitesDir, siteId);
    if (fs.existsSync(sitePath)) {
      return express.static(sitePath)(req, res, next);
    }
  }
  next();
});

// Fallback 404
app.use((req, res) => {
  res.status(404).send(`
    <div style="font-family: system-ui, sans-serif; text-align: center; padding: 50px; background: #0b0f19; color: #fff; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; margin: 0;">
      <h1 style="color: #ff2a5f; font-size: 2.5rem; margin-bottom: 10px;">Route Not Found</h1>
      <p style="color: #94a3b8; font-size: 1.1rem;">Could not resolve host site or API endpoint.</p>
      <a href="/_spark/dashboard/" style="margin-top: 20px; background: #00f2fe; color: #000; padding: 10px 20px; border-radius: 5px; text-decoration: none; font-weight: bold;">Back to Dashboard</a>
    </div>
  `);
});


// --- 9. WEBSOCKET REALTIME ROUTER ---
const clients = new Map(); // ws -> { siteId, rooms: Set, dbSubscriptions: Set }

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const siteId = url.searchParams.get('site') || 'default';
  
  const clientInfo = {
    ws,
    siteId,
    rooms: new Set(),
    dbSubscriptions: new Set(),
    id: 'client_' + crypto.randomBytes(4).toString('hex'),
    user: resolveUser(req.headers)
  };
  
  clients.set(ws, clientInfo);
  
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      
      // Handle DB Subscriptions
      if (msg.type === 'subscribe') {
        clientInfo.dbSubscriptions.add(msg.collection);
      } else if (msg.type === 'unsubscribe') {
        clientInfo.dbSubscriptions.delete(msg.collection);
      }
      
      // Handle Room Syncing (Multiplayer)
      else if (msg.type === 'room-join') {
        clientInfo.rooms.add(msg.room);
        addLog(siteId, 'room-join', `${clientInfo.user.name} joined room "${msg.room}"`);
      } else if (msg.type === 'room-leave') {
        clientInfo.rooms.delete(msg.room);
      } else if (msg.type === 'room-broadcast') {
        // Forward message to all other clients in the same site and room
        clients.forEach((otherClient, otherWs) => {
          if (
            otherWs !== ws && 
            otherClient.siteId === siteId && 
            otherClient.rooms.has(msg.room)
          ) {
            otherWs.send(JSON.stringify({
              type: 'room-event',
              room: msg.room,
              event: msg.event,
              data: msg.data,
              sender: {
                id: clientInfo.id,
                name: clientInfo.user.name,
                avatar: clientInfo.user.avatar
              }
            }));
          }
        });
      }
    } catch (err) {
      console.error('WS parsing error:', err);
    }
  });
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

function resolveUser(headers) {
  const headerEmail = 
    headers['cf-access-authenticated-user-email'] || 
    headers['x-goog-authenticated-user-email'] || 
    headers['x-spark-user-email'];
    
  if (headerEmail) {
    const email = headerEmail.toLowerCase().trim();
    try {
      const stmt = db.prepare('SELECT * FROM profiles WHERE email = ?');
      const row = stmt.get(email);
      if (row) {
        return {
          id: 'user_' + crypto.createHash('md5').update(email).digest('hex').slice(0, 8),
          name: row.name,
          email: row.email,
          role: row.role,
          team: row.team,
          slack: row.slack,
          avatar: row.avatar
        };
      } else {
        // Create default profile
        const prefix = email.split('@')[0];
        const formattedName = prefix.split(/[\._-]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        
        const newUser = {
          id: 'user_' + crypto.createHash('md5').update(email).digest('hex').slice(0, 8),
          name: formattedName,
          email,
          role: 'Developer',
          team: 'Spark Team',
          slack: `@${prefix}`,
          avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(formattedName)}&background=0D0E15&color=00f2fe&bold=true`
        };
        
        const insertStmt = db.prepare(`
          INSERT INTO profiles (email, name, role, team, slack, avatar, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        insertStmt.run(newUser.email, newUser.name, newUser.role, newUser.team, newUser.slack, newUser.avatar, new Date().toISOString());
        
        return newUser;
      }
    } catch (err) {
      console.error('Error resolving user from headers:', err);
    }
  }

  const cookieHeader = headers.cookie;
  if (cookieHeader) {
    const authCookie = cookieHeader.split('; ')?.find(row => row.startsWith('spark_user='))?.split('=')[1];
    if (authCookie) {
      try {
        return JSON.parse(decodeURIComponent(authCookie));
      } catch {}
    }
  }

  return getDefaultUser();
}

// Helper to broadcast DB mutations to subscribers
function broadcastDbChange(siteId, collection, action, doc) {
  const payload = JSON.stringify({
    type: 'db-change',
    collection,
    action,
    doc,
    id: doc.id
  });
  
  clients.forEach((clientInfo, ws) => {
    if (clientInfo.siteId === siteId && clientInfo.dbSubscriptions.has(collection)) {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    }
  });
}

// Upgrade WebSocket connections
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  
  if (pathname === '/_spark/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`⚡ SPARK SERVER RUNNING AT http://localhost:${PORT}`);
  console.log(`⚡ ADMIN DASHBOARD ACCESSIBLE AT http://localhost:${PORT}/_spark/dashboard/`);
  console.log(`====================================================`);
});
