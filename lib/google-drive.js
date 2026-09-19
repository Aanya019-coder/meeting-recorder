/**
 * google-drive.js
 * Cloud synchronization engine for Google Drive.
 * Uploads structured Minutes of Meeting (MOM) and complete transcripts
 * to a dedicated "Precedent Meeting Notes" folder in the client's Google Drive.
 * Uses the restricted drive.file scope (only manages files created by Precedent).
 */
(function (global) {
  const DRIVE_FOLDER_NAME = 'Precedent Meeting Notes';
  const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API_URL = 'https://www.googleapis.com/upload/drive/v3';
  const SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  // Helper to get storage
  function getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }

  function setStorage(obj) {
    return new Promise((resolve) => {
      chrome.storage.local.set(obj, () => resolve(true));
    });
  }

  /**
   * Retrieves or initiates an OAuth2 token for Google Drive.
   */
  async function getToken(interactive = true) {
    const data = await getStorage(['googleDriveToken', 'googleDriveExpiry', 'googleClientId']);
    const now = Date.now();

    if (data.googleDriveToken && data.googleDriveExpiry && data.googleDriveExpiry > now + 60000) {
      return data.googleDriveToken;
    }

    // Try chrome.identity.getAuthToken first if manifest has oauth2
    try {
      if (chrome.identity && chrome.identity.getAuthToken) {
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive }, (t) => {
            if (chrome.runtime.lastError || !t) {
              reject(chrome.runtime.lastError || new Error('No token'));
            } else {
              resolve(t);
            }
          });
        });
        if (token) {
          await setStorage({
            googleDriveToken: token,
            googleDriveExpiry: now + 3600 * 1000
          });
          return token;
        }
      }
    } catch (e) {
      // Fall through to launchWebAuthFlow
    }

    if (!interactive) return null;

    // Use launchWebAuthFlow for custom Client ID or standalone extension installs
    const clientId = data.googleClientId || '467618995574-e8p386q6h38b55h3o91444qg8f8s4m2d.apps.googleusercontent.com';
    const redirectUrl = chrome.identity ? chrome.identity.getRedirectURL() : 'https://' + chrome.runtime.id + '.chromiumapp.org/';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUrl)}&scope=${encodeURIComponent(SCOPES.join(' '))}&prompt=select_account`;

    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, async (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(chrome.runtime.lastError || new Error('Authorization cancelled'));
          return;
        }

        const match = responseUrl.match(/access_token=([^&]+)/);
        const expiresInMatch = responseUrl.match(/expires_in=([^&]+)/);
        if (match && match[1]) {
          const accessToken = match[1];
          const expiresIn = expiresInMatch ? parseInt(expiresInMatch[1], 10) : 3600;
          await setStorage({
            googleDriveToken: accessToken,
            googleDriveExpiry: now + expiresIn * 1000
          });
          // Fetch and store user info
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (userRes.ok) {
              const userInfo = await userRes.json();
              await setStorage({ googleDriveUser: userInfo.email || userInfo.name });
            }
          } catch (err) {
            // non-fatal
          }
          resolve(accessToken);
        } else {
          reject(new Error('Failed to parse access token from Google response'));
        }
      });
    });
  }

  async function getStatus() {
    const data = await getStorage(['googleDriveToken', 'googleDriveExpiry', 'googleDriveUser']);
    const now = Date.now();
    const isConnected = !!(data.googleDriveToken && data.googleDriveExpiry && data.googleDriveExpiry > now);
    return {
      connected: isConnected,
      user: isConnected ? (data.googleDriveUser || 'Connected Google Account') : null
    };
  }

  async function disconnect() {
    const data = await getStorage(['googleDriveToken']);
    if (data.googleDriveToken) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${data.googleDriveToken}`, { method: 'POST' });
      } catch (e) {
        // ignore
      }
    }
    await setStorage({
      googleDriveToken: null,
      googleDriveExpiry: null,
      googleDriveUser: null,
      googleDriveFolderId: null
    });
    return { ok: true };
  }

  /**
   * Finds or creates the "Precedent Meeting Notes" folder in user's Drive.
   */
  async function getOrCreateNotesFolder(token) {
    const data = await getStorage(['googleDriveFolderId']);
    if (data.googleDriveFolderId) {
      // Validate folder still exists
      const check = await fetch(`${DRIVE_API_URL}/files/${data.googleDriveFolderId}?fields=id,trashed`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (check.ok) {
        const json = await check.json();
        if (!json.trashed) return data.googleDriveFolderId;
      }
    }

    // Search for existing folder
    const q = `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const searchRes = await fetch(`${DRIVE_API_URL}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        const folderId = searchData.files[0].id;
        await setStorage({ googleDriveFolderId: folderId });
        return folderId;
      }
    }

    // Create folder
    const createRes = await fetch(`${DRIVE_API_URL}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });

    if (!createRes.ok) {
      throw new Error(`Failed to create Google Drive folder: ${createRes.statusText}`);
    }

    const created = await createRes.json();
    await setStorage({ googleDriveFolderId: created.id });
    return created.id;
  }

  /**
   * Uploads a file via multipart request.
   */
  async function uploadFile(token, { name, mimeType, content, folderId }) {
    const metadata = {
      name,
      mimeType,
      parents: folderId ? [folderId] : []
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n\r\n` +
      content +
      closeDelimiter;

    const res = await fetch(`${UPLOAD_API_URL}/files?uploadType=multipart&fields=id,name,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Upload failed (${res.status}): ${errText}`);
    }

    return res.json();
  }

  /**
   * Main sync function: uploads MOM and optional raw transcript to Google Drive.
   */
  async function syncMeetingToDrive({ meetingTitle, startTime, markdownMOM, rawTranscript }) {
    const token = await getToken(true);
    if (!token) throw new Error('Not connected to Google Drive');

    const folderId = await getOrCreateNotesFolder(token);
    const dateStr = new Date(startTime || Date.now()).toISOString().split('T')[0];
    const safeTitle = (meetingTitle || 'Meeting').replace(/[/\\?%*:|"<>]/g, '-').trim();

    // 1. Upload MOM Markdown
    const momFileName = `${safeTitle} - ${dateStr} (MOM).md`;
    const momResult = await uploadFile(token, {
      name: momFileName,
      mimeType: 'text/markdown',
      content: markdownMOM,
      folderId
    });

    let transcriptResult = null;
    // 2. Upload Transcript if present
    if (rawTranscript && rawTranscript.length > 0) {
      const transcriptFileName = `${safeTitle} - ${dateStr} (Transcript).txt`;
      transcriptResult = await uploadFile(token, {
        name: transcriptFileName,
        mimeType: 'text/plain',
        content: rawTranscript,
        folderId
      });
    }

    return {
      ok: true,
      fileId: momResult.id,
      fileName: momResult.name,
      webViewLink: momResult.webViewLink || `https://drive.google.com/file/d/${momResult.id}/view`,
      transcriptFileId: transcriptResult ? transcriptResult.id : null
    };
  }

  const GoogleDrive = {
    getToken,
    getStatus,
    disconnect,
    syncMeetingToDrive
  };

  global.Precedent = global.Precedent || {};
  global.Precedent.GoogleDrive = GoogleDrive;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoogleDrive;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
