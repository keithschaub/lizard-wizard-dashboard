// Bug reporting: capture game state, screenshots, and submit to relay
import { h } from './dom.js';

// Configuration - can be overridden before deployment
export const RELAY_URL = process.env.RELAY_URL || 'https://lw-bug-relay.keithschaub.workers.dev/report';
export const COMMIT_SHA = process.env.COMMIT_SHA || 'dev';

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
    const state = game.exportState ? game.exportState() : game.st();
    return JSON.stringify(state, null, 2);
  } catch (err) {
    console.error('[bug-report] Failed to capture state:', err);
    return JSON.stringify({ error: 'Failed to capture state', message: err.message });
  }
}

/**
 * Capture screenshot of a specific element
 */
async function captureElementScreenshot(element, label) {
  if (!element) return null;
  
  try {
    // Use html2canvas if available, otherwise fall back to basic capture
    if (window.html2canvas) {
      const canvas = await window.html2canvas(element, {
        backgroundColor: '#070a18',
        scale: window.devicePixelRatio || 1,
        logging: false,
        useCORS: true,
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      
      if (blob.size > MAX_IMAGE_SIZE) {
        // Re-compress at lower quality if too large
        const canvas2 = await window.html2canvas(element, {
          backgroundColor: '#070a18',
          scale: 1,
          logging: false,
          useCORS: true,
        });
        return await new Promise(resolve => canvas2.toBlob(resolve, 'image/jpeg', 0.6));
      }
      
      return blob;
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
  return {
    commitSHA: COMMIT_SHA,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    game: {
      round: v.round,
      phase: v.phase,
      next: v.next,
      gameOver: v.game_over,
    },
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
    allImages.push({ name: `user-${i}-${file.name}`, blob: file });
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
 * Submit report to relay
 */
async function submitReport(reportPackage) {
  const formData = new FormData();
  formData.append('description', reportPackage.description);
  formData.append('metadata', JSON.stringify(reportPackage.metadata));
  formData.append('gameState', reportPackage.gameState);
  
  reportPackage.images.forEach((img, i) => {
    formData.append(`image_${i}`, img.blob, img.name);
  });
  
  const response = await fetch(RELAY_URL, {
    method: 'POST',
    body: formData,
    // Don't set Content-Type, let browser set it with boundary for FormData
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Relay returned ${response.status}: ${text}`);
  }
  
  return await response.json();
}

/**
 * Queue report for later submission
 */
function queueReport(reportPackage) {
  try {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    
    // Convert blobs to base64 for storage
    const storable = {
      ...reportPackage,
      images: reportPackage.images.map(img => ({
        name: img.name,
        data: null, // Will be set below
        type: img.blob.type,
      })),
    };
    
    // Read blobs as base64 (simplified - in production, might want IndexedDB for large files)
    Promise.all(reportPackage.images.map((img, i) => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          storable.images[i].data = reader.result;
          resolve();
        };
        reader.readAsDataURL(img.blob);
      });
    })).then(() => {
      queue.push({ ...storable, queuedAt: Date.now() });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    });
    
  } catch (err) {
    console.error('[bug-report] Failed to queue report:', err);
  }
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
  }
  
  const submitBtn = h('button', {
    class: 'act',
    'data-testid': 'bug-submit',
    onclick: async () => {
      const description = textarea.value.trim();
      if (!description) {
        showToast('Please describe the issue', 2000);
        return;
      }
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      
      try {
        const reportPackage = await createReportPackage(game, description, Array.from(fileInput.files));
        
        try {
          await submitReport(reportPackage);
          showToast('✓ Report sent! Thank you.');
          overlay.remove();
        } catch (err) {
          console.error('[bug-report] Submit failed:', err);
          // Queue for retry
          queueReport(reportPackage);
          showToast('Report queued (offline). Will retry when online.');
          overlay.remove();
        }
      } catch (err) {
        console.error('[bug-report] Failed to create report:', err);
        showToast('Failed to create report. Try downloading instead.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    },
  }, 'Submit Report');
  
  const downloadBtn = h('button', {
    class: 'act secondary',
    'data-testid': 'bug-download',
    onclick: async () => {
      const description = textarea.value.trim();
      if (!description) {
        showToast('Please describe the issue', 2000);
        return;
      }
      
      try {
        const reportPackage = await createReportPackage(game, description, Array.from(fileInput.files));
        downloadReport(reportPackage);
        showToast('Report downloaded');
      } catch (err) {
        console.error('[bug-report] Download failed:', err);
        showToast('Failed to download report');
      }
    },
  }, 'Download Report');
  
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
      selectedFiles,
      h('div', { class: 'bug-info' }, 
        'Game state and screenshots will be captured automatically')),
    h('div', { class: 'actions' }, submitBtn, downloadBtn, cancelBtn)));
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  
  document.getElementById('overlays').appendChild(overlay);
  textarea.focus();
  
  // Try to retry any queued reports
  retryQueuedReports().catch(err => console.warn('[bug-report] Retry failed:', err));
}
