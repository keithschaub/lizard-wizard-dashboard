// Bug reporting: capture game state, screenshots, and submit to relay
import { h } from './dom.js';
import { BUILD, SHA } from './version.js';

// Configuration — set on `window` at deploy time (see index.html / server); no `process` in the browser
export const RELAY_URL = window.LW_RELAY_URL || '';

const HTML2CANVAS_SRC = 'app/vendor/html2canvas.min.js';
let html2canvasLoadPromise = null;

/** Lazy-load vendored html2canvas (UMD exposes global `html2canvas`) */
function ensureHtml2canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (!html2canvasLoadPromise) {
    html2canvasLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-lw-html2canvas="1"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('html2canvas script failed')), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = HTML2CANVAS_SRC;
      s.async = true;
      s.dataset.lwHtml2canvas = '1';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load html2canvas'));
      document.head.append(s);
    });
  }
  return html2canvasLoadPromise;
}

const QUEUE_KEY = 'lw.bug-reports.queue';
const MAX_REPORT_SIZE = 25 * 1024 * 1024; // 25MB total (images + state)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB per image

// Check Web Speech API support
const hasSpeechRecognition = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

/**
 * Capture current game state as JSON
 */
async function captureGameState(game) {
  try {
    const state = game.exportState ? await game.exportState() : await game.st();
    return typeof state === 'string' ? state : JSON.stringify(state, null, 2);
  } catch (err) {
    console.error('[bug-report] Failed to capture state:', err);
    return JSON.stringify({ error: 'Failed to capture state', message: err.message });
  }
}

async function jpegFromCanvas(canvas, maxEdge, quality) {
  let source = canvas;
  const edge = Math.max(canvas.width, canvas.height);
  if (edge > maxEdge) {
    const scale = maxEdge / edge;
    source = document.createElement('canvas');
    source.width = Math.max(1, Math.round(canvas.width * scale));
    source.height = Math.max(1, Math.round(canvas.height * scale));
    source.getContext('2d').drawImage(canvas, 0, 0, source.width, source.height);
  }
  return new Promise((resolve, reject) => {
    source.toBlob((blob) => blob ? resolve(blob) : reject(new Error('JPEG encoding failed')), 'image/jpeg', quality);
  });
}

async function compressUserImage(file) {
  try {
    const url = URL.createObjectURL(file);
    let image;
    try {
      image = await createImageBitmap(file);
    } catch {
      image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    }
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await jpegFromCanvas(canvas, 1600, .8);
    image.close?.();
    URL.revokeObjectURL(url);
    return { name: `${file.name.replace(/\.[^.]+$/, '')}.jpg`, blob };
  } catch (err) {
    console.warn('[bug-report] Could not compress user image:', err);
    return { name: file.name, blob: file };
  }
}

/**
 * Capture screenshot of a specific element
 */
async function captureElementScreenshot(element, label) {
  if (!element) return null;
  
  try {
    try {
      await ensureHtml2canvas();
    } catch (e) {
      console.warn('[bug-report] html2canvas unavailable:', e);
    }
    // Use html2canvas if available, otherwise fall back to basic capture
    if (window.html2canvas) {
      const canvas = await window.html2canvas(element, {
        backgroundColor: '#070a18',
        scale: Math.min(window.devicePixelRatio || 1, 1280 / Math.max(element.scrollWidth || 1, element.scrollHeight || 1)),
        logging: false,
        useCORS: true,
      });
      return await jpegFromCanvas(canvas, 1280, .7);
    }
    
    // Fallback: no screenshot capability
    return null;
  } catch (err) {
    console.warn(`[bug-report] Failed to capture ${label}:`, err);
    return null;
  }
}

/**
 * Capture all relevant screenshots in background
 */
async function captureScreenshots(game) {
  const screenshots = [];
  
  // Current view snapshot
  const app = document.getElementById('app');
  if (app) {
    const blob = await captureElementScreenshot(app, 'current-view');
    if (blob) screenshots.push({ name: 'current-view.jpg', blob });
  }
  
  // Board
  const board = document.getElementById('board');
  if (board) {
    const blob = await captureElementScreenshot(board, 'board');
    if (blob) screenshots.push({ name: 'board.jpg', blob });
  }
  
  // Hand
  const hand = document.getElementById('hand');
  if (hand) {
    const blob = await captureElementScreenshot(hand, 'hand');
    if (blob) screenshots.push({ name: 'hand.jpg', blob });
  }
  
  // Any open overlay
  const overlay = document.querySelector('#overlays .overlay:not(.out)');
  if (overlay) {
    const testid = overlay.dataset.testid || 'overlay';
    const blob = await captureElementScreenshot(overlay, testid);
    if (blob) screenshots.push({ name: `${testid}.jpg`, blob });
  }
  
  // Mats (if we can open it without disrupting view)
  // Skip for now to avoid disruption
  
  return screenshots;
}

/**
 * Gather metadata about the session
 */
function gatherMetadata(game) {
  const v = game.v || {};
  const human = v.players?.find((p) => p.you);
  return {
    build: BUILD,
    sha: SHA,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
    round: v.round,
    currentPlayer: v.next,
    humanName: human?.name || game.me || '',
    phase: v.phase || '',
    gameOver: !!v.game_over,
    url: window.location.href,
  };
}

/**
 * Create the bug report data package
 */
async function createReportPackage(game, description, userImages) {
  const screenshots = await captureScreenshots(game);
  const gameState = await captureGameState(game);
  const metadata = gatherMetadata(game);
  
  // Combine auto-captured screenshots with user-uploaded images
  const allImages = [...screenshots];
  
  // Add user images
  for (let i = 0; i < userImages.length; i++) {
    const file = userImages[i];
    if (file.size > MAX_IMAGE_SIZE) {
      console.warn(`[bug-report] User image ${file.name} too large (${(file.size / 1024 / 1024).toFixed(1)}MB), skipping`);
      continue;
    }
    const compressed = await compressUserImage(file);
    allImages.push({ name: `user-${i}-${compressed.name}`, blob: compressed.blob });
  }
  
  // Check total size
  const totalSize = allImages.reduce((sum, img) => sum + img.blob.size, 0) + gameState.length;
  if (totalSize > MAX_REPORT_SIZE) {
    // Remove some screenshots to fit
    const keep = Math.floor(allImages.length * (MAX_REPORT_SIZE / totalSize));
    allImages.splice(keep);
  }
  
  return {
    description,
    metadata,
    gameState,
    images: allImages,
  };
}

/**
 * Submit report to relay (falls back to queue if relay unavailable)
 */
async function submitReport(reportPackage) {
  // If no relay URL configured, skip submission attempt
  if (!RELAY_URL || RELAY_URL === 'undefined') {
    throw new Error('Relay not configured');
  }
  
  const formData = new FormData();
  formData.append('description', reportPackage.description);
  formData.append('metadata', JSON.stringify(reportPackage.metadata));
  formData.append('gameState', reportPackage.gameState);
  
  reportPackage.images.forEach((img, i) => {
    formData.append(`image_${i}`, img.blob, img.name);
  });
  
  try {
    const response = await fetch(RELAY_URL, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(45000), // screenshots may upload through GitHub
      // Don't set Content-Type, let browser set it with boundary for FormData
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Relay returned ${response.status}: ${text}`);
    }
    
    return await response.json();
  } catch (err) {
    // Network error or timeout - treat as relay unavailable
    if (err.name === 'AbortError' || err.name === 'TypeError') {
      throw new Error('Relay unreachable');
    }
    throw err;
  }
}

/**
 * Queue report for later submission
 */
async function queueReport(reportPackage) {
  const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  const storable = {
    ...reportPackage,
    images: reportPackage.images.map((img) => ({
      name: img.name,
      data: null,
      type: img.blob.type,
    })),
  };
  await Promise.all(reportPackage.images.map((img, i) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      storable.images[i].data = reader.result;
      resolve();
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(img.blob);
  })));
  queue.push({ ...storable, queuedAt: Date.now() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Retry queued reports
 */
export async function retryQueuedReports() {
  try {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    if (queue.length === 0) return;
    
    const remaining = [];
    
    for (const item of queue) {
      try {
        // Reconstruct blobs from base64
        const images = await Promise.all(item.images.map(async img => {
          const response = await fetch(img.data);
          const blob = await response.blob();
          return { name: img.name, blob };
        }));
        
        await submitReport({ ...item, images });
        console.log('[bug-report] Successfully submitted queued report');
      } catch (err) {
        console.warn('[bug-report] Failed to submit queued report, keeping in queue:', err);
        remaining.push(item);
      }
    }
    
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } catch (err) {
    console.error('[bug-report] Error processing queue:', err);
  }
}

/**
 * Download report as fallback
 */
function downloadReport(reportPackage) {
  const zip = {
    description: reportPackage.description,
    metadata: reportPackage.metadata,
    gameState: reportPackage.gameState,
    images: `${reportPackage.images.length} images included (see separate files)`,
  };
  
  const json = JSON.stringify(zip, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bug-report-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  // Also download images
  reportPackage.images.forEach((img, i) => {
    const url = URL.createObjectURL(img.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = img.name;
    if (i === 0) a.click(); // Only auto-download first image
    URL.revokeObjectURL(url);
  });
}

/**
 * Show toast notification
 */
function showToast(message, duration = 3000) {
  const toast = h('div', { class: 'bug-toast', 'data-testid': 'bug-toast' }, message);
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Open bug report dialog
 */
export function openBugReportDialog(game) {
  const overlay = h('div', { class: 'overlay bug-report', 'data-testid': 'bug-report' });
  const textarea = h('textarea', {
    class: 'bug-textarea',
    'data-testid': 'bug-description',
    placeholder: 'Describe what happened, what you expected, and how to reproduce the issue...',
    rows: 8,
  });
  
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    style: { display: 'none' },
    'data-testid': 'bug-images',
  });
  
  const selectedFiles = h('div', { class: 'bug-files', 'data-testid': 'bug-files' });
  
  fileInput.addEventListener('change', () => {
    selectedFiles.innerHTML = '';
    if (fileInput.files.length > 0) {
      selectedFiles.appendChild(h('div', { class: 'bug-files-label' }, 
        `${fileInput.files.length} image${fileInput.files.length > 1 ? 's' : ''} selected`));
    }
  });
  
  // Speech recognition support
  let recognition = null;
  let micBtn = null;
  
  if (hasSpeechRecognition) {
    // iOS Safari can throw from the constructor; the dialog must still open without a mic button.
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
    
      let transcript = '';
    
      recognition.onresult = (event) => {
        transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        textarea.value = transcript;
      };
    
      recognition.onerror = (event) => {
        console.error('[bug-report] Speech recognition error:', event.error);
        if (micBtn) micBtn.classList.remove('active');
      };
    
      recognition.onend = () => {
        if (micBtn) micBtn.classList.remove('active');
      };
    
      micBtn = h('button', {
        class: 'bug-mic',
        'data-testid': 'bug-mic',
        'aria-label': 'Voice input',
        onclick: () => {
          if (micBtn.classList.contains('active')) {
            recognition.stop();
            micBtn.classList.remove('active');
          } else {
            recognition.start();
            micBtn.classList.add('active');
          }
        },
      }, '🎤');
    } catch (err) {
      console.warn('[bug-report] Speech recognition unavailable:', err);
      recognition = null;
      micBtn = null;
    }
  }
  
  const hasRelay = !!(RELAY_URL && RELAY_URL !== 'undefined');
  const submitStatus = h('div', { class: 'bug-submit-status', 'data-testid': 'bug-submit-status', 'aria-live': 'polite' }, '');
  const setSubmitStatus = (text) => { submitStatus.textContent = text; };

  async function packageFromForm() {
    const description = textarea.value.trim();
    if (!description) {
      showToast('Please describe the issue', 2000);
      return null;
    }
    return createReportPackage(game, description, Array.from(fileInput.files));
  }

  const submitBtn = hasRelay ? h('button', {
    class: 'act',
    'data-testid': 'bug-submit',
    onclick: async () => {
      submitBtn.disabled = true;
      setSubmitStatus('Capturing…');
      submitBtn.textContent = 'Capturing…';
      let stillUploadingTimer = null;
      try {
        const reportPackage = await packageFromForm();
        if (!reportPackage) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Report';
          setSubmitStatus('');
          return;
        }
        setSubmitStatus('Uploading…');
        submitBtn.textContent = 'Uploading…';
        stillUploadingTimer = setTimeout(() => {
          setSubmitStatus('Still uploading…');
          submitBtn.textContent = 'Still uploading…';
        }, 8000);
        try {
          const result = await submitReport(reportPackage);
          clearTimeout(stillUploadingTimer);
          overlay.remove();
          const issue = result?.number == null ? '' : ` — issue #${result.number}`;
          showToast(`Report sent${issue}`);
        } catch (err) {
          clearTimeout(stillUploadingTimer);
          console.error('[bug-report] Submit failed:', err);
          const relayNotConfigured = err.message.includes('not configured');
          try {
            await queueReport(reportPackage);
          } catch (qerr) {
            console.error('[bug-report] Failed to queue report:', qerr);
            showToast('Could not save report locally. Use Save report.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Report';
            setSubmitStatus('Could not save report locally.');
            return;
          }
          if (relayNotConfigured) {
            showToast('Relay unavailable. Report queued locally. Use Save report to download.', 5000);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Report';
            setSubmitStatus('Relay unavailable; report queued.');
          } else {
            showToast('Report queued (offline). Will retry when online.');
            overlay.remove();
          }
        }
      } catch (err) {
        console.error('[bug-report] Failed to create report:', err);
        showToast('Failed to create report. Try Save report.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Report';
        setSubmitStatus('Report failed. Please try again.');
      } finally {
        if (stillUploadingTimer) clearTimeout(stillUploadingTimer);
      }
    },
  }, 'Submit Report') : null;

  const saveBtn = !hasRelay ? h('button', {
    class: 'act',
    'data-testid': 'bug-save-report',
    onclick: async () => {
      saveBtn.disabled = true;
      const prev = saveBtn.textContent;
      saveBtn.textContent = 'Saving…';
      try {
        const reportPackage = await packageFromForm();
        if (!reportPackage) {
          saveBtn.disabled = false;
          saveBtn.textContent = prev;
          return;
        }
        try {
          await queueReport(reportPackage);
        } catch (qerr) {
          console.warn('[bug-report] Queue while saving:', qerr);
        }
        downloadReport(reportPackage);
        showToast('Report saved');
        overlay.remove();
      } catch (err) {
        console.error('[bug-report] Save failed:', err);
        showToast('Failed to save report');
        saveBtn.disabled = false;
        saveBtn.textContent = prev;
      }
    },
  }, 'Save report') : null;

  const downloadSecondary = hasRelay ? h('button', {
    class: 'act secondary',
    'data-testid': 'bug-download',
    onclick: async () => {
      downloadSecondary.disabled = true;
      try {
        const reportPackage = await packageFromForm();
        if (!reportPackage) {
          downloadSecondary.disabled = false;
          return;
        }
        downloadReport(reportPackage);
        showToast('Report downloaded');
      } catch (err) {
        console.error('[bug-report] Download failed:', err);
        showToast('Failed to download report');
      }
      downloadSecondary.disabled = false;
    },
  }, 'Download Report') : null;
  
  const cancelBtn = h('button', {
    class: 'act secondary',
    'data-testid': 'bug-cancel',
    onclick: () => {
      if (recognition) recognition.stop();
      overlay.remove();
    },
  }, 'Cancel');
  
  overlay.appendChild(h('div', { class: 'bug-panel' },
    h('div', { class: 'bug-head' },
      h('div', { class: 'bug-title' }, '🐛 Report Bug'),
      h('button', { class: 'bug-close', 'aria-label': 'Close', onclick: () => overlay.remove() }, '×')),
    h('div', { class: 'bug-body' },
      h('div', { class: 'bug-label' }, 'What happened?'),
      h('div', { class: 'bug-input-row' }, textarea, micBtn),
      h('div', { class: 'bug-label' }, 'Attach photos (optional)'),
      h('button', {
        class: 'bug-attach',
        'data-testid': 'bug-attach-btn',
        onclick: () => fileInput.click(),
      }, '📎 Choose Images'),
      fileInput,
      selectedFiles,
      h('div', { class: 'bug-info' }, 
        'Game state and screenshots will be captured automatically'),
      submitStatus),
    h('div', { class: 'actions' }, ...[submitBtn, saveBtn, downloadSecondary, cancelBtn].filter(Boolean))));
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  
  document.getElementById('overlays').appendChild(overlay);
  textarea.focus();
  
  // Try to retry any queued reports
  retryQueuedReports().catch(err => console.warn('[bug-report] Retry failed:', err));
}
