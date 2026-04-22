import { beforeEach, describe, expect, it } from 'vitest';

import {
  clickNativeCopyButton,
  collectAssistantMessages,
  extractResponseText,
  findLatestAssistantMessage,
  getComposeTextarea,
  getSendButton,
  reconcileAssistantTranscript,
  sendBatchToNotebook,
  snapshotAssistantSignatures,
} from '../src/dom';
import { mountNotebookFixture } from './helpers';

beforeEach(() => {
  mountNotebookFixture();
});

describe('NotebookLM composer discovery', () => {
  it('picks the live query box and ignores the discovery textarea', () => {
    const textarea = getComposeTextarea();
    const sendButton = getSendButton();
    const wrongTextarea = document.querySelector('[formcontrolname="discoverSourcesQuery"]');

    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect(textarea).toBe(document.querySelector('textarea.query-box-input'));
    expect(sendButton).toBe(document.querySelector('button.submit-button'));
    expect(wrongTextarea).not.toBe(textarea);
  });

  it('fills the correct textarea and submits through the live form', async () => {
    const textarea = getComposeTextarea();
    const submitButton = getSendButton();
    const wrongTextarea = document.querySelector('[formcontrolname="discoverSourcesQuery"]');
    const form = document.querySelector('form');
    const events = [];

    submitButton.addEventListener('click', () => {
      events.push('click');
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      events.push('submit');
    });

    textarea.addEventListener('input', () => {
      submitButton.disabled = textarea.value.trim().length === 0;
      submitButton.classList.toggle('mat-mdc-button-disabled', submitButton.disabled);
    });

    wrongTextarea.addEventListener('input', () => {
      events.push('wrong-input');
    });

    await sendBatchToNotebook('Primeiro item\n\nSegundo item', new AbortController().signal);

    expect(textarea.value).toBe('Primeiro item\n\nSegundo item');
    expect(wrongTextarea.value).toBe('');
    expect(events).toContain('submit');
    expect(events).not.toContain('wrong-input');
  });
});

describe('NotebookLM assistant transcript capture', () => {
  it('collects only assistant messages and ignores prompts and action chrome', () => {
    const messages = collectAssistantMessages();

    expect(messages).toHaveLength(5);
    expect(messages.map(message => message.kind)).toEqual([
      'assistant',
      'assistant',
      'assistant',
      'assistant',
      'assistant',
    ]);
    expect(messages.map(message => message.messageIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(messages[0].text).toContain('RESPOSTA IA 1');
    expect(messages[0].text).not.toContain('PROMPT 1');
    expect(messages[0].text).not.toContain('Copy model response to clipboard');
    expect(messages[0].text).not.toContain('Save to note');
    expect(messages[0].text).not.toContain('What details are missing?');
  });

  it('falls back to the notebook summary only when there is no conversation yet', () => {
    document.querySelectorAll('.chat-message-pair').forEach(node => node.remove());

    const messages = collectAssistantMessages();

    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('summary');
    expect(messages[0].text).toContain('industrial and technical products');
    expect(messages[0].text).not.toContain('Copy summary');
  });

  it('finds only the newest assistant message after a baseline snapshot', () => {
    const allMessages = collectAssistantMessages();
    const baseline = snapshotAssistantSignatures().slice(0, 4);
    const candidate = findLatestAssistantMessage({ excludeSignatures: new Set(baseline) });

    expect(candidate).not.toBeNull();
    expect(candidate.signature).toBe(allMessages[4].signature);
    expect(candidate.text).toContain('RESPOSTA IA 5');
  });

  it('reconciles broken history entries with DOM assistant messages', () => {
    const history = [
      {
        id: 'response_1',
        batchNumber: 1,
        startIndex: 0,
        endIndex: 2,
        itemCount: 3,
        items: ['PROMPT 1', 'PROMPT 2', 'PROMPT 3'],
        promptText: 'Prompt batch 1',
        responseText: 'PROMPT 1: Classifique os itens do lote 1.',
        responseSignature: 'wrong-signature',
        capturedAt: '2026-04-22T10:00:00.000Z',
        responseSource: 'dom',
        capturedFromDomAt: '',
        reconciledAt: '',
      },
    ];

    const reconciled = reconcileAssistantTranscript(history);

    expect(reconciled.messages).toHaveLength(5);
    expect(reconciled.history).toHaveLength(1);
    expect(reconciled.history[0].responseText).toContain('RESPOSTA IA 1');
    expect(reconciled.history[0].responseText).not.toContain('PROMPT 1');
    expect(reconciled.history[0].messageIndex).toBe(0);
    expect(reconciled.history[0].responseSource).toBe('dom');
    expect(reconciled.history[0].capturedFromDomAt).toBeTruthy();
    expect(reconciled.history[0].reconciledAt).toBeTruthy();
  });

  it('extracts assistant text and keeps native copy as a fallback helper', () => {
    const assistantCard = document.querySelector('.to-user-message-card-content');
    const text = extractResponseText(assistantCard);
    const copyButton = assistantCard.querySelector('button[aria-label="Copy model response to clipboard"]');

    copyButton.dataset.clicked = 'no';
    copyButton.addEventListener('click', () => {
      copyButton.dataset.clicked = 'yes';
    });

    expect(text).toContain('RESPOSTA IA 1');
    expect(text).not.toContain('copy_all');
    expect(clickNativeCopyButton(assistantCard)).toBe(true);
    expect(copyButton.dataset.clicked).toBe('yes');
  });
});
