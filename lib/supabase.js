/**
 * supabase.js
 * Lightweight, dependency-free Supabase Auth client for Manifest V3 Chrome Extension.
 * Handles Sign Up, Password Login, Passwordless Magic Link, Token Refresh, and Session Storage.
 */
(function (global) {
  const DEFAULT_URL = 'https://dnwttcvuzohljotzgozn.supabase.co';
  const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRud3R0Y3Z1em9obGpvdHpnb3puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3OTgzNzYsImV4cCI6MjEwNTM3NDM3Nn0.GvHH3OUF7OHZ2yQE7DISSPQ_6Zi1tDvC_bUZuVpHhS4';

  function getStorage(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } else {
        resolve({});
      }
    });
  }

  function setStorage(obj) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(obj, () => resolve(true));
      } else {
        resolve(true);
      }
    });
  }

  async function getConfig() {
    const data = await getStorage(['supabaseUrl', 'supabaseAnonKey']);
    return {
      url: (data.supabaseUrl || DEFAULT_URL).trim().replace(/\/+$/, ''),
      anonKey: (data.supabaseAnonKey || DEFAULT_ANON_KEY).trim()
    };
  }

  async function saveConfig({ url, anonKey }) {
    await setStorage({
      supabaseUrl: (url || '').trim().replace(/\/+$/, ''),
      supabaseAnonKey: (anonKey || '').trim()
    });
    return { ok: true };
  }

  function getHeaders(anonKey, accessToken) {
    const h = {
      'Content-Type': 'application/json',
      apikey: anonKey
    };
    if (accessToken) {
      h.Authorization = `Bearer ${accessToken}`;
    }
    return h;
  }

  async function saveSession(data) {
    if (!data || !data.access_token) return null;
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: data.user || null
    };
    await setStorage({ supabaseSession: session });
    return session;
  }

  async function getSession() {
    const { supabaseSession } = await getStorage(['supabaseSession']);
    if (!supabaseSession) return null;

    // Check if token expired and needs refresh
    if (supabaseSession.expires_at && Date.now() > supabaseSession.expires_at - 60000) {
      if (supabaseSession.refresh_token) {
        const refreshed = await refreshSession(supabaseSession.refresh_token);
        if (refreshed) return refreshed;
      }
      return null;
    }
    return supabaseSession;
  }

  async function refreshSession(refreshToken) {
    const { url, anonKey } = await getConfig();
    if (!url || !anonKey) return null;

    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: getHeaders(anonKey),
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return await saveSession(data);
    } catch (e) {
      return null;
    }
  }

  async function signUp({ email, password }) {
    const { url, anonKey } = await getConfig();
    if (!url || !anonKey) {
      return { ok: false, error: 'Supabase URL and Anon Key are not configured in Settings.' };
    }

    try {
      const res = await fetch(`${url}/auth/v1/signup`, {
        method: 'POST',
        headers: getHeaders(anonKey),
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error_description || data.msg || data.message || 'Sign up failed' };
      }
      if (data.access_token) {
        await saveSession(data);
      }
      return { ok: true, user: data.user || data, session: data.access_token ? data : null };
    } catch (err) {
      return { ok: false, error: err.message || 'Network error during sign up' };
    }
  }

  async function signInWithPassword({ email, password }) {
    const { url, anonKey } = await getConfig();
    if (!url || !anonKey) {
      return { ok: false, error: 'Supabase URL and Anon Key are not configured in Settings.' };
    }

    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: getHeaders(anonKey),
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error_description || data.msg || data.message || 'Invalid login credentials' };
      }
      const session = await saveSession(data);
      return { ok: true, user: data.user, session };
    } catch (err) {
      return { ok: false, error: err.message || 'Network error during login' };
    }
  }

  async function signInWithOtp({ email }) {
    const { url, anonKey } = await getConfig();
    if (!url || !anonKey) {
      return { ok: false, error: 'Supabase URL and Anon Key are not configured in Settings.' };
    }

    try {
      const res = await fetch(`${url}/auth/v1/otp`, {
        method: 'POST',
        headers: getHeaders(anonKey),
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error_description || data.msg || data.message || 'Failed to send OTP' };
      }
      return { ok: true, message: 'Check your email for the login link!' };
    } catch (err) {
      return { ok: false, error: err.message || 'Network error during OTP request' };
    }
  }

  async function signOut() {
    const { url, anonKey } = await getConfig();
    const session = await getSession();

    if (url && anonKey && session && session.access_token) {
      try {
        await fetch(`${url}/auth/v1/logout`, {
          method: 'POST',
          headers: getHeaders(anonKey, session.access_token)
        });
      } catch (e) {
        // ignore
      }
    }

    await setStorage({ supabaseSession: null });
    return { ok: true };
  }

  async function getUser() {
    const session = await getSession();
    return session ? session.user : null;
  }

  const Supabase = {
    getConfig,
    saveConfig,
    signUp,
    signInWithPassword,
    signInWithOtp,
    signOut,
    getSession,
    getUser
  };

  global.Precedent = global.Precedent || {};
  global.Precedent.Supabase = Supabase;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Supabase;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
