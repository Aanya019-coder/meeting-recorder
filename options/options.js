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

load();
