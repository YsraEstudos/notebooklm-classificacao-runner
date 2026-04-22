import { describe, expect, it } from 'vitest';

import {
  buildHistoryClipboardText,
  createDefaultState,
  createExampleJson,
  loadState,
  parseQueueFromJson,
  saveState,
} from '../src/storage';

describe('storage helpers', () => {
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

  it('persists the configurable wait time in storage', () => {
    expect(createDefaultState().waitMs).toBe(90_000);

    saveState({
      ...createDefaultState(),
      waitMs: '120000',
    });

    const state = loadState();
    expect(state.waitMs).toBe(120_000);
  });
});
