/**
 * mom-generator.js
 * Generates structured Minutes of Meeting (MOM) from meeting metadata,
 * extracted decisions, commitments, attendee rosters, and live transcript logs.
 * Supports Markdown, Plain Text (Slack/Email), and HTML formats.
 * Works 100% locally and offline.
 */
(function (global) {
  function formatDate(ts) {
    if (!ts) return 'N/A';
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function formatDuration(startTs, endTs) {
    if (!startTs) return 'N/A';
    const end = endTs || Date.now();
    const diffMs = Math.max(0, end - startTs);
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'}`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs} hr${hrs === 1 ? '' : 's'} ${remMins} min${remMins === 1 ? '' : 's'}`;
  }

  /**
   * Generates a concise offline executive summary from decisions, commitments, and topics.
   */
  function generateExecutiveSummary(data) {
    const commitments = data.commitments || [];
    const decisions = data.decisions || [];
    const attendees = data.attendees || [];
    const transcript = data.transcript || [];

    const lines = [];
    if (attendees.length > 0) {
      lines.push(`Meeting convened with ${attendees.length} participant${attendees.length === 1 ? '' : 's'} (${attendees.join(', ')}).`);
    }

    if (decisions.length > 0 && commitments.length > 0) {
      lines.push(`The group resolved ${decisions.length} key decision${decisions.length === 1 ? '' : 's'} and established ${commitments.length} action item${commitments.length === 1 ? '' : 's'}.`);
    } else if (decisions.length > 0) {
      lines.push(`The discussion focused on establishing ${decisions.length} key decision${decisions.length === 1 ? '' : 's'}.`);
    } else if (commitments.length > 0) {
      lines.push(`The session primarily focused on assigning ${commitments.length} action item${commitments.length === 1 ? '' : 's'} and deliverables.`);
    } else if (transcript.length > 0) {
      lines.push(`Discussion was held across ${transcript.length} spoken interaction points.`);
    } else {
      lines.push('A sync session was conducted with no pending action items logged.');
    }

    return lines.join(' ');
  }

  /**
   * Formats the meeting record into clean, professional Markdown.
   */
  function toMarkdown(data) {
    const title = data.title || 'Untitled Meeting';
    const dateStr = formatDate(data.startTime);
    const timeStr = formatTime(data.startTime);
    const durationStr = formatDuration(data.startTime, data.endTime);
    const platform = (data.platform || 'Call').toUpperCase();
    const attendees = (data.attendees && data.attendees.length > 0) ? data.attendees.join(', ') : 'Not recorded';
    const commitments = data.commitments || [];
    const decisions = data.decisions || [];
    const transcript = data.transcript || [];
    const execSummary = data.summary || generateExecutiveSummary(data);

    let md = `# Minutes of Meeting: ${title}\n\n`;

    // Metadata Table
    md += '| Field | Details |\n';
    md += '| :--- | :--- |\n';
    md += `| **Date & Time** | ${dateStr} at ${timeStr} |\n`;
    md += `| **Duration** | ${durationStr} |\n`;
    md += `| **Platform** | ${platform} |\n`;
    md += `| **Attendees** | ${attendees} |\n\n`;

    // Executive Summary
    md += '## Executive Summary\n\n';
    md += `${execSummary}\n\n`;

    // Key Decisions
    md += '## Key Decisions Settled\n\n';
    if (decisions.length === 0) {
      md += '_No formal decisions were recorded during this session._\n\n';
    } else {
      decisions.forEach((d, idx) => {
        const speaker = d.speaker ? `**[${d.speaker}]** ` : '';
        md += `${idx + 1}. ${speaker}${d.summary}\n`;
        if (d.sourceText && d.sourceText !== d.summary) {
          md += `   > _"${d.sourceText}"_\n`;
        }
      });
      md += '\n';
    }

    // Action Items / Commitments
    md += '## Action Items & Commitments\n\n';
    if (commitments.length === 0) {
      md += '_No action items or promises were detected._\n\n';
    } else {
      md += '| # | Owner | Action Item | Due Date | Status |\n';
      md += '| :-: | :--- | :--- | :--- | :-: |\n';
      commitments.forEach((c, idx) => {
        const owner = c.owner || 'Unassigned';
        const task = c.task.replace(/\|/g, '\\|');
        const due = c.dueLabel || formatDate(c.dueDate) || 'TBD';
        const status = c.resolved ? '✓ Completed' : '⏳ Pending';
        md += `| ${idx + 1} | **${owner}** | ${task} | ${due} | ${status} |\n`;
      });
      md += '\n';
    }

    // Full Transcript Log (Collapsible)
    if (transcript.length > 0) {
      md += '## Full Transcript Log\n\n';
      md += '<details>\n<summary>Click to view timestamped transcript (' + transcript.length + ' entries)</summary>\n\n';
      transcript.forEach((line) => {
        const t = formatTime(line.timestamp);
        const spk = line.speaker ? `**${line.speaker}**` : '**Someone**';
        md += `- \`[${t}]\` ${spk}: ${line.text}\n`;
      });
      md += '\n</details>\n';
    }

    md += '\n---\n_Generated automatically by Precedent — Meetings That Remember_\n';
    return md;
  }

  /**
   * Formats into a clean plain text email / Slack message.
   */
  function toPlainText(data) {
    const title = data.title || 'Untitled Meeting';
    const dateStr = formatDate(data.startTime);
    const durationStr = formatDuration(data.startTime, data.endTime);
    const attendees = (data.attendees && data.attendees.length > 0) ? data.attendees.join(', ') : 'None recorded';
    const commitments = data.commitments || [];
    const decisions = data.decisions || [];
    const execSummary = data.summary || generateExecutiveSummary(data);

    let txt = `MINUTES OF MEETING: ${title.toUpperCase()}\n`;
    txt += `Date: ${dateStr} | Duration: ${durationStr}\n`;
    txt += `Attendees: ${attendees}\n\n`;

    txt += `OVERVIEW:\n${execSummary}\n\n`;

    txt += 'KEY DECISIONS:\n';
    if (decisions.length === 0) {
      txt += '  • None recorded.\n';
    } else {
      decisions.forEach((d, i) => {
        txt += `  ${i + 1}. ${d.summary} (${d.speaker || 'Team'})\n`;
      });
    }
    txt += '\n';

    txt += 'ACTION ITEMS:\n';
    if (commitments.length === 0) {
      txt += '  • None recorded.\n';
    } else {
      commitments.forEach((c, i) => {
        const due = c.dueLabel || formatDate(c.dueDate) || 'TBD';
        txt += `  ${i + 1}. [${c.owner || 'Unassigned'}] ${c.task} (Due: ${due})\n`;
      });
    }

    txt += '\n---\nPrecedent: On-Device Meeting Memory\n';
    return txt;
  }

  const MOMGenerator = {
    toMarkdown,
    toPlainText,
    generateExecutiveSummary
  };

  global.Precedent = global.Precedent || {};
  global.Precedent.MOMGenerator = MOMGenerator;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MOMGenerator;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
