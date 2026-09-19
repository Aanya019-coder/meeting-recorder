function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
    });
  });
}

const toggleMeet = document.getElementById('toggle-meet');
const toggleZoom = document.getElementById('toggle-zoom');
const toggleTeams = document.getElementById('toggle-teams');
const thresholdSlider = document.getElementById('threshold-slider');
const thresholdLabel = document.getElementById('threshold-label');
const retentionSelect = document.getElementById('retention-select');
const toggleDriveAutoSync = document.getElementById('toggle-drive-autosync');
const driveAccountLabel = document.getElementById('drive-account-label');
const driveAccountDetail = document.getElementById('drive-account-detail');
const driveAuthBtn = document.getElementById('drive-auth-btn');
const customClientId = document.getElementById('custom-client-id');
const saveStatus = document.getElementById('save-status');

const supabaseUserPanel = document.getElementById('supabase-user-panel');
const supabaseUserEmail = document.getElementById('supabase-user-email');
const supabaseSignoutBtn = document.getElementById('supabase-signout-btn');
const supabaseLoginPanel = document.getElementById('supabase-login-panel');
const supabaseEmailInput = document.getElementById('supabase-email');
const supabasePasswordInput = document.getElementById('supabase-password');
const supabaseSigninBtn = document.getElementById('supabase-signin-btn');
const supabaseSignupBtn = document.getElementById('supabase-signup-btn');
const supabaseStatus = document.getElementById('supabase-status');
const supabaseUrlInput = document.getElementById('supabase-url');
const supabaseAnonKeyInput = document.getElementById('supabase-anon-key');
const supabaseSaveConfigBtn = document.getElementById('supabase-save-config-btn');

function describeThreshold(v) {
  if (v <= 0.32) return `${v.toFixed(2)} \u2014 loose (more flags, more false positives)`;
  if (v >= 0.55) return `${v.toFixed(2)} \u2014 strict (only near-identical phrasing)`;
  return `${v.toFixed(2)} \u2014 balanced`;
}

async function refreshDriveUI() {
  const res = await sendMessage({ type: 'DRIVE_STATUS' });
  const connected = res && res.ok && res.status && res.status.connected;

  if (connected) {
    driveAccountLabel.textContent = `Connected: ${res.status.user || 'Google Account'}`;
    driveAccountDetail.textContent = 'Backing up MOM & transcripts to "Precedent Meeting Notes" folder.';
    driveAuthBtn.textContent = 'Disconnect';
    driveAuthBtn.className = 'pc-opt-btn pc-opt-btn-danger';
    driveAuthBtn.onclick = async () => {
      driveAuthBtn.textContent = 'Disconnecting…';
      await sendMessage({ type: 'DRIVE_DISCONNECT' });
      await refreshDriveUI();
      flashSaved();
    };
  } else {
    driveAccountLabel.textContent = 'Not connected';
    driveAccountDetail.textContent = 'Connect your Google account to enable auto-sync.';
    driveAuthBtn.textContent = 'Connect Google Drive';
    driveAuthBtn.className = 'pc-opt-btn pc-opt-btn-primary';
    driveAuthBtn.onclick = async () => {
      driveAuthBtn.textContent = 'Connecting…';
      const authRes = await sendMessage({ type: 'DRIVE_AUTH' });
      await refreshDriveUI();
      flashSaved();
    };
  }
}

async function refreshSupabaseUI() {
  const cfgRes = await sendMessage({ type: 'SUPABASE_GET_CONFIG' });
  if (cfgRes && cfgRes.ok && cfgRes.config) {
    supabaseUrlInput.value = cfgRes.config.url || '';
    supabaseAnonKeyInput.value = cfgRes.config.anonKey || '';
  }

  const userRes = await sendMessage({ type: 'SUPABASE_GET_USER' });
  if (userRes && userRes.ok && userRes.user) {
    supabaseUserPanel.style.display = 'block';
    supabaseLoginPanel.style.display = 'none';
    supabaseUserEmail.textContent = userRes.user.email || 'Logged in user';
  } else {
    supabaseUserPanel.style.display = 'none';
    supabaseLoginPanel.style.display = 'block';
  }
}

async function load() {
  const res = await sendMessage({ type: 'GET_SETTINGS' });
  if (!res.ok) return;
  const s = res.settings;
  toggleMeet.checked = s.platforms.meet !== false;
  toggleZoom.checked = s.platforms.zoom !== false;
  toggleTeams.checked = s.platforms.teams !== false;
  thresholdSlider.value = s.similarityThreshold;
  thresholdLabel.textContent = describeThreshold(s.similarityThreshold);
  retentionSelect.value = String(s.retentionDays);
  toggleDriveAutoSync.checked = !!s.googleDriveAutoSync;

  chrome.storage.local.get('googleClientId', (data) => {
    if (data && data.googleClientId) {
      customClientId.value = data.googleClientId;
    }
  });

  await refreshDriveUI();
  await refreshSupabaseUI();
}

function flashSaved() {
  saveStatus.textContent = 'Saved';
  setTimeout(() => {
    saveStatus.textContent = '';
  }, 1200);
}

async function saveSettings() {
  await sendMessage({
    type: 'SET_SETTINGS',
    settings: {
      platforms: {
        meet: toggleMeet.checked,
        zoom: toggleZoom.checked,
        teams: toggleTeams.checked
      },
      similarityThreshold: parseFloat(thresholdSlider.value),
      retentionDays: parseInt(retentionSelect.value, 10),
      googleDriveAutoSync: toggleDriveAutoSync.checked
    }
  });

  if (customClientId.value.trim()) {
    chrome.storage.local.set({ googleClientId: customClientId.value.trim() });
  }

  flashSaved();
}

[toggleMeet, toggleZoom, toggleTeams, retentionSelect, toggleDriveAutoSync].forEach((elNode) => {
  elNode.addEventListener('change', saveSettings);
});

customClientId.addEventListener('change', saveSettings);

thresholdSlider.addEventListener('input', () => {
  thresholdLabel.textContent = describeThreshold(parseFloat(thresholdSlider.value));
});
thresholdSlider.addEventListener('change', saveSettings);

document.getElementById('export-btn').addEventListener('click', async () => {
  const res = await sendMessage({ type: 'EXPORT_DATA' });
  if (!res.ok) return;
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  if (chrome.downloads) {
    chrome.downloads.download({ url, filename: `precedent-export-${Date.now()}.json` });
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = `precedent-export-${Date.now()}.json`;
    a.click();
  }
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  const confirmed = window.confirm('This permanently deletes every meeting, commitment, and decision Precedent has stored on this device. This cannot be undone. Continue?');
  if (!confirmed) return;
  await sendMessage({ type: 'CLEAR_ALL_DATA' });
  flashSaved();
});

supabaseSaveConfigBtn.addEventListener('click', async () => {
  const url = supabaseUrlInput.value.trim();
  const anonKey = supabaseAnonKeyInput.value.trim();
  await sendMessage({ type: 'SUPABASE_SAVE_CONFIG', url, anonKey });
  supabaseStatus.style.color = 'var(--accent-green)';
  supabaseStatus.textContent = 'Supabase configuration saved.';
  setTimeout(() => { supabaseStatus.textContent = ''; }, 2500);
});

supabaseSigninBtn.addEventListener('click', async () => {
  const email = supabaseEmailInput.value.trim();
  const password = supabasePasswordInput.value;
  if (!email || !password) {
    supabaseStatus.style.color = 'var(--accent-rose)';
    supabaseStatus.textContent = 'Please enter both email and password.';
    return;
  }
  supabaseSigninBtn.textContent = 'Signing in…';
  supabaseSigninBtn.disabled = true;
  const res = await sendMessage({ type: 'SUPABASE_SIGN_IN', email, password });
  supabaseSigninBtn.textContent = 'Sign In';
  supabaseSigninBtn.disabled = false;
  if (res && res.ok) {
    supabaseStatus.style.color = 'var(--accent-green)';
    supabaseStatus.textContent = 'Signed in successfully!';
    supabasePasswordInput.value = '';
    await refreshSupabaseUI();
  } else {
    supabaseStatus.style.color = 'var(--accent-rose)';
    supabaseStatus.textContent = (res && res.error) || 'Failed to sign in. Check credentials and configuration.';
  }
});

supabaseSignupBtn.addEventListener('click', async () => {
  const email = supabaseEmailInput.value.trim();
  const password = supabasePasswordInput.value;
  if (!email || !password) {
    supabaseStatus.style.color = 'var(--accent-rose)';
    supabaseStatus.textContent = 'Please enter both email and password.';
    return;
  }
  supabaseSignupBtn.textContent = 'Creating…';
  supabaseSignupBtn.disabled = true;
  const res = await sendMessage({ type: 'SUPABASE_SIGN_UP', email, password });
  supabaseSignupBtn.textContent = 'Create Account';
  supabaseSignupBtn.disabled = false;
  if (res && res.ok) {
    supabaseStatus.style.color = 'var(--accent-green)';
    supabaseStatus.textContent = res.message || 'Account created! If confirmation is required, check your email.';
    if (res.user && res.session) {
      await refreshSupabaseUI();
    }
  } else {
    supabaseStatus.style.color = 'var(--accent-rose)';
    supabaseStatus.textContent = (res && res.error) || 'Failed to create account.';
  }
});

supabaseSignoutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'SUPABASE_SIGN_OUT' });
  await refreshSupabaseUI();
  supabaseStatus.style.color = 'var(--accent-green)';
  supabaseStatus.textContent = 'Signed out.';
  setTimeout(() => { supabaseStatus.textContent = ''; }, 2000);
});

load();
