// Spark Dashboard Client App

document.addEventListener('DOMContentLoaded', () => {
  let currentUser = null;
  let activeTab = 'overview';
  let sitesData = [];
  
  // DB Explorer State
  let dbSelectedSite = '';
  let dbSelectedCollection = '';
  
  // Elements
  const tabTitles = {
    overview: { title: 'Overview', sub: 'Platform health, logs, and activity metrics' },
    sites: { title: 'Sites Directory', sub: 'Explore and manage active deployed projects' },
    database: { title: 'Spark DB Explorer', sub: 'Inspect and modify real-time document stores' },
    playground: { title: 'Developer SDK', sub: 'Zero-config client APIs cheat sheet' }
  };

  const tabTitle = document.getElementById('tabTitle');
  const tabSubtitle = document.getElementById('tabSubtitle');
  
  // Initialize
  initApp();
  
  function initApp() {
    setupTabNavigation();
    fetchIdentity();
    fetchDashboardData();
    setupEventListeners();
    setupDbExplorer();
    
    // Dynamic terminal live URL based on current environment
    const terminalLiveUrl = document.getElementById('terminalLiveUrl');
    if (terminalLiveUrl) {
      const host = window.location.host;
      const proto = window.location.protocol;
      if (host.includes('localhost') || host.includes('127.0.0.1')) {
        terminalLiveUrl.innerHTML = `✨ Site live! ${proto}//my-awesome-site.localhost:${window.location.port || '3000'}`;
      } else {
        // Strip out 'spark.' prefix if it exists to keep site URLs clean
        const base = host.startsWith('spark.') ? host.slice(6) : host;
        terminalLiveUrl.innerHTML = `✨ Site live! ${proto}//my-awesome-site-spark.${base}`;
      }
    }
    
    // Auto-refresh metrics every 5 seconds
    setInterval(() => {
      if (activeTab === 'overview' || activeTab === 'sites') {
        fetchDashboardData(true); // silent update
      }
    }, 5000);
  }

  // --- TAB NAVIGATION ---
  function setupTabNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        activeTab = tab;
        
        // Update nav UI
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        // Update content UI
        tabContents.forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        
        // Update Header
        tabTitle.textContent = tabTitles[tab].title;
        tabSubtitle.textContent = tabTitles[tab].sub;
        
        if (tab === 'database') {
          refreshDbSiteSelect();
        }
      });
    });
    
    // Doc sections navigation inside Playground
    const docNavItems = document.querySelectorAll('.doc-nav-item');
    const docSections = document.querySelectorAll('.doc-section');
    
    docNavItems.forEach(item => {
      item.addEventListener('click', () => {
        const target = item.dataset.section;
        
        docNavItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        docSections.forEach(s => s.classList.remove('active'));
        document.getElementById(target).classList.add('active');
      });
    });
  }

  // --- IDENTITY ---
  async function fetchIdentity() {
    try {
      const res = await fetch('/_spark/api/identity');
      if (res.status === 401) {
        window.location.href = '/_spark/login?next=' + encodeURIComponent(window.location.pathname);
        return;
      }
      currentUser = await res.json();
      renderUserProfile();
    } catch (err) {
      console.error('Failed to load identity', err);
    }
  }

  function renderUserProfile() {
    if (!currentUser) return;
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role;
    document.getElementById('userTeam').textContent = currentUser.team;
    document.getElementById('userAvatar').src = currentUser.avatar;
  }

  // --- METRICS & LOGS ---
  async function fetchDashboardData(silent = false) {
    try {
      const res = await fetch('/_spark/api/dashboard/metrics');
      const data = await res.json();
      
      // Update stats cards
      document.getElementById('statTotalSites').textContent = data.metrics.totalSites;
      document.getElementById('statTotalDocs').textContent = data.metrics.totalDocs;
      document.getElementById('statWebsockets').textContent = data.metrics.activeWebsockets;
      
      // AI Engine pill
      // In a real environment, the AI proxy would show "Gemini" if key exists
      // We can let the server reply or set it
      // Let's assume if totalDocs > 0 or whatever, we just fetch it
      
      sitesData = data.sites;
      
      if (!silent) {
        renderLogs(data.logs);
      }
      renderSitesTable();
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    }
  }

  function renderLogs(logs) {
    const consoleContainer = document.getElementById('consoleLogs');
    consoleContainer.innerHTML = '';
    
    if (logs.length === 0) {
      consoleContainer.innerHTML = '<div class="log-line">No system events logged yet.</div>';
      return;
    }
    
    logs.forEach(log => {
      const div = document.createElement('div');
      div.className = 'log-line';
      
      const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      div.innerHTML = `
        <span class="log-timestamp">[${time}]</span>
        <span class="log-site">${log.site_id}</span>
        <span class="log-action ${log.action}">${log.action}</span>
        <span class="log-details">${log.details}</span>
      `;
      consoleContainer.appendChild(div);
    });
  }

  function renderSitesTable() {
    const tbody = document.querySelector('#sitesTable tbody');
    tbody.innerHTML = '';
    
    const filterText = document.getElementById('searchSitesInput').value.toLowerCase();
    const filteredSites = sitesData.filter(s => s.name.toLowerCase().includes(filterText));
    
    if (filteredSites.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="table-loading">No active deployments found matching filters.</td>
        </tr>
      `;
      return;
    }
    
    filteredSites.forEach(site => {
      const tr = document.createElement('tr');
      const time = new Date(site.deployedAt).toLocaleString();
      
      let hostname = `${site.name}.localhost`;
      try {
        hostname = new URL(site.urlDomain).hostname;
      } catch (e) {}
      
      tr.innerHTML = `
        <td class="site-title-cell">
          <a href="${site.urlDomain}" target="_blank">⚡ ${hostname}</a>
          <span class="site-secondary-link">${site.urlDomain}</span>
        </td>
        <td>${site.fileCount} files</td>
        <td>${time}</td>
        <td>
          <a href="${site.urlPath}" target="_blank" class="site-secondary-link">Path: /${site.name}/</a>
        </td>
        <td class="actions-col">
          <div class="table-actions">
            <a href="${site.urlDomain}" target="_blank" class="btn btn-sm btn-primary">Open</a>
            <button class="btn btn-sm btn-danger btn-delete-site" data-id="${site.name}">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    // Bind deletes
    document.querySelectorAll('.btn-delete-site').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const name = btn.dataset.id;
        if (confirm(`Are you sure you want to permanently delete site "${name}"? All static files and database records associated will be deleted.`)) {
          btn.textContent = 'Deleting...';
          btn.disabled = true;
          try {
            const res = await fetch(`/_spark/api/sites/${name}`, { method: 'DELETE' });
            if (res.ok) {
              fetchDashboardData();
            } else {
              alert('Delete failed');
              btn.textContent = 'Delete';
              btn.disabled = false;
            }
          } catch (err) {
            console.error(err);
            alert('Delete failed');
          }
        }
      });
    });
  }

  // --- GENERAL EVENTS ---
  function setupEventListeners() {
    document.getElementById('btnRefreshLogs').addEventListener('click', () => {
      fetchDashboardData();
    });
    
    document.getElementById('searchSitesInput').addEventListener('input', () => {
      renderSitesTable();
    });
  }

  // --- DATABASE EXPLORER PANEL ---
  function setupDbExplorer() {
    const siteSelect = document.getElementById('dbSiteSelect');
    const colList = document.getElementById('dbCollectionsList');
    
    // Site selection trigger
    siteSelect.addEventListener('change', (e) => {
      dbSelectedSite = e.target.value;
      dbSelectedCollection = '';
      document.getElementById('dbActionsRow').style.display = 'none';
      colList.innerHTML = '<li class="empty-placeholder">Loading collections...</li>';
      document.getElementById('dbDocsGrid').innerHTML = `
        <div class="db-empty-state">
          <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
          <p>Choose a collection to browse database records.</p>
        </div>
      `;
      
      if (dbSelectedSite) {
        fetchCollections();
      } else {
        colList.innerHTML = '<li class="empty-placeholder">Select a site first</li>';
      }
    });
    
    // Refresh docs button
    document.getElementById('btnRefreshDocs').addEventListener('click', () => {
      if (dbSelectedSite && dbSelectedCollection) {
        fetchDocuments();
      }
    });
    
    // Modal management
    const modal = document.getElementById('newDocModal');
    document.getElementById('btnNewDoc').addEventListener('click', () => {
      // Pre-fill dummy json
      document.getElementById('newDocJson').value = JSON.stringify({
        title: "Sample Entry",
        content: "Write something here...",
        author: currentUser ? currentUser.name : "Alex Developer",
        created_at: new Date().toISOString()
      }, null, 2);
      modal.classList.add('active');
    });
    
    document.getElementById('btnCloseModal').addEventListener('click', () => modal.classList.remove('active'));
    document.getElementById('btnCancelDoc').addEventListener('click', () => modal.classList.remove('active'));
    
    document.getElementById('btnSaveDoc').addEventListener('click', async () => {
      const rawJson = document.getElementById('newDocJson').value;
      let parsedData;
      try {
        parsedData = JSON.parse(rawJson);
      } catch (err) {
        alert('Invalid JSON content. Please correct the formatting.');
        return;
      }
      
      try {
        const res = await fetch(`/_spark/api/db?site=${dbSelectedSite}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            collection: dbSelectedCollection,
            action: 'create',
            data: parsedData
          })
        });
        
        if (res.ok) {
          modal.classList.remove('active');
          fetchDocuments();
          fetchDashboardData(true); // refresh totals
        } else {
          alert('Failed to insert record');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to insert record');
      }
    });
  }
  
  function refreshDbSiteSelect() {
    const siteSelect = document.getElementById('dbSiteSelect');
    const currentVal = siteSelect.value;
    
    siteSelect.innerHTML = '<option value="">-- Choose a Site --</option>';
    
    // Gather sites from sitesData
    sitesData.forEach(site => {
      const opt = document.createElement('option');
      opt.value = site.name;
      opt.textContent = `⚡ ${site.name} (${site.fileCount} files)`;
      siteSelect.appendChild(opt);
    });
    
    // Also add special default context if there are docs in default
    const optDefault = document.createElement('option');
    optDefault.value = 'default';
    optDefault.textContent = `⚙️ default (Global System Room)`;
    siteSelect.appendChild(optDefault);
    
    if (currentVal && [...siteSelect.options].some(o => o.value === currentVal)) {
      siteSelect.value = currentVal;
    }
  }
  
  async function fetchCollections() {
    const colList = document.getElementById('dbCollectionsList');
    
    try {
      const res = await fetch(`/_spark/api/db/collections?site=${dbSelectedSite}`);
      const collections = await res.json();
      
      colList.innerHTML = '';
      
      if (collections.length === 0) {
        colList.innerHTML = '<li class="empty-placeholder">No collections created. Save some data using `spark.db` SDK!</li>';
        return;
      }
      
      collections.forEach(colName => {
        const li = document.createElement('li');
        li.className = 'collection-item';
        li.dataset.name = colName;
        li.innerHTML = `
          <span>📁 ${colName}</span>
        `;
        
        li.addEventListener('click', () => {
          document.querySelectorAll('.collection-item').forEach(c => c.classList.remove('active'));
          li.classList.add('active');
          dbSelectedCollection = colName;
          
          document.getElementById('dbActionsRow').style.display = 'flex';
          document.getElementById('dbDocTitle').textContent = `DB Explorer: ${dbSelectedSite} / ${dbSelectedCollection}`;
          
          fetchDocuments();
        });
        
        colList.appendChild(li);
      });
    } catch (err) {
      console.error(err);
      colList.innerHTML = '<li class="empty-placeholder error">Failed to load collections.</li>';
    }
  }
  
  async function fetchDocuments() {
    const grid = document.getElementById('dbDocsGrid');
    grid.innerHTML = '<div class="table-loading" style="grid-column: span 2;">Fetching collection documents...</div>';
    
    try {
      const res = await fetch(`/_spark/api/db?site=${dbSelectedSite}&collection=${encodeURIComponent(dbSelectedCollection)}`);
      const docs = await res.json();
      
      grid.innerHTML = '';
      
      if (docs.length === 0) {
        grid.innerHTML = `
          <div class="db-empty-state">
            <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
            <p>Collection "${dbSelectedCollection}" is currently empty.</p>
          </div>
        `;
        return;
      }
      
      docs.forEach(doc => {
        const card = document.createElement('div');
        card.className = 'db-doc-card';
        
        // Extract dates
        const dateStr = doc.updated_at ? new Date(doc.updated_at).toLocaleString() : 'N/A';
        
        // Clean system fields from renderable data
        const renderableData = { ...doc };
        delete renderableData.id;
        delete renderableData.created_at;
        delete renderableData.updated_at;
        
        card.innerHTML = `
          <div class="db-doc-card-header">
            <span class="db-doc-id">${doc.id}</span>
            <div class="db-doc-actions">
              <button class="btn btn-sm btn-danger btn-delete-doc" data-id="${doc.id}">Delete</button>
            </div>
          </div>
          <div class="db-doc-body">${JSON.stringify(renderableData, null, 2)}</div>
          <div class="db-doc-footer">Last edit: ${dateStr}</div>
        `;
        
        grid.appendChild(card);
      });
      
      // Bind doc delete buttons
      document.querySelectorAll('.btn-delete-doc').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const docId = btn.dataset.id;
          if (confirm(`Delete document "${docId}"?`)) {
            btn.textContent = 'Deleting...';
            try {
              const res = await fetch(`/_spark/api/db?site=${dbSelectedSite}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  collection: dbSelectedCollection,
                  action: 'delete',
                  id: docId
                })
              });
              
              if (res.ok) {
                fetchDocuments();
                fetchDashboardData(true); // update totals
              } else {
                alert('Delete document failed');
                btn.textContent = 'Delete';
              }
            } catch (err) {
              console.error(err);
              alert('Delete document failed');
            }
          }
        });
      });
    } catch (err) {
      console.error(err);
      grid.innerHTML = '<div class="table-loading error" style="grid-column: span 2;">Failed to load documents.</div>';
    }
  }

});
