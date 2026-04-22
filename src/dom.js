import { createAbortError, delay, normalizeDisplayText, normalizeSignatureText, stableHash, waitFor } from './utils';

const COMPOSE_SELECTORS = [
  'textarea.query-box-input[aria-label="Caixa de consulta"]',
  'textarea.query-box-input',
  'textarea[aria-label="Caixa de consulta"]',
  'textarea[placeholder="Comece a digitar…"]',
  'textarea[placeholder*="Comece a digitar"]',
  'textarea[placeholder*="digitar"]',
  '[contenteditable="true"]',
  '[role="textbox"]',
];

const SEND_BUTTON_SELECTORS = [
  'button.submit-button[aria-label="Enviar"]',
  'button.submit-button',
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

function queryAllDeep(selector, root = document) {
  const results = [];
  const seen = new Set();
  const roots = [root];

  while (roots.length) {
    const currentRoot = roots.pop();
    if (!currentRoot || typeof currentRoot.querySelectorAll !== 'function') continue;

    const matches = currentRoot.querySelectorAll(selector);
    for (const element of matches) {
      if (seen.has(element)) continue;
      seen.add(element);
      results.push(element);
    }

    const allElements = currentRoot.querySelectorAll('*');
    for (const element of allElements) {
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
      }
    }
  }

  return results;
}

function isVisible(element) {
  if (!element || element.nodeType !== 1) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  return element.getClientRects().length > 0;
}

function isInsideShadowPanel(element) {
  let current = element;

  while (current) {
    if (
      current.id === 'nlm-classificacao-host' ||
      current.id === 'nlm-classificacao-panel' ||
      current.id === 'nlm-classificacao-rail'
    ) {
      return true;
    }

    const root = current.getRootNode?.();
    if (root && root.host) {
      current = root.host;
      continue;
    }

    current = current.parentElement;
  }

  return false;
}

function labelMatches(element, patterns) {
  const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.toLowerCase();
  return patterns.some(pattern => pattern.test(label));
}

function isWritableControl(element) {
  if (!element) return false;
  if (element.matches?.('[disabled], [readonly]')) return false;
  if (element.getAttribute?.('formcontrolname') === 'discoverSourcesQuery') return false;
  if (element.closest?.('[formcontrolname="discoverSourcesQuery"]')) return false;
  return true;
}

function isEnabledButton(element) {
  if (!element) return false;
  if (element.disabled) return false;
  if (element.matches?.('[disabled], [aria-disabled="true"], .mat-mdc-button-disabled')) return false;
  if (element.getAttribute?.('aria-disabled') === 'true') return false;
  return true;
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
  const editors = queryAllDeep('textarea, [contenteditable="true"], [role="textbox"]');
  const candidates = [];

  for (const element of editors) {
    if (!isVisible(element)) continue;
    if (isInsideShadowPanel(element)) continue;
    if (!isWritableControl(element)) continue;

    let score = -1;

    if (element.matches?.('textarea.query-box-input[aria-label="Caixa de consulta"]')) score = 100;
    else if (element.matches?.('textarea.query-box-input')) score = 90;
    else if (element.matches?.('textarea[aria-label="Caixa de consulta"]')) score = 80;
    else if (element.matches?.('textarea[placeholder="Comece a digitar…"]')) score = 70;
    else if (element.matches?.('textarea[placeholder*="Comece a digitar"]')) score = 60;
    else if (element.matches?.('textarea[placeholder*="digitar"]')) score = 50;
    else if (element.matches?.('[contenteditable="true"]')) score = 40;
    else if (element.matches?.('[role="textbox"]')) score = 30;

    if (score >= 0) {
      candidates.push({ element, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.element || null;
}

export function getSendButton() {
  const composeForm = getComposeTextarea()?.closest?.('form') || null;
  const buttons = queryAllDeep('button, [role="button"]', composeForm || document);
  const candidates = [];

  for (const element of buttons) {
    if (!isVisible(element)) continue;
    if (isInsideShadowPanel(element)) continue;

    let score = -1;

    if (SEND_BUTTON_SELECTORS.some(selector => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    })) {
      score = 100;
    } else if (labelMatches(element, [/enviar/, /send/])) {
      score = 60;
    }

    if (score < 0) continue;

    if (element.closest?.('form')) score += 20;
    if (element.closest?.('.message-container')) score += 10;

    candidates.push({ element, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.element || null;
}

export function setTextareaValue(textarea, value) {
  const text = String(value ?? '');

  const isTextInput = textarea instanceof HTMLTextAreaElement || textarea instanceof HTMLInputElement;
  const isContentEditable = textarea?.isContentEditable || textarea?.getAttribute?.('contenteditable') === 'true';

  if (isTextInput) {
    const nativeSetter = Object.getOwnPropertyDescriptor(isTextInput && textarea instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(textarea, text);
    } else {
      textarea.value = text;
    }
  } else if (isContentEditable) {
    textarea.focus();
    textarea.textContent = text;
  } else if ('value' in textarea) {
    textarea.value = text;
  } else {
    textarea.textContent = text;
  }

  textarea.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
    data: text,
    inputType: 'insertText',
  }));

  textarea.dispatchEvent(new Event('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
  }));

  textarea.dispatchEvent(new Event('keyup', {
    bubbles: true,
    cancelable: true,
    composed: true,
  }));

  textarea.dispatchEvent(new Event('change', {
    bubbles: true,
    cancelable: true,
    composed: true,
  }));

  textarea.focus();

  if (typeof textarea.setSelectionRange === 'function') {
    textarea.setSelectionRange(text.length, text.length);
  }
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
    return isEnabledButton(button) ? button : null;
  }, { timeoutMs: 10000, intervalMs: 250, signal });
}

export async function activateSubmitButton(button, signal) {
  if (!button) return false;

  const form = button.closest?.('form') || null;
  const touchTarget = button.querySelector?.('.mat-mdc-button-touch-target');

  try {
    button.focus?.({ preventScroll: true });
  } catch {
    button.focus?.();
  }

  try {
    button.click?.();
  } catch {
    // Fallbacks abaixo
  }

  if (touchTarget && typeof touchTarget.click === 'function') {
    try {
      touchTarget.click();
    } catch {
      // Fallbacks abaixo
    }
  }

  if (form?.requestSubmit) {
    try {
      form.requestSubmit(button);
    } catch {
      try {
        form.requestSubmit();
      } catch {
        // Fallback abaixo
      }
    }
  } else if (form) {
    try {
      form.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    } catch {
      // Fallback final abaixo
    }
  }

  await delay(75, signal);
  return true;
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

  const copyButtons = queryAllDeep('button, [role="button"]').filter(button => {
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

  const genericCards = queryAllDeep(selector).filter(element => {
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
  await delay(150, signal);

  const sendButton = await waitForSendButton(signal);
  if (!sendButton) {
    throw new Error('Não encontrei o botão de enviar habilitado.');
  }

  await activateSubmitButton(sendButton, signal);
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
