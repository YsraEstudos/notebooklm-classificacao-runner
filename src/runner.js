import {
  buildBatchText,
  buildHistoryClipboardText,
  loadState,
  parseQueueFromJson,
  saveState,
} from './storage';
import {
  copyText,
  createAbortError,
  delay,
  normalizeDisplayText,
} from './utils';
import {
  clickNativeCopyButton,
  findLatestResponseCandidate,
  sendBatchToNotebook,
  snapshotResponseSignatures,
  waitForBatchDeadline,
} from './dom';

const BATCH_SIZE = 3;
const WAIT_MS = 90_000;
const CAPTURE_TIMEOUT_MS = 45_000;

function formatError(error) {
  if (!error) return 'Erro desconhecido.';
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export class ClassificacaoRunner {
  constructor({ onChange, onLog } = {}) {
    this.onChange = onChange;
    this.onLog = onLog;
    this.state = loadState();
    this.controller = null;
    this.activePromise = null;

    if (this.state.status === 'running') {
      this.state = {
        ...this.state,
        status: 'paused',
        running: false,
        paused: true,
        lastInfo: 'A execução foi restaurada em pausa após recarregar a página.',
      };
      this.persist();
    }
  }

  getState() {
    return this.state;
  }

  persist(patch = null) {
    if (patch) {
      this.state = {
        ...this.state,
        ...patch,
        updatedAt: Date.now(),
      };
    } else {
      this.state = {
        ...this.state,
        updatedAt: Date.now(),
      };
    }

    saveState(this.state);
    this.onChange?.(this.state);
    return this.state;
  }

  log(message, tone = 'info') {
    this.onLog?.(message, tone);
  }

  setCollapsed(collapsed) {
    this.persist({ collapsed: Boolean(collapsed) });
  }

  setLauncherTop(launcherTop) {
    const top = Number(launcherTop);
    if (!Number.isFinite(top)) return;
    this.persist({ launcherTop: top });
  }

  updateDraftText(text) {
    this.persist({ draftText: normalizeDisplayText(text) });
  }

  async loadDraftAndReset(text) {
    const normalized = normalizeDisplayText(text);
    const queue = parseQueueFromJson(normalized);

    this.persist({
      draftText: normalized,
      loadedText: normalized,
      queue,
      nextIndex: 0,
      history: [],
      currentBatch: null,
      lastCapturedSignature: '',
      lastError: '',
      lastInfo: `JSON carregado com ${queue.length} itens.`,
      status: 'idle',
      running: false,
      paused: false,
      runId: `run_${Date.now()}`,
    });

    return queue;
  }

  async ensureDraftLoaded() {
    const draftText = normalizeDisplayText(this.state.draftText);
    if (!draftText) {
      throw new Error('Cole um JSON no painel antes de iniciar.');
    }

    if (draftText !== normalizeDisplayText(this.state.loadedText) || !Array.isArray(this.state.queue) || this.state.queue.length === 0) {
      await this.loadDraftAndReset(draftText);
    }
  }

  async startFromDraft() {
    await this.ensureDraftLoaded();
    return this.start();
  }

  async start() {
    if (this.activePromise) return this.activePromise;

    if (!Array.isArray(this.state.queue) || this.state.queue.length === 0) {
      throw new Error('Carregue um JSON válido antes de iniciar.');
    }

    if (this.state.nextIndex >= this.state.queue.length && !this.state.currentBatch) {
      if (this.state.status === 'done') {
        throw new Error('A fila já terminou. Carregue um novo JSON para recomeçar.');
      }
      if (this.state.status !== 'paused' && this.state.status !== 'stopped') {
        throw new Error('Não há itens pendentes para processar.');
      }
    }

    this.controller = new AbortController();
    this.persist({
      status: 'running',
      running: true,
      paused: false,
      lastError: '',
      lastInfo: 'Execução iniciada.',
    });

    this.activePromise = this.processQueue(this.controller.signal).finally(() => {
      this.activePromise = null;
      this.controller = null;
    });

    return this.activePromise;
  }

  async pause({ collapse = false } = {}) {
    if (this.state.status !== 'running') {
      if (collapse) this.setCollapsed(true);
      return;
    }

    this.persist({
      status: 'paused',
      running: false,
      paused: true,
      lastInfo: 'Execução pausada.',
    });

    if (collapse) this.setCollapsed(true);

    this.controller?.abort();

    try {
      await this.activePromise;
    } catch {
      // Aborto esperado
    }
  }

  async stop() {
    if (this.state.status === 'idle') {
      this.persist({
        status: 'stopped',
        running: false,
        paused: false,
        lastInfo: 'Execução parada.',
      });
      return;
    }

    this.persist({
      status: 'stopped',
      running: false,
      paused: false,
      lastInfo: 'Execução parada.',
    });

    this.controller?.abort();

    try {
      await this.activePromise;
    } catch {
      // Aborto esperado
    }
  }

  async resetProgress() {
    if (this.state.status === 'running' || this.state.status === 'paused' || this.activePromise) {
      await this.stop();
    }

    const hasQueue = Array.isArray(this.state.queue) && this.state.queue.length > 0;
    this.persist({
      status: 'idle',
      running: false,
      paused: false,
      nextIndex: 0,
      history: Array.isArray(this.state.history) ? [...this.state.history] : [],
      currentBatch: null,
      lastCapturedSignature: '',
      lastError: '',
      lastInfo: hasQueue
        ? 'Progresso zerado. A fila voltou ao item 1 sem apagar o histórico.'
        : 'Progresso zerado. Carregue um JSON para começar.',
      runId: `run_${Date.now()}`,
    });
  }

  async togglePause() {
    if (this.state.status === 'running') {
      return this.pause();
    }

    if (this.state.status === 'paused' || this.state.status === 'stopped') {
      return this.start();
    }

    return Promise.resolve();
  }

  async copyAll() {
    const text = buildHistoryClipboardText(this.state.history);
    if (!text.trim()) throw new Error('Ainda não existem respostas no histórico.');

    const ok = await copyText(text);
    if (!ok) throw new Error('Não consegui copiar o histórico.');

    this.persist({ lastInfo: 'Histórico copiado.' });
    return true;
  }

  async copyHistoryEntry(entryId) {
    const entry = this.state.history.find(item => item.id === entryId);
    if (!entry) throw new Error('Resposta não encontrada no histórico.');

    const ok = await copyText(entry.responseText);
    if (!ok) throw new Error('Não consegui copiar a resposta.');

    this.persist({ lastInfo: 'Resposta copiada.' });
    return true;
  }

  async processQueue(signal) {
    try {
      if (this.state.currentBatch?.phase === 'waiting' || this.state.currentBatch?.phase === 'capturing') {
        await this.finishCurrentBatch(signal);
      }

      while (!signal.aborted && this.state.nextIndex < this.state.queue.length) {
        const cursor = this.state.nextIndex;
        const batch = this.state.queue.slice(cursor, cursor + BATCH_SIZE);

        if (!batch.length) break;

        const batchNumber = Math.floor(cursor / BATCH_SIZE) + 1;
        const promptText = buildBatchText(batch);
        const batchId = `batch_${Date.now()}_${cursor}`;
        const baselineSignatures = snapshotResponseSignatures();
        const initialBatchState = {
          id: batchId,
          batchNumber,
          startIndex: cursor,
          endIndex: cursor + batch.length - 1,
          itemCount: batch.length,
          items: batch.map(item => item.text),
          promptText,
          baselineSignatures,
          phase: 'sending',
          sentAt: null,
          waitDeadlineAt: null,
          remainingMs: WAIT_MS,
        };

        this.persist({
          currentBatch: initialBatchState,
          lastInfo: `Enviando lote ${batchNumber} (${cursor + 1}-${cursor + batch.length})...`,
          lastError: '',
        });

        await sendBatchToNotebook(promptText, signal);

        const sentAt = Date.now();
        this.persist({
          currentBatch: {
            ...this.state.currentBatch,
            phase: 'waiting',
            sentAt,
            waitDeadlineAt: sentAt + WAIT_MS,
            remainingMs: WAIT_MS,
          },
          lastInfo: `Lote ${batchNumber} enviado. Aguardando 90 segundos...`,
        });

        await waitForBatchDeadline(this.state.currentBatch.waitDeadlineAt, signal, remaining => {
          this.persist({
            currentBatch: {
              ...this.state.currentBatch,
              phase: 'waiting',
              remainingMs: remaining,
            },
          });
        });

        this.persist({
          currentBatch: {
            ...this.state.currentBatch,
            phase: 'capturing',
            remainingMs: 0,
          },
        });

        const candidate = await this.captureLatestResponse(signal, baselineSignatures);
        if (!candidate) {
          throw new Error('Não encontrei uma resposta nova para o lote atual.');
        }

        const entry = {
          id: `response_${Date.now()}_${batchNumber}`,
          batchNumber,
          startIndex: cursor,
          endIndex: cursor + batch.length - 1,
          itemCount: batch.length,
          items: batch.map(item => item.text),
          promptText,
          responseText: candidate.text,
          responseSignature: candidate.signature,
          capturedAt: new Date().toISOString(),
        };

        this.persist({
          history: [...this.state.history, entry],
          lastCapturedSignature: candidate.signature,
          nextIndex: cursor + batch.length,
          currentBatch: null,
          lastInfo: `Lote ${batchNumber} capturado.`,
          lastError: '',
        });

        clickNativeCopyButton(candidate.element);
      }

      if (!signal.aborted) {
        this.persist({
          status: 'done',
          running: false,
          paused: false,
          currentBatch: null,
          lastInfo: 'Fila concluída.',
          lastError: '',
        });
      }
    } catch (error) {
      if (signal.aborted && (this.state.status === 'paused' || this.state.status === 'stopped' || this.state.status === 'idle')) {
        return;
      }

      const message = formatError(error);
      this.persist({
        status: 'error',
        running: false,
        paused: false,
        lastError: message,
        lastInfo: '',
      });
      this.log(message, 'error');
    } finally {
      if (this.controller?.signal === signal) {
        this.controller = null;
      }
    }
  }

  async finishCurrentBatch(signal) {
    const current = this.state.currentBatch;
    if (!current) return;
    const baselineSignatures = Array.isArray(current.baselineSignatures) ? current.baselineSignatures : [];

    if (current.phase === 'waiting' && current.waitDeadlineAt) {
      await waitForBatchDeadline(current.waitDeadlineAt, signal, remaining => {
        this.persist({
          currentBatch: {
            ...this.state.currentBatch,
            remainingMs: remaining,
          },
        });
      });
    }

    const candidate = await this.captureLatestResponse(signal, baselineSignatures);
    if (!candidate) {
      throw new Error('Não encontrei uma resposta nova para o lote retomado.');
    }

    const entry = {
      id: `response_${Date.now()}_${current.batchNumber}`,
      batchNumber: current.batchNumber,
      startIndex: current.startIndex,
      endIndex: current.endIndex,
      itemCount: current.itemCount,
      items: current.items,
      promptText: current.promptText,
      responseText: candidate.text,
      responseSignature: candidate.signature,
      capturedAt: new Date().toISOString(),
    };

    this.persist({
      history: [...this.state.history, entry],
      lastCapturedSignature: candidate.signature,
      nextIndex: current.endIndex + 1,
      currentBatch: null,
      status: 'running',
      running: true,
      paused: false,
      lastInfo: `Lote ${current.batchNumber} retomado e capturado.`,
      lastError: '',
    });

    clickNativeCopyButton(candidate.element);
  }

  async captureLatestResponse(signal, baselineSignatures = []) {
    const excluded = new Set([
      this.state.lastCapturedSignature,
      ...baselineSignatures,
    ].filter(Boolean).map(value => String(value)));
    const deadline = Date.now() + CAPTURE_TIMEOUT_MS;

    while (!signal.aborted && Date.now() < deadline) {
      const candidate = findLatestResponseCandidate({
        excludeSignatures: excluded,
      });

      if (candidate) {
        const normalizedText = normalizeDisplayText(candidate.text);
        const signature = candidate.signature;

        if (signature && !excluded.has(signature) && normalizedText.length >= 20) {
          return candidate;
        }
      }

      await delay(1000, signal);
    }

    return null;
  }

  async maybeResumeCurrentBatch() {
    if (this.state.currentBatch?.phase === 'waiting' || this.state.currentBatch?.phase === 'capturing') {
      return this.start();
    }

    return this.startFromDraft();
  }
}
