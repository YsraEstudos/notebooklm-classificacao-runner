import { beforeEach, describe, expect, it, vi } from 'vitest';

const domMocks = vi.hoisted(() => ({
  sendBatchToNotebook: vi.fn(async () => true),
  snapshotResponseSignatures: vi.fn(() => []),
  waitForBatchDeadline: vi.fn(async () => 0),
  findLatestResponseCandidate: vi.fn(() => null),
  clickNativeCopyButton: vi.fn(() => true),
}));

vi.mock('../src/dom', () => domMocks);

vi.mock('../src/utils', async () => {
  const actual = await vi.importActual('../src/utils');
  return {
    ...actual,
    delay: vi.fn(() => Promise.resolve()),
    copyText: vi.fn(async () => true),
  };
});

import { ClassificacaoRunner } from '../src/runner';
import { createExampleJson } from '../src/storage';
import { copyText } from '../src/utils';
import { clickNativeCopyButton, sendBatchToNotebook, snapshotResponseSignatures, waitForBatchDeadline } from '../src/dom';

function makeResponseEntry(index, text) {
  return {
    id: `response_${index}`,
    batchNumber: index,
    startIndex: (index - 1) * 3,
    endIndex: (index - 1) * 3 + 2,
    itemCount: 3,
    items: [`Item ${index}-1`, `Item ${index}-2`, `Item ${index}-3`],
    promptText: `Prompt ${index}`,
    responseText: text,
    responseSignature: `sig-${index}`,
    capturedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  snapshotResponseSignatures.mockReturnValue([]);
});

describe('ClassificacaoRunner', () => {
  it('processes a seven-item queue in three batches', async () => {
    const runner = new ClassificacaoRunner();
    await runner.loadDraftAndReset(createExampleJson());

    let captureCount = 0;
    vi.spyOn(runner, 'captureLatestResponse').mockImplementation(async () => {
      captureCount += 1;
      return {
        element: document.createElement('div'),
        text: `Resposta capturada ${captureCount}`,
        signature: `sig-${captureCount}`,
      };
    });

    await runner.start();

    expect(sendBatchToNotebook).toHaveBeenCalledTimes(3);
    expect(waitForBatchDeadline).toHaveBeenCalledTimes(3);
    expect(clickNativeCopyButton).toHaveBeenCalledTimes(3);

    expect(sendBatchToNotebook.mock.calls[0][0]).toContain('1. Primeiro item de exemplo para enviar ao NotebookLM.');
    expect(sendBatchToNotebook.mock.calls[0][0]).toContain('3. Terceiro item de exemplo com outro conteúdo.');
    expect(sendBatchToNotebook.mock.calls[1][0]).toContain('1. Quarto item de exemplo para mostrar continuidade.');
    expect(sendBatchToNotebook.mock.calls[2][0]).toContain('1. Sétimo item de exemplo para fechar o lote final.');

    const state = runner.getState();
    expect(state.status).toBe('done');
    expect(state.running).toBe(false);
    expect(state.nextIndex).toBe(7);
    expect(state.history).toHaveLength(3);
    expect(state.history.map(entry => entry.responseText)).toEqual([
      'Resposta capturada 1',
      'Resposta capturada 2',
      'Resposta capturada 3',
    ]);
  });

  it('rewinds progress without clearing the captured history', async () => {
    const runner = new ClassificacaoRunner();
    await runner.loadDraftAndReset(createExampleJson());

    runner.persist({
      status: 'done',
      running: false,
      paused: false,
      nextIndex: 5,
      history: [makeResponseEntry(1, 'Resposta antiga')],
      currentBatch: {
        id: 'batch_1',
        batchNumber: 1,
        startIndex: 0,
        endIndex: 2,
        itemCount: 3,
        items: ['Item 1-1', 'Item 1-2', 'Item 1-3'],
        promptText: 'Prompt 1',
        baselineSignatures: ['baseline-1'],
        phase: 'waiting',
        sentAt: Date.now(),
        waitDeadlineAt: Date.now() + 1000,
        remainingMs: 1000,
      },
      lastCapturedSignature: 'sig-old',
    });

    await runner.resetProgress();

    const state = runner.getState();
    expect(state.status).toBe('idle');
    expect(state.nextIndex).toBe(0);
    expect(state.currentBatch).toBeNull();
    expect(state.history).toHaveLength(1);
    expect(state.history[0].responseText).toBe('Resposta antiga');
    expect(state.lastCapturedSignature).toBe('');
    expect(state.lastInfo).toContain('Progresso zerado');
  });

  it('copies the accumulated history in chronological order', async () => {
    const runner = new ClassificacaoRunner();
    runner.persist({
      history: [
        makeResponseEntry(1, 'Resposta 1'),
        makeResponseEntry(2, 'Resposta 2'),
      ],
    });

    await runner.copyAll();

    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText.mock.calls[0][0]).toContain('=== LOTE 1 (1-3) ===');
    expect(copyText.mock.calls[0][0]).toContain('Resposta 1');
    expect(copyText.mock.calls[0][0]).toContain('=== LOTE 2 (4-6) ===');
    expect(copyText.mock.calls[0][0]).toContain('Resposta 2');
    expect(runner.getState().lastInfo).toBe('Histórico copiado.');
  });
});
