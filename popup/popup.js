const SUPPORTED_HOST_PATTERNS = [/meet\.google\.com/, /zoom\.us/, /teams\.microsoft\.com/, /teams\.live\.com/];

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response || { ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
    });
  });
}

function formatDate(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function renderStatus() {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const activeCallSection = document.getElementById('active-call-section');
  const activeCallTitle = document.getElementById('active-call-title');
  const activeCallStats = document.getElementById('active-call-stats');
  const activeCallSaveBtn = document.getElementById('active-call-save-btn');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && tab.url ? tab.url : '';
  const onSupportedSite = SUPPORTED_HOST_PATTERNS.some((re) => re.test(url));

  if (!onSupportedSite) {
    dot.className = 'pc-pop-dot inactive';
    text.textContent = 'Open Meet, Zoom, or Teams to activate';
    activeCallSection.style.display = 'none';
    return;
  }

  // Check if content script has an active meeting session
  if (tab && tab.id) {
    const status = await sendTabMessage(tab.id, { type: 'GET_MEETING_STATUS' });
    if (status && status.ok && status.active) {
      dot.className = 'pc-pop-dot listening';
      text.textContent = status.captionsActive ? 'Live captions connected' : 'Active call \u00B7 turn on live captions';
      activeCallSection.style.display = 'flex';
      activeCallTitle.textContent = status.title || 'In-progress meeting';
      activeCallStats.textContent = `${status.commitmentsCount || 0} promise(s), ${status.decisionsCount || 0} decision(s)`;

      activeCallSaveBtn.onclick = async () => {
        activeCallSaveBtn.textContent = 'Saving\u2026';
        activeCallSaveBtn.disabled = true;
        await sendTabMessage(tab.id, { type: 'WRAP_UP_MEETING' });
        activeCallSaveBtn.textContent = '\u2713 Saved to device';
        setTimeout(() => {
          renderCommitments();
          renderMeetings();
        }, 600);
      };
      return;
    }
  }

  dot.className = 'pc-pop-dot listening';
  text.textContent = 'Ready on this tab \u00B7 turn on captions in-call';
  activeCallSection.style.display = 'none';
}

async function renderCommitments() {
  const container = document.getElementById('commitments-list');
  const res = await sendMessage({ type: 'GET_OPEN_COMMITMENTS' });
  container.innerHTML = '';

  if (!res.ok || !res.commitments || res.commitments.length === 0) {
    container.appendChild(elEmpty('No open commitments tracked yet.'));
    return;
  }

  const sorted = res.commitments
    .slice()
    .sort((a, b) => (a.dueDate || Infinity) - (b.dueDate || Infinity))
    .slice(0, 8);

  for (const c of sorted) {
    const item = document.createElement('div');
    item.className = 'pc-pop-item';

    const checkBtn = document.createElement('button');
    checkBtn.className = 'pc-pop-check-btn';
    checkBtn.setAttribute('title', 'Mark as done');
    checkBtn.textContent = '\u2713';

    checkBtn.addEventListener('click', async () => {
      checkBtn.style.background = '#2F6B5E';
      checkBtn.style.color = '#fff';
      main.style.textDecoration = 'line-through';
      item.style.opacity = '0.4';
      await sendMessage({ type: 'MARK_COMMITMENT_RESOLVED', commitmentId: c.id, resolved: true });
      setTimeout(() => renderCommitments(), 350);
    });

    const content = document.createElement('div');
    content.className = 'pc-pop-item-content';

    const main = document.createElement('div');
    main.className = 'pc-pop-item-main';
    main.textContent = `${c.owner}: ${c.task}`;

    const meta = document.createElement('div');
    meta.className = 'pc-pop-item-meta';
    const due = formatDate(c.dueDate) || c.dueLabel;
    meta.textContent = due ? `Due ${due} \u00B7 ${c.meetingTitle || 'past meeting'}` : (c.meetingTitle || 'past meeting');

    content.appendChild(main);
    content.appendChild(meta);

    item.appendChild(checkBtn);
    item.appendChild(content);
    container.appendChild(item);
  }
}

async function renderAuthStatus() {
  const pill = document.getElementById('auth-pill');
  if (!pill) return;
  const userRes = await sendMessage({ type: 'SUPABASE_GET_USER' });
  if (userRes && userRes.ok && userRes.user) {
    const email = userRes.user.email || 'User';
    pill.textContent = `👤 ${email.split('@')[0]}`;
    pill.className = 'pc-pop-pill connected';
    pill.title = `Logged in as ${email}. Click for settings & account`;
    pill.onclick = () => chrome.runtime.openOptionsPage();
  } else {
    pill.textContent = '👤 Sign In';
    pill.className = 'pc-pop-pill disconnected';
    pill.title = 'Click to sign in with Supabase';
    pill.onclick = () => chrome.runtime.openOptionsPage();
  }
}

async function renderDriveStatus() {
  const pill = document.getElementById('drive-pill');
  if (!pill) return;
  const res = await sendMessage({ type: 'DRIVE_STATUS' });
  if (res && res.ok && res.status && res.status.connected) {
    pill.textContent = '☁️ Drive Connected';
    pill.className = 'pc-pop-pill connected';
    pill.title = `Connected to Google Drive (${res.status.user || ''})`;
    pill.onclick = () => chrome.runtime.openOptionsPage();
  } else {
    pill.textContent = '☁️ Connect Drive';
    pill.className = 'pc-pop-pill disconnected';
    pill.title = 'Click to connect Google Drive';
    pill.onclick = async () => {
      pill.textContent = 'Connecting…';
      const authRes = await sendMessage({ type: 'DRIVE_AUTH' });
      if (authRes && authRes.ok) {
        renderDriveStatus();
      } else {
        chrome.runtime.openOptionsPage();
      }
    };
  }
}

async function renderMeetings() {
  const container = document.getElementById('meetings-list');
  const res = await sendMessage({ type: 'GET_RECENT_MEETINGS' });
  container.innerHTML = '';

  if (!res.ok || !res.meetings || res.meetings.length === 0) {
    container.appendChild(elEmpty('No meetings recorded yet.'));
    return;
  }

  for (const m of res.meetings.slice(0, 8)) {
    const item = document.createElement('div');
    item.className = 'pc-pop-item-meeting';

    const content = document.createElement('div');
    content.className = 'pc-pop-item-content';

    const main = document.createElement('div');
    main.className = 'pc-pop-item-main';
    main.textContent = m.title || 'Untitled meeting';

    const meta = document.createElement('div');
    meta.className = 'pc-pop-item-meta';
    meta.textContent = `${formatDate(m.startTime) || ''} \u00B7 ${(m.attendees || []).length} attendee(s) \u00B7 ${m.platform}`;

    const actions = document.createElement('div');
    actions.className = 'pc-pop-item-actions';

    const copyMomBtn = document.createElement('button');
    copyMomBtn.className = 'pc-pop-mini-btn';
    copyMomBtn.textContent = '📋 Copy MOM';
    copyMomBtn.addEventListener('click', async () => {
      copyMomBtn.textContent = 'Generating…';
      const momRes = await sendMessage({ type: 'GENERATE_MOM', meetingId: m.id });
      if (momRes && momRes.ok && momRes.markdown) {
        await navigator.clipboard.writeText(momRes.markdown);
        copyMomBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyMomBtn.textContent = '📋 Copy MOM'; }, 2000);
      } else {
        copyMomBtn.textContent = 'Failed';
        setTimeout(() => { copyMomBtn.textContent = '📋 Copy MOM'; }, 2000);
      }
    });

    const syncDriveBtn = document.createElement('button');
    syncDriveBtn.className = 'pc-pop-mini-btn';
    syncDriveBtn.textContent = '☁️ Drive Sync';
    syncDriveBtn.addEventListener('click', async () => {
      syncDriveBtn.textContent = 'Syncing…';
      const syncRes = await sendMessage({ type: 'SYNC_MEETING_TO_DRIVE', meetingId: m.id, meetingTitle: m.title, startTime: m.startTime });
      if (syncRes && syncRes.ok && syncRes.result) {
        syncDriveBtn.textContent = '✓ In Drive';
        if (syncRes.result.webViewLink) {
          syncDriveBtn.onclick = () => window.open(syncRes.result.webViewLink, '_blank');
        }
      } else {
        syncDriveBtn.textContent = 'Needs login';
        setTimeout(() => { chrome.runtime.openOptionsPage(); }, 1200);
      }
    });

    actions.appendChild(copyMomBtn);
    actions.appendChild(syncDriveBtn);

    content.appendChild(main);
    content.appendChild(meta);
    content.appendChild(actions);
    item.appendChild(content);
    container.appendChild(item);
  }
}

function elEmpty(text) {
  const div = document.createElement('div');
  div.className = 'pc-pop-empty';
  div.textContent = text;
  return div;
}

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('export-data').addEventListener('click', async () => {
  const res = await sendMessage({ type: 'EXPORT_DATA' });
  if (!res.ok) return;
  const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  chrome.downloads
    ? chrome.downloads.download({ url, filename: `precedent-export-${Date.now()}.json` })
    : window.open(url);
});

renderStatus();
renderAuthStatus();
renderDriveStatus();
renderCommitments();
renderMeetings();
