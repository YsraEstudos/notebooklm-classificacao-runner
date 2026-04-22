export function normalizeDisplayText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

export function normalizeSignatureText(text) {
  return normalizeDisplayText(text)
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function stableHash(text) {
  const input = String(text ?? '');
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

export function createAbortError() {
  return new DOMException('Aborted', 'AbortError');
}

export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 250, signal } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw createAbortError();

    const result = await predicate();
    if (result) return result;

    await delay(intervalMs, signal);
  }

  return null;
}

export function formatDuration(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function downloadText(filename, text, mimeType = 'application/json;charset=utf-8') {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  const normalized = String(text ?? '');

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(normalized);
      return true;
    }
  } catch {
    // Fallbacks abaixo
  }

  try {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(normalized, 'text');
      return true;
    }
  } catch {
    // Fallback DOM abaixo
  }

  try {
    const area = document.createElement('textarea');
    area.value = normalized;
    area.setAttribute('readonly', 'true');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    area.style.top = '-9999px';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('JSON inválido. Verifique a sintaxe antes de iniciar.');
  }
}
