/**
 * video-recorder.js
 * High-definition full screen video and audio recording engine for meetings.
 * Uses navigator.mediaDevices.getDisplayMedia for screen & system audio,
 * and navigator.mediaDevices.getUserMedia for microphone audio, mixing them
 * into a single balanced soundtrack using the Web Audio API (AudioContext).
 */
(function (global) {
  let mediaRecorder = null;
  let recordedChunks = [];
  let screenStream = null;
  let micStream = null;
  let audioContext = null;
  let mixedStream = null;
  let recordingStartTime = 0;
  let timerInterval = null;
  let state = 'inactive'; // 'inactive' | 'recording' | 'paused'
  let onStateChangeCallback = null;
  let onTickCallback = null;

  function isSupported() {
    return !!(
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getDisplayMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  function getBestSupportedMimeType() {
    if (typeof MediaRecorder === 'undefined') return 'video/webm';
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return 'video/webm';
  }

  function formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }

  /**
   * Starts full-screen meeting recording.
   * @param {Object} options
   * @param {boolean} [options.includeMic=true] - Whether to mix in user's microphone
   * @param {number} [options.fps=30] - Screen frame rate
   * @param {Function} [options.onTick] - Called each second with formatted duration
   * @param {Function} [options.onStateChange] - Called on status changes
   */
  async function startRecording(options = {}) {
    if (state !== 'inactive') {
      throw new Error('A recording is already in progress.');
    }

    if (!isSupported()) {
      throw new Error('Screen recording is not supported in this browser environment.');
    }

    const includeMic = options.includeMic !== false;
    const fps = options.fps || 30;
    onTickCallback = options.onTick || null;
    onStateChangeCallback = options.onStateChange || null;

    recordedChunks = [];

    // 1. Capture Full Screen & System Audio
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        frameRate: { ideal: fps, max: 60 },
        displaySurface: 'monitor'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000
      }
    });

    const videoTrack = screenStream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('No video track obtained from screen capture.');
    }

    // Handle user clicking native Chrome "Stop sharing" bar
    videoTrack.addEventListener('ended', () => {
      if (state === 'recording' || state === 'paused') {
        stopRecording();
      }
    });

    // 2. Setup Audio Mixing (System Sound + Optional Mic)
    const audioTracks = [];
    const screenAudioTrack = screenStream.getAudioTracks()[0];

    if (includeMic) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
      } catch (micErr) {
        console.warn('Microphone access not granted; continuing with system audio only:', micErr);
        micStream = null;
      }
    }

    // If we have both system audio and mic, mix them with Web Audio API
    if (screenAudioTrack && micStream && micStream.getAudioTracks().length > 0) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();

        const destination = audioContext.createMediaStreamDestination();
        const screenSource = audioContext.createMediaStreamSource(new MediaStream([screenAudioTrack]));
        const micSource = audioContext.createMediaStreamSource(micStream);

        // Balance gains
        const screenGain = audioContext.createGain();
        screenGain.gain.value = 1.0;
        const micGain = audioContext.createGain();
        micGain.gain.value = 1.0;

        screenSource.connect(screenGain).connect(destination);
        micSource.connect(micGain).connect(destination);

        const mixedAudioTrack = destination.stream.getAudioTracks()[0];
        if (mixedAudioTrack) {
          audioTracks.push(mixedAudioTrack);
        }
      } catch (mixErr) {
        console.warn('Web Audio mixing failed, falling back to system audio track:', mixErr);
        audioTracks.push(screenAudioTrack);
      }
    } else if (screenAudioTrack) {
      audioTracks.push(screenAudioTrack);
    } else if (micStream && micStream.getAudioTracks().length > 0) {
      audioTracks.push(micStream.getAudioTracks()[0]);
    }

    // 3. Combine Video and Audio into Mixed Stream
    mixedStream = new MediaStream([videoTrack, ...audioTracks]);

    // 4. Initialize MediaRecorder
    const mimeType = getBestSupportedMimeType();
    mediaRecorder = new MediaRecorder(mixedStream, {
      mimeType,
      videoBitsPerSecond: 2500000 // 2.5 Mbps crisp 1080p
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.start(1000); // 1-second chunks
    state = 'recording';
    recordingStartTime = Date.now();

    // 5. Start Duration Timer
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (state === 'recording') {
        const elapsedSecs = Math.floor((Date.now() - recordingStartTime) / 1000);
        if (onTickCallback) {
          onTickCallback({
            seconds: elapsedSecs,
            formatted: formatDuration(elapsedSecs)
          });
        }
      }
    }, 1000);

    if (onStateChangeCallback) {
      onStateChangeCallback(state);
    }

    return { ok: true, state };
  }

  function pauseRecording() {
    if (mediaRecorder && state === 'recording') {
      mediaRecorder.pause();
      state = 'paused';
      if (onStateChangeCallback) onStateChangeCallback(state);
      return true;
    }
    return false;
  }

  function resumeRecording() {
    if (mediaRecorder && state === 'paused') {
      mediaRecorder.resume();
      state = 'recording';
      if (onStateChangeCallback) onStateChangeCallback(state);
      return true;
    }
    return false;
  }

  /**
   * Stops recording and returns compiled video Blob.
   * @returns {Promise<{ blob: Blob, durationSeconds: number, formattedDuration: string, filename: string }>}
   */
  function stopRecording() {
    return new Promise((resolve) => {
      if (!mediaRecorder || state === 'inactive') {
        resolve(null);
        return;
      }

      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }

      const totalSeconds = Math.max(1, Math.floor((Date.now() - recordingStartTime) / 1000));
      const formattedDuration = formatDuration(totalSeconds);

      mediaRecorder.onstop = () => {
        const mimeType = getBestSupportedMimeType();
        const videoBlob = new Blob(recordedChunks, { type: mimeType });

        // Cleanup tracks
        if (screenStream) {
          screenStream.getTracks().forEach((t) => t.stop());
          screenStream = null;
        }
        if (micStream) {
          micStream.getTracks().forEach((t) => t.stop());
          micStream = null;
        }
        if (mixedStream) {
          mixedStream.getTracks().forEach((t) => t.stop());
          mixedStream = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
          audioContext.close().catch(() => {});
          audioContext = null;
        }

        state = 'inactive';
        if (onStateChangeCallback) onStateChangeCallback(state);

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = `${now.getHours()}${now.getMinutes()}`;
        const filename = `Precedent-Meeting-Recording-${dateStr}-${timeStr}.webm`;

        resolve({
          blob: videoBlob,
          sizeBytes: videoBlob.size,
          durationSeconds: totalSeconds,
          formattedDuration,
          filename
        });
      };

      mediaRecorder.stop();
    });
  }

  /**
   * Trigger direct local download of a recorded video Blob.
   * @param {Blob} blob
   * @param {string} [filename]
   */
  function downloadVideo(blob, filename = 'Precedent-Recording.webm') {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function getState() {
    return state;
  }

  const VideoRecorder = {
    isSupported,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    downloadVideo,
    getState,
    formatDuration,
    getBestSupportedMimeType
  };

  global.Precedent = global.Precedent || {};
  global.Precedent.VideoRecorder = VideoRecorder;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = VideoRecorder;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
