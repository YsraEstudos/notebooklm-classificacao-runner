import { createAbortError, delay, normalizeDisplayText, normalizeSignatureText, stableHash, waitFor } from './utils';

const COMPOSE_SELECTORS = [
  'textarea[aria-label="Caixa de consulta"]',
  'textarea[aria-label*="consulta"]',
  'textarea[placeholder*="Comece a digitar"]',
  'textarea[placeholder*="digitar"]',
  'textarea',
];

const SEND_BUTTON_SELECTORS = [
  'button[aria-label="Enviar"]',
  'button[aria-label*="send"]',
  'button[type="submit"]',
];

const RESPONSE_CARD_SELECTORS = [
  'note-card',
  '.note-card',
  'mat-card',
  'article',
  '[role="article"]',
  '[data-testid*="response"]',
  '[data-testid*="answer"]',
  '[data-testid*="note"]',
  '.message',
  '.answer',
  '.assistant-message',
  '.response',
];

function isVisible(element) {
  if (!element || element.nodeType !== 1) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return element.getClientRects().length > 0;
}

function isInsideShadowPanel(element) {
  return Boolean(element?.closest?.('#nlm-classificacao-panel, #nlm-classificacao-rail'));
}

function labelMatches(element, patterns) {
  const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.toLowerCase();
  return patterns.some(pattern => pattern.test(label));
}

function firstVisibleMatch(list, predicates) {
  for (const element of list) {
    if (!isVisible(element)) continue;
    if (isInsideShadowPanel(element)) continue;
    if (predicates.some(predicate => predicate(element))) return element;
  }
  return null;
}

export function getComposeTextarea() {
  const textareas = [...document.querySelectorAll('textarea')];
  return firstVisibleMatch(textareas, [
    element => COMPOSE_SELECTORS.some(selector => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    }),
  ]);
}

export function getSendButton() {
  const buttons = [...document.querySelectorAll('button')];
  return firstVisibleMatch(buttons, [
    element => SEND_BUTTON_SELECTORS.some(selector => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    }) || labelMatches(element, [/enviar/, /send/]),
  ]);
}

export function setTextareaValue(textarea, value) {
  const text = String(value ?? '');
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

  if (nativeSetter) {
    nativeSetter.call(textarea, text);
  } else {
    textarea.value = text;
  }

  textarea.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
    data: text,
    inputType: 'insertText',
  }));

  textarea.dispatchEvent(new Event('change', {
    bubbles: true,
    cancelable: true,
    composed: true,
  }));

  textarea.focus();
  textarea.setSelectionRange(text.length, text.length);
}

export function clickTouchTarget(button) {
  if (!button) return false;
  const touchTarget = button.querySelector?.('.mat-mdc-button-touch-target');
  if (touchTarget && typeof touchTarget.click === 'function') {
    touchTarget.click();
    return true;
  }

  if (typeof button.click === 'function') {
    button.click();
    return true;
  }

  return false;
}

export async function waitForComposeTextarea(signal) {
  return waitFor(() => getComposeTextarea(), { timeoutMs: 20000, intervalMs: 250, signal });
}

export async function waitForSendButton(signal) {
  return waitFor(() => {
    const button = getSendButton();
    return button && !button.disabled ? button : null;
  }, { timeoutMs: 10000, intervalMs: 250, signal });
}

function cloneWithoutControls(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('button, [role="button"], input, textarea, script, style, svg, mat-icon, .mat-mdc-button-touch-target, [aria-hidden="true"]').forEach(node => node.remove());
  return clone;
}

export function extractResponseText(element) {
  if (!element) return '';
  const clone = cloneWithoutControls(element);
  return normalizeDisplayText(clone.innerText || clone.textContent || '');
}

function getCandidateSignature(element) {
  return stableHash(normalizeSignatureText(extractResponseText(element)));
}

function getCardContainerFromButton(button) {
  const selector = RESPONSE_CARD_SELECTORS.join(',');
  const card = button.closest(selector);
  if (card) return card;

  let current = button.parentElement;
  while (current && current !== document.body) {
    if (current.matches?.('section, article, mat-card, div, note-card')) {
      const text = extractResponseText(current);
      if (text.length >= 20) return current;
    }
    current = current.parentElement;
  }

  return null;
}

function collectResponseCandidates() {
  const selector = RESPONSE_CARD_SELECTORS.join(',');
  const candidates = [];
  const seen = new Set();

  const copyButtons = [...document.querySelectorAll('button')].filter(button => {
    if (!isVisible(button) || isInsideShadowPanel(button)) return false;
    return labelMatches(button, [/copi/, /copy/]);
  });

  for (const button of copyButtons) {
    const card = getCardContainerFromButton(button);
    if (card && !seen.has(card)) {
      candidates.push(card);
      seen.add(card);
    }
  }

  const genericCards = [...document.querySelectorAll(selector)].filter(element => {
    if (!isVisible(element) || isInsideShadowPanel(element)) return false;
    const text = extractResponseText(element);
    return text.length >= 20;
  });

  for (const card of genericCards) {
    if (!seen.has(card)) {
      candidates.push(card);
      seen.add(card);
    }
  }

  return candidates;
}

export function snapshotResponseSignatures() {
  return collectResponseCandidates().map(candidate => getCandidateSignature(candidate));
}

export function findLatestResponseCandidate({ excludeSignatures = new Set() } = {}) {
  const candidates = collectResponseCandidates();

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const text = extractResponseText(candidate);
    if (text.length < 20) continue;

    const signature = getCandidateSignature(candidate);
    if (excludeSignatures.has(signature)) continue;

    const copyButton = [...candidate.querySelectorAll('button')].find(button => labelMatches(button, [/copi/, /copy/]));

    return {
      element: candidate,
      text,
      signature,
      copyButton,
    };
  }

  return null;
}

export function clickNativeCopyButton(candidateElement) {
  if (!candidateElement) return false;

  const copyButton = [...candidateElement.querySelectorAll('button')].find(button => {
    return labelMatches(button, [/copi/, /copy/]);
  });

  if (!copyButton) return false;
  return clickTouchTarget(copyButton);
}

export async function sendBatchToNotebook(promptText, signal) {
  const textarea = await waitForComposeTextarea(signal);
  if (!textarea) {
    throw new Error('Não encontrei a caixa de consulta do NotebookLM.');
  }

  setTextareaValue(textarea, promptText);

  const sendButton = await waitForSendButton(signal);
  if (!sendButton) {
    throw new Error('Não encontrei o botão de enviar habilitado.');
  }

  clickTouchTarget(sendButton);
  return true;
}

export async function waitForBatchDeadline(deadlineAt, signal, onTick) {
  while (true) {
    if (signal?.aborted) throw createAbortError();

    const remaining = Number(deadlineAt) - Date.now();
    if (remaining <= 0) return 0;

    onTick?.(remaining);
    await delay(Math.min(1000, remaining), signal);
  }
}
