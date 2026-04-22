import { beforeEach, describe, expect, it, vi } from 'vitest';

const domMocks = vi.hoisted(() => ({
  sendBatchToNotebook: vi.fn(async () => true),
  snapshotAssistantSignatures: vi.fn(() => []),
  waitForBatchDeadline: vi.fn(async () => 0),
  findLatestAssistantMessage: vi.fn(() => null),
  reconcileAssistantTranscript: vi.fn(history => ({
    messages: [],
    history,
  })),
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
import {
  findLatestAssistantMessage,
  reconcileAssistantTranscript,
  sendBatchToNotebook,
  snapshotAssistantSignatures,
  waitForBatchDeadline,
} from '../src/dom';

function makeAssistantMessage(index, text, source = 'dom') {
  return {
    element: document.createElement('div'),
    text,
    signature: `sig-${index}`,
    messageIndex: index - 1,
    kind: 'assistant',
    source,
  };
}

function makeResponseEntry(index, text) {
  return {
    id: `response_${index}`,
    batchNumber: index,
    startIndex: (index - 1) * 3,
    endIndex: (index - 1) * 3 + (index === 3 ? 0 : 2),
    itemCount: index === 3 ? 1 : 3,
    items: index === 3
      ? ['Item 7']
      : [`Item ${index}-1`, `Item ${index}-2`, `Item ${index}-3`],
    promptText: `Prompt ${index}`,
    responseText: text,
    responseSignature: `sig-${index}`,
    capturedAt: new Date().toISOString(),
    messageIndex: index - 1,
    responseSource: 'dom',
    capturedFromDomAt: new Date().toISOString(),
    reconciledAt: '',
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  snapshotAssistantSignatures.mockReturnValue([]);
  reconcileAssistantTranscript.mockImplementation(history => ({
    messages: [],
    history,
  }));
});

describe('ClassificacaoRunner', () => {
  it('processes a seven-item queue in three batches with assistant-only history metadata', async () => {
    const runner = new ClassificacaoRunner();
    await runner.loadDraftAndReset(createExampleJson());

    let captureCount = 0;
    vi.spyOn(runner, 'captureLatestResponse').mockImplementation(async () => {
      captureCount += 1;
      return makeAssistantMessage(captureCount, `Resposta IA ${captureCount}`);
    });

    await runner.start();

    expect(sendBatchToNotebook).toHaveBeenCalledTimes(3);
    expect(waitForBatchDeadline).toHaveBeenCalledTimes(3);
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
      'Resposta IA 1',
      'Resposta IA 2',
      'Resposta IA 3',
    ]);
    expect(state.history.map(entry => entry.messageIndex)).toEqual([0, 1, 2]);
    expect(state.history.map(entry => entry.responseSource)).toEqual(['dom', 'dom', 'dom']);
    expect(state.history.every(entry => entry.capturedFromDomAt)).toBe(true);
  });

  it('waits for the same assistant response twice before accepting it', async () => {
    const runner = new ClassificacaoRunner();
    findLatestAssistantMessage
      .mockReturnValueOnce(makeAssistantMessage(1, 'Resposta parcial'))
      .mockReturnValueOnce(makeAssistantMessage(1, 'Resposta final'))
      .mockReturnValueOnce(makeAssistantMessage(1, 'Resposta final'));

    const result = await runner.captureLatestResponse(new AbortController().signal, []);

    expect(result.text).toBe('Resposta final');
    expect(findLatestAssistantMessage).toHaveBeenCalledTimes(3);
  });

  it('uses the configured wait time for each batch deadline', async () => {
    const runner = new ClassificacaoRunner();
    await runner.loadDraftAndReset(createExampleJson());
    runner.updateWaitMs(15_000);

    let captureCount = 0;
    vi.spyOn(runner, 'captureLatestResponse').mockImplementation(async () => {
      captureCount += 1;
      return makeAssistantMessage(captureCount, `Resposta IA ${captureCount}`);
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    try {
      await runner.start();
    } finally {
      nowSpy.mockRestore();
    }

    expect(waitForBatchDeadline).toHaveBeenCalledTimes(3);
    expect(waitForBatchDeadline.mock.calls[0][0]).toBe(16_000);
    expect(runner.getState().waitMs).toBe(15_000);
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

  it('reconciles history before copying and appends missing assistant messages', async () => {
    const runner = new ClassificacaoRunner();
    await runner.loadDraftAndReset(createExampleJson());
    runner.persist({
      nextIndex: 7,
      history: [
        {
          ...makeResponseEntry(1, 'PROMPT 1: texto errado'),
          responseSignature: 'wrong-1',
          messageIndex: null,
          capturedFromDomAt: '',
        },
        {
          ...makeResponseEntry(2, 'Resposta IA 2'),
          responseSignature: 'sig-2',
          messageIndex: 1,
        },
      ],
    });

    reconcileAssistantTranscript.mockReturnValue({
      messages: [
        makeAssistantMessage(1, 'Resposta IA 1'),
        makeAssistantMessage(2, 'Resposta IA 2'),
        makeAssistantMessage(3, 'Resposta IA 3'),
      ],
      history: runner.getState().history,
    });

    await runner.copyAll();

    expect(reconcileAssistantTranscript).toHaveBeenCalledTimes(1);
    expect(runner.getState().history).toHaveLength(3);
    expect(runner.getState().history[0].responseText).toBe('Resposta IA 1');
    expect(runner.getState().history[0].messageIndex).toBe(0);
    expect(runner.getState().history[2].responseText).toBe('Resposta IA 3');
    expect(runner.getState().history[2].startIndex).toBe(6);
    expect(runner.getState().history[2].endIndex).toBe(6);
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText.mock.calls[0][0]).toContain('=== LOTE 1 (1-3) ===');
    expect(copyText.mock.calls[0][0]).toContain('Resposta IA 1');
    expect(copyText.mock.calls[0][0]).not.toContain('PROMPT 1');
    expect(copyText.mock.calls[0][0]).toContain('=== LOTE 3 (7-7) ===');
  });
});
