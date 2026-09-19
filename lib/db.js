/**
 * db.js
 * All extension data lives in IndexedDB inside the background service
 * worker. Nothing here ever leaves the device: no server, no account, no
 * sync. That's a deliberate trade-off (no cross-device access, no team
 * sharing) in exchange for the thing most competitors can't credibly
 * claim: your meeting content never touches a third-party server. Content
 * scripts never open the DB directly; they message the background worker
 * (see service-worker.js), which keeps a single connection and avoids
 * version-upgrade races across multiple open tabs.
 */
(function (global) {
  const DB_NAME = 'precedent-db';
  const DB_VERSION = 2;

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = () => {
        const db = req.result;

        if (!db.objectStoreNames.contains('meetings')) {
          const meetings = db.createObjectStore('meetings', { keyPath: 'id' });
          meetings.createIndex('startTime', 'startTime');
        }

        if (!db.objectStoreNames.contains('commitments')) {
          const commitments = db.createObjectStore('commitments', { keyPath: 'id' });
          commitments.createIndex('meetingId', 'meetingId');
          commitments.createIndex('resolved', 'resolved');
          commitments.createIndex('createdAt', 'createdAt');
        }

        if (!db.objectStoreNames.contains('decisions')) {
          const decisions = db.createObjectStore('decisions', { keyPath: 'id' });
          decisions.createIndex('meetingId', 'meetingId');
          decisions.createIndex('meetingDate', 'meetingDate');
        }

        if (!db.objectStoreNames.contains('transcripts')) {
          const transcripts = db.createObjectStore('transcripts', { keyPath: 'id' });
          transcripts.createIndex('meetingId', 'meetingId');
          transcripts.createIndex('timestamp', 'timestamp');
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeNames, mode) {
    return openDb().then((db) => db.transaction(storeNames, mode));
  }

  function promisifyRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAll(storeName) {
    return tx([storeName], 'readonly').then(
      (t) => promisifyRequest(t.objectStore(storeName).getAll())
    );
  }

  function put(storeName, value) {
    return tx([storeName], 'readwrite').then(
      (t) => promisifyRequest(t.objectStore(storeName).put(value))
    );
  }

  function getByIndex(storeName, indexName, value) {
    return tx([storeName], 'readonly').then(
      (t) => promisifyRequest(t.objectStore(storeName).index(indexName).getAll(value))
    );
  }

  function clearStore(storeName) {
    return tx([storeName], 'readwrite').then(
      (t) => promisifyRequest(t.objectStore(storeName).clear())
    );
  }

  function genId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ---- Public API ----

  function addMeeting(meeting) {
    const record = {
      id: meeting.id || genId(),
      platform: meeting.platform,
      title: meeting.title || 'Untitled meeting',
      startTime: meeting.startTime || Date.now(),
      endTime: meeting.endTime || null,
      attendees: meeting.attendees || []
    };
    return put('meetings', record).then(() => record);
  }

  function updateMeetingEndTime(meetingId, endTime) {
    return openDb()
      .then((db) => db.transaction(['meetings'], 'readwrite'))
      .then((t) => {
        const store = t.objectStore('meetings');
        return promisifyRequest(store.get(meetingId)).then((existing) => {
          if (!existing) return null;
          existing.endTime = endTime;
          return promisifyRequest(store.put(existing));
        });
      });
  }

  function addCommitment(commitment) {
    const record = {
      id: commitment.id || genId(),
      meetingId: commitment.meetingId,
      meetingTitle: commitment.meetingTitle,
      attendees: commitment.attendees || [],
      owner: commitment.owner,
      task: commitment.task,
      dueDate: commitment.dueDate || null,
      dueLabel: commitment.dueLabel || null,
      sourceText: commitment.sourceText || '',
      createdAt: commitment.createdAt || Date.now(),
      resolved: false
    };
    return put('commitments', record).then(() => record);
  }

  function addDecision(decision) {
    const record = {
      id: decision.id || genId(),
      meetingId: decision.meetingId,
      meetingTitle: decision.meetingTitle,
      meetingDate: decision.meetingDate || Date.now(),
      attendees: decision.attendees || [],
      summary: decision.summary,
      sourceText: decision.sourceText || '',
      speaker: decision.speaker || '',
      vector: decision.vector || []
    };
    return put('decisions', record).then(() => record);
  }

  function markCommitmentResolved(commitmentId, resolved) {
    return openDb()
      .then((db) => db.transaction(['commitments'], 'readwrite'))
      .then((t) => {
        const store = t.objectStore('commitments');
        return promisifyRequest(store.get(commitmentId)).then((existing) => {
          if (!existing) return null;
          existing.resolved = !!resolved;
          return promisifyRequest(store.put(existing));
        });
      });
  }

  function appendTranscriptLines(meetingId, lines) {
    if (!meetingId || !lines || lines.length === 0) return Promise.resolve([]);
    return tx(['transcripts'], 'readwrite').then((t) => {
      const store = t.objectStore('transcripts');
      const records = lines.map((l) => ({
        id: l.id || `${meetingId}-t-${l.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        meetingId,
        speaker: l.speaker || 'Unknown speaker',
        text: l.text || '',
        timestamp: l.timestamp || Date.now()
      }));
      return Promise.all(records.map((r) => promisifyRequest(store.put(r)))).then(() => records);
    });
  }

  function getTranscript(meetingId) {
    if (!meetingId) return Promise.resolve([]);
    return getByIndex('transcripts', 'meetingId', meetingId).then((lines) => {
      lines.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      return lines;
    });
  }

  function getOpenCommitments() {
    return getAll('commitments').then((all) => all.filter((c) => !c.resolved));
  }

  function getAllDecisions() {
    return getAll('decisions');
  }

  function getAllMeetings() {
    return getAll('meetings');
  }

  function exportAllData() {
    return Promise.all([getAllMeetings(), getAll('commitments'), getAllDecisions(), getAll('transcripts')]).then(
      ([meetings, commitments, decisions, transcripts]) => ({
        exportedAt: new Date().toISOString(),
        meetings,
        commitments,
        decisions,
        transcripts
      })
    );
  }

  function clearAllData() {
    return Promise.all([clearStore('meetings'), clearStore('commitments'), clearStore('decisions'), clearStore('transcripts')]);
  }

  function pruneOlderThan(retentionDays) {
    if (!retentionDays || retentionDays <= 0) return Promise.resolve();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    return Promise.all([getAllMeetings(), getAll('commitments'), getAllDecisions(), getAll('transcripts')]).then(
      ([meetings, commitments, decisions, transcripts]) => {
        const staleMeetingIds = new Set(
          meetings.filter((m) => m.startTime < cutoff).map((m) => m.id)
        );
        const ops = [];
        for (const m of meetings) {
          if (staleMeetingIds.has(m.id)) {
            ops.push(tx(['meetings'], 'readwrite').then((t) => promisifyRequest(t.objectStore('meetings').delete(m.id))));
          }
        }
        for (const c of commitments) {
          if (staleMeetingIds.has(c.meetingId) && c.resolved) {
            ops.push(tx(['commitments'], 'readwrite').then((t) => promisifyRequest(t.objectStore('commitments').delete(c.id))));
          }
        }
        for (const d of decisions) {
          if (d.meetingDate < cutoff) {
            ops.push(tx(['decisions'], 'readwrite').then((t) => promisifyRequest(t.objectStore('decisions').delete(d.id))));
          }
        }
        for (const tr of transcripts) {
          if (staleMeetingIds.has(tr.meetingId)) {
            ops.push(tx(['transcripts'], 'readwrite').then((t) => promisifyRequest(t.objectStore('transcripts').delete(tr.id))));
          }
        }
        return Promise.all(ops);
      }
    );
  }

  function deleteMeetingData(meetingId) {
    if (!meetingId) return Promise.resolve();
    return Promise.all([
      tx(['meetings'], 'readwrite').then((t) => promisifyRequest(t.objectStore('meetings').delete(meetingId))),
      getByIndex('commitments', 'meetingId', meetingId).then((comms) =>
        Promise.all(comms.map((c) => tx(['commitments'], 'readwrite').then((t) => promisifyRequest(t.objectStore('commitments').delete(c.id)))))
      ),
      getByIndex('decisions', 'meetingId', meetingId).then((decs) =>
        Promise.all(decs.map((d) => tx(['decisions'], 'readwrite').then((t) => promisifyRequest(t.objectStore('decisions').delete(d.id)))))
      ),
      getByIndex('transcripts', 'meetingId', meetingId).then((trs) =>
        Promise.all(trs.map((tr) => tx(['transcripts'], 'readwrite').then((t) => promisifyRequest(t.objectStore('transcripts').delete(tr.id)))))
      )
    ]);
  }

  const PrecedentDB = {
    addMeeting,
    updateMeetingEndTime,
    addCommitment,
    addDecision,
    markCommitmentResolved,
    getOpenCommitments,
    getAllDecisions,
    getAllMeetings,
    appendTranscriptLines,
    getTranscript,
    deleteMeetingData,
    exportAllData,
    clearAllData,
    pruneOlderThan
  };

  global.Precedent = global.Precedent || {};
  global.Precedent.DB = PrecedentDB;
})(typeof self !== 'undefined' ? self : this);
