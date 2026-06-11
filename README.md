# ⚡ Spark: Self-Hosted Serverless-like Platform for AI Prototypes

A lightweight, zero-config self-hosted implementation inspired by Shopify's internal hosting platform, **Quick** (as described in [Shopify Engineering: Quick](https://shopify.engineering/quick)).

This system enables developers and AI agents to instantly initialize, prototype, deploy, and host static sites while providing a robust suite of client-side APIs (Database, Real-time WebSockets, Identity Proxy, and AI Co-pilot) with zero configuration.

---

## 🏗️ Architecture Overview

The system consists of three main components:
1. **Spark CLI Tool (`spark`)**: Packages your directory and uploads it directly to the hosting backend in one command.
2. **Express + SQLite + WebSocket Server**: Handles routing (subdomains & URL paths), simulates Identity-Aware Proxy (IAP) cookies, manages real-time socket connections, and runs database queries.
3. **Spark Client SDK (`spark.js`)**: Injected automatically at `/_spark/spark.js`. Exposes real-time collection stores, file uploads, WebSocket rooms, and Gemini chat models to the front-end with zero credentials.

### System Workflow Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Developer
    participant CLI as Spark CLI
    participant Server as Spark Server
    participant SDK as client (spark.js)
    database DB as SQLite (node:sqlite)
    
    Developer->>CLI: spark init
    Note over CLI: Generates template index.html, style.css, app.js
    Developer->>CLI: spark deploy
    Note over CLI: Packs files into temporary zip
    CLI->>Server: POST /_spark/api/deploy?site=my-app (multipart)
    Note over Server: Extracts files to storage/sites/my-app/
    Server->>DB: Log deployment activity
    Server-->>CLI: Returns site URLs (subdomain + path)
    CLI-->>Developer: Prints URLs & Dashboard link

    Note over Developer, SDK: Developer opens site in browser
    SDK->>Server: Establish WebSocket Connection (/_spark/ws)
    SDK->>Server: GET /_spark/api/identity
    Server-->>SDK: Returns simulated IAP profile
    
    SDK->>Server: db.collection("comments").subscribe(...)
    Note over SDK, Server: Registers client socket interest
    
    Developer->>SDK: Clicks "Post Comment"
    SDK->>Server: POST /_spark/api/db (create comment)
    Server->>DB: Inserts row in documents table
    Server->>SDK: Broadcasts document to all active listeners in room
```

---

## ⚡ Features & Client-Side APIs

All client calls are pre-routed through the server layer. Since sites run behind the corporate proxy domain, front-end scripts do not require API keys or credentials.

### 1. Database API (`spark.db`)
A Firestore-like document store backed by SQLite. Updates automatically propagate to all active clients in real time.
```javascript
const posts = spark.db.collection('posts');

// Create a record
const doc = await posts.create({ title: 'Vibe Coding', votes: 1 });

// Update a record
await posts.update(doc.id, { votes: 2 });

// Delete a record
await posts.delete(doc.id);

// Realtime subscriptions
const unsubscribe = posts.subscribe({
  onCreate: (newDoc) => console.log('Created:', newDoc),
  onUpdate: (updatedDoc) => console.log('Updated:', updatedDoc),
  onDelete: (id) => console.log('Deleted ID:', id)
});
```

### 2. AI Engine Proxy (`spark.ai`)
Call frontier LLM chat models directly from client code. If `GEMINI_API_KEY` is present in your server's `.env`, it initiates live Gemini 2.5 Flash calls. If not, it falls back to a sandbox developer chat model. Image generation is powered by Pollinations.ai for free, zero-key image synthesis!
```javascript
// Conversational model
const text = await spark.ai.chat([
  { role: 'user', content: 'Summarize my dashboard design.' }
]);

// Free image generation
const imageUrl = await spark.ai.generateImage('A holographic computer stack');
```

### 3. Multiplayer Sync Rooms (`spark.room`)
A raw WebSocket routing room. Ideal for multiplayer cursors, chat rooms, or sharing page interactions in real-time.
```javascript
const room = spark.room('lobby');

// Broadcast cursor positions
room.send('cursor-move', { x: 100, y: 150 });

// Receive event from peer nodes
room.on('cursor-move', (data, sender) => {
  console.log(`User ${sender.name} moved to:`, data);
});
```

### 4. Zero-Config File Storage (`spark.storage`)
Handle asset uploads from browser forms directly and retrieve permanent static URLs.
```javascript
const url = await spark.storage.upload(fileInput.files[0]);
console.log('File is live at:', url);
```

### 5. Identity Context (`spark.identity`)
In Shopify's environment, this extracts corporate profile headers from Identity-Aware Proxy (IAP). Our platform includes a beautiful custom login panel (`/_spark/login`) to set your custom name, role, and avatar to simulate team workflows.
```javascript
const user = await spark.identity.get();
console.log(`Log in as: ${user.name} (${user.role})`);
```

---

## 🚀 Getting Started

### 1. Install & Start Server
Make sure you have Node.js (v22+ recommended for native SQLite support) installed.

```bash
# Install server dependencies
npm install

# Start the server (runs on port 3000)
npm start
```
*Access the Web Control Panel at [http://localhost:3000/_spark/dashboard/](http://localhost:3000/_spark/dashboard/)*

### 2. Configure Live Gemini API (Optional)
To query live frontier models, create a `.env` file in the root folder (preloaded from `.env.example`) and add your Gemini API Key:
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Setup CLI Link
Link the CLI executable globally so you can access the `spark` command anywhere:
```bash
npm link
```

### 4. Create and Deploy Your First App
```bash
# Create and move to a new project folder
mkdir my-app && cd my-app

# Initialize the starter website template
spark init

# Deploy to local server
spark deploy
```

---

## 🎨 Administrator Dashboard
Our system includes a premium, dark-mode administration control panel:
- **Metrics Panel**: Real-time stats showing WebSocket counts, deployed sites, and database sizes.
- **Sites Directory**: Browse all active subdomains and URLs, inspect size stats, and delete obsolete builds.
- **SQLite Document Explorer**: A visual Firebase-style board to browse collections, inspect JSON tables, add records, and delete documents in real-time.
- **Interactive SDK Console**: Documented examples of each API feature to paste directly into your code.

---

## 📦 CLI Compilation & Self-Hosted Installer

Spark supports compiling the CLI into standalone, single-executable binaries for multiple platforms, and hosting an installer service to allow easy installation via curl (similar to `bun` or `rustup`).

### 1. Build Standalone CLI Binaries
To cross-compile the CLI for Linux, macOS (Darwin), and Windows (which embeds all dependencies using Bun), run:
```bash
# Build binary for your local OS
bun build cli/cli.js --compile --outfile dist/spark

# Build binaries for all supported platforms (Linux x64/arm64, macOS x64/arm64, Windows x64)
npm run build:cli:all
```
The compiled binaries will be saved to the `dist/` directory:
- `spark-linux-x64`
- `spark-linux-arm64`
- `spark-darwin-x64`
- `spark-darwin-arm64`
- `spark-windows-x64.exe`

### 2. Run the Installer Server (Coolify/Docker)
The `coolify/installer` directory contains a containerized server that serves our `install.sh` script dynamically, pre-configuring client CLIs automatically.

To launch the installer server locally or inside Coolify:
1. Set the following environment variables:
   - `PORT`: Port to run the server on (default: 3000)
   - `SPARK_REPO`: GitHub repository to pull compiled releases from (default: `tiagovicente2/spark-v2`)
   - `SPARK_SERVER`: Your deployed Spark backend URL (e.g. `https://spark.arpgg.io`). If provided, the installer automatically configures the downloaded CLI to point to this address.
2. Run the installer:
   ```bash
   node coolify/installer/server.js
   ```

### 3. Install the CLI in One Command
Once the installer server is deployed (e.g., at `https://spark-installer.arpgg.io`), developers can install the CLI directly:
```bash
curl -fsSL https://spark-installer.arpgg.io | bash
```

Alternatively, you can run the script manually:
```bash
./install.sh --server https://spark.arpgg.io
```

The installer will:
- Detect the operating system (macOS or Linux) and CPU architecture.
- Download the correct precompiled binary from the GitHub release.
- Place it in `~/.local/bin/spark` and make it executable.
- Pre-configure the CLI's default backend server to point to your `SPARK_SERVER`.

---

## 💻 Tech Stack
- **Backend Node.js**: Express, WebSocket server (`ws`).
- **Database**: Native SQLite (`node:sqlite`) for zero-compilation build dependencies.
- **CLI**: Archiver, Form-data (native Node.js Fetch Blob API).
- **Front-End**: Vanilla JS, Glassmorphic CSS variables, Google Outfit Font.
- **CLI Packager**: Bun compilation to single-executable application (SEA).
