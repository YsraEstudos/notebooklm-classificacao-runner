import { createAbortError, delay, normalizeDisplayText, normalizeSignatureText, stableHash, waitFor } from './utils';

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

function getNormalizedControlText(element) {
  return normalizeSignatureText([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('placeholder'),
    element?.textContent,
  ].filter(Boolean).join(' '));
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

function getComposeScore(element) {
  if (!element || !isVisible(element) || isInsideShadowPanel(element)) return -1;
  if (element.matches?.('[disabled], [readonly]')) return -1;
  if (element.closest?.('[formcontrolname="discoverSourcesQuery"]')) return -1;

  const labelText = getNormalizedControlText(element);
  if (/discover\s*sources?/.test(labelText)) return -1;
  if (/pesquise\s+fontes/.test(labelText)) return -1;
  if (/search\s*sources?/.test(labelText)) return -1;
  if (/source\s*query/.test(labelText)) return -1;

  let score = -1;

  if (element.matches?.('textarea.query-box-input[aria-label="Query box"]')) score = 120;
  else if (element.matches?.('textarea.query-box-input[aria-label="Caixa de consulta"]')) score = 120;
  else if (element.matches?.('textarea.query-box-input')) score = 100;
  else if (/^query box$/.test(labelText)) score = 95;
  else if (/^caixa de consulta$/.test(labelText)) score = 95;
  else if (element.matches?.('textarea[aria-label="Query box"]')) score = 90;
  else if (element.matches?.('textarea[aria-label="Caixa de consulta"]')) score = 90;
  else if (element.matches?.('textarea[placeholder="Start typing..."]')) score = 90;
  else if (element.matches?.('textarea[placeholder*="Start typing"]')) score = 80;
  else if (element.matches?.('textarea[placeholder*="Comece a digitar"]')) score = 80;
  else if (element.matches?.('textarea[placeholder*="digitar"]')) score = 70;
  else if (element.matches?.('[contenteditable="true"]')) score = 45;
  else if (element.matches?.('[role="textbox"]')) score = 35;
  else if (element.matches?.('textarea')) score = 20;

  if (score < 0) return -1;

  if (element.closest?.('form')) score += 25;
  if (element.closest?.('.message-container')) score += 15;
  if (element.closest?.('.input-group')) score += 10;
  if (element.closest?.('query-box')) score += 10;
  if (element.closest?.('.bottom-container')) score += 5;

  return score;
}

function getSubmitButtonScore(button, composerTextarea = null) {
  if (!button || !isVisible(button) || isInsideShadowPanel(button)) return -1;

  const labelText = getNormalizedControlText(button);
  let score = -1;

  if (button.matches?.('button.submit-button[aria-label="Submit"]')) score = 120;
  else if (button.matches?.('button.submit-button[aria-label="Enviar"]')) score = 120;
  else if (button.matches?.('button.submit-button')) score = 100;
  else if (button.matches?.('button[type="submit"]')) score = 90;
  else if (/^(submit|enviar)$/.test(labelText)) score = 80;
  else if (labelText.includes('submit') || labelText.includes('enviar') || labelText.includes('arrow_forward')) score = 60;
  else if (button.matches?.('button')) score = 20;

  if (score < 0) return -1;

  if (score === 20 && !button.closest?.('form') && !button.closest?.('.bottom-right-container') && !button.closest?.('.message-container') && !button.closest?.('.input-group')) {
    return -1;
  }

  if (button.closest?.('form')) score += 25;
  if (button.closest?.('.bottom-right-container')) score += 15;
  if (button.closest?.('.message-container')) score += 10;
  if (button.closest?.('.input-group')) score += 10;

  if (composerTextarea && button.closest?.('form') === composerTextarea.closest?.('form')) {
    score += 20;
  }

  return score;
}

function getBestSubmitButton(root, composerTextarea = null) {
  const buttons = queryAllDeep('button, [role="button"]', root || document);
  const candidates = [];

  for (const element of buttons) {
    const score = getSubmitButtonScore(element, composerTextarea);
    if (score < 0) continue;
    candidates.push({ element, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.element || null;
}

export function getComposeContext() {
  const editors = queryAllDeep('textarea, [contenteditable="true"], [role="textbox"]');
  const candidates = [];

  for (const element of editors) {
    const score = getComposeScore(element);
    if (score < 0) continue;

    const form = element.closest?.('form') || null;
    const button = getBestSubmitButton(form || document, element) || getBestSubmitButton(document, element);
    candidates.push({
      element,
      form,
      button,
      score: score + (button ? 15 : 0),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function isEnabledButton(element) {
  if (!element) return false;
  if (element.disabled) return false;
  if (element.matches?.('[disabled], [aria-disabled="true"], .mat-mdc-button-disabled')) return false;
  if (element.getAttribute?.('aria-disabled') === 'true') return false;
  return true;
}

export function getComposeTextarea() {
  return getComposeContext()?.element || null;
}

export function getSendButton() {
  return getComposeContext()?.button || null;
}

export function setTextareaValue(textarea, value) {
  const text = String(value ?? '');

  const isTextInput = textarea instanceof HTMLTextAreaElement || textarea instanceof HTMLInputElement;
  const isContentEditable = textarea?.isContentEditable || textarea?.getAttribute?.('contenteditable') === 'true';

  if (isTextInput) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      textarea instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
      'value',
    )?.set;

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

  textarea.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    data: text,
    inputType: 'insertText',
  }));

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
  let submitSeen = false;

  try {
    button.focus?.({ preventScroll: true });
  } catch {
    button.focus?.();
  }

  const onSubmit = () => {
    submitSeen = true;
  };

  form?.addEventListener('submit', onSubmit, { capture: true, once: true });

  const attempt = async action => {
    if (submitSeen || signal?.aborted) return;

    try {
      action?.();
    } catch {
      // Fallbacks abaixo
    }

    await delay(75, signal);
  };

  await attempt(() => {
    if (touchTarget && typeof touchTarget.click === 'function') {
      touchTarget.click();
      return;
    }
    button.click?.();
  });

  await attempt(() => {
    button.click?.();
  });

  if (!submitSeen && form?.requestSubmit) {
    await attempt(() => {
      try {
        form.requestSubmit(button);
      } catch {
        form.requestSubmit();
      }
    });
  }

  if (!submitSeen && form) {
    await attempt(() => {
      form.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    });
  }

  return true;
}

function cloneWithoutControls(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll([
    'button',
    '[role="button"]',
    'input',
    'textarea',
    'script',
    'style',
    'svg',
    'mat-icon',
    '.mat-mdc-button-touch-target',
    '[aria-hidden="true"]',
    'chat-panel-header',
    '.chat-panel-empty-state-action-bar',
    '.suggestions-container',
  ].join(', ')).forEach(node => node.remove());
  return clone;
}

function getResponseRootElement(element) {
  if (!element) return null;
  if (element.matches?.('.notebook-summary')) return element;

  const directSummary = element.querySelector?.('.notebook-summary');
  if (directSummary) return directSummary;

  return element;
}

function getResponseContainerFromButton(button) {
  const selector = [
    '.notebook-summary',
    '.chat-panel-empty-state',
    '.chat-panel-content',
    '.chat-panel-response',
    '.chat-panel-message',
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
  ].join(', ');

  const card = button.closest?.(selector);
  if (card) return card;

  let current = button.parentElement;
  while (current && current !== document.body) {
    if (current.matches?.('section, article, mat-card, div, note-card, chat-panel-content, chat-panel')) {
      const summaryNode = current.querySelector?.('.notebook-summary');
      const text = normalizeDisplayText(summaryNode?.textContent || current.textContent || '');
      if (text.length >= 20) return current;
    }
    current = current.parentElement;
  }

  return button.parentElement || button;
}

export function extractResponseText(element) {
  if (!element) return '';
  const source = getResponseRootElement(element);
  const clone = cloneWithoutControls(source);
  const extracted = normalizeDisplayText(clone.innerText || clone.textContent || '');
  if (extracted) return extracted;
  return normalizeDisplayText(source.innerText || source.textContent || '');
}

function getCandidateSignature(element) {
  return stableHash(normalizeSignatureText(extractResponseText(element)));
}

function getCardContainerFromButton(button) {
  return getResponseContainerFromButton(button);
}

function collectResponseCandidates() {
  const candidates = [];
  const seen = new Set();

  const addCandidate = element => {
    if (!element || seen.has(element) || !isVisible(element) || isInsideShadowPanel(element)) return;
    const text = extractResponseText(element);
    if (text.length < 20) return;
    candidates.push(element);
    seen.add(element);
  };

  queryAllDeep('.notebook-summary').forEach(addCandidate);

  queryAllDeep('button, [role="button"]').filter(button => {
    if (!isVisible(button) || isInsideShadowPanel(button)) return false;
    return labelMatches(button, [/copi/, /copy/]);
  }).forEach(button => {
    const card = getCardContainerFromButton(button);
    addCandidate(card);
  });

  queryAllDeep([
    '.chat-panel-empty-state',
    '.chat-panel-content',
    '.chat-panel-response',
    '.chat-panel-message',
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
  ].join(',')).forEach(addCandidate);

  return candidates;
}

export function snapshotResponseSignatures() {
  return [...new Set(collectResponseCandidates().map(candidate => getCandidateSignature(candidate)).filter(Boolean))];
}

export function findLatestResponseCandidate({ excludeSignatures = new Set() } = {}) {
  const candidates = collectResponseCandidates();

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const text = extractResponseText(candidate);
    if (text.length < 20) continue;

    const signature = getCandidateSignature(candidate);
    if (excludeSignatures.has(signature)) continue;

    const copyRoot = candidate.matches?.('.notebook-summary')
      ? candidate.parentElement || candidate
      : candidate;
    const copyButton = [...copyRoot.querySelectorAll('button')].find(button => labelMatches(button, [/copi/, /copy/]));

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

  const root = candidateElement.matches?.('.notebook-summary')
    ? candidateElement.parentElement || candidateElement
    : candidateElement;
  const copyButton = [...root.querySelectorAll('button')].find(button => {
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
