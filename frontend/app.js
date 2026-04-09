const API = '';
let currentConversationId = null;
let currentPage = 'chat';
let currentFilter = '';
let smartPasteMode = false;

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  const profile = localStorage.getItem('nexus_profile');
  if (!profile) {
    // Show onboarding
    document.getElementById('onboarding').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  } else {
    document.getElementById('onboarding').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    loadProfile(JSON.parse(profile));
    loadCounts();
  }
  setupEventListeners();
});

// --- Onboarding ---
let onboardStep = 1;

function onboardingNext() {
  const current = document.querySelector(`.onboarding-step[data-step="${onboardStep}"]`);
  current.classList.remove('active');
  document.querySelector(`.dot[data-dot="${onboardStep}"]`).classList.remove('active');

  onboardStep++;
  const next = document.querySelector(`.onboarding-step[data-step="${onboardStep}"]`);
  next.classList.add('active');
  document.querySelector(`.dot[data-dot="${onboardStep}"]`).classList.add('active');
}

function completeOnboarding() {
  // Collect checked interests from step 4
  const interests = [];
  document.querySelectorAll('.onboard-check input:checked').forEach(cb => interests.push(cb.value));

  const profile = {
    name: document.getElementById('onboard-name').value || 'User',
    age: document.getElementById('onboard-age').value || '',
    location: document.getElementById('onboard-location').value || '',
    occupation: document.getElementById('onboard-occupation').value || '',
    interests,
    created: new Date().toISOString(),
  };

  localStorage.setItem('nexus_profile', JSON.stringify(profile));

  document.getElementById('onboarding').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  loadProfile(profile);
  loadCounts();
}

function loadProfile(profile) {
  if (profile.name) {
    document.getElementById('sidebar-user').style.display = 'flex';
    document.getElementById('user-name').textContent = profile.name;
    document.getElementById('user-avatar').textContent = profile.name.charAt(0).toUpperCase();
    document.getElementById('chat-greeting').textContent = `Hi ${profile.name}! I'm Nexus, your personal wiki assistant. I can help you:`;
  }
}

function setupEventListeners() {
  // Sidebar navigation
  document.querySelectorAll('.nav-item[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      navigateTo(page);
    });
  });

  // Send message
  document.getElementById('btn-send').addEventListener('click', sendMessage);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  document.getElementById('chat-input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  });

  // Search
  let searchTimeout;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadEntries(currentFilter, e.target.value), 300);
  });

  // New chat
  document.getElementById('btn-new-chat').addEventListener('click', () => {
    currentConversationId = null;
    const messages = document.getElementById('chat-messages');
    messages.innerHTML = `
      <div class="message assistant">
        <div class="message-content">
          <p>New conversation started. How can I help organize your knowledge?</p>
        </div>
      </div>`;
  });

  // Smart paste
  document.getElementById('btn-paste').addEventListener('click', () => {
    smartPasteMode = !smartPasteMode;
    document.getElementById('smart-paste-indicator').style.display = smartPasteMode ? 'flex' : 'none';
    document.getElementById('chat-input').placeholder = smartPasteMode
      ? 'Paste your data here (contacts, notes, anything)...'
      : 'Ask me anything or paste data to organize...';
    document.getElementById('chat-input').focus();
  });

  document.getElementById('cancel-paste').addEventListener('click', () => {
    smartPasteMode = false;
    document.getElementById('smart-paste-indicator').style.display = 'none';
    document.getElementById('chat-input').placeholder = 'Ask me anything or paste data to organize...';
  });

  // Manual add
  document.getElementById('btn-add').addEventListener('click', () => {
    // Pre-select type based on current page
    if (currentFilter) {
      document.getElementById('add-type').value = currentFilter;
    }
    document.getElementById('add-modal-overlay').style.display = 'flex';
  });

  document.getElementById('add-modal-close').addEventListener('click', () => {
    document.getElementById('add-modal-overlay').style.display = 'none';
  });

  document.getElementById('add-modal-save').addEventListener('click', saveManualEntry);

  // Entry detail modal
  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('modal-overlay').style.display = 'none';
  });

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  document.getElementById('add-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  // Gmail connect (in walkthrough page)
  document.getElementById('btn-gmail-connect').addEventListener('click', () => {
    window.open(`${API}/api/gmail/auth`, 'gmail-auth', 'width=500,height=600');
  });

  // Vault
  document.getElementById('btn-vault-upload').addEventListener('click', () => {
    document.getElementById('vault-modal-overlay').style.display = 'flex';
  });
  document.getElementById('vault-modal-close').addEventListener('click', () => {
    document.getElementById('vault-modal-overlay').style.display = 'none';
  });
  document.getElementById('vault-modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.getElementById('vault-modal-save').addEventListener('click', saveVaultEntry);

  // Auto-fill vault name from file name
  document.getElementById('vault-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && !document.getElementById('vault-name').value) {
      const name = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      document.getElementById('vault-name').value = name;
    }
  });

  // Vault category clicks
  document.querySelectorAll('.vault-category').forEach((cat) => {
    cat.addEventListener('click', () => {
      document.getElementById('vault-category').value = cat.dataset.vtype;
      document.getElementById('vault-modal-overlay').style.display = 'flex';
    });
  });

  // Diary
  document.getElementById('btn-generate-diary').addEventListener('click', generateDiary);
}

// --- Navigation ---
function navigateTo(page) {
  // Update sidebar active state
  document.querySelectorAll('.nav-item[data-page]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  currentPage = page;

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  if (page === 'chat') {
    document.getElementById('page-chat').classList.add('active');
  } else if (page === 'diary') {
    document.getElementById('page-diary').classList.add('active');
    loadDiary();
  } else if (page === 'vault') {
    document.getElementById('page-vault').classList.add('active');
    loadVault();
  } else if (page === 'gmail-setup') {
    document.getElementById('page-gmail-setup').classList.add('active');
    document.getElementById('gmail-redirect-uri').textContent = window.location.origin + '/api/gmail/callback';
  } else if (page === 'settings') {
    document.getElementById('page-settings').classList.add('active');
    loadSettingsPage();
  } else if (page === 'mcp-info') {
    document.getElementById('page-mcp-info').classList.add('active');
    const base = window.location.origin;
    document.getElementById('mcp-base-url').textContent = base + '/mcp';
    document.getElementById('mcp-example-url').textContent = base;
    document.getElementById('mcp-example-url2').textContent = base;
    document.getElementById('mcp-discovery-url').textContent = base + '/mcp';
  } else {
    document.getElementById('page-entries').classList.add('active');

    const typeFilter = page === 'all' ? '' : page;
    currentFilter = typeFilter;

    const titles = {
      all: 'All Entries',
      contact: 'Contacts',
      note: 'Notes',
      email: 'Emails',
      bookmark: 'Bookmarks',
      idea: 'Ideas',
      place: 'Places',
    };
    document.getElementById('entries-page-title').textContent = titles[page] || page;
    document.getElementById('search-input').value = '';
    loadEntries(typeFilter);
  }
}

// --- Counts ---
async function loadCounts() {
  try {
    const res = await fetch(`${API}/api/counts`);
    const typeCounts = await res.json();

    let total = 0;
    const counts = {};
    for (const { type, count } of typeCounts) {
      counts[type] = count;
      total += count;
    }

    document.getElementById('count-all').textContent = total;
    for (const type of ['contact', 'note', 'email', 'bookmark', 'idea', 'place', 'diary', 'vault']) {
      const el = document.getElementById(`count-${type}`);
      if (el) el.textContent = counts[type] || 0;
    }
  } catch (err) {
    console.error('Failed to load counts:', err);
  }
}

// --- Entries ---
async function loadEntries(type = '', search = '') {
  try {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (search) params.set('search', search);

    const res = await fetch(`${API}/api/entries?${params}`);
    const entries = await res.json();
    renderEntries(entries);
  } catch (err) {
    console.error('Failed to load entries:', err);
  }
}

function renderEntries(entries) {
  const grid = document.getElementById('entries-grid');

  if (!entries || entries.length === 0) {
    grid.innerHTML = '<div class="empty-state">No entries yet. Use the AI chat to add some!</div>';
    return;
  }

  grid.innerHTML = entries
    .map((entry) => {
      const preview = getEntryPreview(entry);
      const badgeClass = ['contact', 'note', 'email', 'bookmark', 'idea', 'place'].includes(entry.type)
        ? entry.type
        : 'default';
      const time = new Date(entry.created_at + 'Z').toLocaleDateString();

      return `
      <div class="entry-card" onclick="showEntry('${entry.id}')">
        <div class="entry-card-header">
          <span class="type-badge ${badgeClass}">${escapeHtml(entry.type)}</span>
          <span class="entry-title">${escapeHtml(entry.title)}</span>
        </div>
        <div class="entry-preview">${escapeHtml(preview)}</div>
        <div class="entry-meta">
          <span>${time}</span>
          ${entry.tags ? `<span class="entry-tags">${escapeHtml(entry.tags)}</span>` : ''}
        </div>
      </div>`;
    })
    .join('');
}

function getEntryPreview(entry) {
  try {
    const content = JSON.parse(entry.content);
    if (entry.type === 'contact') {
      return [content.email, content.phone, content.company].filter(Boolean).join(' · ');
    }
    if (entry.type === 'note' || entry.type === 'idea') {
      return (content.body || '').slice(0, 120);
    }
    if (entry.type === 'bookmark') {
      return content.description || content.url || '';
    }
    if (entry.type === 'email') {
      return `From: ${content.from || 'unknown'} — ${(content.body || '').slice(0, 80)}`;
    }
    if (entry.type === 'place') {
      return [content.address, content.city, content.description].filter(Boolean).join(' · ');
    }
    return JSON.stringify(content).slice(0, 120);
  } catch {
    return entry.content.slice(0, 120);
  }
}

async function showEntry(id) {
  try {
    const res = await fetch(`${API}/api/entries/${id}`);
    const entry = await res.json();

    document.getElementById('modal-title').textContent = entry.title;

    let html = '';
    const badgeClass = ['contact', 'note', 'email', 'bookmark', 'idea', 'place'].includes(entry.type)
      ? entry.type
      : 'default';
    html += `<div class="detail-field"><div class="detail-label">Type</div><div class="detail-value"><span class="type-badge ${badgeClass}">${escapeHtml(entry.type)}</span></div></div>`;

    try {
      const content = JSON.parse(entry.content);
      for (const [key, value] of Object.entries(content)) {
        if (value) {
          let displayValue;
          if (key === 'url') {
            displayValue = `<a href="${escapeHtml(String(value))}" target="_blank" rel="noopener">${escapeHtml(String(value))}</a>`;
          } else if (key === 'email') {
            displayValue = `<a href="mailto:${escapeHtml(String(value))}">${escapeHtml(String(value))}</a>`;
          } else if (key === 'body') {
            displayValue = `<div style="white-space:pre-wrap">${escapeHtml(String(value))}</div>`;
          } else {
            displayValue = escapeHtml(String(value));
          }
          html += `<div class="detail-field"><div class="detail-label">${escapeHtml(key)}</div><div class="detail-value">${displayValue}</div></div>`;
        }
      }
    } catch {
      html += `<div class="detail-field"><div class="detail-label">Content</div><div class="detail-value" style="white-space:pre-wrap">${escapeHtml(entry.content)}</div></div>`;
    }

    if (entry.tags) {
      html += `<div class="detail-field"><div class="detail-label">Tags</div><div class="detail-value entry-tags">${escapeHtml(entry.tags)}</div></div>`;
    }
    html += `<div class="detail-field"><div class="detail-label">Created</div><div class="detail-value">${new Date(entry.created_at + 'Z').toLocaleString()}</div></div>`;
    html += `<div class="detail-field"><div class="detail-label">Source</div><div class="detail-value">${escapeHtml(entry.source)}</div></div>`;

    document.getElementById('modal-body').innerHTML = html;

    document.getElementById('modal-delete').onclick = async () => {
      if (confirm('Delete this entry?')) {
        await fetch(`${API}/api/entries/${id}`, { method: 'DELETE' });
        document.getElementById('modal-overlay').style.display = 'none';
        if (currentPage !== 'chat') loadEntries(currentFilter);
        loadCounts();
      }
    };

    document.getElementById('modal-overlay').style.display = 'flex';
  } catch (err) {
    console.error('Failed to load entry:', err);
  }
}

async function saveManualEntry() {
  const type = document.getElementById('add-type').value;
  const title = document.getElementById('add-title').value;
  const content = document.getElementById('add-content').value;
  const tags = document.getElementById('add-tags').value;

  if (!title || !content) {
    alert('Title and content are required');
    return;
  }

  try {
    await fetch(`${API}/api/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, content: JSON.stringify({ body: content }), tags }),
    });

    document.getElementById('add-modal-overlay').style.display = 'none';
    document.getElementById('add-title').value = '';
    document.getElementById('add-content').value = '';
    document.getElementById('add-tags').value = '';
    if (currentPage !== 'chat') loadEntries(currentFilter);
    loadCounts();
  } catch (err) {
    console.error('Failed to save entry:', err);
    alert('Failed to save entry');
  }
}

// --- Chat ---
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  const chatMessage = smartPasteMode
    ? `Please parse and organize the following data into appropriate wiki entries:\n\n${message}`
    : message;

  input.value = '';
  input.style.height = 'auto';
  if (smartPasteMode) {
    smartPasteMode = false;
    document.getElementById('smart-paste-indicator').style.display = 'none';
    input.placeholder = 'Ask me anything or paste data to organize...';
  }

  appendMessage('user', message);
  const loadingId = appendMessage('assistant', 'Thinking', true);
  document.getElementById('btn-send').disabled = true;

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: chatMessage,
        conversation_id: currentConversationId,
        user_profile: JSON.parse(localStorage.getItem('nexus_profile') || 'null'),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Chat request failed');
    }

    currentConversationId = data.conversation_id;
    removeMessage(loadingId);
    appendMessage('assistant', data.response, false, data.tool_calls);

    // Refresh wiki data if tools were called
    if (data.tool_calls && data.tool_calls.length > 0) {
      loadCounts();
    }
  } catch (err) {
    console.error('Chat error:', err);
    removeMessage(loadingId);
    appendMessage('assistant', `Error: ${err.message}. Make sure the API is running and ANTHROPIC_API_KEY is set.`);
  } finally {
    document.getElementById('btn-send').disabled = false;
    document.getElementById('chat-input').focus();
  }
}

function appendMessage(role, text, isLoading = false, toolCalls = null) {
  const messages = document.getElementById('chat-messages');
  const id = 'msg-' + Date.now() + Math.random().toString(36).slice(2);

  const div = document.createElement('div');
  div.className = `message ${role}${isLoading ? ' loading' : ''}`;
  div.id = id;

  let html = `<div class="message-content">${isLoading ? '<span class="loading-dots">Thinking</span>' : formatMessage(text)}</div>`;

  if (toolCalls && toolCalls.length > 0) {
    html += '<div class="tool-calls">';
    for (const tc of toolCalls) {
      const icon = getToolIcon(tc.tool);
      const summary = getToolResultSummary(tc);
      html += `<div class="tool-call-item">${icon} <span class="tool-call-name">${escapeHtml(tc.tool)}</span> ${escapeHtml(summary)}</div>`;
    }
    html += '</div>';
  }

  div.innerHTML = html;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return id;
}

function removeMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function getToolIcon(tool) {
  const icons = {
    create_entry: '➕',
    update_entry: '✏️',
    delete_entry: '🗑️',
    search_entries: '🔍',
    list_entries: '📋',
  };
  return icons[tool] || '🔧';
}

function getToolResultSummary(tc) {
  if (tc.tool === 'create_entry' && tc.result?.success) {
    return `Created "${tc.result.title}" (${tc.result.type})`;
  }
  if (tc.tool === 'update_entry' && tc.result?.success) return 'Updated entry';
  if (tc.tool === 'delete_entry' && tc.result?.success) return `Deleted "${tc.result.deleted}"`;
  if (tc.tool === 'search_entries') return `Found ${tc.result?.results?.length || 0} results`;
  if (tc.tool === 'list_entries') return `Listed ${tc.result?.total || 0} entries`;
  return '';
}

function formatMessage(text) {
  if (!text) return '<em style="color:var(--text-dim)">No response</em>';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Diary ---
async function loadDiary() {
  try {
    // Load diary entries and streak in parallel
    const [diaryRes, streakRes] = await Promise.all([
      fetch(`${API}/api/diary`),
      fetch(`${API}/api/diary/streak`),
    ]);

    const diaries = await diaryRes.json();
    const streak = await streakRes.json();

    // Update stats
    document.getElementById('diary-streak').textContent = streak.streak || 0;
    document.getElementById('diary-total').textContent = streak.total_diaries || 0;
    const weekTotal = (streak.week_activity || []).reduce((sum, a) => sum + a.count, 0);
    document.getElementById('diary-week-activity').textContent = weekTotal;

    renderDiaryEntries(diaries);
  } catch (err) {
    console.error('Failed to load diary:', err);
  }
}

function renderDiaryEntries(entries) {
  const container = document.getElementById('diary-entries');

  if (!entries || entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No diary entries yet.</p>
        <p style="margin-top:8px;font-size:13px">Click "Generate Today's Summary" to create an AI-written diary entry based on today's activity, or ask the AI to write one for you in the chat.</p>
      </div>`;
    return;
  }

  container.innerHTML = entries.map((entry) => {
    let content;
    try { content = JSON.parse(entry.content); } catch { content = { body: entry.content }; }

    const mood = content.mood || '';
    const moodClass = ['productive', 'relaxed', 'excited', 'reflective'].includes(mood.toLowerCase())
      ? mood.toLowerCase()
      : 'default';

    const highlights = content.highlights
      ? content.highlights.split(',').map((h) => h.trim()).filter(Boolean)
      : [];

    const date = entry.title.replace('Diary: ', '');
    const dateDisplay = formatDiaryDate(date);

    return `
      <div class="diary-card" onclick="showEntry('${entry.id}')">
        <div class="diary-date">
          ${escapeHtml(dateDisplay)}
          ${mood ? `<span class="diary-mood ${moodClass}">${escapeHtml(mood)}</span>` : ''}
        </div>
        <div class="diary-title">${escapeHtml(entry.title)}</div>
        <div class="diary-body">${escapeHtml(content.body || '')}</div>
        ${highlights.length > 0 ? `
          <div class="diary-highlights">
            ${highlights.map((h) => `<span class="diary-highlight-tag">${escapeHtml(h)}</span>`).join('')}
          </div>
        ` : ''}
      </div>`;
  }).join('');
}

function formatDiaryDate(dateStr) {
  try {
    const date = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

async function generateDiary() {
  const btn = document.getElementById('btn-generate-diary');
  const container = document.getElementById('diary-entries');

  btn.disabled = true;
  btn.textContent = '⏳ Generating...';

  // Show generating state
  const existingContent = container.innerHTML;
  container.innerHTML = `
    <div class="diary-generating">
      <div class="spinner"></div>
      <p>AI is reviewing today's activity and writing your diary entry...</p>
    </div>
  ` + existingContent;

  try {
    const res = await fetch(`${API}/api/diary/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const data = await res.json();

    if (!data.generated) {
      alert(data.response || 'No activity to summarize yet.');
    }

    // Reload diary to show new entry
    await loadDiary();
    loadCounts();
  } catch (err) {
    console.error('Failed to generate diary:', err);
    alert('Failed to generate diary entry. Make sure ANTHROPIC_API_KEY is set.');
    container.innerHTML = existingContent;
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Generate Today\'s Summary';
  }
}

// --- Vault ---
async function loadVault() {
  try {
    const res = await fetch(`${API}/api/entries?type=vault`);
    const entries = await res.json();
    const container = document.getElementById('vault-entries');

    if (!entries || entries.length === 0) {
      container.innerHTML = '<div class="empty-state">No documents stored yet. Upload your first document!</div>';
      return;
    }

    container.innerHTML = entries.map((entry) => {
      let content;
      try { content = JSON.parse(entry.content); } catch { content = { description: entry.content }; }

      const catIcons = { id: '🪪', financial: '💰', medical: '🏥', legal: '📜', education: '🎓', other: '📁' };
      const icon = catIcons[content.category] || '📄';

      return `
        <div class="entry-card" onclick="showEntry('${entry.id}')">
          <div class="entry-card-header">
            <span class="type-badge vault">${icon} ${escapeHtml(content.category || 'document')}</span>
            <span class="entry-title">${escapeHtml(entry.title)}</span>
          </div>
          <div class="entry-preview">${escapeHtml(content.description || '')}</div>
          <div class="entry-meta">
            <span>${new Date(entry.created_at + 'Z').toLocaleDateString()}</span>
            ${entry.tags ? `<span class="entry-tags">${escapeHtml(entry.tags)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load vault:', err);
  }
}

async function saveVaultEntry() {
  const fileInput = document.getElementById('vault-file');
  const name = document.getElementById('vault-name').value;
  const category = document.getElementById('vault-category').value;
  const desc = document.getElementById('vault-desc').value;
  const tags = document.getElementById('vault-tags').value;
  const file = fileInput.files[0];

  if (!name) {
    alert('Document name is required');
    return;
  }

  // Build content with file metadata
  const contentObj = {
    category,
    description: desc,
  };

  if (file) {
    contentObj.fileName = file.name;
    contentObj.fileType = file.type;
    contentObj.fileSize = formatFileSize(file.size);

    // Convert file to base64 for storage
    const base64 = await fileToBase64(file);
    contentObj.fileData = base64;
  }

  try {
    await fetch(`${API}/api/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'vault',
        title: name,
        content: JSON.stringify(contentObj),
        tags: tags || `vault,${category}`,
      }),
    });

    document.getElementById('vault-modal-overlay').style.display = 'none';
    document.getElementById('vault-name').value = '';
    document.getElementById('vault-desc').value = '';
    document.getElementById('vault-tags').value = '';
    fileInput.value = '';
    loadVault();
    loadCounts();
  } catch (err) {
    console.error('Failed to save vault entry:', err);
    alert('Failed to save document');
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// --- Settings ---
async function loadSettingsPage() {
  try {
    const res = await fetch(`${API}/api/settings`);
    const settings = await res.json();

    // Show masked values in placeholders
    const anthropicInput = document.getElementById('setting-anthropic-key');
    const googleIdInput = document.getElementById('setting-google-id');
    const googleSecretInput = document.getElementById('setting-google-secret');

    if (settings.ANTHROPIC_API_KEY) anthropicInput.placeholder = settings.ANTHROPIC_API_KEY;
    if (settings.GOOGLE_CLIENT_ID) googleIdInput.placeholder = settings.GOOGLE_CLIENT_ID;
    if (settings.GOOGLE_CLIENT_SECRET) googleSecretInput.placeholder = settings.GOOGLE_CLIENT_SECRET;

    // Status
    const statusEl = document.getElementById('settings-status');
    const hasAnthropic = settings.ANTHROPIC_API_KEY && settings.ANTHROPIC_API_KEY.startsWith('••');
    const hasGoogle = settings.GOOGLE_CLIENT_ID && settings.GOOGLE_CLIENT_ID.length > 0;

    statusEl.innerHTML = `
      <div><span class="${hasAnthropic ? 'status-ok' : 'status-missing'}">${hasAnthropic ? '  Configured' : '  Not set'}</span> — Anthropic API Key</div>
      <div><span class="${hasGoogle ? 'status-ok' : 'status-missing'}">${hasGoogle ? '  Configured' : '  Not set (optional)'}</span> — Gmail Integration</div>
    `;
  } catch (err) {
    document.getElementById('settings-status').textContent = 'Failed to load settings. The settings table may need to be created.';
  }
}

async function saveSetting(key, inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) {
    alert('Please enter a value');
    return;
  }

  try {
    const res = await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to save');
      return;
    }

    input.value = '';
    input.placeholder = '••••••••' + value.slice(-4);
    loadSettingsPage();
  } catch (err) {
    alert('Failed to save setting: ' + err.message);
  }
}

// Listen for Gmail OAuth callback
window.addEventListener('message', (event) => {
  if (event.data?.type === 'gmail_auth') {
    alert('Gmail connected! You can now import emails through the AI chat.\n\nTell the AI: "Import my recent emails"');
  }
});
