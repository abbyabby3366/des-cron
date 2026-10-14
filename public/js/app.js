// Front-end Application logic for CronWA

let currentUser = null;
try {
  const cachedUser = localStorage.getItem('cronwa_user');
  if (cachedUser) currentUser = JSON.parse(cachedUser);
} catch (e) {}
let apiToken = localStorage.getItem('cronwa_token') || null;
let cachedUsers = [];
let cachedTasks = [];
let cachedLogs = [];
let cachedEvents = [];
let cachedContacts = [];
let loaderTimeout = null;
let autoRefreshInterval = null;
let schedulePreviewTimer = null;
let confirmDialogCallback = null;
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth() + 1;
let calendarData = null;
let calSelectTodayOnRender = false;
let currentTaskFilter = 'all';
let currentTaskStatusFilter = 'upcoming';
let currentEventFilter = 'upcoming';
let currentLogFilter = 'all';
let taskSearchQuery = '';
let eventSearchQuery = '';
let logSearchQuery = '';
let contactSearchQuery = '';

// ---------------------------------------------------------------
// GMT+8 (Asia/Kuala_Lumpur) & DD-MM-YY DATE/TIME STANDARDS
// ---------------------------------------------------------------
function getGMT8Parts(timestamp) {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const yyyy = map.year;
  const yy = String(yyyy).slice(-2);
  const mm = map.month;
  const dd = map.day;
  const hh = map.hour === '24' ? '00' : map.hour;
  const min = map.minute;
  const sec = map.second;
  return {
    dd,
    mm,
    yy,
    yyyy,
    hh,
    min,
    sec,
    dateStr: `${dd}-${mm}-${yy}`,
    timeStr: `${hh}:${min}`,
    timeWithSecStr: `${hh}:${min}:${sec}`,
    dateTimeStr: `${dd}-${mm}-${yy} ${hh}:${min}`
  };
}

function formatDateGMT8(timestamp) {
  if (!timestamp) return '—';
  const p = getGMT8Parts(timestamp);
  return p ? p.dateStr : '—';
}

function formatTimeGMT8(timestamp, includeSeconds = false) {
  if (!timestamp) return '—';
  const p = getGMT8Parts(timestamp);
  if (!p) return '—';
  return includeSeconds ? `${p.timeWithSecStr} GMT+8` : `${p.timeStr} GMT+8`;
}

function formatDateTimeGMT8(timestamp) {
  if (!timestamp) return '—';
  const p = getGMT8Parts(timestamp);
  return p ? `${p.dateTimeStr} GMT+8` : '—';
}

/**
 * Renders date and time on two separate stacked rows inside table cells (<td>),
 * with the secondary component smaller and muted.
 */
function renderStackedDateTime(timestamp, primaryIsDate = true, labelPrefix = '') {
  if (!timestamp) {
    return `<div class="td-datetime-stack"><span class="td-dt-secondary">${labelPrefix ? `${escapeHtml(labelPrefix)}: —` : '—'}</span></div>`;
  }
  const p = getGMT8Parts(timestamp);
  if (!p) {
    return `<div class="td-datetime-stack"><span class="td-dt-secondary">—</span></div>`;
  }
  const prefixHtml = labelPrefix ? `<span style="opacity:0.75;font-weight:500;">${escapeHtml(labelPrefix)}:</span> ` : '';
  if (primaryIsDate) {
    return `
      <div class="td-datetime-stack">
        <span class="td-dt-primary">${prefixHtml}${p.dateStr}</span>
        <span class="td-dt-secondary">${p.timeStr} GMT+8</span>
      </div>
    `;
  }
  return `
    <div class="td-datetime-stack">
      <span class="td-dt-primary">${prefixHtml}${p.timeStr} GMT+8</span>
      <span class="td-dt-secondary">${p.dateStr}</span>
    </div>
  `;
}

/**
 * Converts an epoch/ISO timestamp into YYYY-MM-DDTHH:mm in GMT+8 for <input type="datetime-local">
 */
function toLocalDatetimeInputGMT8(timestamp) {
  const p = getGMT8Parts(timestamp);
  if (!p) return '';
  return `${p.yyyy}-${p.mm}-${p.dd}T${p.hh}:${p.min}`;
}

/**
 * Parses a <input type="datetime-local"> value explicitly as GMT+8 (+08:00) into an ISO string
 */
function parseLocalDatetimeInputGMT8(val) {
  if (!val) return null;
  const normalized = val.length === 16 ? `${val}:00+08:00` : `${val}+08:00`;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? new Date(val).toISOString() : d.toISOString();
}

// ---------------------------------------------------------------
// REUSABLE CONFIRMATION DIALOG (Deletions & Sign Out)
// ---------------------------------------------------------------
function openConfirmDialog({ title, message, confirmText = 'Confirm', danger = true, onConfirm }) {
  const dialog = document.getElementById('confirmDialog');
  const titleEl = document.getElementById('confirmDialogTitle');
  const msgEl = document.getElementById('confirmDialogMessage');
  const confirmBtn = document.getElementById('confirmDialogConfirmBtn');
  if (!dialog || !titleEl || !msgEl || !confirmBtn) return;

  titleEl.textContent = title;
  msgEl.textContent = message;
  confirmBtn.textContent = confirmText;
  confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  confirmDialogCallback = onConfirm;
  dialog.showModal();
}

window.closeConfirmDialog = function() {
  const dialog = document.getElementById('confirmDialog');
  if (dialog && dialog.open) dialog.close();
  confirmDialogCallback = null;
};

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
  
  // Pre-load data for other tabs silently in the background
  preloadAllTabsData();
}

function preloadAllTabsData() {
  if (!apiToken) return;
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  
  if (hash !== 'dashboard') {
    refreshTasks(true);
  }
  if (hash !== 'calendar') {
    refreshCalendar(true);
  }
  if (hash !== 'logs') {
    refreshLogs(true);
  }
  if (hash !== 'events') {
    refreshEvents(true);
  }
  if (hash !== 'contacts') {
    refreshContacts(true);
  }
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
  } else if (tabId === 'events') {
    refreshEvents();
  } else if (tabId === 'calendar') {
    refreshCalendar();
  } else if (tabId === 'contacts') {
    refreshContacts();
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
  
  document.getElementById('logoutBtn').addEventListener('click', promptLogout);
}

function promptLogout() {
  openConfirmDialog({
    title: 'Sign out of CronWA',
    message: `Are you sure you want to sign out from "${currentUser ? currentUser.username : 'your account'}"?`,
    confirmText: 'Sign out',
    danger: true,
    onConfirm: async () => {
      await logout();
    }
  });
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
    } else if (tab === 'events') {
      refreshEvents(true);
    } else if (tab === 'logs') {
      refreshLogs(true);
    } else if (tab === 'calendar') {
      refreshCalendar(true);
    } else if (tab === 'contacts') {
      refreshContacts(true);
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
  // Confirmation Dialog button
  const confirmBtn = document.getElementById('confirmDialogConfirmBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      const cb = confirmDialogCallback;
      closeConfirmDialog();
      if (typeof cb === 'function') {
        await cb();
      }
    });
  }

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

  // Task type selector & live schedule preview triggers
  document.getElementById('taskType').addEventListener('change', (e) => {
    document.querySelectorAll('.schedule-field').forEach(f => f.style.display = 'none');
    const map = { OneTime: 'oneTimeFields', Interval: 'intervalFields', Cron: 'cronFields' };
    const el = document.getElementById(map[e.target.value]);
    if (el) el.style.display = 'block';
    schedulePreviewUpdate();
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
    schedulePreviewUpdate();
  });

  ['runAt', 'intervalSecs', 'cronExpr'].forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) {
      el.addEventListener('input', () => schedulePreviewUpdate());
    }
  });

  // Task filter dropdown change listener
  const taskFilterDropdown = document.getElementById('taskTypeFilterDropdown');
  if (taskFilterDropdown) {
    taskFilterDropdown.addEventListener('change', (e) => {
      currentTaskFilter = e.target.value;
      applyTaskFilterAndRender();
    });
  }

  // Event filter tabs change listener
  document.querySelectorAll('#eventTypeFilterTabs .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#eventTypeFilterTabs .filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentEventFilter = tab.getAttribute('data-value');
      applyEventFilterAndRender();
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

  // Task status filter tabs change listener
  document.querySelectorAll('#taskStatusFilterTabs .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#taskStatusFilterTabs .filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTaskStatusFilter = tab.getAttribute('data-value');
      applyTaskFilterAndRender();
    });
  });

  // Event search query listener
  const eventSearchInput = document.getElementById('eventSearchInput');
  if (eventSearchInput) {
    eventSearchInput.addEventListener('input', (e) => {
      eventSearchQuery = e.target.value.toLowerCase().trim();
      applyEventFilterAndRender();
    });
  }

  // Log search query & status filter tabs listeners
  const logSearchInput = document.getElementById('logSearchInput');
  if (logSearchInput) {
    logSearchInput.addEventListener('input', (e) => {
      logSearchQuery = e.target.value.toLowerCase().trim();
      applyLogFilterAndRender();
    });
  }

  document.querySelectorAll('#logStatusFilterTabs .filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#logStatusFilterTabs .filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentLogFilter = tab.getAttribute('data-value');
      applyLogFilterAndRender();
    });
  });

  // Contact search & form listeners
  const contactSearchInput = document.getElementById('contactSearchInput');
  if (contactSearchInput) {
    contactSearchInput.addEventListener('input', (e) => {
      contactSearchQuery = e.target.value.toLowerCase().trim();
      applyContactFilterAndRender();
    });
  }

  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', handleContactFormSubmit);
  }

  // Event form
  const eventForm = document.getElementById('eventForm');
  if (eventForm) {
    eventForm.addEventListener('submit', handleEventFormSubmit);
  }

  // Auto-check custom checkbox on value input
  const customValueInput = document.getElementById('eventReminderCustomValue');
  if (customValueInput) {
    customValueInput.addEventListener('input', () => {
      const customCb = document.getElementById('eventReminderCustomCheckbox');
      if (customCb && customValueInput.value) {
        customCb.checked = true;
      }
    });
  }

  // Create new event button
  const createEventBtn = document.getElementById('createNewEventBtn');
  if (createEventBtn) {
    createEventBtn.addEventListener('click', () => openEventDialog());
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
        showAlert(alert, 'success', 'WhatsApp number updated and synced to your tasks!');
        currentUser.chatId = number;
        currentUser.verificationCode = null;
        localStorage.setItem('cronwa_user', JSON.stringify(currentUser));
        loadSettings();
        refreshTasks();
      } else {
        showAlert(alert, 'danger', data.error || 'Failed to update WhatsApp number');
      }
    } catch (err) {
      showAlert(alert, 'danger', 'Network error while updating WhatsApp number.');
    }
  });

  // Generate WhatsApp Verification Code button
  const genVerifBtn = document.getElementById('generateVerifCodeBtn');
  if (genVerifBtn) {
    genVerifBtn.addEventListener('click', async () => {
      const alert = document.getElementById('settingsAlertContainer');
      alert.innerHTML = '';
      genVerifBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/verification-code', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        const data = await res.json();
        if (res.ok && data.verificationCode) {
          currentUser.verificationCode = data.verificationCode;
          localStorage.setItem('cronwa_user', JSON.stringify(currentUser));
          const displayBox = document.getElementById('waVerifCodeDisplay');
          const codeEl = document.getElementById('settingsVerifCode');
          if (displayBox && codeEl) {
            codeEl.textContent = formatVerifCode(data.verificationCode);
            displayBox.style.display = 'block';
          }
          showToast('Verification code generated', 'success');
        } else {
          showAlert(alert, 'danger', data.error || 'Failed to generate verification code.');
        }
      } catch (err) {
        showAlert(alert, 'danger', 'Network error while generating verification code.');
      } finally {
        genVerifBtn.disabled = false;
      }
    });
  }

  // Change Password Form
  const changePasswordForm = document.getElementById('changePasswordForm');
  if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPass = document.getElementById('currentPasswordInput').value;
      const newPass = document.getElementById('newPasswordInput').value;
      const alert = document.getElementById('settingsAlertContainer');
      const btn = document.getElementById('changePasswordBtn');
      alert.innerHTML = '';

      if (!newPass || newPass.length < 6) {
        showAlert(alert, 'danger', 'New password must be at least 6 characters.');
        return;
      }

      btn.disabled = true;
      try {
        const currentPasswordHash = await sha256Hex(currentPass);
        const newPasswordHash = await sha256Hex(newPass);
        const res = await fetch('/api/auth/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
          body: JSON.stringify({ currentPasswordHash, newPasswordHash })
        });
        const data = await res.json();
        if (res.ok) {
          changePasswordForm.reset();
          showAlert(alert, 'success', 'Password updated! Please sign in again with your new password.');
          showToast('Password updated. Signing out…', 'success');
          setTimeout(() => logout(), 1500);
        } else {
          showAlert(alert, 'danger', data.error || 'Failed to update password.');
        }
      } catch (err) {
        showAlert(alert, 'danger', 'Network error while updating password.');
      } finally {
        btn.disabled = false;
      }
    });
  }

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
    const isAlreadyCurrentMonth = calCurrentYear === today.getFullYear() && calCurrentMonth === (today.getMonth() + 1);
    
    if (isAlreadyCurrentMonth) {
      const todayCell = document.querySelector('.cal-day-today');
      if (todayCell) {
        if (!todayCell.classList.contains('cal-day-selected')) {
          todayCell.click();
        }
      }
      return;
    }
    
    calCurrentYear = today.getFullYear();
    calCurrentMonth = today.getMonth() + 1;
    calSelectTodayOnRender = true;
    refreshCalendar();
  });

  // Calendar Toggles: daily, weekly, monthly, yearly, tasks, events, reminders
  ['daily', 'weekly', 'monthly', 'yearly', 'tasks', 'events', 'reminders'].forEach(type => {
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
  if (!container) return;
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
  
  // SWR: render from cache instantly
  if (cachedTasks && cachedTasks.length > 0) {
    applyTaskFilterAndRender();
  }
  
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
    } else if (filterVal === 'reminders') {
      filtered = cachedTasks.filter(t => t.event_id);
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

  if (currentTaskStatusFilter === 'upcoming') {
    filtered = filtered.filter(t => {
      if (t.status === 'Completed' || t.status === 'Failed') return false;
      if (t.task_type === 'OneTime' && t.next_run_at && t.next_run_at < Date.now()) return false;
      return true;
    });
    // Sort upcoming tasks: soonest next run first (tasks with next_run_at ascending, and items with next_run_at === null or undefined at the end)
    filtered.sort((a, b) => {
      if (!a.next_run_at) return 1;
      if (!b.next_run_at) return -1;
      return a.next_run_at - b.next_run_at;
    });
  } else if (currentTaskStatusFilter === 'past') {
    filtered = filtered.filter(t => {
      return t.status === 'Completed' || t.status === 'Failed' || (t.task_type === 'OneTime' && t.next_run_at && t.next_run_at < Date.now());
    });
    // Sort past tasks: most recently run first (last_run_at descending)
    filtered.sort((a, b) => {
      const aTime = a.last_run_at ? new Date(a.last_run_at).getTime() : 0;
      const bTime = b.last_run_at ? new Date(b.last_run_at).getTime() : 0;
      return bTime - aTime;
    });
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
      const statusLabel = currentTaskStatusFilter === 'upcoming' ? 'Upcoming' : 'Past';
      const searchLabel = taskSearchQuery ? ` matching "${taskSearchQuery}"` : '';
      summaryText.textContent = `${filtered.length} of ${cachedTasks.length} task${cachedTasks.length === 1 ? '' : 's'} shown (${statusLabel})${typeLabel}${searchLabel}`;
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
    <th style="width: 30%;">Task Details</th>
    <th style="width: 30%;">Message</th>
    <th style="width: 24%;">Schedule &amp; Next / Last Run</th>
    <th style="width: 16%; text-align: right;">Actions</th>
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
      schedDetail = `Once (${formatDateTimeGMT8(spec.run_at)})`;
    } else if (task.task_type === 'Interval') {
      schedDetail = `Every ${spec.interval_secs}s`;
    } else if (task.task_type === 'Cron') {
      schedDetail = `Cron: ${spec.expression}`;
    }

    const ownerText = currentUser.isAdmin
      ? ` • by ${escapeHtml(task.owner_username || 'Unknown')}`
      : '';

    let actionBtns = '';
    actionBtns += `<button class="btn btn-secondary btn-sm" onclick="runTaskNow('${task.id}')" title="Test Send / Run Now" style="padding: 0.35rem 0.5rem; color: var(--accent);">⚡</button>`;
    if (task.status === 'Active') {
      actionBtns += `<button class="btn btn-secondary btn-sm" onclick="pauseTask('${task.id}')" title="Pause" style="padding: 0.35rem 0.5rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg></button>`;
    } else if (task.status === 'Paused' || task.status === 'Failed') {
      actionBtns += `<button class="btn btn-secondary btn-sm" onclick="resumeTask('${task.id}')" title="Resume" style="padding: 0.35rem 0.5rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button>`;
    }
    actionBtns += `<button class="btn btn-secondary btn-sm" onclick="openTaskDialog('${task.id}')" title="Edit" style="padding: 0.35rem 0.5rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>`;
    actionBtns += `<button class="btn btn-danger btn-sm" onclick="deleteTask('${task.id}')" title="Delete" style="padding: 0.35rem 0.5rem;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;

    const eventBadge = task.event_id
      ? '<span class="badge badge-xs" style="background-color: rgba(14, 165, 233, 0.12); color: #7dd3fc; border: 1px solid rgba(14, 165, 233, 0.2);">Event Reminder</span>'
      : '';

    const primaryTs = task.task_type === 'OneTime'
      ? (task.last_run_at || task.next_run_at)
      : (task.next_run_at || task.last_run_at);
    const tsLabel = task.task_type === 'OneTime'
      ? (task.last_run_at ? 'Sent' : 'Run')
      : (task.next_run_at ? 'Next' : 'Last');

    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; flex-wrap: wrap;">
          <span class="td-name">${escapeHtml(task.name)}</span>
          ${task.status !== 'Active' ? `<span class="badge ${statusClass}">${task.status}</span>` : ''}
          <span class="badge badge-primary badge-xs">${task.task_type}</span>
          ${eventBadge}
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
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.2rem;">${escapeHtml(schedDetail)}</div>
        ${renderStackedDateTime(primaryTs, true, tsLabel)}
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

async function runTaskNow(taskId) {
  const alertEl = document.getElementById('dashboardAlertContainer');
  try {
    showToast('Triggering test send…', 'info');
    const res = await fetch(`/api/tasks/${taskId}/run-now`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Task sent immediately!', 'success');
      showAlert(alertEl, 'success', data.message || 'Task sent immediately!');
      refreshTasks(true);
      refreshStats();
      refreshLogs(true);
    } else {
      showToast(data.error || 'Test send failed', 'danger');
      showAlert(alertEl, 'danger', data.error || 'Test send failed');
    }
  } catch (err) {
    showToast('Network error while triggering task', 'danger');
    showAlert(alertEl, 'danger', 'Network error while triggering task.');
  }
}

window.runTaskFromDialog = async function() {
  const taskId = document.getElementById('taskIdField').value;
  if (!taskId) return;
  await runTaskNow(taskId);
};

async function pauseTask(taskId) {
  const alertEl = document.getElementById('dashboardAlertContainer');
  try {
    const res = await fetch(`/api/tasks/${taskId}/pause`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (res.ok) {
      refreshTasks();
      refreshStats();
      showToast('Task paused', 'info');
    } else {
      const data = await res.json();
      showAlert(alertEl, 'danger', data.error || 'Failed to pause task');
    }
  } catch (err) {
    showAlert(alertEl, 'danger', 'Network error while pausing task.');
  }
}

async function resumeTask(taskId) {
  const alertEl = document.getElementById('dashboardAlertContainer');
  try {
    const res = await fetch(`/api/tasks/${taskId}/resume`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (res.ok) {
      refreshTasks();
      refreshStats();
      showToast('Task resumed', 'success');
    } else {
      const data = await res.json();
      showAlert(alertEl, 'danger', data.error || 'Failed to resume task');
    }
  } catch (err) {
    showAlert(alertEl, 'danger', 'Network error while resuming task.');
  }
}

function deleteTask(taskId) {
  const task = cachedTasks.find(t => t.id === taskId);
  const taskLabel = task ? `"${task.name}"` : 'this task';
  openConfirmDialog({
    title: 'Delete Task',
    message: `Are you sure you want to permanently delete ${taskLabel}?`,
    confirmText: 'Delete task',
    danger: true,
    onConfirm: async () => {
      const alertEl = document.getElementById('dashboardAlertContainer');
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'DELETE', headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        if (res.ok) {
          refreshTasks();
          refreshStats();
          showToast('Task deleted', 'success');
        } else {
          const data = await res.json();
          showAlert(alertEl, 'danger', data.error || 'Failed to delete task');
        }
      } catch (err) {
        showAlert(alertEl, 'danger', 'Network error while deleting task.');
      }
    }
  });
}

// ---------------------------------------------------------------
// CRON PRESETS, LIVE SCHEDULE PREVIEW & LIVE MESSAGE PREVIEW
// ---------------------------------------------------------------
window.setCronPreset = function(expr) {
  const cronInput = document.getElementById('cronExpr');
  if (cronInput) {
    cronInput.value = expr;
    schedulePreviewUpdate();
  }
};

window.setIntervalPreset = function(secs) {
  const intervalInput = document.getElementById('intervalSecs');
  if (intervalInput) {
    intervalInput.value = secs;
    schedulePreviewUpdate();
  }
};

function schedulePreviewUpdate() {
  if (schedulePreviewTimer) clearTimeout(schedulePreviewTimer);
  schedulePreviewTimer = setTimeout(updateSchedulePreview, 220);
}

async function updateSchedulePreview() {
  const previewBox = document.getElementById('schedulePreviewBox');
  if (!previewBox) return;

  const taskType = document.getElementById('taskType').value;
  let scheduleSpec = null;

  if (taskType === 'OneTime') {
    const sendImm = document.getElementById('sendImmediately').checked;
    if (sendImm) {
      previewBox.style.display = 'block';
      previewBox.innerHTML = `<div class="schedule-preview-title">Upcoming Schedule (GMT+8)</div><div class="schedule-preview-item">1. Immediate execution upon saving</div>`;
      return;
    }
    const val = document.getElementById('runAt').value;
    if (!val) {
      previewBox.style.display = 'none';
      return;
    }
    scheduleSpec = { run_at: parseLocalDatetimeInputGMT8(val) };
  } else if (taskType === 'Interval') {
    const secs = parseInt(document.getElementById('intervalSecs').value, 10);
    if (!secs || secs < 60) {
      previewBox.style.display = 'none';
      return;
    }
    scheduleSpec = { interval_secs: secs };
  } else if (taskType === 'Cron') {
    const expr = document.getElementById('cronExpr').value.trim();
    if (!expr) {
      previewBox.style.display = 'none';
      return;
    }
    scheduleSpec = { expression: expr };
  }

  try {
    const res = await fetch('/api/tasks/preview-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
      body: JSON.stringify({ taskType, scheduleSpec })
    });
    const data = await res.json();
    previewBox.style.display = 'block';
    if (!res.ok || !data.valid || !data.nextRuns || data.nextRuns.length === 0) {
      previewBox.innerHTML = `<div class="schedule-preview-title" style="color: var(--danger);">Invalid or Past Schedule</div><div class="schedule-preview-item">${escapeHtml(data.error || 'No future runs found for this specification.')}</div>`;
      return;
    }
    const itemsHtml = data.nextRuns.map((ts, idx) => {
      return `<div class="schedule-preview-item">${idx + 1}. ${formatDateTimeGMT8(ts)}</div>`;
    }).join('');
    previewBox.innerHTML = `<div class="schedule-preview-title">Next ${data.nextRuns.length} Run${data.nextRuns.length > 1 ? 's' : ''} (GMT+8)</div>${itemsHtml}`;
  } catch (err) {
    previewBox.style.display = 'none';
  }
}

window.previewTaskMessage = async function() {
  const template = document.getElementById('messageTemplate').value.trim();
  const previewBox = document.getElementById('messagePreviewBox');
  const btn = document.getElementById('previewMessageBtn');
  if (!previewBox) return;

  if (!template) {
    previewBox.style.display = 'block';
    previewBox.textContent = 'Enter a message template above to preview resolved placeholders.';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Resolving…';
  }
  try {
    const res = await fetch('/api/tasks/preview-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
      body: JSON.stringify({ messageTemplate: template })
    });
    const data = await res.json();
    previewBox.style.display = 'block';
    if (res.ok && data.resolvedMessage !== undefined) {
      previewBox.textContent = data.resolvedMessage;
    } else {
      previewBox.textContent = `Preview error: ${data.error || 'Failed to resolve placeholders'}`;
    }
  } catch (err) {
    previewBox.style.display = 'block';
    previewBox.textContent = 'Network error while previewing message.';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Preview live variables';
    }
  }
};

function renderTaskContactPickers() {
  const primaryBar = document.getElementById('taskPrimaryContactPicker');
  const broadcastBar = document.getElementById('taskBroadcastContactPicker');
  if (!primaryBar || !broadcastBar) return;

  if (!cachedContacts || cachedContacts.length === 0) {
    primaryBar.style.display = 'none';
    broadcastBar.style.display = 'none';
    return;
  }

  // Primary contact chips
  primaryBar.style.display = 'flex';
  primaryBar.innerHTML = `<span style="font-size: 0.7rem; color: var(--text-muted); align-self: center; margin-right: 0.25rem;">Saved:</span>` +
    cachedContacts.map(c => {
      return `<button type="button" class="cron-chip" onclick="selectPrimaryContact('${escapeHtml(c.phone)}')">${escapeHtml(c.name)}</button>`;
    }).join('');

  // Broadcast group chips + individual contact chips
  const groups = {};
  cachedContacts.forEach(c => {
    if (c.group_name) {
      if (!groups[c.group_name]) groups[c.group_name] = [];
      groups[c.group_name].push(c.phone);
    }
  });

  const groupChips = Object.keys(groups).map(gName => {
    const phonesCsv = groups[gName].join(',');
    return `<button type="button" class="cron-chip" style="border-color: rgba(99, 102, 241, 0.4); color: #a5b4fc;" onclick="appendBroadcastRecipients('${escapeHtml(phonesCsv)}')">+ Group: ${escapeHtml(gName)} (${groups[gName].length})</button>`;
  });

  const contactChips = cachedContacts.map(c => {
    return `<button type="button" class="cron-chip" onclick="appendBroadcastRecipients('${escapeHtml(c.phone)}')">+ ${escapeHtml(c.name)}</button>`;
  });

  broadcastBar.style.display = 'flex';
  broadcastBar.innerHTML = [...groupChips, ...contactChips].join('');
}

window.selectPrimaryContact = function(phone) {
  const input = document.getElementById('taskTargetWaChatId');
  if (input) input.value = phone;
};

window.appendBroadcastRecipients = function(phonesCsv) {
  const input = document.getElementById('targetList');
  if (!input) return;
  const existing = input.value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const incoming = phonesCsv
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const merged = [...new Set([...existing, ...incoming])];
  input.value = merged.join(', ');
};

// Task dialog
function openTaskDialog(taskId = null) {
  const form = document.getElementById('taskForm');
  form.reset();
  
  const idField = document.getElementById('taskIdField');
  const title = document.getElementById('taskDialogTitle');
  const dialogAlert = document.getElementById('taskDialogAlertContainer');
  const previewBox = document.getElementById('schedulePreviewBox');
  const msgPreviewBox = document.getElementById('messagePreviewBox');
  const runNowBtn = document.getElementById('taskDialogRunNowBtn');
  if (dialogAlert) dialogAlert.innerHTML = '';
  if (previewBox) previewBox.style.display = 'none';
  if (msgPreviewBox) msgPreviewBox.style.display = 'none';
  
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

  renderTaskContactPickers();

  if (taskId) {
    const task = cachedTasks.find(t => t.id === taskId);
    if (!task) return;
    
    title.textContent = 'Edit Task';
    idField.value = task.id;
    if (runNowBtn) runNowBtn.style.display = 'inline-flex';
    
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
      if (spec.run_at) document.getElementById('runAt').value = toLocalDatetimeInputGMT8(spec.run_at);
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
    schedulePreviewUpdate();
  } else {
    title.textContent = 'Create Task';
    idField.value = '';
    if (runNowBtn) runNowBtn.style.display = 'none';
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
  const dialogAlert = document.getElementById('taskDialogAlertContainer');
  if (dialogAlert) dialogAlert.innerHTML = '';
  
  const targetList = targetListText ? targetListText.split(',').map(s => s.trim()).filter(Boolean) : [];
    
  let scheduleSpec = {};
  if (taskType === 'OneTime') {
    const sendImmediately = document.getElementById('sendImmediately').checked;
    if (sendImmediately) {
      scheduleSpec = { run_at: new Date().toISOString() };
    } else {
      const val = document.getElementById('runAt').value;
      if (!val) {
        showAlert(dialogAlert, 'danger', 'Please select a trigger date and time.');
        return;
      }
      scheduleSpec = { run_at: parseLocalDatetimeInputGMT8(val) };
    }
  } else if (taskType === 'Interval') {
    const secs = parseInt(document.getElementById('intervalSecs').value, 10);
    if (!secs || secs < 60) {
      showAlert(dialogAlert, 'danger', 'Interval must be at least 60 seconds.');
      return;
    }
    scheduleSpec = { interval_secs: secs };
  } else if (taskType === 'Cron') {
    const cron = document.getElementById('cronExpr').value.trim();
    if (!cron) {
      showAlert(dialogAlert, 'danger', 'Please enter a valid cron expression.');
      return;
    }
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
      showAlert(dialogAlert, 'danger', data.error || 'Failed to save task.');
    }
  } catch (err) {
    showAlert(dialogAlert, 'danger', 'Network error while saving task.');
  } finally {
    submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------
// LOGS (Search, Status Filter & One-Click Retry)
// ---------------------------------------------------------------
async function refreshLogs(silent = false) {
  if (!apiToken) return;
  
  if (cachedLogs && cachedLogs.length > 0) {
    applyLogFilterAndRender();
  }
  
  try {
    const res = await fetch('/api/logs', { headers: { 'Authorization': `Bearer ${apiToken}` } });
    if (!res.ok) {
      if (!silent) showAlert(document.getElementById('logsAlertContainer'), 'danger', 'Failed to load send logs.');
      return;
    }
    const logs = await res.json();
    cachedLogs = logs;
    applyLogFilterAndRender();
  } catch (e) {
    console.error('Error refreshing logs:', e);
    if (!silent) showAlert(document.getElementById('logsAlertContainer'), 'danger', 'Network error while loading send logs.');
  }
}

function applyLogFilterAndRender() {
  let filtered = cachedLogs;

  if (currentLogFilter === 'sent') {
    filtered = filtered.filter(l => !!l.success);
  } else if (currentLogFilter === 'failed') {
    filtered = filtered.filter(l => !l.success);
  }

  if (logSearchQuery) {
    filtered = filtered.filter(l => {
      const nameMatch = l.task_name && l.task_name.toLowerCase().includes(logSearchQuery);
      const jidMatch = l.target_jid && l.target_jid.toLowerCase().includes(logSearchQuery);
      const msgMatch = l.message && l.message.toLowerCase().includes(logSearchQuery);
      const errMatch = l.error_msg && l.error_msg.toLowerCase().includes(logSearchQuery);
      return nameMatch || jidMatch || msgMatch || errMatch;
    });
  }

  const summaryEl = document.getElementById('logSummaryText');
  if (summaryEl) {
    if (cachedLogs.length === 0) {
      summaryEl.textContent = 'No message delivery logs yet';
    } else {
      const statusLabel = currentLogFilter === 'all' ? 'All' : (currentLogFilter === 'sent' ? 'Sent' : 'Failed');
      const searchLabel = logSearchQuery ? ` matching "${logSearchQuery}"` : '';
      summaryEl.textContent = `${filtered.length} of ${cachedLogs.length} log${cachedLogs.length === 1 ? '' : 's'} shown (${statusLabel})${searchLabel}`;
    }
  }

  renderLogsList(filtered);
}

window.toggleLogDetail = function(btn, logId) {
  const container = document.getElementById(`log-detail-${logId}`);
  if (container) {
    const isHidden = container.style.display === 'none';
    container.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? 'Hide Details' : 'View Details';
    if (isHidden) {
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-secondary');
    } else {
      btn.classList.add('btn-secondary');
      btn.classList.remove('btn-primary');
    }
  }
};

window.retryLog = async function(logId) {
  const alertEl = document.getElementById('logsAlertContainer');
  if (alertEl) alertEl.innerHTML = '';
  try {
    showToast('Retrying message send…', 'info');
    const res = await fetch(`/api/logs/${logId}/retry`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Message re-sent!', 'success');
      showAlert(alertEl, 'success', 'Message re-sent!');
    } else {
      showToast(data.error || 'Retry send failed', 'danger');
      showAlert(alertEl, 'danger', data.error || 'Retry send failed');
    }
    refreshLogs(true);
    refreshStats();
  } catch (err) {
    showToast('Network error while retrying message', 'danger');
    showAlert(alertEl, 'danger', 'Network error while retrying message.');
  }
};

function renderLogsList(logs) {
  const tbody = document.getElementById('logsTableBody');
  tbody.innerHTML = '';

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem;">No matching logs found.</td></tr>`;
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
        const logId = log.id;
        apiColumnHtml = `
          <button class="btn btn-secondary btn-sm" onclick="toggleLogDetail(this, '${logId}')">View Details</button>
          <div id="log-detail-${logId}" style="display: none; margin-top: 0.5rem; text-align: left;">
            <pre style="white-space: pre-wrap; word-break: break-all; font-family: monospace; font-size: 0.7rem; background: rgba(0, 0, 0, 0.25); padding: 0.5rem; border-radius: 4px; border: 1px solid var(--border); max-width: 250px; max-height: 180px; overflow-y: auto; color: var(--text-muted);">${escapeHtml(prettyJson)}</pre>
          </div>
        `;
      }
    }

    const retryActionHtml = !log.success
      ? `<button class="btn btn-secondary btn-sm" onclick="retryLog('${log.id}')" title="Retry sending this message">↻ Retry</button>`
      : `<span style="color: var(--text-muted); font-size: 0.8rem;">—</span>`;
      
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
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.25rem;">
          ${badge}
        </div>
        ${renderStackedDateTime(log.sent_at, true)}
        ${errorDetailHtml}
      </td>
      <td>
        ${apiColumnHtml}
      </td>
      <td style="text-align: right;">
        ${retryActionHtml}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------
// CALENDAR
// ---------------------------------------------------------------
async function refreshCalendar(silent = false) {
  if (!apiToken) return;
  const grid = document.getElementById('calendarGrid');
  const prevBtn = document.getElementById('calPrevBtn');
  const nextBtn = document.getElementById('calNextBtn');
  const todayBtn = document.getElementById('calTodayBtn');
  const loader = document.getElementById('calendarLoader');

  // SWR: render from cache instantly
  if (calendarData) {
    renderCalendar(calendarData);
  }

  // Clear any existing loader timeout
  if (loaderTimeout) {
    clearTimeout(loaderTimeout);
    loaderTimeout = null;
  }

  // Delay showing loader to prevent flickering on fast requests
  if (!silent) {
    loaderTimeout = setTimeout(() => {
      if (grid) grid.style.opacity = '0.5';
      if (loader) loader.classList.add('active');
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      if (todayBtn) todayBtn.disabled = true;
    }, 250);
  }

  try {
    const res = await fetch(`/api/calendar?year=${calCurrentYear}&month=${calCurrentMonth}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) {
      if (!silent) showToast('Failed to load calendar data', 'danger');
      return;
    }
    calendarData = await res.json();
    renderCalendar(calendarData);
  } catch (e) {
    console.error('Error refreshing calendar:', e);
    if (!silent) showToast('Network error loading calendar', 'danger');
  } finally {
    if (loaderTimeout) {
      clearTimeout(loaderTimeout);
      loaderTimeout = null;
    }
    // Hide loading state
    if (!silent) {
      if (grid) grid.style.opacity = '1';
      if (loader) loader.classList.remove('active');
      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = false;
      if (todayBtn) todayBtn.disabled = false;
    }
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

function isCalendarReminder(item) {
  return !!item.event_id || (item.name && item.name.startsWith('Reminder:')) || (item.task_name && item.task_name.startsWith('Reminder:'));
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
  const hideTasks = localStorage.getItem('cal_hide_tasks') === 'true';
  const hideEvents = localStorage.getItem('cal_hide_events') === 'true';
  const hideReminders = localStorage.getItem('cal_hide_reminders') === 'true';

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
    
    const dayLogs = (data.logs && data.logs[day]) || [];
    const dayScheduled = (data.scheduled && data.scheduled[day]) || [];
    const dayEvents = (data.events && data.events[day]) || [];
    
    const dayLogsFiltered = hideTasks
      ? []
      : dayLogs.filter(l => {
          if (hideReminders && isCalendarReminder(l)) return false;
          return shouldShowItem(l, hideDaily, hideWeekly, hideMonthly, hideYearly);
        });
    const dayScheduledFiltered = hideTasks
      ? []
      : dayScheduled.filter(s => {
          if (hideReminders && isCalendarReminder(s)) return false;
          return shouldShowItem(s, hideDaily, hideWeekly, hideMonthly, hideYearly);
        });
    const dayEventsFiltered = hideEvents ? [] : dayEvents;
    
    let dotsHtml = '';
    let labelsHtml = '';
    
    let dots = [];
    
    // 1. Process events on this day
    dayEventsFiltered.forEach(item => {
      dots.push(`<div class="cal-dot cal-dot-event" title="${escapeHtml(item.name)}: Event"></div>`);
    });
    
    // 2. Process each scheduled task on this day
    const processedTaskNames = new Set();
    dayScheduledFiltered.forEach(item => {
      processedTaskNames.add(item.name);
      
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
    
    // 3. Process any remaining logs that don't match any scheduled task
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
    
    // Display the event titles first
    dayEventsFiltered.forEach(item => {
      labelsHtml += `<div class="cal-day-label cal-day-label-event">${escapeHtml(item.name)}</div>`;
    });

    // Display the task titles for scheduled tasks below events
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
      document.querySelectorAll('.cal-day').forEach(c => c.classList.remove('cal-day-selected'));
      cell.classList.add('cal-day-selected');
      showDayDetail(day, data);
    });
    
    grid.appendChild(cell);
  }
  
  const totalCellsRendered = firstDayIndex + totalDays;
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
  const detailPanel = document.getElementById('calDayDetail');
  const title = document.getElementById('calDayDetailTitle');
  const content = document.getElementById('calDayDetailContent');
  
  const dd = String(day).padStart(2, '0');
  const mm = String(data.month).padStart(2, '0');
  const yy = String(data.year).slice(-2);
  title.textContent = `${dd}-${mm}-${yy}`;
  content.innerHTML = '';

  const hideDaily = localStorage.getItem('cal_hide_daily') === 'true';
  const hideWeekly = localStorage.getItem('cal_hide_weekly') === 'true';
  const hideMonthly = localStorage.getItem('cal_hide_monthly') === 'true';
  const hideYearly = localStorage.getItem('cal_hide_yearly') === 'true';
  const hideTasks = localStorage.getItem('cal_hide_tasks') === 'true';
  const hideEvents = localStorage.getItem('cal_hide_events') === 'true';
  const hideReminders = localStorage.getItem('cal_hide_reminders') === 'true';

  const dayLogs = (data.logs && data.logs[day]) || [];
  const dayScheduled = (data.scheduled && data.scheduled[day]) || [];
  const dayEvents = (data.events && data.events[day]) || [];
  
  const dayLogsFiltered = hideTasks
    ? []
    : dayLogs.filter(l => {
        if (hideReminders && isCalendarReminder(l)) return false;
        return shouldShowItem(l, hideDaily, hideWeekly, hideMonthly, hideYearly);
      });
  const dayScheduledFiltered = hideTasks
    ? []
    : dayScheduled.filter(s => {
        if (hideReminders && isCalendarReminder(s)) return false;
        return shouldShowItem(s, hideDaily, hideWeekly, hideMonthly, hideYearly);
      });
  const dayEventsFiltered = hideEvents ? [] : dayEvents;
  
  if (dayLogsFiltered.length === 0 && dayScheduledFiltered.length === 0 && dayEventsFiltered.length === 0) {
    content.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1.5rem 0;">No visible logs, scheduled tasks, or events for this day.</p>`;
    detailPanel.style.display = 'block';
    return;
  }
  
  let html = '';
  let firstSectionAdded = false;
  
  // 1. Events Section
  if (dayEventsFiltered.length > 0) {
    html += `
      <div class="cal-detail-section" ${firstSectionAdded ? 'style="margin-top: 1.5rem;"' : ''}>
        <h4 class="cal-detail-section-title">Events</h4>
    `;
    firstSectionAdded = true;
    
    dayEventsFiltered.sort((a, b) => a.event_date - b.event_date);
    
    dayEventsFiltered.forEach(item => {
      const timeStr = formatTimeGMT8(item.event_date);
      const recBadge = item.recurrence && item.recurrence !== 'None'
        ? ` <span class="badge badge-primary badge-xs">${escapeHtml(item.recurrence)}</span>`
        : '';
      
      html += `
        <div class="cal-detail-item">
          <div class="cal-dot cal-dot-event"></div>
          <div class="cal-detail-item-info">
            <div class="cal-detail-item-name">${escapeHtml(item.name)}${recBadge}</div>
            <div class="cal-detail-item-meta">${timeStr} — ${escapeHtml(item.description || 'No description')}</div>
          </div>
        </div>
      `;
    });
    
    html += `</div>`;
  }
  
  // 2. Scheduled Tasks Section
  if (dayScheduledFiltered.length > 0) {
    html += `
      <div class="cal-detail-section" ${firstSectionAdded ? 'style="margin-top: 1.5rem;"' : ''}>
        <h4 class="cal-detail-section-title">Scheduled Tasks</h4>
    `;
    firstSectionAdded = true;
    
    dayScheduledFiltered.sort((a, b) => a.fire_at - b.fire_at);
    
    dayScheduledFiltered.forEach(item => {
      const timeStr = formatTimeGMT8(item.fire_at);
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
  
  // 3. Sent Logs Section
  if (dayLogsFiltered.length > 0) {
    html += `
      <div class="cal-detail-section" ${firstSectionAdded ? 'style="margin-top: 1.5rem;"' : ''}>
        <h4 class="cal-detail-section-title">Activity Logs</h4>
    `;
    firstSectionAdded = true;
    
    dayLogsFiltered.sort((a, b) => a.sent_at - b.sent_at);
    
    dayLogsFiltered.forEach(log => {
      const timeStr = formatTimeGMT8(log.sent_at);
      const successBadge = log.success
        ? '<span class="badge badge-success" style="font-size: 0.7rem; padding: 2px 6px; display: inline-flex; align-items: center;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.2rem;"><polyline points="20 6 9 17 4 12"></polyline></svg>Sent</span>'
        : `<span class="badge badge-danger" style="font-size: 0.7rem; padding: 2px 6px; display: inline-flex; align-items: center;" title="${escapeHtml(log.error_msg || '')}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 0.2rem;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Failed</span>`;
 
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
// EVENTS (With Recurrence & Stacked GMT+8 Date/Time)
// ---------------------------------------------------------------
async function refreshEvents(silent = false) {
  if (!apiToken) return;
  
  if (cachedEvents && cachedEvents.length > 0) {
    applyEventFilterAndRender();
  }
  
  try {
    const res = await fetch('/api/events', {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    
    if (!res.ok) {
      if (res.status === 401) logout();
      return;
    }
    
    const events = await res.json();
    cachedEvents = events;
    toggleConnectionBanner(false);
    
    applyEventFilterAndRender();
  } catch (err) {
    console.error('Error refreshing events:', err);
    toggleConnectionBanner(true);
  }
}

function applyEventFilterAndRender() {
  let filtered = cachedEvents;
  
  if (eventSearchQuery) {
    filtered = filtered.filter(e => {
      const nameMatch = e.name && e.name.toLowerCase().includes(eventSearchQuery);
      const descMatch = e.description && e.description.toLowerCase().includes(eventSearchQuery);
      return nameMatch || descMatch;
    });
  }
  
  const now = Date.now();
  if (currentEventFilter === 'upcoming') {
    filtered = filtered.filter(e => e.event_date >= now || (e.recurrence && e.recurrence !== 'None'));
    filtered.sort((a, b) => a.event_date - b.event_date);
  } else if (currentEventFilter === 'past') {
    filtered = filtered.filter(e => e.event_date < now && (!e.recurrence || e.recurrence === 'None'));
    filtered.sort((a, b) => b.event_date - a.event_date);
  }
  
  const summaryText = document.getElementById('eventSummaryText');
  if (summaryText) {
    if (cachedEvents.length === 0) {
      summaryText.textContent = 'No events scheduled';
    } else {
      const searchLabel = eventSearchQuery ? ` matching "${eventSearchQuery}"` : '';
      const filterLabel = currentEventFilter === 'upcoming' ? 'Upcoming' : 'Past';
      summaryText.textContent = `${filtered.length} of ${cachedEvents.length} event${cachedEvents.length === 1 ? '' : 's'} shown (${filterLabel})${searchLabel}`;
    }
  }
  
  renderEventsList(filtered);
}

function renderEventsList(events) {
  const tableContainer = document.getElementById('eventsTableContainer');
  const emptyState = document.getElementById('eventsEmptyState');
  const tbody = document.getElementById('eventsTableBody');
  
  tbody.innerHTML = '';
  
  if (events.length === 0) {
    if (tableContainer) tableContainer.style.display = 'none';
    if (emptyState) {
      emptyState.style.display = 'block';
    }
    return;
  }
  
  if (tableContainer) tableContainer.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';
  
  events.forEach(event => {
    const tr = document.createElement('tr');
    
    const offsetDescs = (event.reminders || []).map(offset => {
      if (offset === 172800) return '48h before';
      if (offset === 86400) return '24h before';
      if (offset === 7200) return '2h before';
      if (offset === 3600) return '1h before';
      if (offset === 0) return 'At start';
      
      const absOffset = Math.abs(offset);
      const suffix = offset > 0 ? 'before' : 'after';
      
      if (absOffset % 86400 === 0) {
        return `${absOffset / 86400}d ${suffix}`;
      }
      if (absOffset % 3600 === 0) {
        return `${absOffset / 3600}h ${suffix}`;
      }
      return `${Math.round(absOffset / 60)}m ${suffix}`;
    });
    
    const remindersText = offsetDescs.length > 0
      ? offsetDescs.map(d => `<span class="badge badge-primary">${d}</span>`).join(' ')
      : '<span style="color: var(--text-muted); font-size: 0.8rem;">No reminders</span>';

    const recurrenceBadge = event.recurrence && event.recurrence !== 'None'
      ? `<span class="badge badge-xs" style="background-color: rgba(16, 185, 129, 0.14); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.25);">↻ ${escapeHtml(event.recurrence)}</span>`
      : '';

    const actionBtns = `
      <button class="btn btn-secondary btn-sm" onclick="openEventDialog('${event.id}')" title="Edit" style="padding: 0.35rem 0.5rem;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
      </button>
      <button class="btn btn-danger btn-sm" onclick="deleteEvent('${event.id}')" title="Delete" style="padding: 0.35rem 0.5rem;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    `;

    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; flex-wrap: wrap;">
          <span class="td-name">${escapeHtml(event.name)}</span>
          ${recurrenceBadge}
        </div>
        ${renderStackedDateTime(event.event_date, true)}
      </td>
      <td class="td-msg" title="${escapeHtml(event.description || '')}">
        ${escapeHtml(event.description || '—')}
      </td>
      <td>
        <div style="display: flex; gap: 0.25rem; flex-wrap: wrap;">
          ${remindersText}
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

window.deleteEvent = function(eventId) {
  const ev = cachedEvents.find(e => e.id === eventId);
  const label = ev ? `"${ev.name}"` : 'this event';
  openConfirmDialog({
    title: 'Delete Event',
    message: `Are you sure you want to delete ${label}? All associated WhatsApp reminder tasks will also be deleted.`,
    confirmText: 'Delete event',
    danger: true,
    onConfirm: async () => {
      const alertEl = document.getElementById('eventsAlertContainer');
      try {
        const res = await fetch(`/api/events/${eventId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        if (res.ok) {
          refreshEvents();
          refreshTasks(true);
          refreshStats();
          showToast('Event deleted', 'success');
        } else {
          const data = await res.json();
          showAlert(alertEl, 'danger', data.error || 'Failed to delete event');
        }
      } catch (err) {
        showAlert(alertEl, 'danger', 'Network error while deleting event.');
      }
    }
  });
};

window.openEventDialog = function(eventId = null) {
  const form = document.getElementById('eventForm');
  form.reset();
  
  const idField = document.getElementById('eventIdField');
  const title = document.getElementById('eventDialogTitle');
  const dialogAlert = document.getElementById('eventDialogAlertContainer');
  const recurrenceSelect = document.getElementById('eventRecurrence');
  if (dialogAlert) dialogAlert.innerHTML = '';
  if (recurrenceSelect) recurrenceSelect.value = 'None';
  
  document.querySelectorAll('#eventForm input[name="eventReminder"]').forEach(cb => cb.checked = false);
  
  const customCb = document.getElementById('eventReminderCustomCheckbox');
  const customValInput = document.getElementById('eventReminderCustomValue');
  const customUnitSelect = document.getElementById('eventReminderCustomUnit');
  const customRelationSelect = document.getElementById('eventReminderCustomRelation');
  if (customCb) customCb.checked = false;
  if (customValInput) customValInput.value = '';
  if (customUnitSelect) customUnitSelect.value = '3600';
  if (customRelationSelect) customRelationSelect.value = 'before';
  
  if (eventId) {
    const event = cachedEvents.find(e => e.id === eventId);
    if (!event) return;
    
    title.textContent = 'Edit Event';
    idField.value = event.id;
    document.getElementById('eventName').value = event.name;
    document.getElementById('eventDescription').value = event.description || '';
    if (recurrenceSelect) recurrenceSelect.value = event.recurrence || 'None';
    if (event.event_date) {
      document.getElementById('eventDate').value = toLocalDatetimeInputGMT8(event.event_date);
    }
    
    const standardOffsets = [172800, 86400, 7200, 3600, 0];
    if (event.reminders && Array.isArray(event.reminders)) {
      event.reminders.forEach(offset => {
        if (standardOffsets.includes(offset)) {
          const cb = document.querySelector(`#eventForm input[name="eventReminder"][value="${offset}"]`);
          if (cb) cb.checked = true;
        } else {
          if (customCb && customValInput && customUnitSelect && customRelationSelect) {
            customCb.checked = true;
            const suffix = offset >= 0 ? 'before' : 'after';
            customRelationSelect.value = suffix;
            
            const absOffset = Math.abs(offset);
            if (absOffset % 86400 === 0) {
              customUnitSelect.value = '86400';
              customValInput.value = absOffset / 86400;
            } else if (absOffset % 3600 === 0) {
              customUnitSelect.value = '3600';
              customValInput.value = absOffset / 3600;
            } else {
              customUnitSelect.value = '60';
              customValInput.value = Math.round(absOffset / 60);
            }
          }
        }
      });
    }
  } else {
    title.textContent = 'Create Event';
    idField.value = '';
  }
  
  document.getElementById('eventDialog').showModal();
};

async function handleEventFormSubmit(e) {
  e.preventDefault();
  const eventId = document.getElementById('eventIdField').value;
  const name = document.getElementById('eventName').value.trim();
  const eventDateStr = document.getElementById('eventDate').value;
  const recurrence = document.getElementById('eventRecurrence') ? document.getElementById('eventRecurrence').value : 'None';
  const description = document.getElementById('eventDescription').value.trim();
  const dialogAlert = document.getElementById('eventDialogAlertContainer');
  if (dialogAlert) dialogAlert.innerHTML = '';
  
  if (!eventDateStr) {
    showAlert(dialogAlert, 'danger', 'Please select a date and time.');
    return;
  }
  const eventDate = parseLocalDatetimeInputGMT8(eventDateStr);

  const reminders = [];
  document.querySelectorAll('#eventForm input[name="eventReminder"]:checked').forEach(cb => {
    reminders.push(parseInt(cb.value, 10));
  });

  const customCb = document.getElementById('eventReminderCustomCheckbox');
  const customValInput = document.getElementById('eventReminderCustomValue');
  const customUnitSelect = document.getElementById('eventReminderCustomUnit');
  const customRelationSelect = document.getElementById('eventReminderCustomRelation');
  if (customCb && customCb.checked) {
    if (!customValInput || !customValInput.value) {
      showAlert(dialogAlert, 'danger', 'Please enter the custom reminder value.');
      return;
    }
    const val = parseFloat(customValInput.value);
    const unit = parseInt(customUnitSelect.value || '3600', 10);
    const isAfter = customRelationSelect && customRelationSelect.value === 'after';
    
    if (!isNaN(val) && val > 0) {
      let offset = Math.round(val * unit);
      if (isAfter) {
        offset = -offset;
      }
      reminders.push(offset);
    } else {
      showAlert(dialogAlert, 'danger', 'Please enter a valid positive number for custom reminder.');
      return;
    }
  }

  const payload = { name, eventDate, recurrence, description, reminders };
  const alertEl = document.getElementById('eventsAlertContainer');
  if (alertEl) alertEl.innerHTML = '';
  const submitBtn = document.getElementById('eventFormSubmitBtn');
  submitBtn.disabled = true;

  try {
    let res;
    if (eventId) {
      res = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (res.ok) {
      document.getElementById('eventDialog').close();
      refreshEvents();
      refreshTasks(true);
      refreshStats();
      if (alertEl) showAlert(alertEl, 'success', `Event ${eventId ? 'updated' : 'created'}!`);
    } else {
      showAlert(dialogAlert, 'danger', data.error || 'Failed to save event.');
    }
  } catch (err) {
    showAlert(dialogAlert, 'danger', 'Network error while saving event.');
  } finally {
    submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------
// SAVED CONTACTS & RECIPIENT GROUPS
// ---------------------------------------------------------------
async function refreshContacts(silent = false) {
  if (!apiToken) return;
  if (cachedContacts && cachedContacts.length > 0) {
    applyContactFilterAndRender();
  }
  try {
    const res = await fetch('/api/contacts', {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) {
      if (!silent) showAlert(document.getElementById('contactsAlertContainer'), 'danger', 'Failed to load contacts.');
      return;
    }
    cachedContacts = await res.json();
    applyContactFilterAndRender();
  } catch (err) {
    if (!silent) showAlert(document.getElementById('contactsAlertContainer'), 'danger', 'Network error while loading contacts.');
  }
}

function applyContactFilterAndRender() {
  let filtered = cachedContacts;
  if (contactSearchQuery) {
    filtered = filtered.filter(c => {
      const nameMatch = c.name && c.name.toLowerCase().includes(contactSearchQuery);
      const phoneMatch = c.phone && c.phone.toLowerCase().includes(contactSearchQuery);
      const groupMatch = c.group_name && c.group_name.toLowerCase().includes(contactSearchQuery);
      const notesMatch = c.notes && c.notes.toLowerCase().includes(contactSearchQuery);
      return nameMatch || phoneMatch || groupMatch || notesMatch;
    });
  }

  const countText = document.getElementById('contactCountText');
  if (countText) {
    countText.textContent = `${filtered.length} of ${cachedContacts.length} contact${cachedContacts.length === 1 ? '' : 's'}`;
  }
  renderContactsList(filtered);
}

function renderContactsList(contacts) {
  const tableContainer = document.getElementById('contactsTableContainer');
  const emptyState = document.getElementById('contactsEmptyState');
  const tbody = document.getElementById('contactsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (contacts.length === 0) {
    if (tableContainer) tableContainer.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (tableContainer) tableContainer.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';

  contacts.forEach(contact => {
    const tr = document.createElement('tr');
    const groupBadge = contact.group_name
      ? `<span class="badge badge-primary">${escapeHtml(contact.group_name)}</span>`
      : `<span style="color: var(--text-muted); font-size: 0.8rem;">—</span>`;

    tr.innerHTML = `
      <td class="td-name">${escapeHtml(contact.name)}</td>
      <td class="td-mono">${escapeHtml(contact.phone)}</td>
      <td>${groupBadge}</td>
      <td class="td-msg" title="${escapeHtml(contact.notes || '')}">${escapeHtml(contact.notes || '—')}</td>
      <td>${renderStackedDateTime(contact.updated_at || contact.created_at, true)}</td>
      <td>
        <div style="display: flex; justify-content: flex-end; gap: 0.35rem;">
          <button class="btn btn-secondary btn-sm" onclick="openContactDialog('${contact.id}')" title="Edit" style="padding: 0.35rem 0.5rem;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteContact('${contact.id}')" title="Delete" style="padding: 0.35rem 0.5rem;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.openContactDialog = function(contactId = null) {
  const form = document.getElementById('contactForm');
  if (form) form.reset();
  const idField = document.getElementById('contactIdField');
  const title = document.getElementById('contactDialogTitle');
  const dialogAlert = document.getElementById('contactDialogAlertContainer');
  if (dialogAlert) dialogAlert.innerHTML = '';

  if (contactId) {
    const contact = cachedContacts.find(c => c.id === contactId);
    if (!contact) return;
    title.textContent = 'Edit Contact';
    idField.value = contact.id;
    document.getElementById('contactName').value = contact.name;
    document.getElementById('contactPhone').value = contact.phone;
    document.getElementById('contactGroup').value = contact.group_name || '';
    document.getElementById('contactNotes').value = contact.notes || '';
  } else {
    title.textContent = 'Add Contact';
    idField.value = '';
  }
  document.getElementById('contactDialog').showModal();
};

async function handleContactFormSubmit(e) {
  e.preventDefault();
  const contactId = document.getElementById('contactIdField').value;
  const name = document.getElementById('contactName').value.trim();
  const phone = document.getElementById('contactPhone').value.trim();
  const group_name = document.getElementById('contactGroup').value.trim();
  const notes = document.getElementById('contactNotes').value.trim();
  const dialogAlert = document.getElementById('contactDialogAlertContainer');
  const alertEl = document.getElementById('contactsAlertContainer');
  const submitBtn = document.getElementById('contactFormSubmitBtn');

  if (dialogAlert) dialogAlert.innerHTML = '';
  if (alertEl) alertEl.innerHTML = '';
  submitBtn.disabled = true;

  try {
    const url = contactId ? `/api/contacts/${contactId}` : '/api/contacts';
    const method = contactId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
      body: JSON.stringify({ name, phone, group_name, notes })
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('contactDialog').close();
      refreshContacts();
      showAlert(alertEl, 'success', `Contact "${name}" ${contactId ? 'updated' : 'saved'}!`);
    } else {
      showAlert(dialogAlert, 'danger', data.error || 'Failed to save contact.');
    }
  } catch (err) {
    showAlert(dialogAlert, 'danger', 'Network error while saving contact.');
  } finally {
    submitBtn.disabled = false;
  }
}

window.deleteContact = function(contactId) {
  const contact = cachedContacts.find(c => c.id === contactId);
  const label = contact ? `"${contact.name}"` : 'this contact';
  openConfirmDialog({
    title: 'Delete Contact',
    message: `Are you sure you want to delete ${label} from your saved contacts?`,
    confirmText: 'Delete contact',
    danger: true,
    onConfirm: async () => {
      const alertEl = document.getElementById('contactsAlertContainer');
      try {
        const res = await fetch(`/api/contacts/${contactId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${apiToken}` }
        });
        if (res.ok) {
          refreshContacts();
          showToast('Contact deleted', 'success');
        } else {
          const data = await res.json();
          showAlert(alertEl, 'danger', data.error || 'Failed to delete contact.');
        }
      } catch (err) {
        showAlert(alertEl, 'danger', 'Network error while deleting contact.');
      }
    }
  });
};

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
  const verifDisplay = document.getElementById('waVerifCodeDisplay');
  const verifCodeEl = document.getElementById('settingsVerifCode');
  
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

  if (verifDisplay && verifCodeEl) {
    if (currentUser.verificationCode) {
      verifCodeEl.textContent = formatVerifCode(currentUser.verificationCode);
      verifDisplay.style.display = 'block';
    } else {
      verifDisplay.style.display = 'none';
    }
  }

  // Revert UI to non-edit mode
  if (manualWaNumberEl) manualWaNumberEl.disabled = true;
  const editWaBtn = document.getElementById('editWaBtn');
  const saveWaBtn = document.getElementById('saveWaBtn');
  const cancelWaBtn = document.getElementById('cancelWaBtn');
  if (editWaBtn) editWaBtn.style.display = 'inline-block';
  if (saveWaBtn) saveWaBtn.style.display = 'none';
  if (cancelWaBtn) cancelWaBtn.style.display = 'none';
  
  await loadInstructions();
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
  const alert = document.getElementById('adminAlertContainer');
  try {
    const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${apiToken}` } });
    if (!res.ok) {
      showAlert(alert, 'danger', 'Failed to load users.');
      return;
    }
    const users = await res.json();
    cachedUsers = users;
    document.getElementById('userCountText').textContent = `${users.length} user${users.length !== 1 ? 's' : ''} total`;
    renderUsersList(users);
  } catch (e) {
    showAlert(alert, 'danger', 'Network error while loading users.');
  }
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
      <td>${renderStackedDateTime(u.createdAt, true)}</td>
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

function deleteUser(userId, name) {
  openConfirmDialog({
    title: 'Delete User Account',
    message: `Are you sure you want to permanently delete user "${name}"? All of their scheduled tasks, events, contacts, and logs will be deleted.`,
    confirmText: 'Delete user',
    danger: true,
    onConfirm: async () => {
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
          showAlert(alert, 'danger', data.error || 'Failed to delete user');
        }
      } catch (e) {
        showAlert(alert, 'danger', 'Network error while deleting user');
      }
    }
  });
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
