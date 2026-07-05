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
let calSelectTodayOnRender = false;
let currentTaskFilter = 'all';
let taskSearchQuery = '';

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
// PAGE AGENT STATE MANAGEMENT & TOASTS
// ---------------------------------------------------------------
const PAGE_AGENT_CDN = 'https://cdn.jsdelivr.net/npm/page-agent@1.11.0/dist/iife/page-agent.demo.js';
const PAGE_AGENT_SCRIPT_ID = 'pageAgentScript';

function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${type === 'danger' ? 'rgba(239, 68, 68, 0.95)' : type === 'success' ? 'rgba(16, 185, 129, 0.95)' : 'rgba(30, 41, 59, 0.95)'};
    color: white;
    padding: 0.75rem 1.25rem;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    border: 1px solid ${type === 'danger' ? 'rgba(239, 68, 68, 0.2)' : type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.08)'};
    pointer-events: auto;
    animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    transition: opacity 0.3s, transform 0.3s;
    font-family: sans-serif;
  `;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  if (!document.getElementById('toastAnimationStyles')) {
    const style = document.createElement('style');
    style.id = 'toastAnimationStyles';
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%) translateY(0); opacity: 0; }
        to { transform: translateX(0) translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

function updatePageAgentUI() {
  const textEl = document.getElementById('pageAgentStatusText');
  const dotEl = document.getElementById('pageAgentStatusDot');
  const btnEl = document.getElementById('pageAgentToggleBtn');
  const isEnabled = localStorage.getItem('pageAgentEnabled') === 'true';

  if (textEl && dotEl) {
    if (isEnabled) {
      textEl.textContent = 'ON';
      dotEl.style.background = 'var(--success)';
      if (btnEl) {
        btnEl.style.borderColor = 'rgba(16, 185, 129, 0.2)';
        btnEl.style.background = 'rgba(16, 185, 129, 0.08)';
        btnEl.style.color = 'var(--success)';
      }
    } else {
      textEl.textContent = 'OFF';
      dotEl.style.background = '#94a3b8';
      if (btnEl) {
        btnEl.style.borderColor = 'var(--border)';
        btnEl.style.background = 'rgba(255, 255, 255, 0.04)';
        btnEl.style.color = 'var(--text-secondary)';
      }
    }
  }
}

function loadPageAgentScript() {
  // Don't load again if already present
  if (document.getElementById(PAGE_AGENT_SCRIPT_ID)) return;

  const script = document.createElement('script');
  script.id = PAGE_AGENT_SCRIPT_ID;
  script.src = PAGE_AGENT_CDN;
  script.crossOrigin = 'true';
  script.onload = () => {
    showToast('Page Agent loaded', 'success');
  };
  script.onerror = () => {
    showToast('Failed to load Page Agent script. Check your network.', 'danger');
    localStorage.setItem('pageAgentEnabled', 'false');
    updatePageAgentUI();
  };
  document.body.appendChild(script);
}

function unloadPageAgent() {
  // Remove the injected script tag
  const script = document.getElementById(PAGE_AGENT_SCRIPT_ID);
  if (script) script.remove();

  // Remove all DOM elements injected by PageAgent (they use very high z-index)
  // PageAgent injects elements with specific class prefixes into the body
  document.querySelectorAll('[class*="_wrapper_1ooyb"], [class*="_wrapper_1tu05"], [class*="_cursor_1dgwb"]').forEach(el => el.remove());

  // Also remove the style tag it injects
  document.querySelectorAll('style').forEach(style => {
    if (style.textContent && style.textContent.includes('_wrapper_1ooyb')) {
      style.remove();
    }
  });
}

function initPageAgent() {
  const isEnabled = localStorage.getItem('pageAgentEnabled') === 'true';
  if (isEnabled) {
    loadPageAgentScript();
    startBridgePolling();
  } else {
    unloadPageAgent();
    stopBridgePolling();
  }
  updatePageAgentUI();
}

function togglePageAgent() {
  const isEnabled = localStorage.getItem('pageAgentEnabled') === 'true';
  localStorage.setItem('pageAgentEnabled', (!isEnabled).toString());
  initPageAgent();
}

// ---------------------------------------------------------------
// ANTIGRAVITY ↔ PAGE AGENT BRIDGE
// ---------------------------------------------------------------
let bridgePollingInterval = null;
let bridgeBusy = false;

function startBridgePolling() {
  if (bridgePollingInterval) return;
  console.log('[Bridge] Polling started');
  bridgePollingInterval = setInterval(pollForBridgeTask, 2500);
}

function stopBridgePolling() {
  if (bridgePollingInterval) {
    clearInterval(bridgePollingInterval);
    bridgePollingInterval = null;
    console.log('[Bridge] Polling stopped');
  }
}

async function pollForBridgeTask() {
  if (bridgeBusy) return;
  try {
    const res = await fetch('/api/page-agent/pending');
    const data = await res.json();
    if (!data) return;

    bridgeBusy = true;
    console.log(`[Bridge] Received task: ${data.taskId} — "${data.task}"`);

    if (data.task === '__screenshot_only__') {
      // Screenshot-only request
      await handleScreenshotOnly(data.taskId);
    } else {
      await handleBridgeTask(data.taskId, data.task, data.includeScreenshot);
    }
  } catch (err) {
    console.error('[Bridge] Poll error:', err);
  } finally {
    bridgeBusy = false;
  }
}

async function handleScreenshotOnly(taskId) {
  try {
    const screenshot = await captureScreenshot();
    await reportBridgeResult(taskId, 'Screenshot captured', screenshot);
    showToast('Screenshot captured for Antigravity', 'success');
  } catch (err) {
    console.error('[Bridge] Screenshot error:', err);
    await reportBridgeResult(taskId, `Screenshot error: ${err.message}`, null);
  }
}

async function handleBridgeTask(taskId, task, includeScreenshot) {
  try {
    // Step 1: Find PageAgent's input field and submit the task
    const submitted = submitTaskToPageAgent(task);
    if (!submitted) {
      await reportBridgeResult(taskId, 'Error: Could not find PageAgent input field. Is PageAgent loaded?', null);
      showToast('Bridge: PageAgent input not found', 'danger');
      return;
    }

    showToast(`Bridge: Running "${task.substring(0, 50)}..."`, 'info');

    // Step 2: Wait for PageAgent to complete (watch status indicator)
    const completed = await waitForPageAgentCompletion(120000); // 2 min timeout

    // Step 3: Read result from history panel
    const result = readPageAgentResult();

    // Step 4: Capture screenshot if requested
    let screenshot = null;
    if (includeScreenshot) {
      // Small delay to let final UI settle
      await new Promise(r => setTimeout(r, 1000));
      screenshot = await captureScreenshot();
    }

    // Step 5: Report back
    await reportBridgeResult(taskId, result, screenshot);

    showToast(`Bridge: Task completed`, 'success');
    console.log(`[Bridge] Task ${taskId} completed. Result: ${result.substring(0, 100)}`);

  } catch (err) {
    console.error('[Bridge] Task error:', err);
    await reportBridgeResult(taskId, `Error: ${err.message}`, null);
    showToast(`Bridge error: ${err.message}`, 'danger');
  }
}

function submitTaskToPageAgent(task) {
  // Find PageAgent's input field by its CSS class pattern
  const input = document.querySelector('[class*="_taskInput_"]');
  if (!input) return false;

  // Set the value
  input.value = task;
  // Dispatch input event so PageAgent's internal state updates
  input.dispatchEvent(new Event('input', { bubbles: true }));

  // Simulate Enter key press to submit
  setTimeout(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
    }));
  }, 100);

  return true;
}

function waitForPageAgentCompletion(timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let wasRunning = false;

    const check = () => {
      if (Date.now() - startTime > timeoutMs) {
        resolve(false);
        return;
      }

      const indicator = document.querySelector('[class*="_indicator_"]');
      const statusText = document.querySelector('[class*="_statusText_"]');

      // Check if agent is currently running (thinking/executing)
      if (indicator) {
        const classes = indicator.className || '';
        if (classes.includes('_thinking_') || classes.includes('_tool_executing_')) {
          wasRunning = true;
        }
        // Check if it completed (was running, now shows completed/error/idle)
        if (wasRunning && (classes.includes('_completed_') || classes.includes('_error_') ||
            classes.includes('_input_') || classes.includes('_output_'))) {
          // Give a brief moment for history to update
          setTimeout(() => resolve(true), 500);
          return;
        }
      }

      // Also check status text for completion indicators
      if (statusText && wasRunning) {
        const text = (statusText.textContent || '').toLowerCase();
        if (text.includes('done') || text.includes('complete') || text.includes('finished') || text.includes('failed')) {
          setTimeout(() => resolve(true), 500);
          return;
        }
      }

      setTimeout(check, 1000);
    };

    // Small initial delay to let PageAgent start processing
    setTimeout(check, 2000);
  });
}

function readPageAgentResult() {
  // Read the last few history items from PageAgent's history panel
  const historyItems = document.querySelectorAll('[class*="_historyItem_"]');
  if (!historyItems || historyItems.length === 0) {
    return 'No history items found. PageAgent may not have produced output.';
  }

  // Collect the last few items as the result
  const results = [];
  const items = Array.from(historyItems).slice(-5); // Last 5 items
  for (const item of items) {
    const content = item.querySelector('[class*="_historyContent_"]');
    if (content) {
      results.push(content.textContent.trim());
    }
  }

  return results.join('\n---\n') || 'Could not read PageAgent output.';
}

async function captureScreenshot() {
  if (typeof html2canvas === 'undefined') {
    throw new Error('html2canvas not loaded');
  }

  // Hide PageAgent overlay for clean screenshot
  const overlays = document.querySelectorAll('[class*="_wrapper_1ooyb"], [class*="_wrapper_1tu05"]');
  overlays.forEach(el => { el.style.display = 'none'; });

  try {
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      scale: 1,
      logging: false,
      ignoreElements: (el) => {
        // Ignore PageAgent elements and toast container
        const cls = el.className || '';
        if (typeof cls === 'string') {
          return cls.includes('_wrapper_1ooyb') || cls.includes('_wrapper_1tu05') ||
                 cls.includes('_cursor_1dgwb') || el.id === 'toastContainer';
        }
        return false;
      }
    });
    return canvas.toDataURL('image/png');
  } finally {
    // Restore PageAgent overlay
    overlays.forEach(el => { el.style.display = ''; });
  }
}

async function reportBridgeResult(taskId, result, screenshot) {
  try {
    await fetch('/api/page-agent/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, result, screenshot })
    });
  } catch (err) {
    console.error('[Bridge] Failed to report result:', err);
  }
}

// ---------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupEventListeners();
  setupDialogLightDismiss();
  initPageAgent();
  
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
  } else if (tabId === 'instructions') {
    loadInstructions();
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

  // Task filter tabs change listener
  document.querySelectorAll('#taskTypeFilterTabs .filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#taskTypeFilterTabs .filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTaskFilter = tab.getAttribute('data-value');
      applyTaskFilterAndRender();
    });
  });

  // Task search query listener
  const searchInput = document.getElementById('taskSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      taskSearchQuery = e.target.value.toLowerCase().trim();
      applyTaskFilterAndRender();
    });
  }

  // Task form
  document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);
  document.getElementById('createNewTaskBtn').addEventListener('click', () => openTaskDialog());


  // Manual WhatsApp binding
  const manualWaInput = document.getElementById('manualWaNumber');
  const editWaBtn = document.getElementById('editWaBtn');
  const saveWaBtn = document.getElementById('saveWaBtn');
  const cancelWaBtn = document.getElementById('cancelWaBtn');

  if (editWaBtn) {
    editWaBtn.addEventListener('click', () => {
      manualWaInput.disabled = false;
      manualWaInput.focus();
      editWaBtn.style.display = 'none';
      saveWaBtn.style.display = 'inline-block';
      cancelWaBtn.style.display = 'inline-block';
    });
  }

  if (cancelWaBtn) {
    cancelWaBtn.addEventListener('click', () => {
      manualWaInput.disabled = true;
      manualWaInput.value = currentUser.chatId || '';
      editWaBtn.style.display = 'inline-block';
      saveWaBtn.style.display = 'none';
      cancelWaBtn.style.display = 'none';
    });
  }

  document.getElementById('manualWaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const number = manualWaInput.value.trim();
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
    calSelectTodayOnRender = true;
    refreshCalendar();
  });

  // Calendar Toggles: daily, weekly, monthly, yearly
  ['daily', 'weekly', 'monthly', 'yearly'].forEach(type => {
    const capType = type.charAt(0).toUpperCase() + type.slice(1);
    const toggleBtn = document.getElementById(`calToggle${capType}Btn`);
    if (toggleBtn) {
      const initialHide = localStorage.getItem(`cal_hide_${type}`) === 'true';
      updateToggleBtnState(type, initialHide);

      toggleBtn.addEventListener('click', () => {
        const currentHide = localStorage.getItem(`cal_hide_${type}`) === 'true';
        const newHide = !currentHide;
        localStorage.setItem(`cal_hide_${type}`, newHide);
        updateToggleBtnState(type, newHide);
        if (calendarData) {
          renderCalendar(calendarData);
        }
      });
    }
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

  // Copy AI Prompt template event listener
  const copyBtn = document.getElementById('copyPromptBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const promptEl = document.getElementById('aiPromptTemplate');
      if (promptEl) {
        promptEl.select();
        promptEl.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(promptEl.value);
        
        const spanEl = copyBtn.querySelector('span');
        const origText = spanEl.textContent;
        spanEl.textContent = 'Copied!';
        copyBtn.style.borderColor = '#10b981';
        copyBtn.style.color = '#10b981';
        setTimeout(() => {
          spanEl.textContent = origText;
          copyBtn.style.borderColor = '';
          copyBtn.style.color = '';
        }, 2000);
      }
    });
  }

  // Page Agent toggle listener
  const pageAgentBtn = document.getElementById('pageAgentToggleBtn');
  if (pageAgentBtn) {
    pageAgentBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePageAgent();
    });
  }
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
    
    applyTaskFilterAndRender();
  } catch (err) {
    console.error('Error refreshing tasks:', err);
    toggleConnectionBanner(true);
  }
}

function applyTaskFilterAndRender() {
  const filterVal = currentTaskFilter;
  let filtered = cachedTasks;
  if (filterVal !== 'all') {
    if (filterVal === 'OneTime') {
      filtered = cachedTasks.filter(t => t.task_type === 'OneTime');
    } else if (filterVal === 'daily') {
      filtered = cachedTasks.filter(t => isDailySchedule(t));
    } else if (filterVal === 'weekly') {
      filtered = cachedTasks.filter(t => isWeeklySchedule(t));
    } else if (filterVal === 'monthly') {
      filtered = cachedTasks.filter(t => isMonthlySchedule(t));
    } else if (filterVal === 'yearly') {
      filtered = cachedTasks.filter(t => isYearlySchedule(t));
    }
  }
  
  if (taskSearchQuery) {
    filtered = filtered.filter(t => {
      const nameMatch = t.name && t.name.toLowerCase().includes(taskSearchQuery);
      const msgMatch = t.message_template && t.message_template.toLowerCase().includes(taskSearchQuery);
      const targetMatch = t.target_wa_chat_id && t.target_wa_chat_id.toLowerCase().includes(taskSearchQuery);
      const ownerMatch = t.owner_username && t.owner_username.toLowerCase().includes(taskSearchQuery);
      return nameMatch || msgMatch || targetMatch || ownerMatch;
    });
  }
  
  const summaryText = document.getElementById('taskSummaryText');
  if (summaryText) {
    if (cachedTasks.length === 0) {
      summaryText.textContent = 'No scheduled tasks';
    } else {
      const typeLabel = filterVal === 'all' ? '' : ` (${filterVal})`;
      const searchLabel = taskSearchQuery ? ` matching "${taskSearchQuery}"` : '';
      summaryText.textContent = `${filtered.length} of ${cachedTasks.length} task${cachedTasks.length === 1 ? '' : 's'} shown${typeLabel}${searchLabel}`;
    }
  }
  
  renderTasksList(filtered);
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
      const hasAnyTasks = cachedTasks.length > 0;
      emptyState.innerHTML = hasAnyTasks ? `
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <h4 class="empty-title">No matching tasks</h4>
          <p class="empty-desc">Try changing the task type filter to view other tasks.</p>
        </div>
      ` : `
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
    <th style="width: 22%;">Task Details</th>
    <th style="width: 35%;">Message</th>
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
          ${task.task_type === 'OneTime'
            ? (task.last_run_at
              ? `<div>Sent: ${new Date(task.last_run_at).toLocaleString()}</div>`
              : `<div>Scheduled for ${task.next_run_at ? new Date(task.next_run_at).toLocaleString() : '—'}</div>`)
            : `<div>Last: ${lastRun}</div><div>Next: ${nextRun}</div>`
          }
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

window.toggleLogDetail = function(btn, logId) {
  const container = document.getElementById(`log-detail-${logId}`);
  if (container) {
    const isHidden = container.style.display === 'none';
    container.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? 'Hide Details' : 'View Details';
    // Style toggle
    if (isHidden) {
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-secondary');
    } else {
      btn.classList.add('btn-secondary');
      btn.classList.remove('btn-primary');
    }
  }
};

function renderLogsList(logs) {
  const tbody = document.getElementById('logsTableBody');
  tbody.innerHTML = '';

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 3rem;">No logs yet.</td></tr>`;
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
    let errorDetailHtml = '';
    if (!log.success && log.error_msg) {
      errorDetailHtml = `<div style="font-size: 0.75rem; color: var(--danger); margin-top: 4px; word-break: break-all;">✗ ${escapeHtml(log.error_msg)}</div>`;
    }

    let apiColumnHtml = '<span style="color: var(--text-muted); font-size: 0.85rem;">—</span>';
    if (log.api_response) {
      let parsedRes = null;
      try { parsedRes = JSON.parse(log.api_response); } catch (e) {}
      if (parsedRes) {
        const prettyJson = JSON.stringify(parsedRes, null, 2);
        const logId = log.id || Math.random().toString(36).substring(2, 9);
        apiColumnHtml = `
          <button class="btn btn-secondary btn-sm" onclick="toggleLogDetail(this, '${logId}')">View Details</button>
          <div id="log-detail-${logId}" style="display: none; margin-top: 0.5rem; text-align: left;">
            <pre style="white-space: pre-wrap; word-break: break-all; font-family: monospace; font-size: 0.7rem; background: rgba(0, 0, 0, 0.25); padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border); max-width: 250px; max-height: 180px; overflow-y: auto; color: var(--text-muted);">${escapeHtml(prettyJson)}</pre>
          </div>
        `;
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
        ${errorDetailHtml}
      </td>
      <td>
        ${apiColumnHtml}
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
  const grid = document.getElementById('calendarGrid');
  const prevBtn = document.getElementById('calPrevBtn');
  const nextBtn = document.getElementById('calNextBtn');
  const todayBtn = document.getElementById('calTodayBtn');

  // Show loading state
  if (grid) grid.style.opacity = '0.5';
  if (prevBtn) prevBtn.disabled = true;
  if (nextBtn) nextBtn.disabled = true;
  if (todayBtn) todayBtn.disabled = true;

  try {
    const res = await fetch(`/api/calendar?year=${calCurrentYear}&month=${calCurrentMonth}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) return;
    calendarData = await res.json();
    renderCalendar(calendarData);
  } catch (e) {
    console.error('Error refreshing calendar:', e);
  } finally {
    // Hide loading state
    if (grid) grid.style.opacity = '1';
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) nextBtn.disabled = false;
    if (todayBtn) todayBtn.disabled = false;
  }
}

function getScheduleInfo(item) {
  const spec = item.scheduleSpec || item.schedule_spec || {};
  const interval_secs = item.interval_secs || spec.interval_secs;
  const expression = item.expression || spec.expression;
  return { interval_secs, expression };
}

function isDailySchedule(item) {
  if (item.task_type === 'Interval') {
    const { interval_secs } = getScheduleInfo(item);
    return interval_secs && interval_secs <= 86400;
  }
  if (item.task_type === 'Cron') {
    const { expression } = getScheduleInfo(item);
    if (expression) {
      const parts = expression.trim().split(/\s+/);
      if (parts.length >= 5) {
        const dom = parts[2];
        const dow = parts[4];
        return dom === '*' && (dow === '*' || dow === '?');
      }
    }
  }
  return false;
}

function isWeeklySchedule(item) {
  if (item.task_type === 'Interval') {
    const { interval_secs } = getScheduleInfo(item);
    return interval_secs && interval_secs > 86400 && interval_secs <= 604800;
  }
  if (item.task_type === 'Cron') {
    const { expression } = getScheduleInfo(item);
    if (expression) {
      const parts = expression.trim().split(/\s+/);
      if (parts.length >= 5) {
        const dom = parts[2];
        const dow = parts[4];
        return dom === '*' && dow !== '*' && dow !== '?';
      }
    }
  }
  return false;
}

function isMonthlySchedule(item) {
  if (item.task_type === 'Interval') {
    const { interval_secs } = getScheduleInfo(item);
    return interval_secs && interval_secs > 604800 && interval_secs <= 2678400;
  }
  if (item.task_type === 'Cron') {
    const { expression } = getScheduleInfo(item);
    if (expression) {
      const parts = expression.trim().split(/\s+/);
      if (parts.length >= 5) {
        const dom = parts[2];
        const month = parts[3];
        return dom !== '*' && dom !== '?' && month === '*';
      }
    }
  }
  return false;
}

function isYearlySchedule(item) {
  if (item.task_type === 'Interval') {
    const { interval_secs } = getScheduleInfo(item);
    return interval_secs && interval_secs > 2678400;
  }
  if (item.task_type === 'Cron') {
    const { expression } = getScheduleInfo(item);
    if (expression) {
      const parts = expression.trim().split(/\s+/);
      if (parts.length >= 5) {
        const dom = parts[2];
        const month = parts[3];
        return dom !== '*' && dom !== '?' && month !== '*';
      }
    }
  }
  return false;
}

function shouldShowItem(item, hideDaily, hideWeekly, hideMonthly, hideYearly) {
  if (isDailySchedule(item)) return !hideDaily;
  if (isWeeklySchedule(item)) return !hideWeekly;
  if (isMonthlySchedule(item)) return !hideMonthly;
  if (isYearlySchedule(item)) return !hideYearly;
  return true;
}

function updateToggleBtnState(type, hide) {
  const capType = type.charAt(0).toUpperCase() + type.slice(1);
  const btn = document.getElementById(`calToggle${capType}Btn`);
  const text = document.getElementById(`calToggle${capType}Text`);
  const icon = document.getElementById(`calToggle${capType}Icon`);
  if (!btn || !text || !icon) return;

  if (hide) {
    btn.classList.add('btn-toggle-active');
    text.textContent = `Show ${type}`;
    icon.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `;
  } else {
    btn.classList.remove('btn-toggle-active');
    text.textContent = `Hide ${type}`;
    icon.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    `;
  }
}

function updateToggleDailyBtnState(hideDaily) {
  updateToggleBtnState('daily', hideDaily);
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
  const hideWeekly = localStorage.getItem('cal_hide_weekly') === 'true';
  const hideMonthly = localStorage.getItem('cal_hide_monthly') === 'true';
  const hideYearly = localStorage.getItem('cal_hide_yearly') === 'true';

  // Render current month days
  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (isCurrentMonth && day === todayDay) {
      cell.classList.add('cal-day-today');
      if (calSelectTodayOnRender) {
        cell.classList.add('cal-day-selected');
        showDayDetail(day, data);
      }
    }
    
    // Check if we have logs or scheduled tasks for this day
    const dayLogs = (data.logs && data.logs[day]) || [];
    const dayScheduled = (data.scheduled && data.scheduled[day]) || [];
    
    const dayLogsFiltered = dayLogs.filter(l => shouldShowItem(l, hideDaily, hideWeekly, hideMonthly, hideYearly));
    const dayScheduledFiltered = dayScheduled.filter(s => shouldShowItem(s, hideDaily, hideWeekly, hideMonthly, hideYearly));
    
    let dotsHtml = '';
    let labelsHtml = '';
    
    let dots = [];
    
    // 1. Process each scheduled task on this day
    const processedTaskNames = new Set();
    dayScheduledFiltered.forEach(item => {
      processedTaskNames.add(item.name);
      
      // Find logs for this task on this day
      const taskLogs = dayLogsFiltered.filter(l => l.task_name === item.name);
      if (taskLogs.length > 0) {
        const hasSuccess = taskLogs.some(l => l.success);
        if (hasSuccess) {
          dots.push(`<div class="cal-dot cal-dot-sent-encapsulated" title="${escapeHtml(item.name)}: sent success"></div>`);
        } else {
          dots.push(`<div class="cal-dot cal-dot-failed-encapsulated" title="${escapeHtml(item.name)}: sent failed"></div>`);
        }
      } else {
        dots.push(`<div class="cal-dot cal-dot-scheduled" title="${escapeHtml(item.name)}: scheduled"></div>`);
      }
    });
    
    // 2. Process any remaining logs that don't match any scheduled task
    dayLogsFiltered.forEach(log => {
      if (!processedTaskNames.has(log.task_name)) {
        if (log.success) {
          dots.push(`<div class="cal-dot cal-dot-sent" title="${escapeHtml(log.task_name)}: sent success"></div>`);
        } else {
          dots.push(`<div class="cal-dot cal-dot-failed" title="${escapeHtml(log.task_name)}: sent failed"></div>`);
        }
        processedTaskNames.add(log.task_name);
      }
    });
    
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
  
  calSelectTodayOnRender = false;
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
  const hideWeekly = localStorage.getItem('cal_hide_weekly') === 'true';
  const hideMonthly = localStorage.getItem('cal_hide_monthly') === 'true';
  const hideYearly = localStorage.getItem('cal_hide_yearly') === 'true';
  
  const dayLogsFiltered = dayLogs.filter(l => shouldShowItem(l, hideDaily, hideWeekly, hideMonthly, hideYearly));
  const dayScheduledFiltered = dayScheduled.filter(s => shouldShowItem(s, hideDaily, hideWeekly, hideMonthly, hideYearly));
  
  if (dayLogsFiltered.length === 0 && dayScheduledFiltered.length === 0) {
    const hiddenList = [];
    if (hideDaily) hiddenList.push('daily');
    if (hideWeekly) hiddenList.push('weekly');
    if (hideMonthly) hiddenList.push('monthly');
    if (hideYearly) hiddenList.push('yearly');
    const hiddenStr = hiddenList.length > 0 ? ` (${hiddenList.join(', ')} schedules hidden)` : '';
    content.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1.5rem 0;">No logs or scheduled tasks for this day${hiddenStr}.</p>`;
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

  // Revert UI to non-edit mode
  if (manualWaNumberEl) manualWaNumberEl.disabled = true;
  const editWaBtn = document.getElementById('editWaBtn');
  const saveWaBtn = document.getElementById('saveWaBtn');
  const cancelWaBtn = document.getElementById('cancelWaBtn');
  if (editWaBtn) editWaBtn.style.display = 'inline-block';
  if (saveWaBtn) saveWaBtn.style.display = 'none';
  if (cancelWaBtn) cancelWaBtn.style.display = 'none';
}

async function loadInstructions() {
  await fetchCurrentUser();
  
  const promptEl = document.getElementById('aiPromptTemplate');
  if (promptEl) {
    const defaultNumber = currentUser && currentUser.chatId ? currentUser.chatId : 'Not Configured';
    const token = apiToken || 'Not Configured';
    const apiUrl = window.location.origin + '/api/tasks';
    
    let rawTemplate = promptEl.getAttribute('data-raw-template');
    if (!rawTemplate) {
      rawTemplate = promptEl.value;
      promptEl.setAttribute('data-raw-template', rawTemplate);
    }
    
    let promptVal = rawTemplate;
    promptVal = promptVal.split('[DEFAULT_NUMBER]').join(defaultNumber);
    promptVal = promptVal.split('[API_TOKEN]').join(token);
    promptVal = promptVal.split('[API_URL]').join(apiUrl);
    
    promptEl.value = promptVal;
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
