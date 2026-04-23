import {
  buildBatchText,
  buildHistoryClipboardText,
  buildFirstBatchText,
  loadState,
  parseQueueFromJson,
  saveState,
} from './storage';
import {
  copyText,
  createAbortError,
  delay,
  formatDuration,
  normalizeDisplayText,
} from './utils';
import {
  findLatestAssistantMessage,
  reconcileAssistantTranscript,
  sendBatchToNotebook,
  snapshotAssistantSignatures,
  waitForBatchDeadline,
} from './dom';
import { normalizeWaitMs } from './storage';

const BATCH_SIZE = 3;
const CAPTURE_TIMEOUT_MS = 45_000;
const CAPTURE_STABLE_POLLS = 2;

function formatError(error) {
  if (!error) return 'Erro desconhecido.';
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function toSignatureSet(values) {
  return new Set(
    values
      .filter(Boolean)
      .map(value => String(value)),
  );
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

  getWaitMs() {
    return normalizeWaitMs(this.state.waitMs);
  }

  updateWaitMs(waitMs) {
    const normalized = normalizeWaitMs(waitMs);
    const patch = { waitMs: normalized };

    if (this.state.status !== 'running') {
      patch.lastInfo = `Tempo de espera ajustado para ${formatDuration(normalized)}.`;
    }

    this.persist(patch);
    return normalized;
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

    const preservedHistory = Array.isArray(this.state.history)
      ? this.state.history.map(entry => ({ ...entry }))
      : [];
    const hasQueue = Array.isArray(this.state.queue) && this.state.queue.length > 0;
    this.persist({
      status: 'idle',
      running: false,
      paused: false,
      nextIndex: 0,
      history: preservedHistory,
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
    const reconciledHistory = await this.reconcileHistoryFromDom();
    const text = buildHistoryClipboardText(reconciledHistory);
    if (!text.trim()) throw new Error('Ainda não existem respostas da IA no histórico.');

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

  getBatchSlice(startIndex) {
    if (!Array.isArray(this.state.queue) || startIndex < 0) return [];
    return this.state.queue.slice(startIndex, startIndex + BATCH_SIZE);
  }

  buildBatchSnapshot(startIndex, fallback = {}) {
    const safeStartIndex = Number.isFinite(startIndex) ? startIndex : 0;
    const queueSlice = this.getBatchSlice(safeStartIndex);
    const fallbackItems = Array.isArray(fallback.items) && fallback.items.length
      ? fallback.items
      : queueSlice.map(item => item.text);
    const itemCount = Number.isFinite(fallback.itemCount)
      ? fallback.itemCount
      : fallbackItems.length;
    const endIndex = Number.isFinite(fallback.endIndex)
      ? fallback.endIndex
      : Math.max(safeStartIndex, safeStartIndex + Math.max(itemCount, 1) - 1);

    return {
      batchNumber: Number.isFinite(fallback.batchNumber)
        ? fallback.batchNumber
        : Math.floor(safeStartIndex / BATCH_SIZE) + 1,
      startIndex: safeStartIndex,
      endIndex,
      itemCount,
      items: fallbackItems,
      promptText: fallback.promptText || (queueSlice.length
        ? (safeStartIndex === 0 ? buildFirstBatchText(queueSlice) : buildBatchText(queueSlice))
        : ''),
    };
  }

  createHistoryEntryFromMessage(messageOrder, message, existingEntry = null) {
    const fallbackStartIndex = Number.isFinite(existingEntry?.startIndex)
      ? existingEntry.startIndex
      : messageOrder * BATCH_SIZE;
    const snapshot = this.buildBatchSnapshot(fallbackStartIndex, existingEntry || {});
    const capturedFromDomAt = new Date().toISOString();
    const text = normalizeDisplayText(message?.text || existingEntry?.responseText || '');
    const signature = message?.signature ? String(message.signature) : String(existingEntry?.responseSignature || '');
    const changed = existingEntry
      ? normalizeDisplayText(existingEntry.responseText || '') !== text || String(existingEntry.responseSignature || '') !== signature
      : true;

    return {
      id: existingEntry?.id || `response_${Date.now()}_${snapshot.batchNumber}`,
      batchNumber: snapshot.batchNumber,
      startIndex: snapshot.startIndex,
      endIndex: snapshot.endIndex,
      itemCount: snapshot.itemCount,
      items: snapshot.items,
      promptText: snapshot.promptText,
      responseText: text,
      responseSignature: signature,
      capturedAt: existingEntry?.capturedAt || capturedFromDomAt,
      messageIndex: Number.isFinite(message?.messageIndex) ? message.messageIndex : existingEntry?.messageIndex ?? null,
      responseSource: message?.source || existingEntry?.responseSource || 'dom',
      capturedFromDomAt: existingEntry?.capturedFromDomAt || capturedFromDomAt,
      reconciledAt: changed ? capturedFromDomAt : existingEntry?.reconciledAt || '',
    };
  }

  async reconcileHistoryFromDom() {
    const baseHistory = Array.isArray(this.state.history) ? this.state.history : [];
    const transcript = reconcileAssistantTranscript(baseHistory);
    const assistantMessages = Array.isArray(transcript.messages) ? transcript.messages : [];

    if (!assistantMessages.length) {
      return baseHistory;
    }

    const reconciledHistory = [];
    const maxLength = Math.max(assistantMessages.length, baseHistory.length);

    for (let index = 0; index < maxLength; index += 1) {
      const message = assistantMessages[index];
      const existingEntry = baseHistory[index] || null;

      if (!message) {
        if (existingEntry) reconciledHistory.push(existingEntry);
        continue;
      }

      reconciledHistory.push(this.createHistoryEntryFromMessage(index, message, existingEntry));
    }

    this.persist({
      history: reconciledHistory,
      lastCapturedSignature: reconciledHistory.at(-1)?.responseSignature || this.state.lastCapturedSignature,
      lastInfo: 'Histórico reconciliado com o DOM atual.',
      lastError: '',
    });

    return reconciledHistory;
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
        const promptText = cursor === 0 ? buildFirstBatchText(batch) : buildBatchText(batch);
        const batchId = `batch_${Date.now()}_${cursor}`;
        const baselineSignatures = snapshotAssistantSignatures();
        const waitMs = this.getWaitMs();
        const initialBatchState = {
          id: batchId,
          batchNumber,
          startIndex: cursor,
          endIndex: cursor + batch.length - 1,
          itemCount: batch.length,
          items: batch.map(item => item.text),
          promptText,
          baselineSignatures,
          waitMs,
          phase: 'sending',
          sentAt: null,
          waitDeadlineAt: null,
          remainingMs: waitMs,
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
            waitMs,
            waitDeadlineAt: sentAt + waitMs,
            remainingMs: waitMs,
          },
          lastInfo: `Lote ${batchNumber} enviado. Aguardando ${formatDuration(waitMs)}...`,
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

        const message = await this.captureLatestResponse(signal, baselineSignatures);
        if (!message) {
          throw new Error('Não encontrei uma resposta nova da IA para o lote atual.');
        }

        const entry = this.createHistoryEntryFromMessage(batchNumber - 1, message, {
          batchNumber,
          startIndex: cursor,
          endIndex: cursor + batch.length - 1,
          itemCount: batch.length,
          items: batch.map(item => item.text),
          promptText,
        });

        this.persist({
          history: [...this.state.history, entry],
          lastCapturedSignature: entry.responseSignature,
          nextIndex: cursor + batch.length,
          currentBatch: null,
          lastInfo: `Lote ${batchNumber} capturado.`,
          lastError: '',
        });
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

    const message = await this.captureLatestResponse(signal, baselineSignatures);
    if (!message) {
      throw new Error('Não encontrei uma resposta nova da IA para o lote retomado.');
    }

    const entry = this.createHistoryEntryFromMessage(current.batchNumber - 1, message, {
      batchNumber: current.batchNumber,
      startIndex: current.startIndex,
      endIndex: current.endIndex,
      itemCount: current.itemCount,
      items: current.items,
      promptText: current.promptText,
    });

    this.persist({
      history: [...this.state.history, entry],
      lastCapturedSignature: entry.responseSignature,
      nextIndex: current.endIndex + 1,
      currentBatch: null,
      status: 'running',
      running: true,
      paused: false,
      lastInfo: `Lote ${current.batchNumber} retomado e capturado.`,
      lastError: '',
    });
  }

  async captureLatestResponse(signal, baselineSignatures = []) {
    const excluded = toSignatureSet([
      this.state.lastCapturedSignature,
      ...baselineSignatures,
    ]);
    const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
    let stableCandidate = null;
    let stableReads = 0;
    let lastSeenCandidate = null;

    while (!signal.aborted && Date.now() < deadline) {
      const candidate = findLatestAssistantMessage({
        excludeSignatures: excluded,
        includeSummaryFallback: true,
      });

      if (candidate?.signature && !excluded.has(candidate.signature)) {
        lastSeenCandidate = candidate;

        const sameCandidate = stableCandidate
          && stableCandidate.signature === candidate.signature
          && normalizeDisplayText(stableCandidate.text) === normalizeDisplayText(candidate.text);

        if (sameCandidate) {
          stableReads += 1;
        } else {
          stableCandidate = candidate;
          stableReads = 1;
        }

        if (stableReads >= CAPTURE_STABLE_POLLS) {
          return candidate;
        }
      }

      await delay(1000, signal);
    }

    return lastSeenCandidate;
  }

  async maybeResumeCurrentBatch() {
    if (this.state.currentBatch?.phase === 'waiting' || this.state.currentBatch?.phase === 'capturing') {
      return this.start();
    }

    return this.startFromDraft();
  }
}
