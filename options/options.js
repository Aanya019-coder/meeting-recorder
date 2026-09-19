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
const saveStatus = document.getElementById('save-status');

function describeThreshold(v) {
  if (v <= 0.32) return `${v.toFixed(2)} \u2014 loose (more flags, more false positives)`;
  if (v >= 0.55) return `${v.toFixed(2)} \u2014 strict (only near-identical phrasing)`;
  return `${v.toFixed(2)} \u2014 balanced`;
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
      retentionDays: parseInt(retentionSelect.value, 10)
    }
  });
  flashSaved();
}

[toggleMeet, toggleZoom, toggleTeams, retentionSelect].forEach((elNode) => {
  elNode.addEventListener('change', saveSettings);
});

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
