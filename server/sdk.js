// Spark Platform Client SDK
// Served dynamically at /_spark/spark.js

(function() {
  // Helper to extract site ID from URL
  function getSiteId() {
    const hostname = window.location.hostname;
    // e.g. mysite.localhost -> mysite
    const parts = hostname.split('.');
    if (parts.length > 1 && (parts[parts.length - 1] === 'localhost' || hostname.endsWith('.local'))) {
      // Check if it has a subdomain and is not just localhost
      if (parts.length === 2 && parts[1] === 'localhost') return parts[0];
      if (parts.length > 2) return parts[0];
    }
    
    // Fallback: check pathname for /sites/some-site/
    const match = window.location.pathname.match(/^\/sites\/([^/]+)/);
    if (match) {
      return match[1];
    }
    
    // Double fallback: query param or default
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('__spark_site')) {
      return urlParams.get('__spark_site');
    }
    
    return 'default';
  }

  const SITE_ID = getSiteId();
  const API_BASE = window.location.origin;
  
  // Setup WebSocket connection
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/_spark/ws?site=${SITE_ID}`;
  
  let socket = null;
  let socketReady = false;
  const messageQueue = [];
  const dbListeners = new Map(); // collection -> Set of callbacks
  const roomListeners = new Map(); // room -> Map of event -> Set of callbacks
  let reconnectAttempts = 0;
  
  function connectWebSocket() {
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
      socketReady = true;
      reconnectAttempts = 0;
      console.log(`[Spark SDK] Realtime connection established for site: ${SITE_ID}`);
      
      // Flush queue
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift();
        socket.send(JSON.stringify(msg));
      }
      
      // Re-register active subscriptions
      for (const collection of dbListeners.keys()) {
        socket.send(JSON.stringify({ type: 'subscribe', collection }));
      }
      for (const room of roomListeners.keys()) {
        socket.send(JSON.stringify({ type: 'room-join', room }));
      }
    };
    
    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'db-change') {
          const listeners = dbListeners.get(msg.collection);
          if (listeners) {
            listeners.forEach(cb => {
              if (msg.action === 'create' && cb.onCreate) cb.onCreate(msg.doc);
              if (msg.action === 'update' && cb.onUpdate) cb.onUpdate(msg.doc);
              if (msg.action === 'delete' && cb.onDelete) cb.onDelete(msg.id);
            });
          }
        } else if (msg.type === 'room-event') {
          const roomEvents = roomListeners.get(msg.room);
          if (roomEvents) {
            const callbacks = roomEvents.get(msg.event);
            if (callbacks) {
              callbacks.forEach(cb => cb(msg.data, msg.sender));
            }
          }
        }
      } catch (err) {
        console.error('[Spark SDK] Error handling WebSocket message:', err);
      }
    };
    
    socket.onclose = () => {
      socketReady = false;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      reconnectAttempts++;
      console.warn(`[Spark SDK] Connection lost. Reconnecting in ${delay}ms...`);
      setTimeout(connectWebSocket, delay);
    };
    
    socket.onerror = (err) => {
      console.error('[Spark SDK] WebSocket error:', err);
    };
  }
  
  function sendWSMessage(msg) {
    if (socketReady) {
      socket.send(JSON.stringify(msg));
    } else {
      messageQueue.push(msg);
    }
  }
  
  // Start WebSocket connection
  connectWebSocket();

  // Core Spark Object
  const spark = {
    siteId: SITE_ID,
    
    // 1. Identity API
    identity: {
      async get() {
        const res = await fetch(`${API_BASE}/_spark/api/identity?site=${SITE_ID}`);
        if (!res.ok) throw new Error('Failed to fetch identity');
        return await res.json();
      }
    },
    
    // 2. Database API (Firestore-like)
    db: {
      collection(collectionName) {
        return {
          async list() {
            const res = await fetch(`${API_BASE}/_spark/api/db?site=${SITE_ID}&collection=${encodeURIComponent(collectionName)}`);
            if (!res.ok) throw new Error('Database list failed');
            return await res.json();
          },
          
          async create(data) {
            const res = await fetch(`${API_BASE}/_spark/api/db?site=${SITE_ID}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection: collectionName, action: 'create', data })
            });
            if (!res.ok) throw new Error('Database create failed');
            return await res.json();
          },
          
          async update(id, data) {
            const res = await fetch(`${API_BASE}/_spark/api/db?site=${SITE_ID}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection: collectionName, action: 'update', id, data })
            });
            if (!res.ok) throw new Error('Database update failed');
            return await res.json();
          },
          
          async delete(id) {
            const res = await fetch(`${API_BASE}/_spark/api/db?site=${SITE_ID}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ collection: collectionName, action: 'delete', id })
            });
            if (!res.ok) throw new Error('Database delete failed');
            return await res.json();
          },
          
          subscribe(callbacks) {
            if (!dbListeners.has(collectionName)) {
              dbListeners.set(collectionName, new Set());
              sendWSMessage({ type: 'subscribe', collection: collectionName });
            }
            
            dbListeners.get(collectionName).add(callbacks);
            
            // Return unsubscribe function
            return () => {
              const listeners = dbListeners.get(collectionName);
              if (listeners) {
                listeners.delete(callbacks);
                if (listeners.size === 0) {
                  dbListeners.delete(collectionName);
                  sendWSMessage({ type: 'unsubscribe', collection: collectionName });
                }
              }
            };
          }
        };
      }
    },
    
    // 3. AI API
    ai: {
      async chat(messages, options = {}) {
        const res = await fetch(`${API_BASE}/_spark/api/ai/chat?site=${SITE_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, options })
        });
        if (!res.ok) throw new Error('AI chat failed');
        const data = await res.json();
        return data.content;
      },
      
      async generateImage(prompt) {
        const res = await fetch(`${API_BASE}/_spark/api/ai/image?site=${SITE_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        if (!res.ok) throw new Error('AI image generation failed');
        const data = await res.json();
        return data.url;
      }
    },
    
    // 4. File Storage API
    storage: {
      async upload(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        const res = await fetch(`${API_BASE}/_spark/api/storage?site=${SITE_ID}`, {
          method: 'POST',
          body: formData
        });
        if (!res.ok) throw new Error('File upload failed');
        const data = await res.json();
        return data.url;
      }
    },
    
    // 5. Multiplayer Room API (WebSockets helper)
    room(roomName) {
      // Ensure we are joined
      if (!roomListeners.has(roomName)) {
        roomListeners.set(roomName, new Map());
        sendWSMessage({ type: 'room-join', room: roomName });
      }
      
      return {
        send(event, data) {
          sendWSMessage({
            type: 'room-broadcast',
            room: roomName,
            event,
            data
          });
        },
        
        on(event, callback) {
          const roomEvents = roomListeners.get(roomName);
          if (!roomEvents.has(event)) {
            roomEvents.set(event, new Set());
          }
          roomEvents.get(event).add(callback);
        },
        
        off(event, callback) {
          const roomEvents = roomListeners.get(roomName);
          if (roomEvents && roomEvents.has(event)) {
            const callbacks = roomEvents.get(event);
            callbacks.delete(callback);
            if (callbacks.size === 0) {
              roomEvents.delete(event);
            }
          }
        },
        
        leave() {
          sendWSMessage({ type: 'room-leave', room: roomName });
          roomListeners.delete(roomName);
        }
      };
    }
  };
  
  // Attach to window
  window.spark = spark;
  console.log('[Spark SDK] Initialized successfully.');
})();
