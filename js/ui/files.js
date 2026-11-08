/** Petits utilitaires fichiers (téléchargement, lecture, partage). */
export function downloadJson(obj, name) { downloadText(JSON.stringify(obj, null, 1), name, 'application/json'); }

export function downloadText(text, name, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileAsText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}

/** Copie dans le presse-papiers (ou partage natif si disponible). */
export async function shareText(text, title) {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return 'partagé'; }
  } catch { /* annulé */ }
  try { await navigator.clipboard.writeText(text); return 'copié'; } catch { return null; }
}
