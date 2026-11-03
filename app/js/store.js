// Saves: autosave of the full engine state in localStorage, plus JSON export / import files.
const KEY = 'lw.save.v1';

export function saveLocal(text) {
  try { localStorage.setItem(KEY, text); localStorage.setItem(KEY + '.at', new Date().toISOString()); return true; } catch { return false; }
}
export function loadLocal() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function clearLocal() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '.at'); } catch { /* ignore */ }
}
export function savedAt() {
  try { return localStorage.getItem(KEY + '.at'); } catch { return null; }
}

export function exportFile(text, round) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lizard-wizard-R${round}-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function pickFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = async () => resolve(inp.files[0] ? await inp.files[0].text() : null);
    inp.click();
  });
}
