import { downloadText, formatDateTime, formatDuration } from './utils';
import { createExampleJson } from './storage';

const PANEL_WIDTH = 392;
const LAUNCHER_SIZE = 56;
const DEFAULT_LAUNCHER_TOP = 120;

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

function setChipContent(container, primaryText, secondaryText = '') {
  container.replaceChildren();

  const strong = createElement('strong');
  strong.textContent = primaryText;
  container.appendChild(strong);

  if (secondaryText) {
    container.appendChild(document.createTextNode(secondaryText));
  }
}

export class ClassificacaoPanel {
  constructor({
    onDraftChange,
    onLoadJson,
    onStart,
    onTogglePause,
    onStop,
    onReset,
    onCopyAll,
    onCopyEntry,
    onToggleCollapsed,
    onLauncherTopChange,
    onImportFile,
    onDownloadExample,
  } = {}) {
    this.onDraftChange = onDraftChange;
    this.onLoadJson = onLoadJson;
    this.onStart = onStart;
    this.onTogglePause = onTogglePause;
    this.onStop = onStop;
    this.onReset = onReset;
    this.onCopyAll = onCopyAll;
    this.onCopyEntry = onCopyEntry;
    this.onToggleCollapsed = onToggleCollapsed;
    this.onLauncherTopChange = onLauncherTopChange;
    this.onImportFile = onImportFile;
    this.onDownloadExample = onDownloadExample;

    this.state = null;
    this.ignoreEditorEvents = false;
    this.isCollapsed = false;
    this.launcherTop = DEFAULT_LAUNCHER_TOP;
    this.launcherDragState = null;
    this.launcherDragCleanup = null;
    this.suppressLauncherClick = false;

    this.host = document.createElement('div');
    this.host.id = 'nlm-classificacao-host';
    this.host.setAttribute('aria-live', 'polite');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.buildStyles();
    this.shadow.appendChild(style);

    this.shell = createElement('div', 'nlm-shell');
    this.panel = createElement('aside', 'nlm-panel');
    this.panel.id = 'nlm-classificacao-panel';
    this.rail = createElement('div', 'nlm-rail');
    this.rail.id = 'nlm-classificacao-rail';
    this.railButton = createElement('button', 'nlm-rail-button');
    this.railButton.type = 'button';
    this.railButton.title = 'Abrir painel e arrastar para mover';
    this.railButton.setAttribute('aria-label', 'Abrir painel do Classificacao');

    const railBadge = createElement('span', 'nlm-rail-badge');
    railBadge.textContent = 'NLM';
    const railHint = createElement('span', 'nlm-rail-hint');
    railHint.textContent = '↕';
    this.railButton.append(railBadge, railHint);
    this.rail.append(this.railButton);
    this.railButton.tabIndex = -1;
    this.railButton.setAttribute('aria-hidden', 'true');

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
    this.bindEvents();
    this.applyLauncherTop(this.launcherTop, { persist: false });
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
        width: 0;
        z-index: 2147483647;
        pointer-events: none;
        overflow: visible;
        font-family: "Google Sans Text", "Google Sans", "Segoe UI", sans-serif;
        color: #eef2ff;
        --nlm-launcher-top: ${DEFAULT_LAUNCHER_TOP}px;
        --nlm-launcher-size: ${LAUNCHER_SIZE}px;
      }

      .nlm-panel {
        position: fixed;
        inset: 0 auto 0 0;
        width: min(${PANEL_WIDTH}px, calc(100vw - 16px));
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
        transition:
          transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
          box-shadow 220ms ease,
          background 220ms ease;
        will-change: transform, opacity;
      }

      .nlm-shell.is-collapsed .nlm-panel {
        background: transparent;
        border-right-color: transparent;
        box-shadow: none;
        transform: translateX(calc(-100% - 16px));
        pointer-events: none;
      }

      .nlm-content {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px 14px 14px 14px;
        overflow: hidden;
        transition: opacity 160ms ease, transform 180ms ease;
      }

      .nlm-shell.is-collapsed .nlm-content {
        opacity: 0;
        pointer-events: none;
        transform: translateX(-12px);
      }

      .nlm-rail {
        position: fixed;
        left: 12px;
        top: var(--nlm-launcher-top);
        width: calc(var(--nlm-launcher-size) + 6px);
        height: calc(var(--nlm-launcher-size) + 6px);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        opacity: 1;
        transition: opacity 160ms ease, transform 180ms ease;
        z-index: 2;
      }

      .nlm-shell:not(.is-collapsed) .nlm-rail {
        opacity: 0;
        pointer-events: none;
        transform: translateX(-10px) scale(0.92);
      }

      .nlm-shell.is-collapsed .nlm-rail,
      .nlm-shell.is-collapsed .nlm-rail-button {
        pointer-events: auto;
      }

      .nlm-rail-button {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 20px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background:
          radial-gradient(circle at 25% 20%, rgba(255, 255, 255, 0.3), transparent 36%),
          linear-gradient(180deg, rgba(14, 165, 233, 0.96), rgba(37, 99, 235, 0.94) 58%, rgba(15, 23, 42, 0.98));
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        letter-spacing: 0.14em;
        font-size: 10px;
        font-weight: 800;
        cursor: grab;
        box-shadow:
          0 14px 30px rgba(15, 23, 42, 0.38),
          0 0 0 1px rgba(255, 255, 255, 0.1) inset;
        transform: translateY(0) scale(1);
        transition: transform 160ms ease, box-shadow 180ms ease, filter 180ms ease, opacity 180ms ease;
        overflow: hidden;
        touch-action: none;
        user-select: none;
        z-index: 1;
      }

      .nlm-rail-button::before {
        content: "";
        position: absolute;
        inset: 1px;
        border-radius: inherit;
        background:
          radial-gradient(circle at 28% 24%, rgba(255, 255, 255, 0.4), transparent 42%),
          radial-gradient(circle at 70% 82%, rgba(56, 189, 248, 0.18), transparent 46%);
        opacity: 0.9;
        pointer-events: none;
      }

      .nlm-rail-button:hover {
        filter: brightness(1.04);
        box-shadow:
          0 16px 30px rgba(15, 23, 42, 0.42),
          0 0 0 1px rgba(255, 255, 255, 0.14) inset,
          0 0 0 8px rgba(56, 189, 248, 0.09);
      }

      .nlm-rail-button:active {
        cursor: grabbing;
        transform: translateY(1px) scale(0.98);
      }

      .nlm-shell.is-collapsed .nlm-rail-button {
        animation:
          nlm-button-float 4.8s ease-in-out infinite,
          nlm-button-pulse 5.4s ease-in-out infinite;
      }

      .nlm-shell.is-collapsed .nlm-rail-button:hover {
        filter: brightness(1.08);
        box-shadow:
          0 18px 36px rgba(15, 23, 42, 0.48),
          0 0 0 1px rgba(255, 255, 255, 0.16) inset,
          0 0 0 10px rgba(56, 189, 248, 0.08);
      }

      .nlm-shell.is-launcher-dragging .nlm-rail-button {
        animation-play-state: paused;
        cursor: grabbing;
      }

      .nlm-rail-badge,
      .nlm-rail-hint {
        position: relative;
        z-index: 1;
        line-height: 1;
        text-transform: uppercase;
      }

      .nlm-rail-badge {
        font-size: 11px;
        letter-spacing: 0.14em;
      }

      .nlm-rail-hint {
        font-size: 11px;
        letter-spacing: 0.02em;
        opacity: 0.9;
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
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .nlm-controls .nlm-btn {
        flex: 1 1 112px;
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

      @keyframes nlm-button-float {
        0%, 100% {
          transform: translateY(0) scale(1);
        }
        50% {
          transform: translateY(-5px) scale(1.01);
        }
      }

      @keyframes nlm-button-pulse {
        0%, 100% {
          box-shadow:
            0 12px 28px rgba(15, 23, 42, 0.34),
            0 0 0 1px rgba(255, 255, 255, 0.08) inset;
        }
        50% {
          box-shadow:
            0 16px 34px rgba(15, 23, 42, 0.44),
            0 0 0 1px rgba(255, 255, 255, 0.14) inset,
            0 0 0 10px rgba(56, 189, 248, 0.06);
        }
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
    this.resetButton = makeButton('Zerar progresso', 'ghost');
    this.copyAllButton = makeButton('Copiar tudo', 'secondary');
    this.downloadExampleButton = makeButton('Exemplo', 'ghost');
    this.importFileButton = makeButton('Arquivo', 'ghost');

    wrap.append(
      this.loadButton,
      this.startButton,
      this.pauseButton,
      this.stopButton,
      this.resetButton,
      this.copyAllButton,
      this.downloadExampleButton,
      this.importFileButton,
    );

    return wrap;
  }

  buildEditor() {
    const wrap = createElement('div', 'nlm-editor-wrap');
    const titleRow = createElement('div', 'nlm-section-title');
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
    setChipContent(this.progressChip, '0', ' itens carregados');

    this.currentChip = createElement('div', 'nlm-mini');
    setChipContent(this.currentChip, 'Pronto', ' para iniciar');

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

    this.railButton.addEventListener('click', event => {
      if (this.suppressLauncherClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (this.isCollapsed) {
        this.onToggleCollapsed?.(false);
      }
    });

    this.startButton.addEventListener('click', () => this.onStart?.());
    this.pauseButton.addEventListener('click', () => this.onTogglePause?.());
    this.stopButton.addEventListener('click', () => this.onStop?.());
    this.resetButton.addEventListener('click', () => this.onReset?.());
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

    this.railButton.addEventListener('pointerdown', event => {
      if (!this.isCollapsed) return;
      if (event.button !== 0) return;

      event.preventDefault();

      const pointerId = event.pointerId;
      const startTop = this.launcherTop;
      const startY = event.clientY;
      const dragState = {
        pointerId,
        startY,
        startTop,
        moved: false,
      };

      this.launcherDragState = dragState;
      this.shell.classList.add('is-launcher-dragging');

      const handleMove = moveEvent => {
        if (!this.launcherDragState || moveEvent.pointerId !== pointerId) return;
        const delta = moveEvent.clientY - startY;
        if (Math.abs(delta) > 4) {
          this.launcherDragState.moved = true;
        }

        this.applyLauncherTop(startTop + delta, { persist: false });
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', handleMove, true);
        window.removeEventListener('pointerup', handleUp, true);
        window.removeEventListener('pointercancel', handleCancel, true);
        this.shell.classList.remove('is-launcher-dragging');
        this.launcherDragCleanup = null;
      };

      const handleUp = upEvent => {
        if (upEvent.pointerId !== pointerId) return;
        cleanup();

        const wasMoved = Boolean(this.launcherDragState?.moved);
        this.launcherDragState = null;

        if (wasMoved) {
          this.suppressLauncherClick = true;
          window.setTimeout(() => {
            this.suppressLauncherClick = false;
          }, 0);
          this.onLauncherTopChange?.(this.launcherTop);
          return;
        }

        this.onToggleCollapsed?.(false);
      };

      const handleCancel = cancelEvent => {
        if (cancelEvent.pointerId !== pointerId) return;
        cleanup();
        this.launcherDragState = null;
      };

      try {
        this.railButton.setPointerCapture?.(pointerId);
      } catch {
        // Ignorar se o browser não suportar
      }

      window.addEventListener('pointermove', handleMove, true);
      window.addEventListener('pointerup', handleUp, true);
      window.addEventListener('pointercancel', handleCancel, true);
      this.launcherDragCleanup = cleanup;
    });

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

    this.handleWindowResize = () => {
      const clamped = this.clampLauncherTop(this.launcherTop);
      if (clamped !== this.launcherTop) {
        this.onLauncherTopChange?.(clamped);
        return;
      }

      this.applyLauncherTop(clamped, { persist: false });
    };

    window.addEventListener('resize', this.handleWindowResize, { passive: true });
  }

  mount() {
    if (!document.body) return;
    if (!document.body.contains(this.host)) {
      document.body.appendChild(this.host);
    }
  }

  destroy() {
    this.launcherDragCleanup?.();
    window.removeEventListener('resize', this.handleWindowResize);
    this.host.remove();
  }

  setCollapsed(collapsed) {
    this.isCollapsed = Boolean(collapsed);
    this.shell.classList.toggle('is-collapsed', this.isCollapsed);
    this.collapseButton.textContent = this.isCollapsed ? 'Abrir' : 'Recolher';
    this.railButton.tabIndex = this.isCollapsed ? 0 : -1;
    this.railButton.setAttribute('aria-hidden', this.isCollapsed ? 'false' : 'true');
    this.railButton.title = this.isCollapsed
      ? 'Clique para abrir ou arraste para mover'
      : 'Painel aberto';
  }

  getLauncherButtonHeight() {
    return this.railButton?.offsetHeight || 60;
  }

  clampLauncherTop(top) {
    const parsed = Number(top);
    const viewportHeight = Math.max(window.innerHeight || document.documentElement?.clientHeight || 0, 0);
    const buttonHeight = this.getLauncherButtonHeight();
    const minTop = 12;
    const maxTop = Math.max(minTop, viewportHeight - buttonHeight - 12);

    if (!Number.isFinite(parsed)) {
      return this.launcherTop || DEFAULT_LAUNCHER_TOP;
    }

    return Math.min(maxTop, Math.max(minTop, Math.round(parsed)));
  }

  applyLauncherTop(top, { persist = true } = {}) {
    const safeTop = this.clampLauncherTop(top);
    this.launcherTop = safeTop;
    this.shell.style.setProperty('--nlm-launcher-top', `${safeTop}px`);

    if (persist) {
      this.onLauncherTopChange?.(safeTop);
    }

    return safeTop;
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
    this.applyLauncherTop(Number.isFinite(state.launcherTop) ? state.launcherTop : this.launcherTop, { persist: false });

    const statusTone = state.status || 'idle';
    this.statusChip.dataset.tone = statusTone;
    this.statusChip.textContent = statusTone.toUpperCase();

    const loadedCount = Array.isArray(state.queue) ? state.queue.length : 0;
    const historyCount = Array.isArray(state.history) ? state.history.length : 0;
    setChipContent(this.progressChip, String(loadedCount), ' itens carregados');
    this.historyCount.textContent = `${historyCount} resposta${historyCount === 1 ? '' : 's'}`;

    const current = state.currentBatch;
    if (current) {
      const statusLabel = {
        sending: `Enviando lote ${current.batchNumber}`,
        waiting: `Aguardando ${formatDuration(current.remainingMs ?? 0)}`,
        capturing: `Capturando lote ${current.batchNumber}`,
      }[current.phase] || `Lote ${current.batchNumber}`;
      setChipContent(this.currentChip, statusLabel, ` · itens ${formatRange(current.startIndex, current.endIndex)}`);
      const progress = loadedCount > 0 ? Math.min(100, ((current.endIndex + 1) / loadedCount) * 100) : 0;
      this.progressBarFill.style.width = `${progress}%`;
    } else if (state.status === 'done') {
      setChipContent(this.currentChip, 'Concluído', ' · pronto para novo JSON');
      this.progressBarFill.style.width = '100%';
    } else if (state.status === 'paused') {
      setChipContent(this.currentChip, 'Pausado', ' · pode retomar do mesmo ponto');
      const progress = loadedCount > 0 ? (Math.min(state.nextIndex, loadedCount) / loadedCount) * 100 : 0;
      this.progressBarFill.style.width = `${progress}%`;
    } else if (state.status === 'error') {
      setChipContent(this.currentChip, 'Erro', ' · revise a DOM ou o JSON');
    } else {
      setChipContent(this.currentChip, 'Pronto', ' para iniciar');
      const progress = loadedCount > 0 ? (Math.min(state.nextIndex, loadedCount) / loadedCount) * 100 : 0;
      this.progressBarFill.style.width = `${progress}%`;
    }

    const pauseLabel = state.status === 'running' ? 'Pause' : 'Resume';
    this.pauseButton.textContent = pauseLabel;
    this.pauseButton.disabled = !(state.status === 'running' || state.status === 'paused' || state.status === 'stopped');
    this.startButton.disabled = state.status === 'running';
    this.stopButton.disabled = !(state.status === 'running' || state.status === 'paused' || state.status === 'stopped');
    this.resetButton.disabled = !loadedCount && historyCount === 0 && !current;
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
    this.footerText.textContent = state.collapsed
      ? 'Botão flutuante recolhido. Arraste para mudar de posição.'
      : 'Esc pausa e recolhe o painel.';
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
