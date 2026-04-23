import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildHistoryClipboardText,
  buildFirstBatchText,
  createDefaultState,
  createExampleJson,
  loadState,
  parseQueueFromJson,
  saveState,
} from '../src/storage';

describe('storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('parses arrays and object-backed queues', () => {
    const queue = parseQueueFromJson(JSON.stringify([
      'Texto direto',
      { text: 'Texto com text' },
      { message: 'Texto com message' },
      { content: 'Texto com content' },
    ]));

    expect(queue.map(item => item.text)).toEqual([
      'Texto direto',
      'Texto com text',
      'Texto com message',
      'Texto com content',
    ]);
  });

  it('rejects invalid queue shapes', () => {
    expect(() => parseQueueFromJson('{"foo": "bar"}')).toThrow('O JSON precisa ser um array ou um objeto com a chave `items`.');
    expect(() => parseQueueFromJson('[]')).toThrow('Nenhum item válido foi encontrado no JSON.');
  });

  it('publishes a seven-item example json', () => {
    const example = JSON.parse(createExampleJson());
    expect(example).toHaveLength(7);
    expect(example[6].text).toContain('Sétimo item');
  });

  it('formats clipboard history in chronological order', () => {
    const clipboard = buildHistoryClipboardText([
      { startIndex: 0, endIndex: 2, responseText: 'Resposta 1' },
      { startIndex: 3, endIndex: 5, responseText: 'Resposta 2' },
    ]);

    expect(clipboard).toContain('=== LOTE 1 (1-3) ===');
    expect(clipboard).toContain('Resposta 1');
    expect(clipboard).toContain('=== LOTE 2 (4-6) ===');
    expect(clipboard).toContain('Resposta 2');
  });

  it('prepends the special instruction and ids to the first batch prompt', () => {
    const queue = parseQueueFromJson(JSON.stringify([
      { text: 'Item A' },
      { text: 'Item B' },
    ]));

    const prompt = buildFirstBatchText(queue);

    expect(prompt).toContain('Elenque o codigo id junto.');
    expect(prompt).toContain('Elenque 3 possiveis ncms');
    expect(prompt).toContain('[ID: item_');
    expect(prompt).toContain('1. [ID:');
    expect(prompt).toContain('Item A');
    expect(prompt).toContain('2. [ID:');
    expect(prompt).toContain('Item B');
  });

  it('persists the configurable wait time in storage', () => {
    expect(createDefaultState().waitMs).toBe(90_000);

    saveState({
      ...createDefaultState(),
      waitMs: '120000',
    });

    const state = loadState();
    expect(state.waitMs).toBe(120_000);
  });

  it('defaults waitMs when the field is missing from the saved state', () => {
    saveState({
      ...createDefaultState(),
      waitMs: undefined,
    });

    const state = loadState();
    expect(state.waitMs).toBe(90_000);
  });

  it('normalizes invalid waitMs values and currentBatch reload state', () => {
    saveState({
      ...createDefaultState(),
      waitMs: 'not-a-number',
      currentBatch: {
        id: 'batch_1',
        batchNumber: 1,
        startIndex: 0,
        endIndex: 2,
        itemCount: 3,
        items: ['Item 1', 'Item 2', 'Item 3'],
        promptText: 'Prompt 1',
        baselineSignatures: ['sig-1'],
        phase: 'waiting',
        sentAt: 123,
        waitDeadlineAt: 456,
        remainingMs: undefined,
        waitMs: 'oops',
      },
    });

    const state = loadState();
    expect(state.waitMs).toBe(90_000);
    expect(state.currentBatch.waitMs).toBe(90_000);
    expect(state.currentBatch.remainingMs).toBe(90_000);
  });
});
