// Front-end Application logic for CronWA

let currentUser = null;
try {
  const cachedUser = localStorage.getItem('cronwa_user');
  if (cachedUser) currentUser = JSON.parse(cachedUser);
} catch (e) {}
let apiToken = localStorage.getItem('cronwa_token') || null;
let cachedUsers = [];
let cachedTasks = [];
let autoRefreshInterval = null;
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth() + 1;
let calendarData = null;

// SHA-256 via Web Crypto API
async function sha256Hex(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Format an 8-char verification code as "ABCD-EFGH"
function formatVerifCode(code) {
  if (!code || code.length < 8) return '---- ----';
  const raw = code.replace(/[^A-Z0-9]/gi, '');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

// ---------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupEventListeners();
  setupDialogLightDismiss();
  
  if (apiToken && currentUser) {
    // Optimistically show the app using the cached profile to prevent login screen flashing
    showApp();
    
    const res = await fetchCurrentUser();
    if (!res.success) {
      if (res.status === 401) {
        logout();
      } else {
        toggleConnectionBanner(true);
      }
    }
  } else {
    showLogin();
    if (apiToken) {
      const res = await fetchCurrentUser();
      if (res.success) {
        showApp();
      } else {
        logout();
      }
    }
  }
});

async function fetchCurrentUser() {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    
    if (res.ok) {
      currentUser = await res.json();
      localStorage.setItem('cronwa_user', JSON.stringify(currentUser));
      toggleConnectionBanner(false);
      updateProfileUI();
      return { success: true };
    }
    return { success: false, status: res.status };
  } catch (err) {
    console.error('Error fetching current user:', err);
    return { success: false, status: 'network-error' };
  }
}

function toggleConnectionBanner(show) {
  let banner = document.getElementById('connectionBanner');
  if (!banner) {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      banner = document.createElement('div');
      banner.id = 'connectionBanner';
      banner.className = 'connection-banner';
      banner.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>Connection lost. Operating in cached offline mode. Reconnecting...</span>
      `;
      const toggle = mainContent.querySelector('.mobile-header-toggle');
      if (toggle) {
        toggle.insertAdjacentElement('afterend', banner);
      } else {
        mainContent.insertBefore(banner, mainContent.firstChild);
      }
    }
  }
  if (banner) {
    banner.style.display = show ? 'flex' : 'none';
  }
}

// ---------------------------------------------------------------
// NAVIGATION & VIEW SWITCHING
// ---------------------------------------------------------------
function showLogin() {
  document.getElementById('appPage').style.display = 'none';
  document.getElementById('loginPage').style.display = 'flex';
  stopAutoRefresh();
}

function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'flex';
  
  updateProfileUI();
  
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  switchTab(hash);
  startAutoRefresh();
}

function updateProfileUI() {
  if (!currentUser) return;
  
  const profileUsername = document.getElementById('profileUsername');
  const profileRole = document.getElementById('profileRole');
  const userAvatar = document.getElementById('userAvatar');
  const adminNav = document.getElementById('adminNav');

  if (profileUsername) profileUsername.textContent = currentUser.username;
  if (profileRole) profileRole.textContent = currentUser.isAdmin ? 'Admin' : 'User';
  if (userAvatar) userAvatar.textContent = currentUser.username.charAt(0).toUpperCase();
  
  if (adminNav) {
    if (currentUser.isAdmin) {
      adminNav.style.display = 'block';
      fetchUsersList();
    } else {
      adminNav.style.display = 'none';
    }
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-tab') === tabId);
  });
  
  document.querySelectorAll('.page-container').forEach(page => {
    page.classList.toggle('active', page.id === `${tabId}Tab`);
  });

  if (tabId === 'dashboard') {
    refreshTasks();
    refreshStats();
  } else if (tabId === 'logs') {
    refreshLogs();
  } else if (tabId === 'calendar') {
    refreshCalendar();
  } else if (tabId === 'settings') {
    loadSettings();
  } else if (tabId === 'admin') {
    if (currentUser.isAdmin) refreshUsers();
    else switchTab('dashboard');
  }
  
  window.location.hash = tabId;
  document.getElementById('appSidebar').classList.remove('mobile-open');
}

function setupNavigation() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(link.getAttribute('data-tab'));
    });
  });
  
  document.getElementById('mobileMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('appSidebar').classList.toggle('mobile-open');
  });
  
  // Close mobile sidebar when clicking outside
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('appSidebar');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    if (sidebar.classList.contains('mobile-open') && 
        !sidebar.contains(e.target) && 
        !mobileMenuBtn.contains(e.target)) {
      sidebar.classList.remove('mobile-open');
    }
  });
  
  document.getElementById('logoutBtn').addEventListener('click', logout);
}

async function logout() {
  if (apiToken) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
    } catch (e) {}
  }
  
  apiToken = null;
  currentUser = null;
  localStorage.removeItem('cronwa_token');
  localStorage.removeItem('cronwa_user');
  showLogin();
}

// ---------------------------------------------------------------
// AUTO-REFRESH
// ---------------------------------------------------------------
function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(() => {
    const tab = window.location.hash.replace('#', '') || 'dashboard';
    if (tab === 'dashboard') {
      refreshTasks(true);
      refreshStats();
    }
  }, 10000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// ---------------------------------------------------------------
// EVENT LISTENERS
// ---------------------------------------------------------------
function setupEventListeners() {
  // Login form
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const submitBtn = document.getElementById('loginSubmitBtn');
    const alertContainer = document.getElementById('loginAlertContainer');
    
    alertContainer.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Signing in…';
    
    try {
      const passwordHash = await sha256Hex(password);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passwordHash })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        showAlert(alertContainer, 'danger', data.error || 'Login failed');
        return;
      }
      
      apiToken = data.token;
      currentUser = data.user;
      localStorage.setItem('cronwa_token', apiToken);
      localStorage.setItem('cronwa_user', JSON.stringify(currentUser));
      
      document.getElementById('loginForm').reset();
      showApp();
    } catch (err) {
      showAlert(alertContainer, 'danger', 'Network error, please try again.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Sign in';
    }
  });

  // Task type selector
  document.getElementById('taskType').addEventListener('change', (e) => {
    document.querySelectorAll('.schedule-field').forEach(f => f.style.display = 'none');
    const map = { OneTime: 'oneTimeFields', Interval: 'intervalFields', Cron: 'cronFields' };
    const el = document.getElementById(map[e.target.value]);
    if (el) el.style.display = 'block';
  });

  // Send immediately selector
  document.getElementById('sendImmediately').addEventListener('change', (e) => {
    const runAtInput = document.getElementById('runAt');
    if (e.target.checked) {
      runAtInput.disabled = true;
      runAtInput.value = '';
    } else {
      runAtInput.disabled = false;
    }
  });

  // Task form
  document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);
  document.getElementById('createNewTaskBtn').addEventListener('click', () => openTaskDialog());


  // Manual WhatsApp binding
  document.getElementById('manualWaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const number = document.getElementById('manualWaNumber').value.trim();
    const alert = document.getElementById('settingsAlertContainer');
    alert.innerHTML = '';
    
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify({ chatId: number })
      });
      const data = await res.json();
      if (res.ok) {
        showAlert(alert, 'success', 'WhatsApp number updated!');
        currentUser.chatId = number;
        currentUser.verificationCode = null;
        localStorage.setItem('cronwa_user', JSON.stringify(currentUser));
        loadSettings();
        refreshTasks();
      } else {
        showAlert(alert, 'danger', data.error || 'Failed');
      }
    } catch (err) {
      showAlert(alert, 'danger', 'Network error');
    }
  });



  // Refresh logs button
  document.getElementById('refreshLogsBtn').addEventListener('click', () => refreshLogs());

  // Calendar Navigation
  document.getElementById('calPrevBtn').addEventListener('click', () => {
    calCurrentMonth--;
    if (calCurrentMonth < 1) {
      calCurrentMonth = 12;
      calCurrentYear--;
    }
    refreshCalendar();
  });

  document.getElementById('calNextBtn').addEventListener('click', () => {
    calCurrentMonth++;
    if (calCurrentMonth > 12) {
      calCurrentMonth = 1;
      calCurrentYear++;
    }
    refreshCalendar();
  });

  document.getElementById('calTodayBtn').addEventListener('click', () => {
    const today = new Date();
    calCurrentYear = today.getFullYear();
    calCurrentMonth = today.getMonth() + 1;
    refreshCalendar();
  });

  // Calendar Daily Toggle
  const toggleDailyBtn = document.getElementById('calToggleDailyBtn');
  if (toggleDailyBtn) {
    const initialHide = localStorage.getItem('cal_hide_daily') === 'true';
    updateToggleDailyBtnState(initialHide);

    toggleDailyBtn.addEventListener('click', () => {
      const currentHide = localStorage.getItem('cal_hide_daily') === 'true';
      const newHide = !currentHide;
      localStorage.setItem('cal_hide_daily', newHide);
      updateToggleDailyBtnState(newHide);
      if (calendarData) {
        renderCalendar(calendarData);
      }
    });
  }

  // Create User
  document.getElementById('createNewUserBtn').addEventListener('click', () => {
    document.getElementById('userForm').reset();
    document.getElementById('userDialog').showModal();
  });

  // User form Submit
  document.getElementById('userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('createUserUsername').value.trim();
    const pass = document.getElementById('createUserPassword').value;
    const isAdmin = document.getElementById('createUserIsAdmin').checked;
    const chatId = document.getElementById('createUserChatId').value.trim();
    const alert = document.getElementById('adminAlertContainer');
    alert.innerHTML = '';

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify({ username, passwordHash: await sha256Hex(pass), isAdmin, chatId: chatId || null })
      });
      
      if (res.ok) {
        document.getElementById('userDialog').close();
        refreshUsers();
        showAlert(alert, 'success', `User "${username}" created!`);
      } else {
        const data = await res.json();
        showAlert(alert, 'danger', data.error || 'Failed to create user');
        document.getElementById('userDialog').close();
      }
    } catch (e) {
      showAlert(alert, 'danger', 'Error creating user');
      document.getElementById('userDialog').close();
    }
  });

  // Edit User form Submit
  document.getElementById('editUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = document.getElementById('editUserIdField').value;
    const username = document.getElementById('editUserUsername').value.trim();
    const pass = document.getElementById('editUserPassword').value;
    const isAdmin = document.getElementById('editUserIsAdmin').checked;
    const chatId = document.getElementById('editUserChatId').value.trim();
    
    const alert = document.getElementById('adminAlertContainer');
    alert.innerHTML = '';

    const payload = { username, isAdmin, chatId: chatId || null };
    if (pass) payload.passwordHash = await sha256Hex(pass);

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        document.getElementById('editUserDialog').close();
        refreshUsers();
        showAlert(alert, 'success', 'User updated!');
      } else {
        const data = await res.json();
        showAlert(alert, 'danger', data.error || 'Failed');
        document.getElementById('editUserDialog').close();
      }
    } catch (e) {
      showAlert(alert, 'danger', 'Error updating user');
      document.getElementById('editUserDialog').close();
    }
  });
}

// Dialog light-dismiss fallback
function setupDialogLightDismiss() {
  document.querySelectorAll('dialog').forEach(dialog => {
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        if (event.clientX === 0 && event.clientY === 0) return; // Prevent dismissal on native select/date-time overlays
        const rect = dialog.getBoundingClientRect();
        const inside = (
          rect.top <= event.clientY && event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX && event.clientX <= rect.left + rect.width
        );
        if (!inside) dialog.close();
      });
    }
  });
}

// ---------------------------------------------------------------
// ALERTS
// ---------------------------------------------------------------
function showAlert(container, type, message) {
  container.innerHTML = `<div class="alert alert-${type}"><div>${message}</div></div>`;
}

// ---------------------------------------------------------------
// DASHBOARD STATS
// ---------------------------------------------------------------
async function refreshStats() {
  try {
    const res = await fetch('/api/tasks/stats', {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) return;
    const stats = await res.json();
    toggleConnectionBanner(false);
    
    const container = document.getElementById('statsContainer');
    if (!container) return;
    
    container.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.total}</div>
        <div class="stat-label">Total Tasks</div>
      </div>
      <div class="stat-card stat-active">
        <div class="stat-value">${stats.Active}</div>
        <div class="stat-label">Active</div>
      </div>
      <div class="stat-card stat-paused">
        <div class="stat-value">${stats.Paused}</div>
        <div class="stat-label">Paused</div>
      </div>
      <div class="stat-card stat-completed">
        <div class="stat-value">${stats.Completed + stats.Failed}</div>
        <div class="stat-label">Done / Failed</div>
      </div>
      <div class="stat-card stat-logs">
        <div class="stat-value">${stats.recentLogs.succeeded}<span class="stat-sub">/ ${stats.recentLogs.total}</span></div>
        <div class="stat-label">Sent (24h)</div>
      </div>
    `;
  } catch (e) {
    toggleConnectionBanner(true);
  }
}

// ---------------------------------------------------------------
// TASKS
// ---------------------------------------------------------------
async function refreshTasks(silent = false) {
  if (!apiToken) return;
  
  try {
    const res = await fetch('/api/tasks', {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    
    if (!res.ok) {
      if (res.status === 401) logout();
      return;
    }
    
    const tasks = await res.json();
    cachedTasks = tasks;
    toggleConnectionBanner(false);
    
    const summaryText = document.getElementById('taskSummaryText');
    summaryText.textContent = tasks.length === 0
      ? 'No scheduled tasks'
      : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} scheduled`;
    
    renderTasksList(tasks);
  } catch (err) {
    console.error('Error refreshing tasks:', err);
    toggleConnectionBanner(true);
  }
}

function renderTasksList(tasks) {
  const tableContainer = document.getElementById('tasksTableContainer');
  const emptyState = document.getElementById('tasksEmptyState');
  const headerRow = document.getElementById('tasksTableHeaderRow');
  const tbody = document.getElementById('tasksTableBody');
  
  tbody.innerHTML = '';
  
  if (tasks.length === 0) {
    if (tableContainer) tableContainer.style.display = 'none';
    if (emptyState) {
      emptyState.style.display = 'block';
      emptyState.innerHTML = `
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <h4 class="empty-title">No tasks scheduled yet</h4>
          <p class="empty-desc">Create your first notification task to get started.</p>
          <button class="btn btn-primary btn-sm" onclick="openTaskDialog()">Create first task</button>
        </div>
      `;
    }
    return;
  }
  
  if (tableContainer) tableContainer.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';
  
  // Build header
  const headerHtml = `
    <th>Task Details</th>
    <th>Message</th>
    <th>Schedule &amp; Runs</th>
    <th style="text-align: right;">Actions</th>
  `;
  if (headerRow) headerRow.innerHTML = headerHtml;

  tasks.forEach(task => {
    const tr = document.createElement('tr');
    
    const statusMap = {
      Active: 'badge-success', Paused: 'badge-secondary', Firing: 'badge-warning',
      Completed: 'badge-success', Failed: 'badge-danger'
    };
    const statusClass = statusMap[task.status] || 'badge-secondary';
    
    let schedDetail = '';
    const spec = task.scheduleSpec || {};
    if (task.task_type === 'OneTime' && spec.run_at) {
      schedDetail = `Once: ${new Date(spec.run_at).toLocaleString()}`;
    } else if (task.task_type === 'Interval') {
      schedDetail = `Every ${spec.interval_secs}s`;
    } else if (task.task_type === 'Cron') {
      schedDetail = `Cron: ${spec.expression}`;
    }

    const nextRun = task.next_run_at ? new Date(task.next_run_at).toLocaleString() : '—';
    const lastRun = task.last_run_at ? new Date(task.last_run_at).toLocaleString() : 'Never';
    
    const ownerText = currentUser.isAdmin
      ? ` • by ${escapeHtml(task.owner_username || 'Unknown')}`
      : '';

    let actionBtns = '';
    if (task.status === 'Active') {
      actionBtns += `<button class="btn btn-secondary btn-sm" onclick="pauseTask('${task.id}')" title="Pause" style="padding: 0.35rem 0.5rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg></button>`;
    } else if (task.status === 'Paused' || task.status === 'Failed') {
      actionBtns += `<button class="btn btn-secondary btn-sm" onclick="resumeTask('${task.id}')" title="Resume" style="padding: 0.35rem 0.5rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>`;
    }
    actionBtns += `<button class="btn btn-secondary btn-sm" onclick="openTaskDialog('${task.id}')" title="Edit" style="padding: 0.35rem 0.5rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>`;
    actionBtns += `<button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')" title="Delete" style="padding: 0.35rem 0.5rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;

    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
          <span class="td-name">${escapeHtml(task.name)}</span>
          <span class="badge ${statusClass}">${task.status}</span>
          <span class="badge badge-primary">${task.task_type}</span>
        </div>
        <div class="td-meta" style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="td-mono">To: ${escapeHtml(task.target_wa_chat_id)}</span>
          <span style="opacity: 0.8;">${ownerText}</span>
        </div>
      </td>
      <td class="td-msg" title="${escapeHtml(task.message_template)}">
        ${escapeHtml(task.message_template)}
      </td>
      <td>
        <div style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary);">${escapeHtml(schedDetail)}</div>
        <div class="td-meta" style="margin-top: 0.25rem; line-height: 1.3;">
          <div>Last: ${lastRun}</div>
          <div>Next: ${nextRun}</div>
        </div>
      </td>
      <td>
        <div style="display: flex; justify-content: flex-end; gap: 0.35rem;">
          ${actionBtns}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function pauseTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/pause`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (res.ok) { refreshTasks(); refreshStats(); }
  } catch (err) {}
}

async function resumeTask(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/resume`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (res.ok) { refreshTasks(); refreshStats(); }
  } catch (err) {}
}

async function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;
  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE', headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (res.ok) { refreshTasks(); refreshStats(); }
  } catch (err) {}
}

// Task dialog
function openTaskDialog(taskId = null) {
  const form = document.getElementById('taskForm');
  form.reset();
  
  const idField = document.getElementById('taskIdField');
  const title = document.getElementById('taskDialogTitle');
  
  document.querySelectorAll('.schedule-field').forEach(f => f.style.display = 'none');
  document.getElementById('oneTimeFields').style.display = 'block';

  // Reset immediate send checkbox
  const sendImm = document.getElementById('sendImmediately');
  if (sendImm) {
    sendImm.checked = false;
    document.getElementById('runAt').disabled = false;
  }

  // Reset accordion
  const accordion = document.querySelector('#taskDialog .accordion');
  if (accordion) {
    accordion.open = false;
  }

  if (taskId) {
    const task = cachedTasks.find(t => t.id === taskId);
    if (!task) return;
    
    title.textContent = 'Edit Task';
    idField.value = task.id;
    
    document.getElementById('taskName').value = task.name;
    document.getElementById('taskType').value = task.task_type;
    document.getElementById('taskTargetWaChatId').value = task.target_wa_chat_id || '';
    document.getElementById('messageTemplate').value = task.message_template;
    document.getElementById('messageTemplate2').value = task.message_template_2 || '';
    document.getElementById('targetList').value = (task.targetList || []).join(', ');
    
    document.querySelectorAll('.schedule-field').forEach(f => f.style.display = 'none');
    const spec = task.scheduleSpec || {};
    if (task.task_type === 'OneTime') {
      document.getElementById('oneTimeFields').style.display = 'block';
      if (spec.run_at) document.getElementById('runAt').value = new Date(spec.run_at).toISOString().slice(0, 16);
    } else if (task.task_type === 'Interval') {
      document.getElementById('intervalFields').style.display = 'block';
      document.getElementById('intervalSecs').value = spec.interval_secs || 3600;
    } else if (task.task_type === 'Cron') {
      document.getElementById('cronFields').style.display = 'block';
      document.getElementById('cronExpr').value = spec.expression || '';
    }

    // Open accordion if broadcast has data
    const hasBroadcast = task.message_template_2 || (task.targetList && task.targetList.length > 0);
    if (accordion) {
      accordion.open = !!hasBroadcast;
    }
  } else {
    title.textContent = 'Create Task';
    idField.value = '';
    document.getElementById('taskTargetWaChatId').value = currentUser.chatId || '';
  }
  
  document.getElementById('taskDialog').showModal();
}

async function handleTaskFormSubmit(e) {
  e.preventDefault();
  const taskId = document.getElementById('taskIdField').value;
  const name = document.getElementById('taskName').value.trim();
  const taskType = document.getElementById('taskType').value;
  const targetWaChatId = document.getElementById('taskTargetWaChatId').value.trim();
  const messageTemplate = document.getElementById('messageTemplate').value.trim();
  const messageTemplate2 = document.getElementById('messageTemplate2').value.trim();
  const targetListText = document.getElementById('targetList').value.trim();
  
  const targetList = targetListText ? targetListText.split(',').map(s => s.trim()).filter(Boolean) : [];
    
  let scheduleSpec = {};
  if (taskType === 'OneTime') {
    const sendImmediately = document.getElementById('sendImmediately').checked;
    if (sendImmediately) {
      scheduleSpec = { run_at: new Date().toISOString() };
    } else {
      const val = document.getElementById('runAt').value;
      if (!val) return alert('Please enter a trigger date.');
      scheduleSpec = { run_at: new Date(val).toISOString() };
    }
  } else if (taskType === 'Interval') {
    const secs = parseInt(document.getElementById('intervalSecs').value, 10);
    if (!secs || secs < 60) return alert('Interval must be at least 60 seconds.');
    scheduleSpec = { interval_secs: secs };
  } else if (taskType === 'Cron') {
    const cron = document.getElementById('cronExpr').value.trim();
    if (!cron) return alert('Please enter a cron expression.');
    scheduleSpec = { expression: cron };
  }

  const payload = { name, taskType, targetWaChatId, targetList, scheduleSpec, messageTemplate, messageTemplate2 };
  const alertEl = document.getElementById('dashboardAlertContainer');
  alertEl.innerHTML = '';
  const submitBtn = document.getElementById('taskFormSubmitBtn');
  submitBtn.disabled = true;

  try {
    let res;
    if (taskId) {
      res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok) {
      document.getElementById('taskDialog').close();
      refreshTasks();
      refreshStats();
      showAlert(alertEl, 'success', `Task ${taskId ? 'updated' : 'created'}!`);
    } else {
      alert(data.error || 'Failed to save task.');
    }
  } catch (err) {
    alert('Network error.');
  } finally {
    submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------
// LOGS
// ---------------------------------------------------------------
async function refreshLogs() {
  if (!apiToken) return;
  const btn = document.getElementById('refreshLogsBtn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  
  try {
    const res = await fetch('/api/logs', { headers: { 'Authorization': `Bearer ${apiToken}` } });
    if (!res.ok) return;
    renderLogsList(await res.json());
  } catch (e) {
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

function renderLogsList(logs) {
  const tbody = document.getElementById('logsTableBody');
  tbody.innerHTML = '';

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 3rem;">No logs yet.</td></tr>`;
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    const badge = log.success
      ? '<span class="badge badge-success" style="display: inline-flex; align-items: center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.25rem;"><polyline points="20 6 9 17 4 12"></polyline></svg>Sent</span>'
      : `<span class="badge badge-danger" style="display: inline-flex; align-items: center;" title="${escapeHtml(log.error_msg || '')}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.25rem;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Failed</span>`;
      
    const ownerText = currentUser.isAdmin
      ? ` • by ${escapeHtml(log.owner_username || `#${log.owner_user_id}`)}`
      : '';

    // Build error/response detail line
    let detailHtml = '';
    if (!log.success && log.error_msg) {
      detailHtml = `<div style="font-size: 0.75rem; color: var(--danger); margin-top: 4px; word-break: break-all;">✗ ${escapeHtml(log.error_msg)}</div>`;
    }
    if (log.api_response) {
      let parsedRes = null;
      try { parsedRes = JSON.parse(log.api_response); } catch (e) {}
      if (parsedRes) {
        const resPreview = JSON.stringify(parsedRes);
        detailHtml += `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 3px; font-family: 'SF Mono', Monaco, monospace; word-break: break-all; opacity: 0.7;">API: ${escapeHtml(resPreview.length > 120 ? resPreview.substring(0, 120) + '…' : resPreview)}</div>`;
      }
    }
      
    tr.innerHTML = `
      <td>
        <div class="td-name">${escapeHtml(log.task_name)}</div>
        <div class="td-meta" style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem;">
          <span class="td-mono">To: ${escapeHtml(log.target_jid)}</span>
          <span style="opacity: 0.8;">${ownerText}</span>
        </div>
      </td>
      <td class="td-msg" title="${escapeHtml(log.message)}">${escapeHtml(log.message)}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          ${badge}
        </div>
        <div class="td-meta" style="margin-top: 0.25rem;">${new Date(log.sent_at).toLocaleString()}</div>
        ${detailHtml}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------
// CALENDAR
// ---------------------------------------------------------------
async function refreshCalendar() {
  if (!apiToken) return;
  try {
    const res = await fetch(`/api/calendar?year=${calCurrentYear}&month=${calCurrentMonth}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) return;
    calendarData = await res.json();
    renderCalendar(calendarData);
  } catch (e) {
    console.error('Error refreshing calendar:', e);
  }
}

function isDailySchedule(item) {
  if (item.task_type === 'Interval') {
    return item.interval_secs && item.interval_secs <= 86400;
  }
  if (item.task_type === 'Cron' && item.expression) {
    const parts = item.expression.trim().split(/\s+/);
    if (parts.length >= 5) {
      const dom = parts[2];
      const dow = parts[4];
      return dom === '*' && (dow === '*' || dow === '?');
    }
  }
  return false;
}

function updateToggleDailyBtnState(hideDaily) {
  const btn = document.getElementById('calToggleDailyBtn');
  const text = document.getElementById('calToggleDailyText');
  const icon = document.getElementById('calToggleDailyIcon');
  if (!btn || !text || !icon) return;

  if (hideDaily) {
    btn.classList.add('btn-toggle-active');
    text.textContent = 'Show daily';
    icon.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `;
  } else {
    btn.classList.remove('btn-toggle-active');
    text.textContent = 'Hide daily';
    icon.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    `;
  }
}

function renderCalendar(data) {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  document.getElementById('calMonthLabel').textContent = `${monthNames[data.month - 1]} ${data.year}`;
  
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  
  // Close the day detail panel on month change
  document.getElementById('calDayDetail').style.display = 'none';

  // Get first day of the month and total days
  const firstDayIndex = new Date(data.year, data.month - 1, 1).getDay(); // 0 is Sunday
  const totalDays = new Date(data.year, data.month, 0).getDate();
  const prevMonthTotalDays = new Date(data.year, data.month - 1, 0).getDate();
  
  // Render previous month's overlapping days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = prevMonthTotalDays - i;
    const cell = document.createElement('div');
    cell.className = 'cal-day cal-day-other';
    cell.innerHTML = `<div class="cal-day-number">${dayNum}</div>`;
    grid.appendChild(cell);
  }
  
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === data.year && (today.getMonth() + 1) === data.month;
  const todayDay = today.getDate();

  const hideDaily = localStorage.getItem('cal_hide_daily') === 'true';

  // Render current month days
  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (isCurrentMonth && day === todayDay) {
      cell.classList.add('cal-day-today');
    }
    
    // Check if we have logs or scheduled tasks for this day
    const dayLogs = (data.logs && data.logs[day]) || [];
    const dayScheduled = (data.scheduled && data.scheduled[day]) || [];
    
    const dayLogsFiltered = hideDaily ? dayLogs.filter(l => !isDailySchedule(l)) : dayLogs;
    const dayScheduledFiltered = hideDaily ? dayScheduled.filter(s => !isDailySchedule(s)) : dayScheduled;
    
    let dotsHtml = '';
    let labelsHtml = '';
    
    const sentLogs = dayLogsFiltered.filter(l => l.success);
    const failedLogs = dayLogsFiltered.filter(l => !l.success);
    
    let dots = [];
    if (dayScheduledFiltered.length > 0) {
      dots.push(`<div class="cal-dot cal-dot-scheduled" title="${dayScheduledFiltered.length} scheduled"></div>`);
    }
    if (sentLogs.length > 0) {
      dots.push(`<div class="cal-dot cal-dot-sent" title="${sentLogs.length} sent"></div>`);
    }
    if (failedLogs.length > 0) {
      dots.push(`<div class="cal-dot cal-dot-failed" title="${failedLogs.length} failed"></div>`);
    }
    dotsHtml = dots.join('');
    
    // Display the task titles for scheduled tasks
    const schedTaskNames = [...new Set(dayScheduledFiltered.map(s => s.name))];
    schedTaskNames.forEach(name => {
      labelsHtml += `<div class="cal-day-label cal-day-label-scheduled">${escapeHtml(name)}</div>`;
    });
    
    cell.innerHTML = `
      <div class="cal-day-number">${day}</div>
      <div class="cal-day-dots">${dotsHtml}</div>
      <div class="cal-day-labels">${labelsHtml}</div>
    `;
    
    cell.addEventListener('click', () => {
      // Highlight selected cell
      document.querySelectorAll('.cal-day').forEach(c => c.classList.remove('cal-day-selected'));
      cell.classList.add('cal-day-selected');
      showDayDetail(day, data);
    });
    
    grid.appendChild(cell);
  }
  
  // Render next month's overlapping days to fill the 6-row grid (42 cells total)
  const totalCellsRendered = firstDayIndex + totalDays;
  const remainingCells = 42 - totalCellsRendered;
  const targetCellsCount = totalCellsRendered > 35 ? 42 : 35;
  const finalRemaining = targetCellsCount - totalCellsRendered;
  
  for (let day = 1; day <= finalRemaining; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day cal-day-other';
    cell.innerHTML = `<div class="cal-day-number">${day}</div>`;
    grid.appendChild(cell);
  }
}

function showDayDetail(day, data) {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  
  const detailPanel = document.getElementById('calDayDetail');
  const title = document.getElementById('calDayDetailTitle');
  const content = document.getElementById('calDayDetailContent');
  
  title.textContent = `${monthNames[data.month - 1]} ${day}, ${data.year}`;
  content.innerHTML = '';
  
  const dayLogs = (data.logs && data.logs[day]) || [];
  const dayScheduled = (data.scheduled && data.scheduled[day]) || [];
  
  const hideDaily = localStorage.getItem('cal_hide_daily') === 'true';
  const dayLogsFiltered = hideDaily ? dayLogs.filter(l => !isDailySchedule(l)) : dayLogs;
  const dayScheduledFiltered = hideDaily ? dayScheduled.filter(s => !isDailySchedule(s)) : dayScheduled;
  
  if (dayLogsFiltered.length === 0 && dayScheduledFiltered.length === 0) {
    content.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1.5rem 0;">No logs or scheduled tasks for this day${hideDaily ? ' (daily schedules hidden)' : ''}.</p>`;
    detailPanel.style.display = 'block';
    return;
  }
  
  let html = '';
  
  // 1. Scheduled Tasks Section
  if (dayScheduledFiltered.length > 0) {
    html += `
      <div class="cal-detail-section">
        <h4 class="cal-detail-section-title">Scheduled Tasks</h4>
    `;
    
    // Sort scheduled runs chronologically
    dayScheduledFiltered.sort((a, b) => a.fire_at - b.fire_at);
    
    dayScheduledFiltered.forEach(item => {
      const timeStr = new Date(item.fire_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const statusBadge = item.status === 'Paused'
        ? '<span class="badge badge-secondary" style="font-size: 0.7rem; padding: 2px 6px;">Paused</span>'
        : '<span class="badge" style="background-color: rgba(99,102,241,0.15); color: #a5b4fc; font-size: 0.7rem; padding: 2px 6px;">Active</span>';
        
      html += `
        <div class="cal-detail-item">
          <div class="cal-dot cal-dot-scheduled"></div>
          <div class="cal-detail-item-info">
            <div class="cal-detail-item-name">${escapeHtml(item.name)} <span style="font-weight: normal; color: var(--text-muted); font-size: 0.8rem;">(${item.task_type})</span></div>
            <div class="cal-detail-item-meta">Will run at ${timeStr}</div>
          </div>
          <div>${statusBadge}</div>
        </div>
      `;
    });
    
    html += `</div>`;
  }
  
  // 2. Sent Logs Section
  if (dayLogsFiltered.length > 0) {
    html += `
      <div class="cal-detail-section" style="margin-top: 1.5rem;">
        <h4 class="cal-detail-section-title">Activity Logs</h4>
    `;
    
    // Sort logs chronologically
    dayLogsFiltered.sort((a, b) => a.sent_at - b.sent_at);
    
    dayLogsFiltered.forEach(log => {
      const timeStr = new Date(log.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const successBadge = log.success
        ? '<span class="badge badge-success" style="font-size: 0.7rem; padding: 2px 6px; display: inline-flex; align-items: center;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.2rem;"><polyline points="20 6 9 17 4 12"></polyline></svg>Sent</span>'
        : `<span class="badge badge-danger" style="font-size: 0.7rem; padding: 2px 6px; display: inline-flex; align-items: center;" title="${escapeHtml(log.error_msg || '')}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.2rem;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Failed</span>`;

      // Build detail lines for error/API response
      let detailHtml = '';
      if (!log.success && log.error_msg) {
        detailHtml += `<div style="font-size: 0.75rem; color: var(--danger); margin-top: 2px;">Error: ${escapeHtml(log.error_msg)}</div>`;
      }
      if (log.api_response) {
        let parsedRes = null;
        try { parsedRes = JSON.parse(log.api_response); } catch (e) {}
        if (parsedRes) {
          const resPreview = JSON.stringify(parsedRes);
          detailHtml += `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; font-family: 'SF Mono', Monaco, monospace; word-break: break-all; opacity: 0.7;">API: ${escapeHtml(resPreview.length > 100 ? resPreview.substring(0, 100) + '…' : resPreview)}</div>`;
        }
      }
        
      html += `
        <div class="cal-detail-item">
          <div class="cal-dot ${log.success ? 'cal-dot-sent' : 'cal-dot-failed'}"></div>
          <div class="cal-detail-item-info">
            <div class="cal-detail-item-name">${escapeHtml(log.task_name)}</div>
            <div class="cal-detail-item-meta" title="${escapeHtml(log.message)}">${timeStr} to ${escapeHtml(log.target_jid)}: "${escapeHtml(log.message)}"</div>
            ${detailHtml}
          </div>
          <div>${successBadge}</div>
        </div>
      `;
    });
    
    html += `</div>`;
  }
  
  content.innerHTML = html;
  detailPanel.style.display = 'block';
}

// ---------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------
async function loadSettings() {
  await fetchCurrentUser();
  
  const subtitleEl = document.getElementById('settingsSubtitle');
  if (subtitleEl) {
    subtitleEl.innerHTML = `Signed in as <span style="color: var(--text); font-weight: 600;">${escapeHtml(currentUser.username)}</span>`;
  }
  
  const connectedEl = document.getElementById('waStatusConnected');
  const disconnectedEl = document.getElementById('waStatusDisconnected');
  const boundChatIdEl = document.getElementById('settingsBoundChatId');
  const manualWaNumberEl = document.getElementById('manualWaNumber');
  
  if (currentUser.chatId) {
    if (disconnectedEl) disconnectedEl.style.display = 'none';
    if (connectedEl) connectedEl.style.display = 'block';
    if (boundChatIdEl) boundChatIdEl.textContent = currentUser.chatId;
    if (manualWaNumberEl) manualWaNumberEl.value = currentUser.chatId;
  } else {
    if (connectedEl) connectedEl.style.display = 'none';
    if (disconnectedEl) disconnectedEl.style.display = 'block';
    if (manualWaNumberEl) manualWaNumberEl.value = '';
  }
}

// ---------------------------------------------------------------
// ADMIN USERS
// ---------------------------------------------------------------
async function fetchUsersList() {
  try {
    const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${apiToken}` } });
    if (res.ok) cachedUsers = await res.json();
  } catch (e) {}
}

async function refreshUsers() {
  if (!apiToken || !currentUser.isAdmin) return;
  try {
    const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${apiToken}` } });
    if (!res.ok) return;
    const users = await res.json();
    cachedUsers = users;
    document.getElementById('userCountText').textContent = `${users.length} user${users.length !== 1 ? 's' : ''} total`;
    renderUsersList(users);
  } catch (e) {}
}

function renderUsersList(users) {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '';
  
  users.forEach(u => {
    const tr = document.createElement('tr');
    const roleBadge = u.isAdmin
      ? '<span class="badge" style="background-color: rgba(99,102,241,0.15); color: #a5b4fc;">Admin</span>'
      : '<span class="badge badge-secondary">User</span>';
      
    let waStatus;
    if (u.chatId) {
      waStatus = `<span class="verif-status-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> ${escapeHtml(u.chatId)}</span>`;
    } else {
      waStatus = '<span style="color: var(--text-muted);">Not configured</span>';
    }

    const deleteBtn = u.id === currentUser.id ? '' : `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}', '${escapeHtml(u.username)}')">Delete</button>`;
      
    tr.innerHTML = `
      <td class="td-name">${escapeHtml(u.username)}</td>
      <td>${roleBadge}</td>
      <td class="td-mono">${waStatus}</td>
      <td class="td-meta">${new Date(u.createdAt).toLocaleDateString()}</td>
      <td>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-secondary btn-sm" onclick="openEditUserDialog('${u.id}')">Edit</button>
          ${deleteBtn}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function deleteUser(userId, name) {
  if (!confirm(`Delete user "${name}"? All their tasks will be deleted.`)) return;
  const alert = document.getElementById('adminAlertContainer');
  alert.innerHTML = '';
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE', headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (res.ok) {
      refreshUsers();
      showAlert(alert, 'success', `User "${name}" deleted.`);
    } else {
      const data = await res.json();
      showAlert(alert, 'danger', data.error || 'Failed');
    }
  } catch (e) {
    showAlert(alert, 'danger', 'Error');
  }
}

function openEditUserDialog(userId) {
  const user = cachedUsers.find(u => u.id === userId);
  if (!user) return;
  
  document.getElementById('editUserIdField').value = user.id;
  document.getElementById('editUserUsername').value = user.username;
  document.getElementById('editUserPassword').value = '';
  document.getElementById('editUserIsAdmin').checked = !!user.isAdmin;
  document.getElementById('editUserChatId').value = user.chatId || '';
  
  document.getElementById('editUserDialog').showModal();
}

// ---------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
