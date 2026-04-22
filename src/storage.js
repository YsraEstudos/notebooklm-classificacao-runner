import { normalizeDisplayText, normalizeSignatureText, stableHash, parseMaybeJson } from './utils';

const STORAGE_KEY = 'notebooklm_classificacao_runner_state_v1';
const STORAGE_FALLBACK_PREFIX = '__nblm_classificacao_runner__';

function readRawStorage() {
  try {
    if (typeof GM_getValue === 'function') {
      return GM_getValue(STORAGE_KEY, null);
    }
  } catch {
    // Fallback abaixo
  }

  try {
    return localStorage.getItem(`${STORAGE_FALLBACK_PREFIX}${STORAGE_KEY}`);
  } catch {
    return null;
  }
}

function writeRawStorage(value) {
  try {
    if (typeof GM_setValue === 'function') {
      GM_setValue(STORAGE_KEY, value);
      return;
    }
  } catch {
    // Fallback abaixo
  }

  try {
    localStorage.setItem(`${STORAGE_FALLBACK_PREFIX}${STORAGE_KEY}`, value);
  } catch {
    // Silencioso: o runner continua em memória
  }
}

export function createDefaultState() {
  return {
    version: 2,
    status: 'idle',
    collapsed: false,
    launcherTop: 120,
    draftText: '',
    loadedText: '',
    queue: [],
    nextIndex: 0,
    history: [],
    currentBatch: null,
    lastCapturedSignature: '',
    lastError: '',
    lastInfo: '',
    runId: null,
    updatedAt: Date.now(),
  };
}

export function loadState() {
  const raw = readRawStorage();
  if (!raw) return createDefaultState();

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const state = {
      ...createDefaultState(),
      ...parsed,
    };

    state.queue = Array.isArray(state.queue) ? state.queue : [];
    state.history = Array.isArray(state.history) ? state.history : [];
    state.nextIndex = Number.isFinite(state.nextIndex) ? state.nextIndex : 0;
    state.collapsed = Boolean(state.collapsed);
    state.launcherTop = Number.isFinite(state.launcherTop) ? state.launcherTop : 120;
    state.status = ['idle', 'running', 'paused', 'stopped', 'done', 'error'].includes(state.status)
      ? state.status
      : 'idle';

    if (state.currentBatch && typeof state.currentBatch === 'object') {
      state.currentBatch = {
        ...state.currentBatch,
        baselineSignatures: Array.isArray(state.currentBatch.baselineSignatures)
          ? state.currentBatch.baselineSignatures.map(signature => String(signature))
          : [],
      };
    } else {
      state.currentBatch = null;
    }

    if (state.status === 'running') {
      state.status = 'paused';
      state.lastInfo = 'A execução anterior foi restaurada em pausa depois de recarregar a página.';
      state.lastError = '';
    }

    if (state.draftText) state.draftText = normalizeDisplayText(state.draftText);
    if (state.loadedText) state.loadedText = normalizeDisplayText(state.loadedText);
    if (state.lastCapturedSignature) {
      state.lastCapturedSignature = String(state.lastCapturedSignature);
    }
    state.updatedAt = Date.now();
    return state;
  } catch {
    return createDefaultState();
  }
}

export function saveState(state) {
  const snapshot = {
    ...state,
    updatedAt: Date.now(),
  };

  writeRawStorage(JSON.stringify(snapshot));
  return snapshot;
}

function extractItemText(entry) {
  if (typeof entry === 'string') return normalizeDisplayText(entry);
  if (typeof entry === 'number' || typeof entry === 'boolean') {
    return normalizeDisplayText(String(entry));
  }

  if (!entry || typeof entry !== 'object') return '';

  const preferredKeys = ['text', 'message', 'prompt', 'content', 'value', 'title'];
  for (const key of preferredKeys) {
    if (typeof entry[key] === 'string' && entry[key].trim()) {
      return normalizeDisplayText(entry[key]);
    }
  }

  const stringValues = Object.values(entry).filter(value => typeof value === 'string' && value.trim());
  if (stringValues.length === 1) {
    return normalizeDisplayText(stringValues[0]);
  }

  return '';
}

function normalizeQueueItem(entry, index) {
  const text = extractItemText(entry);
  if (!text) return null;

  const signature = normalizeSignatureText(text);
  const idSeed = `${index}-${signature}`;

  return {
    id: `item_${stableHash(idSeed)}_${index + 1}`,
    index,
    text,
    raw: entry,
  };
}

export function parseQueueFromJson(jsonText) {
  const parsed = parseMaybeJson(jsonText);

  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : null;

  if (!items) {
    throw new Error('O JSON precisa ser um array ou um objeto com a chave `items`.');
  }

  const queue = items
    .map((entry, index) => normalizeQueueItem(entry, index))
    .filter(Boolean);

  if (!queue.length) {
    throw new Error('Nenhum item válido foi encontrado no JSON.');
  }

  return queue;
}

export function buildBatchText(batchItems) {
  return batchItems
    .map((item, index) => `${index + 1}. ${item.text}`)
    .join('\n\n');
}

export function buildHistoryClipboardText(history) {
  return history
    .map((entry, index) => {
      const title = `LOTE ${index + 1} (${entry.startIndex + 1}-${entry.endIndex + 1})`;
      return `=== ${title} ===\n${entry.responseText}`;
    })
    .join('\n\n');
}

export function createExampleJson() {
  return JSON.stringify([
    { text: 'Primeiro item de exemplo para enviar ao NotebookLM.' },
    { text: 'Segundo item de exemplo para demonstrar o lote de 3.' },
    { text: 'Terceiro item de exemplo com outro conteúdo.' },
    { text: 'Quarto item de exemplo para mostrar continuidade.' },
    { text: 'Quinto item de exemplo.' },
    { text: 'Sexto item de exemplo.' },
    { text: 'Sétimo item de exemplo para fechar o lote final.' },
  ], null, 2);
}
