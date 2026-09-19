/**
 * Precedent Landing Page Interactive Logic
 * Live simulator, Tab switcher, Copy-to-clipboard, Preset phrases
 */

document.addEventListener('DOMContentLoaded', () => {
  // -------------------------------------------------------------
  // 1. Interactive Demo Simulator
  // -------------------------------------------------------------
  const speakerInput = document.getElementById('demo-speaker');
  const textInput = document.getElementById('demo-text');
  const analyzeBtn = document.getElementById('demo-analyze-btn');
  const presetChips = document.querySelectorAll('.preset-chip');

  const commitmentBadge = document.getElementById('commitment-badge');
  const commitmentTask = document.getElementById('commitment-task');
  const commitmentOwner = document.getElementById('commitment-owner');
  const commitmentDue = document.getElementById('commitment-due');
  const commitmentConf = document.getElementById('commitment-confidence');

  const dejavuBadge = document.getElementById('dejavu-badge');
  const dejavuText = document.getElementById('dejavu-text');
  const dejavuScore = document.getElementById('dejavu-score');
  const dejavuDate = document.getElementById('dejavu-date');
  const dejavuAttendees = document.getElementById('dejavu-attendees');

  const simBanner = document.getElementById('simulated-banner');
  const simIcon = document.getElementById('sim-icon');
  const simTitle = document.getElementById('sim-title');
  const simDesc = document.getElementById('sim-desc');

  // Past decisions knowledge base for simulator
  const PAST_DECISIONS = [
    { text: 'Settled on PostgreSQL instead of DynamoDB for v1', keywords: ['postgresql', 'dynamodb', 'database', 'sql'], date: '14 days ago', attendees: 'Priya, Alex' },
    { text: 'Postpone marketing launch until after enterprise SSO rollout', keywords: ['marketing', 'launch', 'postpone', 'tiers'], date: '8 days ago', attendees: 'Jordan, Alex' },
    { text: 'All mobile mockups must use high-contrast color palette', keywords: ['figma', 'mobile', 'mockups', 'palette'], date: '3 weeks ago', attendees: 'David, Sarah' }
  ];

  function parseRelativeDate(text) {
    const lower = text.toLowerCase();
    if (lower.includes('by friday') || lower.includes('this friday')) return 'this coming friday';
    if (lower.includes('by monday') || lower.includes('this monday')) return 'this coming monday';
    if (lower.includes('eod tomorrow') || lower.includes('end of day tomorrow')) return 'tomorrow at 5:00 PM';
    if (lower.includes('by eod') || lower.includes('end of day')) return 'today at 5:00 PM';
    if (lower.includes('tomorrow')) return 'tomorrow';
    if (lower.includes('next week')) return 'next week';
    if (lower.includes('next month')) return 'next month';
    return null;
  }

  function analyzePhrase() {
    const speaker = (speakerInput.value || 'Someone').trim();
    const rawText = (textInput.value || '').trim();
    const text = rawText.toLowerCase();

    // Check for weak verbs
    const isWeak = /\b(maybe|think|feel|consider|reconsidering|might)\b/i.test(rawText);

    // Commitment Check
    let hasCommitment = false;
    let task = '';
    let owner = speaker;
    let due = parseRelativeDate(text) || 'No explicit date';
    let confidence = 'high';

    if (/\b(i will|i'll|i promise|let me|i'm going to)\s+(.+)/i.test(rawText)) {
      const match = rawText.match(/\b(i will|i'll|i promise|let me|i'm going to)\s+(.+)/i);
      task = match[2];
      hasCommitment = true;
      confidence = isWeak ? 'low' : (due !== 'No explicit date' ? 'high' : 'medium');
    } else if (/\b([A-Z][a-z]+)[,\s]+(can you|could you|please)\s+(.+)/i.test(rawText)) {
      const match = rawText.match(/\b([A-Z][a-z]+)[,\s]+(can you|could you|please)\s+(.+)/i);
      owner = match[1];
      task = match[3];
      hasCommitment = true;
      confidence = 'medium';
    } else if (/\b([A-Z][a-z]+)\s+will\s+(.+)/i.test(rawText)) {
      const match = rawText.match(/\b([A-Z][a-z]+)\s+will\s+(.+)/i);
      owner = match[1];
      task = match[2];
      hasCommitment = true;
      confidence = 'medium';
    }

    // Clean up task text
    if (task) {
      task = task.replace(/\b(by\s+[a-z]+|tomorrow|next\s+week|next\s+month|eod)\b/gi, '').trim().replace(/[.,?!]+$/, '');
    }

    if (hasCommitment && !isWeak) {
      commitmentBadge.textContent = 'Commitment Detected';
      commitmentBadge.className = 'result-badge';
      commitmentTask.textContent = `"${task}"`;
      commitmentOwner.textContent = `Owner: ${owner}`;
      commitmentDue.textContent = `Due: ${due}`;
      commitmentConf.textContent = `Confidence: ${confidence}`;
    } else if (isWeak) {
      commitmentBadge.textContent = 'Weak Verb Ignored';
      commitmentBadge.className = 'result-badge alert';
      commitmentTask.textContent = 'Phrase contains speculative phrasing ("maybe", "think"). Filtered out.';
      commitmentOwner.textContent = `Speaker: ${speaker}`;
      commitmentDue.textContent = 'No commitment created';
      commitmentConf.textContent = 'Filtered by heuristic';
    } else {
      commitmentBadge.textContent = 'No Promise Extracted';
      commitmentBadge.className = 'result-badge';
      commitmentTask.textContent = 'General conversational statement. No direct action promise detected.';
      commitmentOwner.textContent = `Speaker: ${speaker}`;
      commitmentDue.textContent = 'N/A';
      commitmentConf.textContent = 'N/A';
    }

    // Déjà vu Similarity Check
    let bestMatch = null;
    let bestScore = 0;

    for (const past of PAST_DECISIONS) {
      let score = 0;
      for (const kw of past.keywords) {
        if (text.includes(kw)) score += 0.28;
      }
      if (score > bestScore) {
        bestScore = Math.min(score, 0.94);
        bestMatch = past;
      }
    }

    if (bestScore >= 0.45 && bestMatch) {
      dejavuBadge.textContent = 'Déjà Vu Alert';
      dejavuBadge.className = 'result-badge alert';
      dejavuText.textContent = `"${bestMatch.text}"`;
      dejavuScore.textContent = `Similarity: ${(bestScore).toFixed(2)}`;
      dejavuDate.textContent = `Past Meeting: ${bestMatch.date}`;
      dejavuAttendees.textContent = `Overlap: ${bestMatch.attendees}`;
    } else {
      dejavuBadge.textContent = 'No Prior Conflict';
      dejavuBadge.className = 'result-badge';
      dejavuText.textContent = 'No previous settled decision matches this topic.';
      dejavuScore.textContent = 'Similarity: < 0.20';
      dejavuDate.textContent = 'Unique discussion';
      dejavuAttendees.textContent = 'Clear to proceed';
    }

    // Update Simulated Banner
    if (bestScore >= 0.45 && bestMatch) {
      simBanner.className = 'simulated-banner alert-style';
      simIcon.textContent = '⚠️';
      simTitle.textContent = `Déjà Vu Warning: Decision previously settled`;
      simDesc.textContent = `Cited from ${bestMatch.date} (${bestMatch.attendees}): "${bestMatch.text}"`;
    } else if (hasCommitment && !isWeak) {
      simBanner.className = 'simulated-banner';
      simIcon.textContent = '✓';
      simTitle.textContent = `Action item tracked`;
      simDesc.textContent = `${owner}: ${task} (${due})`;
    } else {
      simBanner.className = 'simulated-banner';
      simIcon.textContent = '•';
      simTitle.textContent = `Precedent Listening`;
      simDesc.textContent = `Continuous live captions active on ${speaker}'s voice`;
    }
  }

  // Preset clicks
  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      presetChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      textInput.value = chip.getAttribute('data-phrase');
      speakerInput.value = chip.getAttribute('data-speaker');
      analyzePhrase();
    });
  });

  analyzeBtn.addEventListener('click', analyzePhrase);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') analyzePhrase();
  });

  // Run initial demo analysis
  analyzePhrase();

  // -------------------------------------------------------------
  // 2. Screenshot Tabs Switcher
  // -------------------------------------------------------------
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');

      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const activePanel = document.getElementById(`tab-${target}`);
      if (activePanel) activePanel.classList.add('active');
    });
  });

  // -------------------------------------------------------------
  // 3. Copy-to-Clipboard Buttons
  // -------------------------------------------------------------
  const copyButtons = document.querySelectorAll('.copy-btn');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      if (!textToCopy) return;

      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#2f6b5e';
        btn.style.color = '#fff';

        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
          btn.style.color = '';
        }, 1800);
      } catch (err) {
        console.error('Failed to copy', err);
      }
    });
  });
});
