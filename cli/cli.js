#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function getServerUrl() {
  if (process.env.SPARK_SERVER) return process.env.SPARK_SERVER;
  if (process.env.QUICK_SERVER) return process.env.QUICK_SERVER;

  try {
    const configPath = path.join(os.homedir(), '.spark', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.server) {
        return config.server;
      }
    }
  } catch (e) {
    // ignore config read errors
  }

  return 'http://localhost:3000';
}

const serverUrl = getServerUrl();

// Main CLI router
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const param = args[1];

  if (!command || (command !== 'init' && command !== 'deploy' && command !== 'config')) {
    printHelp();
    process.exit(1);
  }

  if (command === 'init') {
    await initSite(param);
  } else if (command === 'deploy') {
    await deploySite(param);
  } else if (command === 'config') {
    await configSite(param);
  }
}

function printHelp() {
  console.log(`
  ⚡ SPARK CLI TOOL - AI ERA
  
  Usage:
    spark init [site-name]    - Initialize a new website template in your directory
    spark deploy [site-name]  - Bundle and deploy website folder to the hosting backend
    spark config [server-url] - View or set the default Spark backend server URL
  `);
}

// --- INIT COMMAND ---
async function initSite(siteName) {
  const targetDirName = siteName || path.basename(process.cwd());
  const targetPath = siteName ? path.join(process.cwd(), siteName) : process.cwd();

  console.log(`⚡ Initializing new site in: ${targetPath}`);

  if (siteName && !fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }

  // Load starter files
  const starterIndex = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spark Sandbox - Vibe Coding</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <div class="container">
    <header class="app-header">
      <div class="logo">⚡ SPARK<span>.site</span></div>
      <div class="badge" id="siteLabel">Loading context...</div>
    </header>

    <div class="grid">
      <!-- 1. IDENTITY CARD -->
      <section class="card glass">
        <div class="card-title">
          <span class="icon">👤</span>
          <h3>spark.identity</h3>
        </div>
        <div class="identity-profile" id="profile">
          <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&h=80&q=80" alt="Avatar" class="avatar">
          <div class="profile-details">
            <h4 id="userName">Alex Beauchamp</h4>
            <p id="userRole">UX Designer</p>
            <span class="team-badge" id="userTeam">Core Vibe Labs</span>
          </div>
        </div>
        <div class="action-footer">
          <a href="/_spark/login" target="_blank" class="btn btn-secondary">Simulate Auth Login</a>
        </div>
      </section>

      <!-- 2. DATABASE / GUESTBOOK -->
      <section class="card glass">
        <div class="card-title">
          <span class="icon">📁</span>
          <h3>spark.db (Live Guestbook)</h3>
        </div>
        <div class="guestbook-messages" id="messagesList">
          <div class="placeholder">No messages posted. Be the first!</div>
        </div>
        <form id="commentForm" class="comment-form">
          <input type="text" id="commentText" placeholder="Write a live synced message..." required>
          <button type="submit" class="btn btn-primary">Post</button>
        </form>
      </section>

      <!-- 3. AI CO-PILOT SANDBOX -->
      <section class="card glass">
        <div class="card-title">
          <span class="icon">🤖</span>
          <h3>spark.ai (Gemini Proxy)</h3>
        </div>
        <div class="ai-chat-console" id="aiOutput">
          <div class="ai-msg bot">Hello! I am your proxied AI. Ask me anything or trigger the free image generation.</div>
        </div>
        <form id="aiForm" class="ai-form">
          <input type="text" id="aiInput" placeholder="Type a chat prompt..." required>
          <button type="submit" class="btn btn-primary" id="btnChat">Chat</button>
          <button type="button" class="btn btn-secondary" id="btnImage">Draw</button>
        </form>
      </section>

      <!-- 4. WEBSOCKETS / MULTIPLAYER -->
      <section class="card glass canvas-card">
        <div class="card-title">
          <span class="icon">⚡</span>
          <h3>spark.room (Multiplayer Cursors)</h3>
        </div>
        <div class="multiplayer-canvas" id="canvasArea">
          <div class="canvas-instructions">Move your cursor around this card. Open this site in another window to see multiplayer syncing!</div>
          <div id="cursorContainer"></div>
        </div>
      </section>
    </div>
  </div>

  <!-- LOAD ZERO-CONFIG CLIENT SDK -->
  <script src="/_spark/spark.js"></script>
  <script src="app.js"></script>
</body>
</html>`;

  const starterCss = `:root {
  --bg: #0b0f19;
  --text: #f8fafc;
  --text-muted: #94a3b8;
  --card-bg: rgba(22, 28, 45, 0.4);
  --card-border: rgba(255, 255, 255, 0.08);
  --accent: #00f2fe;
  --accent-secondary: #4facfe;
  --accent-success: #00ff87;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--bg);
  background-image: 
    radial-gradient(circle at 10% 20%, rgba(79, 172, 254, 0.08) 0%, transparent 40%),
    radial-gradient(circle at 90% 80%, rgba(0, 242, 254, 0.05) 0%, transparent 40%);
  color: var(--text);
  font-family: 'Outfit', sans-serif;
  min-height: 100vh;
  padding: 40px 20px;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 40px;
  border-bottom: 1px solid var(--card-border);
  padding-bottom: 20px;
}

.logo {
  font-size: 1.8rem;
  font-weight: 800;
  letter-spacing: -1px;
}

.logo span {
  background: linear-gradient(135deg, var(--accent-secondary) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.badge {
  background: rgba(0, 242, 254, 0.08);
  border: 1px solid rgba(0, 242, 254, 0.2);
  color: var(--accent);
  padding: 6px 14px;
  border-radius: 50px;
  font-size: 0.85rem;
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 20px;
  padding: 24px;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  height: 350px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.card-title .icon {
  font-size: 1.5rem;
}

.card-title h3 {
  font-size: 1.2rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  color: #fff;
}

/* IDENTITY */
.identity-profile {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-grow: 1;
}

.identity-profile .avatar {
  width: 76px;
  height: 76px;
  border-radius: 16px;
  object-fit: cover;
  border: 2px solid var(--accent);
  box-shadow: 0 0 15px rgba(0, 242, 254, 0.2);
}

.profile-details h4 {
  font-size: 1.15rem;
  font-weight: 600;
}

.profile-details p {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-top: 2px;
}

.team-badge {
  display: inline-block;
  background: rgba(255,255,255,0.05);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent);
  margin-top: 6px;
}

/* GUESTBOOK */
.guestbook-messages {
  flex-grow: 1;
  overflow-y: auto;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 6px;
}

.placeholder {
  color: var(--text-muted);
  font-style: italic;
  font-size: 0.9rem;
  text-align: center;
  padding-top: 40px;
}

.msg-bubble {
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--card-border);
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 0.85rem;
  line-height: 1.4;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.msg-content {
  color: #fff;
}

.msg-user {
  color: var(--accent);
  font-weight: 600;
  margin-right: 6px;
}

.btn-delete-msg {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
}

.btn-delete-msg:hover {
  color: #ff5f56;
}

.comment-form, .ai-form {
  display: flex;
  gap: 10px;
}

input[type="text"] {
  flex-grow: 1;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--card-border);
  padding: 10px 14px;
  border-radius: 10px;
  color: #fff;
  font-size: 0.9rem;
  outline: none;
}

input[type="text"]:focus {
  border-color: var(--accent);
}

/* AI CHAT */
.ai-chat-console {
  flex-grow: 1;
  background: #05070e;
  border-radius: 12px;
  padding: 14px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  overflow-y: auto;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ai-msg {
  line-height: 1.5;
  white-space: pre-wrap;
}

.ai-msg.user { color: #818cf8; }
.ai-msg.bot { color: #10b981; }

.ai-image-render {
  max-width: 100%;
  border-radius: 8px;
  margin-top: 5px;
  border: 1px solid var(--card-border);
}

/* MULTIPLAYER CANVAS */
.canvas-card {
  height: 350px;
  position: relative;
}

.multiplayer-canvas {
  flex-grow: 1;
  border: 1px dashed rgba(255,255,255,0.1);
  border-radius: 12px;
  position: relative;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 20px;
}

.canvas-instructions {
  color: var(--text-muted);
  font-size: 0.85rem;
  pointer-events: none;
}

.remote-cursor {
  position: absolute;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 50;
  transition: all 0.1s ease-out;
}

.cursor-pointer {
  width: 14px;
  height: 14px;
  background: var(--accent);
  clip-path: polygon(0 0, 0% 100%, 30% 70%, 100% 70%);
}

.cursor-label {
  background: var(--accent);
  color: #000;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  margin-top: 4px;
}

/* GENERAL UI BUTTONS */
.btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s ease;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-primary {
  background: linear-gradient(135deg, var(--accent-secondary) 0%, var(--accent) 100%);
  color: #020617;
  border: none;
}

.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 242, 254, 0.25);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--card-border);
  color: var(--text);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.08);
}

.action-footer {
  margin-top: auto;
}
`;

  const starterApp = `// Client Application logic utilizing Spark SDK

async function start() {
  console.log("App loading in site:", spark.siteId);
  document.getElementById('siteLabel').textContent = \`Context: \${spark.siteId}\`;

  // --- 1. IDENTITY INTEGRATION ---
  let user = null;
  try {
    user = await spark.identity.get();
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = user.role;
    document.getElementById('userTeam').textContent = user.team;
    document.getElementById('profile').querySelector('.avatar').src = user.avatar;
  } catch (err) {
    console.warn("Identity lookup failed, using mock identity", err);
  }

  // --- 2. LIVE SYNCHRONIZED GUESTBOOK ---
  const guestbook = spark.db.collection('guestbook');
  const messagesList = document.getElementById('messagesList');
  const commentForm = document.getElementById('commentForm');
  const commentText = document.getElementById('commentText');

  // Load initial comments
  async function loadComments() {
    try {
      const list = await guestbook.list();
      messagesList.innerHTML = '';
      if (list.length === 0) {
        messagesList.innerHTML = '<div class="placeholder">No messages posted. Be the first!</div>';
        return;
      }
      
      list.forEach(msg => appendComment(msg));
    } catch (err) {
      console.error(err);
    }
  }

  function appendComment(msg) {
    // Remove placeholder
    const placeholder = messagesList.querySelector('.placeholder');
    if (placeholder) placeholder.remove();

    const div = document.createElement('div');
    div.className = 'msg-bubble';
    div.id = msg.id;
    div.innerHTML = \`
      <div class="msg-content">
        <span class="msg-user">\${msg.author}</span> \${msg.text}
      </div>
      <button class="btn-delete-msg" data-id="\${msg.id}">&times;</button>
    \`;

    // Bind delete
    div.querySelector('.btn-delete-msg').addEventListener('click', async () => {
      await guestbook.delete(msg.id);
    });

    messagesList.appendChild(div);
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  // Handle post submit
  commentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = commentText.value.trim();
    if (!text) return;

    await guestbook.create({
      author: user ? user.name : 'Vibe Coder',
      text: text,
      timestamp: new Date().toISOString()
    });

    commentText.value = '';
  });

  // Database Real-time subscription
  guestbook.subscribe({
    onCreate: (doc) => {
      appendComment(doc);
    },
    onUpdate: (doc) => {
      const el = document.getElementById(doc.id);
      if (el) {
        el.querySelector('.msg-content').innerHTML = \`<span class="msg-user">\${doc.author}</span> \${doc.text}\`;
      }
    },
    onDelete: (id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
      if (messagesList.children.length === 0) {
        messagesList.innerHTML = '<div class="placeholder">No messages posted. Be the first!</div>';
      }
    }
  });

  loadComments();

  // --- 3. AI CO-PILOT SANDBOX ---
  const aiOutput = document.getElementById('aiOutput');
  const aiForm = document.getElementById('aiForm');
  const aiInput = document.getElementById('aiInput');
  const btnChat = document.getElementById('btnChat');
  const btnImage = document.getElementById('btnImage');

  function appendAiMsg(role, text, isImage = false) {
    const div = document.createElement('div');
    div.className = \`ai-msg \${role}\`;
    
    if (isImage) {
      div.textContent = \`🎨 Prompt: "\${text}"\`;
      const img = document.createElement('img');
      img.className = 'ai-image-render';
      img.src = text;
      div.appendChild(img);
    } else {
      div.textContent = \`\${role === 'user' ? '👤 You: ' : '🤖 AI: '} \${text}\`;
    }
    
    aiOutput.appendChild(div);
    aiOutput.scrollTop = aiOutput.scrollHeight;
  }

  aiForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = aiInput.value.trim();
    if (!prompt) return;

    appendAiMsg('user', prompt);
    aiInput.value = '';
    
    btnChat.disabled = true;
    btnChat.textContent = 'Thinking...';

    try {
      const answer = await spark.ai.chat([
        { role: 'user', content: prompt }
      ]);
      appendAiMsg('bot', answer);
    } catch (err) {
      console.error(err);
      appendAiMsg('bot', 'AI connection failed. Ensure the server is online.');
    } finally {
      btnChat.disabled = false;
      btnChat.textContent = 'Chat';
    }
  });

  btnImage.addEventListener('click', async () => {
    const prompt = aiInput.value.trim();
    if (!prompt) {
      alert('Write a prompt in the text field first to generate an image!');
      return;
    }

    appendAiMsg('user', \`Generate image: "\${prompt}"\`);
    aiInput.value = '';
    
    btnImage.disabled = true;
    btnImage.textContent = 'Drawing...';

    try {
      const url = await spark.ai.generateImage(prompt);
      appendAiMsg('bot', url, true);
    } catch (err) {
      console.error(err);
      appendAiMsg('bot', 'Image generation failed.');
    } finally {
      btnImage.disabled = false;
      btnImage.textContent = 'Draw';
    }
  });

  // --- 4. MULTIPLAYER CURSORS ---
  const canvasArea = document.getElementById('canvasArea');
  const room = spark.room('canvas-cursor');
  const cursorContainer = document.getElementById('cursorContainer');
  const remoteCursors = new Map(); // senderId -> element

  canvasArea.addEventListener('mousemove', (e) => {
    const rect = canvasArea.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    room.send('cursor', { x, y });
  });

  canvasArea.addEventListener('mouseleave', () => {
    room.send('cursor-leave', {});
  });

  // Listen to multiplayer cursor moves
  room.on('cursor', (data, sender) => {
    let cursorEl = remoteCursors.get(sender.id);
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'remote-cursor';
      cursorEl.innerHTML = \`
        <div class="cursor-pointer"></div>
        <div class="cursor-label">\\\${sender.name}</div>
      \`;
      cursorContainer.appendChild(cursorEl);
      remoteCursors.set(sender.id, cursorEl);
    }

    cursorEl.style.left = \`\\\${data.x}%\`;
    cursorEl.style.top = \`\\\${data.y}%\`;
    cursorEl.style.display = 'flex';
  });

  room.on('cursor-leave', (data, sender) => {
    const cursorEl = remoteCursors.get(sender.id);
    if (cursorEl) {
      cursorEl.style.display = 'none';
    }
  });
}

start();
`;

  // Write files
  fs.writeFileSync(path.join(targetPath, 'index.html'), starterIndex);
  fs.writeFileSync(path.join(targetPath, 'style.css'), starterCss);
  fs.writeFileSync(path.join(targetPath, 'app.js'), starterApp);

  console.log(`✨ Template files successfully generated!`);
  if (siteName) {
    console.log(`To get started:
    $ cd ${siteName}
    $ spark deploy
    `);
  } else {
    console.log(`To get started:
    $ spark deploy
    `);
  }
}

// --- DEPLOY COMMAND ---
async function deploySite(siteName) {
  const siteId = siteName || path.basename(process.cwd());
  if (!/^[a-z0-9-]+$/.test(siteId)) {
    console.error('❌ Error: Site name must contain only lowercase alphanumeric characters and dashes.');
    process.exit(1);
  }

  const archivePath = path.join(process.cwd(), `spark-deploy-${siteId}.zip`);
  console.log(`⚡ Bundling folder: "${process.cwd()}" for site: "${siteId}"`);

  // Create zip file
  const output = fs.createWriteStream(archivePath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', async () => {
      console.log(`⚡ Zip package created: ${(archive.pointer() / 1024).toFixed(1)} KB`);
      console.log(`⚡ Uploading to Spark host: ${serverUrl}`);

      try {
        const formData = new FormData();
        const fileContent = fs.readFileSync(archivePath);
        const blob = new Blob([fileContent], { type: 'application/zip' });
        
        formData.append('archive', blob, 'archive.zip');

        const res = await fetch(`${serverUrl}/_spark/api/deploy?site=${siteId}`, {
          method: 'POST',
          body: formData
        });

        // Clean up zip
        fs.unlinkSync(archivePath);

        if (!res.ok) {
          const errText = await res.text();
          console.error(`❌ Deployment failed: ${errText}`);
          resolve();
          return;
        }

        const data = await res.json();
        console.log(`\n🎉 DEPLOYMENT SUCCESSFUL!`);
        console.log(`🔗 Subdomain URL: ${data.urls.domain}`);
        console.log(`🔗 Fallback URL:  ${data.urls.path}`);
        console.log(`\nView stats in Dashboard: ${serverUrl}/_spark/dashboard/`);
        resolve();
      } catch (err) {
        // Clean up zip
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
        console.error('❌ Error sending upload request to server:', err.message);
        resolve();
      }
    });

    archive.on('error', (err) => {
      console.error('❌ Zip error:', err);
      reject(err);
    });

    archive.pipe(output);

    // Glob files, ignoring node_modules, git, and zip files
    archive.glob('**/*', {
      ignore: [
        'node_modules/**',
        '.git/**',
        'spark-deploy-*.zip',
        '.DS_Store'
      ]
    });

    archive.finalize();
  });
}

async function configSite(serverUrlInput) {
  if (!serverUrlInput) {
    const currentUrl = getServerUrl();
    console.log(`⚡ Current Spark server URL: ${currentUrl}`);
    return;
  }

  try {
    const configDir = path.join(os.homedir(), '.spark');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const configPath = path.join(configDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ server: serverUrlInput }, null, 2));
    console.log(`⚡ Default Spark server URL configured to: ${serverUrlInput}`);
  } catch (err) {
    console.error(`❌ Failed to save configuration: ${err.message}`);
  }
}

main();
