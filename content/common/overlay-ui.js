/**
 * overlay-ui.js
 * Renders the in-meeting UI inside a closed shadow root so the host page's
 * CSS can't bleed in (and vice versa) — important on platforms as
 * style-aggressive as Meet/Zoom/Teams. Design: a small collapsed pill by
 * default (name + status dot), expanding into a panel only when there's
 * something worth showing or the user clicks it. Deliberately quiet —
 * this sits on top of a video call, so it should earn attention, not
 * demand it.
 */
(function (global) {
  const WORDMARK = 'Precedent';

  function injectStyles(root) {
    const link = document.createElement('style');
    link.textContent = OVERLAY_CSS;
    root.appendChild(link);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatDate(d) {
    if (!d) return null;
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function createOverlay() {
    const host = document.createElement('div');
    host.id = 'precedent-overlay-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    injectStyles(shadow);

    const root = el('div', 'pc-root pc-collapsed');
    shadow.appendChild(root);

    const pill = el('button', 'pc-pill');
    pill.setAttribute('aria-label', 'Open Precedent panel');
    const dot = el('span', 'pc-dot');
    const pillLabel = el('span', 'pc-pill-label', WORDMARK);
    const badge = el('span', 'pc-badge');
    badge.style.display = 'none';
    pill.appendChild(dot);
    pill.appendChild(pillLabel);
    pill.appendChild(badge);
    root.appendChild(pill);

    const panel = el('div', 'pc-panel');
    panel.style.display = 'none';
    root.appendChild(panel);

    const header = el('div', 'pc-header');
    const title = el('span', 'pc-title', WORDMARK);
    const headerRight = el('div', 'pc-header-right');
    const wrapUpBtn = el('button', 'pc-header-btn', 'Wrap up');
    wrapUpBtn.style.display = 'none';
    const closeBtn = el('button', 'pc-close', '\u2715');
    closeBtn.setAttribute('aria-label', 'Collapse panel');
    header.appendChild(title);
    headerRight.appendChild(wrapUpBtn);
    headerRight.appendChild(closeBtn);
    header.appendChild(headerRight);
    panel.appendChild(header);

    const body = el('div', 'pc-body');
    panel.appendChild(body);

    let expanded = false;
    let unseenCount = 0;
    let currentPrimer = null;
    let liveCommitments = [];
    let liveDecisions = [];
    let onWrapUpCallback = null;

    function setExpanded(next) {
      expanded = next;
      panel.style.display = expanded ? 'block' : 'none';
      root.classList.toggle('pc-collapsed', !expanded);
      if (expanded) {
        unseenCount = 0;
        badge.style.display = 'none';
        renderMainView();
      }
    }

    pill.addEventListener('click', () => setExpanded(true));
    closeBtn.addEventListener('click', () => setExpanded(false));
    wrapUpBtn.addEventListener('click', () => {
      if (onWrapUpCallback) onWrapUpCallback();
    });

    function bumpBadge() {
      if (expanded) return;
      unseenCount += 1;
      badge.textContent = String(unseenCount);
      badge.style.display = 'inline-flex';
    }

    function setStatus(status) {
      // status: 'idle' | 'listening' | 'no-captions'
      dot.className = 'pc-dot pc-dot-' + status;
      const labels = {
        idle: WORDMARK,
        listening: WORDMARK,
        'no-captions': WORDMARK + ' \u00B7 turn on captions'
      };
      pillLabel.textContent = labels[status] || WORDMARK;
    }

    function clearBody() {
      body.innerHTML = '';
    }

    function renderMainView() {
      clearBody();
      const hasLive = liveCommitments.length > 0 || liveDecisions.length > 0;
      wrapUpBtn.style.display = hasLive ? 'inline-block' : 'none';

      // Section 1: Live Captured Items in this meeting
      const liveSection = el('div', 'pc-section');
      liveSection.appendChild(el('div', 'pc-section-title', 'Captured this meeting'));

      if (!hasLive) {
        liveSection.appendChild(el('div', 'pc-empty', 'Listening for commitments & decisions...'));
      } else {
        if (liveCommitments.length > 0) {
          const group = el('div', 'pc-group');
          group.appendChild(el('div', 'pc-group-label', `New commitments (${liveCommitments.length})`));
          for (const c of liveCommitments) {
            const item = el('div', 'pc-item');
            item.appendChild(el('div', 'pc-item-main', `${c.owner}: ${c.task}`));
            item.appendChild(el('div', 'pc-item-meta', c.dueLabel ? `Due ${c.dueLabel}` : 'No due date detected'));
            group.appendChild(item);
          }
          liveSection.appendChild(group);
        }
        if (liveDecisions.length > 0) {
          const group = el('div', 'pc-group');
          group.appendChild(el('div', 'pc-group-label', `New decisions (${liveDecisions.length})`));
          for (const d of liveDecisions) {
            const item = el('div', 'pc-item');
            item.appendChild(el('div', 'pc-item-main', d.summary));
            group.appendChild(item);
          }
          liveSection.appendChild(group);
        }

        const wrapUpBar = el('div', 'pc-actions');
        const saveNowBtn = el('button', 'pc-btn pc-btn-primary', 'Save & Wrap Up');
        saveNowBtn.addEventListener('click', () => {
          if (onWrapUpCallback) onWrapUpCallback();
        });
        wrapUpBar.appendChild(saveNowBtn);
        liveSection.appendChild(wrapUpBar);
      }
      body.appendChild(liveSection);

      // Section 2: Before you start primer
      if (currentPrimer) {
        const { openCommitments, relatedDecisions } = currentPrimer;
        const primerSection = el('div', 'pc-section');
        primerSection.style.marginTop = '14px';
        primerSection.appendChild(el('div', 'pc-section-title', 'Before you start'));

        if ((!openCommitments || openCommitments.length === 0) && (!relatedDecisions || relatedDecisions.length === 0)) {
          primerSection.appendChild(el('div', 'pc-empty', 'No open past items with this group. Clean slate.'));
        } else {
          if (openCommitments && openCommitments.length > 0) {
            const group = el('div', 'pc-group');
            group.appendChild(el('div', 'pc-group-label', `Open commitments from past calls (${openCommitments.length})`));
            for (const c of openCommitments.slice(0, 5)) {
              const item = el('div', 'pc-item');
              const dueStr = formatDate(c.dueDate) || c.dueLabel;
              item.appendChild(el('div', 'pc-item-main', `${c.owner}: ${c.task}`));
              item.appendChild(el('div', 'pc-item-meta', dueStr ? `Due ${dueStr} \u00B7 ${c.meetingTitle || 'past meeting'}` : `From ${c.meetingTitle || 'past meeting'}`));
              group.appendChild(item);
            }
            primerSection.appendChild(group);
          }

          if (relatedDecisions && relatedDecisions.length > 0) {
            const group = el('div', 'pc-group');
            group.appendChild(el('div', 'pc-group-label', `Related past decisions (${relatedDecisions.length})`));
            for (const d of relatedDecisions.slice(0, 5)) {
              const item = el('div', 'pc-item');
              item.appendChild(el('div', 'pc-item-main', d.summary));
              item.appendChild(el('div', 'pc-item-meta', `${formatDate(d.meetingDate) || ''} \u00B7 ${d.meetingTitle || 'past meeting'}`));
              group.appendChild(item);
            }
            primerSection.appendChild(group);
          }
        }
        body.appendChild(primerSection);
      }
    }

    function renderPrimer({ openCommitments, relatedDecisions, attendees }) {
      currentPrimer = { openCommitments, relatedDecisions, attendees };
      renderMainView();
      bumpBadge();
    }

    function updateLiveItems({ commitments, decisions }) {
      liveCommitments = commitments || [];
      liveDecisions = decisions || [];
      bumpBadge();
      if (expanded) {
        renderMainView();
      }
    }

    function showDejaVuToast(match) {
      const toast = el('div', 'pc-toast pc-toast-dejavu');
      toast.appendChild(el('div', 'pc-toast-title', 'You may have already decided this'));
      toast.appendChild(el('div', 'pc-toast-body', match.decision.summary));
      toast.appendChild(el('div', 'pc-toast-meta', `${formatDate(match.decision.meetingDate) || ''} \u00B7 ${match.decision.meetingTitle || 'past meeting'} \u00B7 ${Math.round(match.similarity * 100)}% similar`));
      const dismiss = el('button', 'pc-toast-dismiss', 'Dismiss');
      dismiss.addEventListener('click', () => toast.remove());
      toast.appendChild(dismiss);
      root.appendChild(toast);
      bumpBadge();
      setTimeout(() => toast.remove(), 20000);
    }

    function renderEndSummary(
      { newCommitments = [], newDecisions = [], transcript = [], meetingTitle = 'Meeting', attendees = [] },
      { onConfirm, onDiscard }
    ) {
      clearBody();
      setExpanded(true);
      wrapUpBtn.style.display = 'none';

      const section = el('div', 'pc-section');
      section.appendChild(el('div', 'pc-section-title', 'Meeting wrap-up & MOM'));
      section.appendChild(
        el(
          'div',
          'pc-empty',
          `Captured ${newCommitments.length} promise${newCommitments.length === 1 ? '' : 's'}, ${newDecisions.length} decision${newDecisions.length === 1 ? '' : 's'}, and ${transcript.length} caption lines.`
        )
      );

      if (newCommitments.length > 0) {
        const group = el('div', 'pc-group');
        group.appendChild(el('div', 'pc-group-label', 'New commitments'));
        for (const c of newCommitments) {
          const item = el('div', 'pc-item');
          item.appendChild(el('div', 'pc-item-main', `${c.owner}: ${c.task}`));
          item.appendChild(el('div', 'pc-item-meta', c.dueLabel ? `Due ${c.dueLabel}` : 'No due date detected'));
          group.appendChild(item);
        }
        section.appendChild(group);
      }

      if (newDecisions.length > 0) {
        const group = el('div', 'pc-group');
        group.appendChild(el('div', 'pc-group-label', 'New decisions'));
        for (const d of newDecisions) {
          const item = el('div', 'pc-item');
          item.appendChild(el('div', 'pc-item-main', d.summary));
          group.appendChild(item);
        }
        section.appendChild(group);
      }

      const actions = el('div', 'pc-actions');
      actions.style.display = 'flex';
      actions.style.flexWrap = 'wrap';
      actions.style.gap = '6px';

      const copyMomBtn = el('button', 'pc-btn pc-btn-ghost', '📋 Copy MOM');
      copyMomBtn.addEventListener('click', () => {
        const MOMGen = (global.Precedent && global.Precedent.MOMGenerator);
        if (MOMGen) {
          const md = MOMGen.toMarkdown({
            title: meetingTitle,
            startTime: Date.now(),
            platform: 'call',
            attendees,
            commitments: newCommitments,
            decisions: newDecisions,
            transcript
          });
          navigator.clipboard.writeText(md).then(() => {
            copyMomBtn.textContent = '✓ Copied MOM!';
            setTimeout(() => { copyMomBtn.textContent = '📋 Copy MOM'; }, 2000);
          });
        }
      });

      const discardBtn = el('button', 'pc-btn pc-btn-ghost', 'Discard');
      const keepBtn = el('button', 'pc-btn pc-btn-primary', 'Save & Sync');

      keepBtn.addEventListener('click', () => {
        keepBtn.textContent = 'Saving…';
        keepBtn.disabled = true;
        discardBtn.style.display = 'none';
        if (onConfirm) onConfirm();
        setTimeout(() => setExpanded(false), 1800);
      });

      discardBtn.addEventListener('click', () => {
        if (onDiscard) onDiscard();
        setExpanded(false);
      });

      actions.appendChild(copyMomBtn);
      actions.appendChild(discardBtn);
      actions.appendChild(keepBtn);
      section.appendChild(actions);

      body.appendChild(section);
    }

    function showSavedConfirmation(syncInfo) {
      const toast = el('div', 'pc-toast');
      toast.style.borderColor = '#2F6B5E';
      toast.appendChild(el('div', 'pc-toast-title', '✓ Saved successfully'));
      let msg = 'Meeting items and transcript recorded.';
      if (syncInfo && syncInfo.webViewLink) {
        msg = 'Saved to device and synced to Google Drive!';
      }
      toast.appendChild(el('div', 'pc-toast-body', msg));
      root.appendChild(toast);
      setTimeout(() => toast.remove(), 4500);
    }

    document.documentElement.appendChild(host);
    setStatus('idle');

    return {
      setStatus,
      renderPrimer,
      updateLiveItems,
      showDejaVuToast,
      renderEndSummary,
      showSavedConfirmation,
      setOnWrapUp: (cb) => { onWrapUpCallback = cb; },
      expand: () => setExpanded(true),
      collapse: () => setExpanded(false)
    };
  }

  const OVERLAY_CSS = `
    :host { all: initial; }
    .pc-root {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483000;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }
    .pc-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #14181F;
      color: #EFEAE0;
      border: 1px solid rgba(239,234,224,0.14);
      border-radius: 999px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.28);
    }
    .pc-dot { width: 8px; height: 8px; border-radius: 50%; background: #7A8195; }
    .pc-dot-listening { background: #4E9B84; box-shadow: 0 0 0 3px rgba(78,155,132,0.25); }
    .pc-dot-no-captions { background: #C08A2E; }
    .pc-badge {
      background: #C08A2E;
      color: #14181F;
      font-size: 11px;
      font-weight: 700;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }
    .pc-panel {
      width: 320px;
      max-height: 60vh;
      overflow-y: auto;
      background: #14181F;
      color: #EFEAE0;
      border: 1px solid rgba(239,234,224,0.14);
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.4);
    }
    .pc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(239,234,224,0.1);
    }
    .pc-title { font-family: Georgia, "Iowan Old Style", serif; font-size: 15px; }
    .pc-header-right { display: flex; align-items: center; gap: 8px; }
    .pc-header-btn {
      background: #2F6B5E;
      color: #EFEAE0;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }
    .pc-header-btn:hover { background: #3d8676; }
    .pc-close {
      background: transparent;
      border: none;
      color: #9AA0AE;
      cursor: pointer;
      font-size: 13px;
      padding: 4px;
    }
    .pc-body { padding: 12px 14px 14px; }
    .pc-section-title { font-size: 12px; text-transform: none; color: #9AA0AE; margin-bottom: 8px; }
    .pc-empty { font-size: 13px; color: #C7CBD6; line-height: 1.5; }
    .pc-group { margin-top: 12px; }
    .pc-group-label { font-size: 11px; color: #6F92BC; font-weight: 600; margin-bottom: 6px; }
    .pc-item {
      background: rgba(239,234,224,0.05);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 6px;
    }
    .pc-item-main { font-size: 13px; line-height: 1.4; }
    .pc-item-meta { font-size: 11px; color: #9AA0AE; margin-top: 3px; }
    .pc-toast {
      width: 300px;
      background: #241C10;
      border: 1px solid rgba(192,138,46,0.4);
      border-radius: 12px;
      padding: 12px 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.4);
      color: #F0E6D2;
    }
    .pc-toast-title { font-size: 12px; font-weight: 700; color: #E0AC4E; margin-bottom: 4px; }
    .pc-toast-body { font-size: 13px; line-height: 1.4; margin-bottom: 4px; }
    .pc-toast-meta { font-size: 11px; color: #C4AE84; margin-bottom: 8px; }
    .pc-toast-dismiss {
      background: transparent;
      border: 1px solid rgba(240,230,210,0.25);
      color: #F0E6D2;
      border-radius: 6px;
      font-size: 11px;
      padding: 4px 8px;
      cursor: pointer;
    }
    .pc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .pc-btn { border-radius: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; border: 1px solid transparent; }
    .pc-btn-primary { background: #2F6B5E; color: #EFEAE0; }
    .pc-btn-ghost { background: transparent; color: #9AA0AE; border-color: rgba(239,234,224,0.16); }
  `;

  global.Precedent = global.Precedent || {};
  global.Precedent.createOverlay = createOverlay;
})(typeof window !== 'undefined' ? window : this);
