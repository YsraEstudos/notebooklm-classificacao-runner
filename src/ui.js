import { downloadText, formatDateTime, formatDuration } from './utils';
import { createExampleJson } from './storage';

const PANEL_WIDTH = 392;
const RAIL_WIDTH = 52;

function createElement(tag, className, textContent) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent != null) element.textContent = textContent;
  return element;
}

function makeButton(label, tone = 'secondary') {
  const button = createElement('button', `nlm-btn nlm-btn-${tone}`);
  button.type = 'button';
  button.textContent = label;
  return button;
}

function formatRange(startIndex, endIndex) {
  return `${startIndex + 1}-${endIndex + 1}`;
}

export class ClassificacaoPanel {
  constructor({
    onDraftChange,
    onLoadJson,
    onStart,
    onTogglePause,
    onStop,
    onCopyAll,
    onCopyEntry,
    onToggleCollapsed,
    onImportFile,
    onDownloadExample,
  } = {}) {
    this.onDraftChange = onDraftChange;
    this.onLoadJson = onLoadJson;
    this.onStart = onStart;
    this.onTogglePause = onTogglePause;
    this.onStop = onStop;
    this.onCopyAll = onCopyAll;
    this.onCopyEntry = onCopyEntry;
    this.onToggleCollapsed = onToggleCollapsed;
    this.onImportFile = onImportFile;
    this.onDownloadExample = onDownloadExample;

    this.state = null;
    this.ignoreEditorEvents = false;
    this.isCollapsed = false;

    this.host = document.createElement('div');
    this.host.id = 'nlm-classificacao-host';
    this.host.setAttribute('aria-live', 'polite');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.buildStyles();
    this.shadow.appendChild(style);

    this.shell = createElement('div', 'nlm-shell');
    this.panel = createElement('aside', 'nlm-panel');
    this.rail = createElement('div', 'nlm-rail');
    this.rail.id = 'nlm-classificacao-rail';

    this.content = createElement('div', 'nlm-content');
    this.header = this.buildHeader();
    this.notice = createElement('div', 'nlm-notice');
    this.controls = this.buildControls();
    this.editor = this.buildEditor();
    this.stats = this.buildStats();
    this.history = this.buildHistory();
    this.footer = this.buildFooter();

    this.content.append(
      this.header,
      this.notice,
      this.controls,
      this.editor,
      this.stats,
      this.history,
      this.footer,
    );

    this.panel.append(this.content, this.rail);
    this.shell.append(this.panel);
    this.shadow.append(this.shell);

    document.body.appendChild(this.host);
    this.bindEvents();
  }

  buildStyles() {
    return `
      :host {
        all: initial;
      }

      * {
        box-sizing: border-box;
      }

      .nlm-shell {
        position: fixed;
        inset: 0 auto 0 0;
        width: ${PANEL_WIDTH}px;
        z-index: 2147483647;
        pointer-events: none;
        font-family: "Google Sans Text", "Google Sans", "Segoe UI", sans-serif;
        color: #eef2ff;
      }

      .nlm-panel {
        position: absolute;
        inset: 0 auto 0 0;
        width: 100%;
        pointer-events: auto;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 30%),
          radial-gradient(circle at bottom right, rgba(251, 191, 36, 0.12), transparent 30%),
          linear-gradient(180deg, rgba(11, 15, 28, 0.95), rgba(7, 11, 20, 0.98));
        border-right: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: 12px 0 48px rgba(2, 6, 23, 0.36);
        backdrop-filter: blur(16px);
        overflow: hidden;
        transform: translateX(0);
        transition: transform 240ms ease;
      }

      .nlm-shell.is-collapsed .nlm-panel {
        transform: translateX(calc(-100% + ${RAIL_WIDTH}px));
      }

      .nlm-content {
        position: absolute;
        inset: 0 ${RAIL_WIDTH}px 0 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px 14px 14px 14px;
        overflow: hidden;
      }

      .nlm-rail {
        position: absolute;
        inset: 0 0 0 auto;
        width: ${RAIL_WIDTH}px;
        border-left: 1px solid rgba(148, 163, 184, 0.14);
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.72));
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
      }

      .nlm-rail-button {
        width: 36px;
        height: 132px;
        border-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background:
          linear-gradient(180deg, rgba(14, 165, 233, 0.28), rgba(251, 191, 36, 0.18)),
          rgba(15, 23, 42, 0.92);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        writing-mode: vertical-rl;
        text-orientation: mixed;
        letter-spacing: 0.16em;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.3);
      }

      .nlm-rail-meta {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        color: rgba(226, 232, 240, 0.78);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
      }

      .nlm-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #38bdf8;
        box-shadow: 0 0 0 6px rgba(56, 189, 248, 0.16);
      }

      .nlm-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 2px 2px 0 2px;
      }

      .nlm-title-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .nlm-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: rgba(191, 219, 254, 0.86);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .nlm-title {
        margin: 0;
        font-size: 18px;
        line-height: 1.15;
        font-weight: 700;
        color: #f8fafc;
      }

      .nlm-subtitle {
        margin: 0;
        color: rgba(226, 232, 240, 0.72);
        font-size: 12px;
        line-height: 1.4;
      }

      .nlm-top-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .nlm-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.5);
        color: #e2e8f0;
      }

      .nlm-chip[data-tone="running"] { color: #67e8f9; }
      .nlm-chip[data-tone="paused"] { color: #fbbf24; }
      .nlm-chip[data-tone="done"] { color: #86efac; }
      .nlm-chip[data-tone="error"] { color: #fca5a5; }

      .nlm-notice {
        min-height: 18px;
        color: rgba(226, 232, 240, 0.82);
        font-size: 12px;
        line-height: 1.45;
      }

      .nlm-notice.is-error {
        color: #fca5a5;
      }

      .nlm-notice.is-success {
        color: #86efac;
      }

      .nlm-controls {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .nlm-controls-row {
        display: flex;
        gap: 8px;
      }

      .nlm-btn {
        appearance: none;
        border: 0;
        border-radius: 14px;
        padding: 10px 12px;
        min-height: 40px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #fff;
      }

      .nlm-btn:hover { transform: translateY(-1px); }
      .nlm-btn:active { transform: translateY(0); }
      .nlm-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

      .nlm-btn-primary {
        background: linear-gradient(180deg, #0ea5e9, #2563eb);
        box-shadow: 0 10px 24px rgba(37, 99, 235, 0.24);
      }

      .nlm-btn-secondary {
        background: rgba(30, 41, 59, 0.95);
        border: 1px solid rgba(148, 163, 184, 0.18);
      }

      .nlm-btn-ghost {
        background: rgba(15, 23, 42, 0.5);
        border: 1px solid rgba(148, 163, 184, 0.18);
      }

      .nlm-btn-warm {
        background: linear-gradient(180deg, #f59e0b, #ea580c);
        box-shadow: 0 10px 24px rgba(249, 115, 22, 0.18);
      }

      .nlm-btn-danger {
        background: linear-gradient(180deg, #ef4444, #be123c);
        box-shadow: 0 10px 24px rgba(239, 68, 68, 0.16);
      }

      .nlm-editor-wrap {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 150px;
      }

      .nlm-section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: rgba(226, 232, 240, 0.8);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .nlm-textarea {
        width: 100%;
        min-height: 148px;
        max-height: 220px;
        resize: vertical;
        border-radius: 16px;
        padding: 12px 14px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(2, 6, 23, 0.74);
        color: #f8fafc;
        font-family: "Google Sans Code", Consolas, monospace;
        font-size: 12px;
        line-height: 1.45;
        outline: none;
      }

      .nlm-textarea:focus {
        border-color: rgba(56, 189, 248, 0.8);
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14);
      }

      .nlm-inline-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .nlm-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .nlm-mini {
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.52);
        border: 1px solid rgba(148, 163, 184, 0.15);
        font-size: 12px;
        color: #e2e8f0;
      }

      .nlm-mini strong {
        color: #fff;
      }

      .nlm-progress {
        width: 100%;
        height: 10px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.58);
        border: 1px solid rgba(148, 163, 184, 0.14);
        overflow: hidden;
      }

      .nlm-progress-bar {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: linear-gradient(90deg, #38bdf8, #a78bfa, #f59e0b);
        transition: width 180ms ease;
      }

      .nlm-history {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
        flex: 1;
      }

      .nlm-history-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow: auto;
        padding-right: 4px;
        min-height: 0;
      }

      .nlm-entry {
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(15, 23, 42, 0.58);
        padding: 12px;
      }

      .nlm-entry-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .nlm-entry-title {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .nlm-entry-title strong {
        color: #f8fafc;
        font-size: 13px;
      }

      .nlm-entry-meta {
        color: rgba(226, 232, 240, 0.68);
        font-size: 11px;
      }

      .nlm-entry-items {
        margin: 0 0 8px 0;
        color: rgba(191, 219, 254, 0.92);
        font-size: 11px;
        line-height: 1.5;
      }

      .nlm-entry-response {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 220px;
        overflow: auto;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(2, 6, 23, 0.62);
        border: 1px solid rgba(148, 163, 184, 0.12);
        color: #e5eefc;
        font-size: 12px;
        line-height: 1.55;
      }

      .nlm-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        padding-top: 2px;
        color: rgba(226, 232, 240, 0.72);
        font-size: 11px;
      }

      .nlm-muted {
        color: rgba(226, 232, 240, 0.54);
      }

      .nlm-link {
        color: #93c5fd;
        cursor: pointer;
      }

      .nlm-spacer {
        flex: 1;
      }
    `;
  }

  buildHeader() {
    const header = createElement('div', 'nlm-header');
    const titleWrap = createElement('div', 'nlm-title-wrap');
    const kicker = createElement('div', 'nlm-kicker');
    kicker.textContent = 'NotebookLM Runner';
    const title = createElement('h2', 'nlm-title');
    title.textContent = 'Classificação em lotes';
    const subtitle = createElement('p', 'nlm-subtitle');
    subtitle.textContent = 'JSON flexível, envio em blocos de 3 e histórico com cópia rápida.';

    titleWrap.append(kicker, title, subtitle);

    const topActions = createElement('div', 'nlm-top-actions');
    this.collapseButton = makeButton('Recolher', 'ghost');
    this.collapseButton.title = 'Recolher ou abrir o painel';
    topActions.append(this.collapseButton);

    header.append(titleWrap, topActions);
    return header;
  }

  buildControls() {
    const wrap = createElement('div', 'nlm-controls');
    this.loadButton = makeButton('Carregar JSON', 'secondary');
    this.startButton = makeButton('Start', 'primary');
    this.pauseButton = makeButton('Pause', 'warm');
    this.stopButton = makeButton('Stop', 'danger');
    this.copyAllButton = makeButton('Copiar tudo', 'secondary');
    this.downloadExampleButton = makeButton('Exemplo', 'ghost');
    this.importFileButton = makeButton('Arquivo', 'ghost');

    wrap.append(
      this.loadButton,
      this.startButton,
      this.pauseButton,
      this.stopButton,
      this.copyAllButton,
      this.downloadExampleButton,
    );

    const row = createElement('div', 'nlm-controls-row');
    row.append(this.importFileButton);
    wrap.append(row);

    return wrap;
  }

  buildEditor() {
    const wrap = createElement('div', 'nlm-editor-wrap');
    const titleRow = createElement('div', 'nlm-section-title');
    titleRow.innerHTML = '';
    const left = createElement('span');
    left.textContent = 'Entrada JSON';
    const right = createElement('span', 'nlm-muted');
    right.textContent = 'Aceita array ou { items: [] }';
    titleRow.append(left, right);

    this.textarea = createElement('textarea', 'nlm-textarea');
    this.textarea.placeholder = `[
  { "text": "Item 1" },
  { "text": "Item 2" },
  { "text": "Item 3" }
]`;

    const row = createElement('div', 'nlm-inline-actions');
    this.loadNowButton = makeButton('Carregar agora', 'secondary');
    this.clearButton = makeButton('Limpar', 'ghost');
    row.append(this.loadNowButton, this.clearButton);

    wrap.append(titleRow, this.textarea, row);
    return wrap;
  }

  buildStats() {
    const wrap = createElement('div', 'nlm-stats');
    this.statusChip = createElement('div', 'nlm-chip');
    this.statusChip.dataset.tone = 'idle';
    this.statusChip.textContent = 'IDLE';

    this.progressChip = createElement('div', 'nlm-mini');
    this.progressChip.innerHTML = '<strong>0</strong> itens carregados';

    this.currentChip = createElement('div', 'nlm-mini');
    this.currentChip.innerHTML = '<strong>Pronto</strong> para iniciar';

    this.progressBar = createElement('div', 'nlm-progress');
    this.progressBarFill = createElement('div', 'nlm-progress-bar');
    this.progressBar.appendChild(this.progressBarFill);

    wrap.append(this.statusChip, this.progressChip, this.currentChip, this.progressBar);
    return wrap;
  }

  buildHistory() {
    const wrap = createElement('div', 'nlm-history');
    const title = createElement('div', 'nlm-section-title');
    const left = createElement('span');
    left.textContent = 'Histórico';
    this.historyCount = createElement('span', 'nlm-muted');
    this.historyCount.textContent = '0 respostas';
    title.append(left, this.historyCount);

    this.historyList = createElement('div', 'nlm-history-list');
    wrap.append(title, this.historyList);
    return wrap;
  }

  buildFooter() {
    const footer = createElement('div', 'nlm-footer');
    this.footerText = createElement('div', 'nlm-muted');
    this.footerText.textContent = 'Esc pausa e recolhe o painel';
    this.footerInfo = createElement('div', 'nlm-muted');
    this.footerInfo.textContent = '90s por lote';
    footer.append(this.footerText, this.footerInfo);
    return footer;
  }

  bindEvents() {
    this.collapseButton.addEventListener('click', () => {
      this.onToggleCollapsed?.(!this.isCollapsed);
    });

    this.rail.addEventListener('click', () => {
      this.onToggleCollapsed?.(!this.isCollapsed);
    });

    this.startButton.addEventListener('click', () => this.onStart?.());
    this.pauseButton.addEventListener('click', () => this.onTogglePause?.());
    this.stopButton.addEventListener('click', () => this.onStop?.());
    this.copyAllButton.addEventListener('click', () => this.onCopyAll?.());
    this.loadButton.addEventListener('click', () => this.onLoadJson?.());
    this.loadNowButton.addEventListener('click', () => this.onLoadJson?.());
    this.clearButton.addEventListener('click', () => {
      this.setEditorValue('');
      this.onDraftChange?.('');
      this.setNotice('Entrada limpa.', 'success');
    });
    this.downloadExampleButton.addEventListener('click', () => this.onDownloadExample?.());
    this.importFileButton.addEventListener('click', () => this.fileInput?.click());

    this.textarea.addEventListener('input', () => {
      if (this.ignoreEditorEvents) return;
      this.onDraftChange?.(this.textarea.value);
    });

    this.textarea.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (!file) return;
      this.onImportFile?.(file);
    });
    this.shadow.appendChild(this.fileInput);
  }

  mount() {
    if (!document.body.contains(this.host)) {
      document.body.appendChild(this.host);
    }
  }

  destroy() {
    this.host.remove();
  }

  setCollapsed(collapsed) {
    this.isCollapsed = Boolean(collapsed);
    this.shell.classList.toggle('is-collapsed', this.isCollapsed);
    this.collapseButton.textContent = this.isCollapsed ? 'Abrir' : 'Recolher';
  }

  setNotice(text, tone = 'info') {
    const normalized = String(text ?? '').trim();
    this.notice.textContent = normalized;
    this.notice.classList.toggle('is-error', tone === 'error');
    this.notice.classList.toggle('is-success', tone === 'success');
  }

  setEditorValue(text) {
    this.ignoreEditorEvents = true;
    this.textarea.value = String(text ?? '');
    this.ignoreEditorEvents = false;
  }

  getEditorValue() {
    return this.textarea.value;
  }

  render(state) {
    this.state = state;
    this.setCollapsed(state.collapsed);

    const statusTone = state.status || 'idle';
    this.statusChip.dataset.tone = statusTone;
    this.statusChip.textContent = statusTone.toUpperCase();

    const loadedCount = Array.isArray(state.queue) ? state.queue.length : 0;
    const historyCount = Array.isArray(state.history) ? state.history.length : 0;
    this.progressChip.innerHTML = `<strong>${loadedCount}</strong> itens carregados`;
    this.historyCount.textContent = `${historyCount} resposta${historyCount === 1 ? '' : 's'}`;

    const current = state.currentBatch;
    if (current) {
      const statusLabel = {
        sending: `Enviando lote ${current.batchNumber}`,
        waiting: `Aguardando ${formatDuration(current.remainingMs ?? 0)}`,
        capturing: `Capturando lote ${current.batchNumber}`,
      }[current.phase] || `Lote ${current.batchNumber}`;
      this.currentChip.innerHTML = `<strong>${statusLabel}</strong> · itens ${formatRange(current.startIndex, current.endIndex)}`;
      const progress = loadedCount > 0 ? Math.min(100, ((current.endIndex + 1) / loadedCount) * 100) : 0;
      this.progressBarFill.style.width = `${progress}%`;
    } else if (state.status === 'done') {
      this.currentChip.innerHTML = '<strong>Concluído</strong> · pronto para novo JSON';
      this.progressBarFill.style.width = '100%';
    } else if (state.status === 'paused') {
      this.currentChip.innerHTML = '<strong>Pausado</strong> · pode retomar do mesmo ponto';
      const progress = loadedCount > 0 ? (Math.min(state.nextIndex, loadedCount) / loadedCount) * 100 : 0;
      this.progressBarFill.style.width = `${progress}%`;
    } else if (state.status === 'error') {
      this.currentChip.innerHTML = `<strong>Erro</strong> · revise a DOM ou o JSON`;
    } else {
      this.currentChip.innerHTML = '<strong>Pronto</strong> para iniciar';
      const progress = loadedCount > 0 ? (Math.min(state.nextIndex, loadedCount) / loadedCount) * 100 : 0;
      this.progressBarFill.style.width = `${progress}%`;
    }

    const pauseLabel = state.status === 'running' ? 'Pause' : 'Resume';
    this.pauseButton.textContent = pauseLabel;
    this.pauseButton.disabled = !(state.status === 'running' || state.status === 'paused' || state.status === 'stopped');
    this.startButton.disabled = state.status === 'running';
    this.stopButton.disabled = !(state.status === 'running' || state.status === 'paused' || state.status === 'stopped');
    this.copyAllButton.disabled = historyCount === 0;

    if (state.lastError) {
      this.setNotice(state.lastError, 'error');
    } else if (state.lastInfo) {
      this.setNotice(state.lastInfo, state.status === 'done' ? 'success' : 'info');
    } else {
      this.setNotice('', 'info');
    }

    if (this.shadow.activeElement !== this.textarea) {
      this.setEditorValue(state.draftText || '');
    }

    this.renderHistory(state.history || []);
    this.footerInfo.textContent = state.status === 'running' && current?.phase === 'waiting'
      ? `Aguardando: ${formatDuration(current.remainingMs ?? 0)}`
      : `90s por lote · ${formatDateTime(state.updatedAt) || 'sem data'}`;
  }

  renderHistory(history) {
    const nodes = [];

    if (!history.length) {
      const empty = createElement('div', 'nlm-mini');
      empty.textContent = 'Nenhuma resposta capturada ainda.';
      nodes.push(empty);
      this.historyList.replaceChildren(...nodes);
      return;
    }

    history.forEach((entry, index) => {
      const article = createElement('article', 'nlm-entry');

      const head = createElement('div', 'nlm-entry-head');
      const titleWrap = createElement('div', 'nlm-entry-title');
      const title = createElement('strong');
      title.textContent = `Lote ${entry.batchNumber ?? index + 1}`;
      const meta = createElement('div', 'nlm-entry-meta');
      meta.textContent = `Itens ${formatRange(entry.startIndex, entry.endIndex)} · ${formatDateTime(entry.capturedAt) || 'sem data'}`;
      titleWrap.append(title, meta);

      const copyButton = makeButton('Copiar', 'ghost');
      copyButton.addEventListener('click', () => this.onCopyEntry?.(entry.id));
      head.append(titleWrap, copyButton);

      const items = createElement('div', 'nlm-entry-items');
      items.textContent = `Enviado: ${entry.items?.join(' | ') || ''}`;

      const response = createElement('pre', 'nlm-entry-response');
      response.textContent = entry.responseText || '';

      article.append(head, items, response);
      nodes.push(article);
    });

    this.historyList.replaceChildren(...nodes);
  }

  promptDownloadExample() {
    downloadText('notebooklm-classificacao-example.json', createExampleJson(), 'application/json;charset=utf-8');
  }
}
