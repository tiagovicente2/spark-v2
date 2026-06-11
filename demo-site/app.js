// Client Application logic utilizing Spark SDK

async function start() {
  console.log("App loading in site:", spark.siteId);
  document.getElementById('siteLabel').textContent = `Context: ${spark.siteId}`;

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
    div.innerHTML = `
      <div class="msg-content">
        <span class="msg-user">${msg.author}</span> ${msg.text}
      </div>
      <button class="btn-delete-msg" data-id="${msg.id}">&times;</button>
    `;

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
        el.querySelector('.msg-content').innerHTML = `<span class="msg-user">${doc.author}</span> ${doc.text}`;
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
    div.className = `ai-msg ${role}`;
    
    if (isImage) {
      div.textContent = `🎨 Prompt: "${text}"`;
      const img = document.createElement('img');
      img.className = 'ai-image-render';
      img.src = text;
      div.appendChild(img);
    } else {
      div.textContent = `${role === 'user' ? '👤 You: ' : '🤖 AI: '} ${text}`;
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

    appendAiMsg('user', `Generate image: "${prompt}"`);
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
      cursorEl.innerHTML = `
        <div class="cursor-pointer"></div>
        <div class="cursor-label">\${sender.name}</div>
      `;
      cursorContainer.appendChild(cursorEl);
      remoteCursors.set(sender.id, cursorEl);
    }

    cursorEl.style.left = `\${data.x}%`;
    cursorEl.style.top = `\${data.y}%`;
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
