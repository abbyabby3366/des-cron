// Front-end Application logic for CronWA

let currentUser = null;
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
  
  if (apiToken) {
    const success = await fetchCurrentUser();
    if (success) {
      showApp();
    } else {
      logout();
    }
  } else {
    showLogin();
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
      return true;
    }
    return false;
  } catch (err) {
    console.error('Error fetching current user:', err);
    return false;
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
  
  document.getElementById('profileUsername').textContent = currentUser.username;
  document.getElementById('profileRole').textContent = currentUser.isAdmin ? 'Admin' : 'User';
  document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
  
  if (currentUser.isAdmin) {
    document.getElementById('adminNav').style.display = 'block';
    fetchUsersList();
  } else {
    document.getElementById('adminNav').style.display = 'none';
  }
  
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  switchTab(hash);
  startAutoRefresh();
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
  
  document.getElementById('mobileMenuBtn').addEventListener('click', () => {
    document.getElementById('appSidebar').classList.toggle('mobile-open');
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
        if (data.unverified) {
          showAlert(alertContainer, 'warning', `
            <strong>Account Pending Verification</strong><br>
            Send this code to the WhatsApp bot to verify:<br>
            <div class="verif-code" style="margin: 0.5rem 0; font-size: 1.5rem;">${formatVerifCode(data.verificationCode)}</div>
          `);
        } else {
          showAlert(alertContainer, 'danger', data.error || 'Login failed');
        }
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

  // Task form
  document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);
  document.getElementById('createNewTaskBtn').addEventListener('click', () => openTaskDialog());

  // Send test (Dashboard)
  document.getElementById('sendTestNotificationBtn').addEventListener('click', async () => {
    const btn = document.getElementById('sendTestNotificationBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';
    const alert = document.getElementById('dashboardAlertContainer');
    alert.innerHTML = '';
    
    try {
      const res = await fetch('/api/tasks/test', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      const data = await res.json();
      showAlert(alert, res.ok ? 'success' : 'danger', res.ok ? '✅ Test message sent!' : (data.error || 'Failed'));
    } catch (err) {
      showAlert(alert, 'danger', 'Network error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> Send test`;
    }
  });

  // Send test (Settings)
  document.getElementById('settingsTestBtn').addEventListener('click', async () => {
    const btn = document.getElementById('settingsTestBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    const alert = document.getElementById('settingsAlertContainer');
    alert.innerHTML = '';

    try {
      const res = await fetch('/api/tasks/test', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      const data = await res.json();
      showAlert(alert, res.ok ? 'success' : 'danger', res.ok ? '✅ Test message sent!' : (data.error || 'Failed'));
    } catch (e) {
      showAlert(alert, 'danger', 'Error sending test');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send test message';
    }
  });

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
        showAlert(alert, 'success', '✅ WhatsApp number updated!');
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

  // Change password
  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldP = document.getElementById('oldPassword').value;
    const newP = document.getElementById('newPassword').value;
    const confP = document.getElementById('confirmPassword').value;
    const alert = document.getElementById('settingsAlertContainer');
    alert.innerHTML = '';

    if (newP !== confP) {
      showAlert(alert, 'danger', 'Passwords do not match');
      return;
    }

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify({ oldPasswordHash: await sha256Hex(oldP), newPasswordHash: await sha256Hex(newP) })
      });
      const data = await res.json();
      if (res.ok) {
        showAlert(alert, 'success', '✅ Password updated!');
        document.getElementById('changePasswordForm').reset();
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
    const alert = document.getElementById('adminAlertContainer');
    alert.innerHTML = '';

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify({ username, passwordHash: await sha256Hex(pass), isAdmin })
      });
      const data = await res.json();
      
      if (res.ok) {
        document.getElementById('userDialog').close();
        refreshUsers();
        
        document.getElementById('createdUsernameLabel').textContent = username;
        document.getElementById('createdCodeLabel').textContent = formatVerifCode(data.verificationCode);
        document.getElementById('codeDialog').showModal();
      } else {
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
    const resetVerification = document.getElementById('editUserResetVerification').checked;
    
    const alert = document.getElementById('adminAlertContainer');
    alert.innerHTML = '';

    const payload = { username, isAdmin, chatId: chatId || null, resetVerification };
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
  } catch (e) {}
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
    
    const summaryText = document.getElementById('taskSummaryText');
    summaryText.textContent = tasks.length === 0
      ? 'No scheduled tasks'
      : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} scheduled`;

    const testBtn = document.getElementById('sendTestNotificationBtn');
    testBtn.style.display = currentUser.chatId ? 'inline-flex' : 'none';
    
    renderTasksList(tasks);
  } catch (err) {
    console.error('Error refreshing tasks:', err);
  }
}

function renderTasksList(tasks) {
  const container = document.getElementById('tasksList');
  container.innerHTML = '';
  
  if (tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <h4 class="empty-title">No tasks scheduled yet</h4>
        <p class="empty-desc">Create your first notification task to get started.</p>
        <button class="btn btn-primary btn-sm" onclick="openTaskDialog()">Create first task</button>
      </div>
    `;
    return;
  }
  
  tasks.forEach(task => {
    const card = document.createElement('div');
    card.className = 'task-card';
    
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
    
    let ownerText = '';
    if (currentUser.isAdmin && task.owner_username) {
      ownerText = `<div class="task-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> ${escapeHtml(task.owner_username)}</div>`;
    }

    let actionBtns = '';
    if (task.status === 'Active') {
      actionBtns += `<button class="btn btn-secondary btn-sm" onclick="pauseTask(${task.id})">Pause</button>`;
    } else if (task.status === 'Paused' || task.status === 'Failed') {
      actionBtns += `<button class="btn btn-secondary btn-sm" onclick="resumeTask(${task.id})">Resume</button>`;
    }
    actionBtns += `<button class="btn btn-secondary btn-sm" onclick="openTaskDialog(${task.id})">Edit</button>`;
    actionBtns += `<button class="btn btn-danger btn-sm" onclick="deleteTask(${task.id})">Delete</button>`;

    card.innerHTML = `
      <div class="task-card-left">
        <div class="task-card-title-row">
          <span class="task-name">${escapeHtml(task.name)}</span>
          <span class="badge ${statusClass}">${task.status}</span>
          <span class="badge badge-primary">${task.task_type}</span>
        </div>
        <div class="task-desc">${escapeHtml(task.message_template)}</div>
        <div class="task-meta">
          ${ownerText}
          <div class="task-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg> ${escapeHtml(task.target_wa_chat_id)}</div>
          <div class="task-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> ${schedDetail}</div>
          <div class="task-meta-item">Next: ${nextRun}</div>
          <div class="task-meta-item">Last: ${lastRun}</div>
        </div>
      </div>
      <div class="task-actions">${actionBtns}</div>
    `;
    container.appendChild(card);
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
  const userSelectGroup = document.getElementById('adminUserSelectionGroup');
  const userSelect = document.getElementById('taskOwnerSelect');
  
  document.querySelectorAll('.schedule-field').forEach(f => f.style.display = 'none');
  document.getElementById('oneTimeFields').style.display = 'block';
  
  if (currentUser.isAdmin) {
    userSelectGroup.style.display = 'block';
    populateAdminUserSelect(userSelect);
  } else {
    userSelectGroup.style.display = 'none';
  }

  if (taskId) {
    const task = cachedTasks.find(t => t.id === taskId);
    if (!task) return;
    
    title.textContent = 'Edit Task';
    idField.value = task.id;
    
    document.getElementById('taskName').value = task.name;
    document.getElementById('taskType').value = task.task_type;
    document.getElementById('messageTemplate').value = task.message_template;
    document.getElementById('messageTemplate2').value = task.message_template_2 || '';
    document.getElementById('targetList').value = (task.targetList || []).join(', ');
    
    userSelectGroup.style.display = 'none';
    
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
  } else {
    title.textContent = 'Create Task';
    idField.value = '';
  }
  
  document.getElementById('taskDialog').showModal();
}

function populateAdminUserSelect(el) {
  el.innerHTML = '';
  const users = cachedUsers.filter(u => u.id !== currentUser.id);
  if (users.length === 0) {
    el.innerHTML = '<option value="" disabled>No eligible users</option>';
  } else {
    users.forEach(u => {
      el.innerHTML += `<option value="${u.id}">${escapeHtml(u.username)} (ID: ${u.id})</option>`;
    });
  }
}

async function handleTaskFormSubmit(e) {
  e.preventDefault();
  const taskId = document.getElementById('taskIdField').value;
  const name = document.getElementById('taskName').value.trim();
  const taskType = document.getElementById('taskType').value;
  const messageTemplate = document.getElementById('messageTemplate').value.trim();
  const messageTemplate2 = document.getElementById('messageTemplate2').value.trim();
  const targetListText = document.getElementById('targetList').value.trim();
  
  const targetList = targetListText ? targetListText.split(',').map(s => s.trim()).filter(Boolean) : [];
    
  let scheduleSpec = {};
  if (taskType === 'OneTime') {
    const val = document.getElementById('runAt').value;
    if (!val) return alert('Please enter a trigger date.');
    scheduleSpec = { run_at: new Date(val).toISOString() };
  } else if (taskType === 'Interval') {
    const secs = parseInt(document.getElementById('intervalSecs').value, 10);
    if (!secs || secs < 60) return alert('Interval must be at least 60 seconds.');
    scheduleSpec = { interval_secs: secs };
  } else if (taskType === 'Cron') {
    const cron = document.getElementById('cronExpr').value.trim();
    if (!cron) return alert('Please enter a cron expression.');
    scheduleSpec = { expression: cron };
  }

  const payload = { name, taskType, targetList, scheduleSpec, messageTemplate, messageTemplate2 };
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
      if (currentUser.isAdmin) payload.ownerUserId = document.getElementById('taskOwnerSelect').value;
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
      showAlert(alertEl, 'success', `✅ Task ${taskId ? 'updated' : 'created'}!`);
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
  const ownerH = document.getElementById('logsOwnerHeader');
  tbody.innerHTML = '';
  ownerH.style.display = currentUser.isAdmin ? 'table-cell' : 'none';

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${currentUser.isAdmin ? 6 : 5}" style="text-align: center; color: var(--text-muted); padding: 3rem;">No logs yet.</td></tr>`;
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    const badge = log.success
      ? '<span class="badge badge-success">✓ Sent</span>'
      : `<span class="badge badge-danger" title="${escapeHtml(log.error_msg || '')}">✗ Failed</span>`;
    const ownerCol = currentUser.isAdmin ? `<td>${escapeHtml(log.owner_username || `#${log.owner_user_id}`)}</td>` : '';
      
    tr.innerHTML = `
      <td style="color: var(--text-muted); font-size: 0.85rem; white-space: nowrap;">${new Date(log.sent_at).toLocaleString()}</td>
      ${ownerCol}
      <td style="font-weight: 500;">${escapeHtml(log.task_name)}</td>
      <td class="input-mono" style="font-size: 0.8rem;">${escapeHtml(log.target_jid)}</td>
      <td style="font-size: 0.85rem; color: var(--text-secondary); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(log.message)}</td>
      <td>${badge}</td>
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
    
    let dotsHtml = '';
    let labelsHtml = '';
    
    // Track unique scheduled tasks for labels
    const schedTaskNames = [...new Set(dayScheduled.map(s => s.name))];
    
    // Add dots
    if (dayScheduled.length > 0) {
      dotsHtml += `<div class="cal-dot cal-dot-scheduled"></div>`;
    }
    
    const sentLogs = dayLogs.filter(l => l.success);
    const failedLogs = dayLogs.filter(l => !l.success);
    
    if (sentLogs.length > 0) {
      dotsHtml += `<div class="cal-dot cal-dot-sent"></div>`;
    }
    if (failedLogs.length > 0) {
      dotsHtml += `<div class="cal-dot cal-dot-failed"></div>`;
    }
    
    // Add Labels (visible on desktop)
    schedTaskNames.forEach(name => {
      labelsHtml += `<div class="cal-day-label cal-day-label-scheduled">${escapeHtml(name)}</div>`;
    });
    
    if (sentLogs.length > 0) {
      labelsHtml += `<div class="cal-day-label cal-day-label-sent">${sentLogs.length} Sent</div>`;
    }
    if (failedLogs.length > 0) {
      labelsHtml += `<div class="cal-day-label cal-day-label-failed">${failedLogs.length} Failed</div>`;
    }
    
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
  
  if (dayLogs.length === 0 && dayScheduled.length === 0) {
    content.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1.5rem 0;">No logs or scheduled tasks for this day.</p>';
    detailPanel.style.display = 'block';
    return;
  }
  
  let html = '';
  
  // 1. Scheduled Tasks Section
  if (dayScheduled.length > 0) {
    html += `
      <div class="cal-detail-section">
        <h4 class="cal-detail-section-title">Scheduled Tasks</h4>
    `;
    
    // Sort scheduled runs chronologically
    dayScheduled.sort((a, b) => a.fire_at - b.fire_at);
    
    dayScheduled.forEach(item => {
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
  if (dayLogs.length > 0) {
    html += `
      <div class="cal-detail-section" style="margin-top: 1.5rem;">
        <h4 class="cal-detail-section-title">Activity Logs</h4>
    `;
    
    // Sort logs chronologically
    dayLogs.sort((a, b) => a.sent_at - b.sent_at);
    
    dayLogs.forEach(log => {
      const timeStr = new Date(log.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const successBadge = log.success
        ? '<span class="badge badge-success" style="font-size: 0.7rem; padding: 2px 6px;">✓ Sent</span>'
        : `<span class="badge badge-danger" style="font-size: 0.7rem; padding: 2px 6px;" title="${escapeHtml(log.error_msg || '')}">✗ Failed</span>`;
        
      html += `
        <div class="cal-detail-item">
          <div class="cal-dot ${log.success ? 'cal-dot-sent' : 'cal-dot-failed'}"></div>
          <div class="cal-detail-item-info">
            <div class="cal-detail-item-name">${escapeHtml(log.task_name)}</div>
            <div class="cal-detail-item-meta" title="${escapeHtml(log.message)}">${timeStr} to ${escapeHtml(log.target_jid)}: "${escapeHtml(log.message)}"</div>
            ${!log.success && log.error_msg ? `<div style="font-size: 0.75rem; color: var(--danger); margin-top: 2px;">Error: ${escapeHtml(log.error_msg)}</div>` : ''}
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
  
  document.getElementById('settingsSubtitle').innerHTML = `Signed in as <span style="color: var(--text); font-weight: 600;">${escapeHtml(currentUser.username)}</span>`;
  
  const notBound = document.getElementById('waStatusNotBound');
  const bound = document.getElementById('waStatusBound');
  
  if (currentUser.chatId) {
    notBound.style.display = 'none';
    bound.style.display = 'block';
    document.getElementById('settingsBoundChatId').textContent = currentUser.chatId;
    document.getElementById('manualWaNumber').value = currentUser.chatId;
  } else {
    bound.style.display = 'none';
    notBound.style.display = 'block';
    document.getElementById('settingsVerificationCode').textContent = formatVerifCode(currentUser.verificationCode);
    document.getElementById('manualWaNumber').value = '';
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
      waStatus = `<span class="verif-status-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Verified (${escapeHtml(u.chatId)})</span>`;
    } else if (u.verificationCode) {
      waStatus = `<span class="badge badge-warning" style="font-family: monospace;" title="Pending">${formatVerifCode(u.verificationCode)}</span>`;
    } else {
      waStatus = '<span style="color: var(--text-muted);">—</span>';
    }

    const deleteBtn = u.id === currentUser.id ? '' : `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')">Delete</button>`;
      
    tr.innerHTML = `
      <td style="font-weight: 600;">${escapeHtml(u.username)}</td>
      <td>${roleBadge}</td>
      <td>${waStatus}</td>
      <td style="color: var(--text-muted); font-size: 0.85rem;">${new Date(u.createdAt).toLocaleDateString()}</td>
      <td style="display: flex; gap: 0.5rem;">
        <button class="btn btn-secondary btn-sm" onclick="openEditUserDialog(${u.id})">Edit</button>
        ${deleteBtn}
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
  document.getElementById('editUserResetVerification').checked = false;
  
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
