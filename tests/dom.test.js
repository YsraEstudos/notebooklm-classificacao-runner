import { beforeEach, describe, expect, it } from 'vitest';

import {
  clickNativeCopyButton,
  extractResponseText,
  findLatestResponseCandidate,
  getComposeTextarea,
  getSendButton,
  sendBatchToNotebook,
  snapshotResponseSignatures,
} from '../src/dom';
import { mountNotebookFixture } from './helpers';

function addGeneratedResponse() {
  const container = document.querySelector('chat-panel-content');
  const response = document.createElement('div');
  response.className = 'chat-panel-message ng-star-inserted';

  const summary = document.createElement('span');
  summary.className = 'notebook-summary mat-body-medium ng-star-inserted';
  summary.textContent = 'Generated response about the uploaded sources and their layout.';

  const actions = document.createElement('div');
  actions.className = 'chat-panel-message-action-bar';

  const copyButton = document.createElement('button');
  copyButton.setAttribute('aria-label', 'Copy summary');
  copyButton.className = 'mdc-icon-button mat-mdc-icon-button mat-mdc-button-base mat-mdc-tooltip-trigger xap-copy-to-clipboard mat-unthemed';
  copyButton.innerHTML = '<span class="mat-mdc-button-touch-target"></span><span>copy_all</span>';

  response.append(summary, actions, copyButton);
  container.appendChild(response);

  return { response, summary, copyButton };
}

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
  });
});

describe('NotebookLM response capture', () => {
  it('extracts the summary text without action-bar noise', () => {
    const content = document.querySelector('chat-panel-content');
    const text = extractResponseText(content);

    expect(text).toContain('industrial inventory database');
    expect(text).not.toContain('Save to note');
    expect(text).not.toContain('thumb_up');
    expect(text).not.toContain('thumb_down');
  });

  it('captures the latest response while excluding the baseline', () => {
    const baseline = snapshotResponseSignatures();
    const { copyButton } = addGeneratedResponse();
    const candidate = findLatestResponseCandidate({ excludeSignatures: new Set(baseline) });

    expect(candidate).not.toBeNull();
    expect(candidate.text).toContain('Generated response');

    copyButton.dataset.clicked = 'no';
    copyButton.addEventListener('click', () => {
      copyButton.dataset.clicked = 'yes';
    });

    expect(clickNativeCopyButton(candidate.element)).toBe(true);
    expect(copyButton.dataset.clicked).toBe('yes');
  });
});
