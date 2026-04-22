// ==UserScript==
// @name         NotebookLM Classificacao Runner
// @namespace    npm/vite-plugin-monkey
// @version      1.0.7
// @author       monkey
// @homepage     https://github.com/YsraEstudos/notebooklm-classificacao-runner
// @homepageURL  https://github.com/YsraEstudos/notebooklm-classificacao-runner
// @source       https://github.com/YsraEstudos/notebooklm-classificacao-runner.git
// @supportURL   https://github.com/YsraEstudos/notebooklm-classificacao-runner/issues
// @downloadURL  https://raw.githubusercontent.com/YsraEstudos/notebooklm-classificacao-runner/main/dist/notebooklm-classificacao-runner.user.js
// @updateURL    https://raw.githubusercontent.com/YsraEstudos/notebooklm-classificacao-runner/main/dist/notebooklm-classificacao-runner.meta.js
// @match        https://notebooklm.google.com/*
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function normalizeDisplayText(text) {
    return String(text ?? "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  }
  function normalizeSignatureText(text) {
    return normalizeDisplayText(text).replace(/\s+/g, " ").toLowerCase();
  }
  function stableHash(text) {
    const input = String(text ?? "");
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
  function createAbortError() {
    return new DOMException("Aborted", "AbortError");
  }
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal == null ? void 0 : signal.aborted) {
        reject(createAbortError());
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      const onAbort = () => {
        cleanup();
        reject(createAbortError());
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal == null ? void 0 : signal.removeEventListener("abort", onAbort);
      };
      signal == null ? void 0 : signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  async function waitFor(predicate, { timeoutMs = 1e4, intervalMs = 250, signal } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (signal == null ? void 0 : signal.aborted) throw createAbortError();
      const result = await predicate();
      if (result) return result;
      await delay(intervalMs, signal);
    }
    return null;
  }
  function formatDuration(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.ceil(safeMs / 1e3);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) return `${seconds}s`;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  function formatDateTime(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }
  function downloadText(filename, text, mimeType = "application/json;charset=utf-8") {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }
  async function copyText(text) {
    var _a;
    const normalized = String(text ?? "");
    try {
      if ((_a = navigator.clipboard) == null ? void 0 : _a.writeText) {
        await navigator.clipboard.writeText(normalized);
        return true;
      }
    } catch {
    }
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(normalized, "text");
        return true;
      }
    } catch {
    }
    try {
      const area = document.createElement("textarea");
      area.value = normalized;
      area.setAttribute("readonly", "true");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      area.style.top = "-9999px";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
  function parseMaybeJson(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("JSON inválido. Verifique a sintaxe antes de iniciar.");
    }
  }
  const STORAGE_KEY = "notebooklm_classificacao_runner_state_v1";
  const STORAGE_FALLBACK_PREFIX = "__nblm_classificacao_runner__";
  function readRawStorage() {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(STORAGE_KEY, null);
      }
    } catch {
    }
    try {
      return localStorage.getItem(`${STORAGE_FALLBACK_PREFIX}${STORAGE_KEY}`);
    } catch {
      return null;
    }
  }
  function writeRawStorage(value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(STORAGE_KEY, value);
        return;
      }
    } catch {
    }
    try {
      localStorage.setItem(`${STORAGE_FALLBACK_PREFIX}${STORAGE_KEY}`, value);
    } catch {
    }
  }
  function createDefaultState() {
    return {
      version: 2,
      status: "idle",
      collapsed: false,
      launcherTop: 120,
      draftText: "",
      loadedText: "",
      queue: [],
      nextIndex: 0,
      history: [],
      currentBatch: null,
      lastCapturedSignature: "",
      lastError: "",
      lastInfo: "",
      runId: null,
      updatedAt: Date.now()
    };
  }
  function loadState() {
    const raw = readRawStorage();
    if (!raw) return createDefaultState();
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      const state = {
        ...createDefaultState(),
        ...parsed
      };
      state.queue = Array.isArray(state.queue) ? state.queue : [];
      state.history = Array.isArray(state.history) ? state.history : [];
      state.nextIndex = Number.isFinite(state.nextIndex) ? state.nextIndex : 0;
      state.collapsed = Boolean(state.collapsed);
      state.launcherTop = Number.isFinite(state.launcherTop) ? state.launcherTop : 120;
      state.status = ["idle", "running", "paused", "stopped", "done", "error"].includes(state.status) ? state.status : "idle";
      if (state.currentBatch && typeof state.currentBatch === "object") {
        state.currentBatch = {
          ...state.currentBatch,
          baselineSignatures: Array.isArray(state.currentBatch.baselineSignatures) ? state.currentBatch.baselineSignatures.map((signature) => String(signature)) : []
        };
      } else {
        state.currentBatch = null;
      }
      if (state.status === "running") {
        state.status = "paused";
        state.lastInfo = "A execução anterior foi restaurada em pausa depois de recarregar a página.";
        state.lastError = "";
      }
      if (state.draftText) state.draftText = normalizeDisplayText(state.draftText);
      if (state.loadedText) state.loadedText = normalizeDisplayText(state.loadedText);
      if (state.lastCapturedSignature) {
        state.lastCapturedSignature = String(state.lastCapturedSignature);
      }
      state.updatedAt = Date.now();
      return state;
    } catch {
      return createDefaultState();
    }
  }
  function saveState(state) {
    const snapshot = {
      ...state,
      updatedAt: Date.now()
    };
    writeRawStorage(JSON.stringify(snapshot));
    return snapshot;
  }
  function extractItemText(entry) {
    if (typeof entry === "string") return normalizeDisplayText(entry);
    if (typeof entry === "number" || typeof entry === "boolean") {
      return normalizeDisplayText(String(entry));
    }
    if (!entry || typeof entry !== "object") return "";
    const preferredKeys = ["text", "message", "prompt", "content", "value", "title"];
    for (const key of preferredKeys) {
      if (typeof entry[key] === "string" && entry[key].trim()) {
        return normalizeDisplayText(entry[key]);
      }
    }
    const stringValues = Object.values(entry).filter((value) => typeof value === "string" && value.trim());
    if (stringValues.length === 1) {
      return normalizeDisplayText(stringValues[0]);
    }
    return "";
  }
  function normalizeQueueItem(entry, index) {
    const text = extractItemText(entry);
    if (!text) return null;
    const signature = normalizeSignatureText(text);
    const idSeed = `${index}-${signature}`;
    return {
      id: `item_${stableHash(idSeed)}_${index + 1}`,
      index,
      text,
      raw: entry
    };
  }
  function parseQueueFromJson(jsonText) {
    const parsed = parseMaybeJson(jsonText);
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed == null ? void 0 : parsed.items) ? parsed.items : null;
    if (!items) {
      throw new Error("O JSON precisa ser um array ou um objeto com a chave `items`.");
    }
    const queue = items.map((entry, index) => normalizeQueueItem(entry, index)).filter(Boolean);
    if (!queue.length) {
      throw new Error("Nenhum item válido foi encontrado no JSON.");
    }
    return queue;
  }
  function buildBatchText(batchItems) {
    return batchItems.map((item, index) => `${index + 1}. ${item.text}`).join("\n\n");
  }
  function buildHistoryClipboardText(history) {
    return history.map((entry, index) => {
      const title = `LOTE ${index + 1} (${entry.startIndex + 1}-${entry.endIndex + 1})`;
      return `=== ${title} ===
${entry.responseText}`;
    }).join("\n\n");
  }
  function createExampleJson() {
    return JSON.stringify([
      { text: "Primeiro item de exemplo para enviar ao NotebookLM." },
      { text: "Segundo item de exemplo para demonstrar o lote de 3." },
      { text: "Terceiro item de exemplo com outro conteúdo." },
      { text: "Quarto item de exemplo para mostrar continuidade." },
      { text: "Quinto item de exemplo." },
      { text: "Sexto item de exemplo." },
      { text: "Sétimo item de exemplo para fechar o lote final." }
    ], null, 2);
  }
  function queryAllDeep(selector, root = document) {
    const results = [];
    const seen = /* @__PURE__ */ new Set();
    const roots = [root];
    while (roots.length) {
      const currentRoot = roots.pop();
      if (!currentRoot || typeof currentRoot.querySelectorAll !== "function") continue;
      const matches = currentRoot.querySelectorAll(selector);
      for (const element of matches) {
        if (seen.has(element)) continue;
        seen.add(element);
        results.push(element);
      }
      const allElements = currentRoot.querySelectorAll("*");
      for (const element of allElements) {
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
        }
      }
    }
    return results;
  }
  function getNormalizedControlText(element) {
    var _a, _b;
    return normalizeSignatureText([
      (_a = element == null ? void 0 : element.getAttribute) == null ? void 0 : _a.call(element, "aria-label"),
      (_b = element == null ? void 0 : element.getAttribute) == null ? void 0 : _b.call(element, "placeholder"),
      element == null ? void 0 : element.textContent
    ].filter(Boolean).join(" "));
  }
  function isVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    return element.getClientRects().length > 0;
  }
  function isInsideShadowPanel(element) {
    var _a;
    let current = element;
    while (current) {
      if (current.id === "nlm-classificacao-host" || current.id === "nlm-classificacao-panel" || current.id === "nlm-classificacao-rail") {
        return true;
      }
      const root = (_a = current.getRootNode) == null ? void 0 : _a.call(current);
      if (root && root.host) {
        current = root.host;
        continue;
      }
      current = current.parentElement;
    }
    return false;
  }
  function labelMatches(element, patterns) {
    const label = `${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`.toLowerCase();
    return patterns.some((pattern) => pattern.test(label));
  }
  function getComposeScore(element) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s;
    if (!element || !isVisible(element) || isInsideShadowPanel(element)) return -1;
    if ((_a = element.matches) == null ? void 0 : _a.call(element, "[disabled], [readonly]")) return -1;
    if ((_b = element.closest) == null ? void 0 : _b.call(element, '[formcontrolname="discoverSourcesQuery"]')) return -1;
    const labelText = getNormalizedControlText(element);
    if (/discover\s*sources?/.test(labelText)) return -1;
    if (/pesquise\s+fontes/.test(labelText)) return -1;
    if (/search\s*sources?/.test(labelText)) return -1;
    if (/source\s*query/.test(labelText)) return -1;
    let score = -1;
    if ((_c = element.matches) == null ? void 0 : _c.call(element, 'textarea.query-box-input[aria-label="Query box"]')) score = 120;
    else if ((_d = element.matches) == null ? void 0 : _d.call(element, 'textarea.query-box-input[aria-label="Caixa de consulta"]')) score = 120;
    else if ((_e = element.matches) == null ? void 0 : _e.call(element, "textarea.query-box-input")) score = 100;
    else if (/^query box$/.test(labelText)) score = 95;
    else if (/^caixa de consulta$/.test(labelText)) score = 95;
    else if ((_f = element.matches) == null ? void 0 : _f.call(element, 'textarea[aria-label="Query box"]')) score = 90;
    else if ((_g = element.matches) == null ? void 0 : _g.call(element, 'textarea[aria-label="Caixa de consulta"]')) score = 90;
    else if ((_h = element.matches) == null ? void 0 : _h.call(element, 'textarea[placeholder="Start typing..."]')) score = 90;
    else if ((_i = element.matches) == null ? void 0 : _i.call(element, 'textarea[placeholder*="Start typing"]')) score = 80;
    else if ((_j = element.matches) == null ? void 0 : _j.call(element, 'textarea[placeholder*="Comece a digitar"]')) score = 80;
    else if ((_k = element.matches) == null ? void 0 : _k.call(element, 'textarea[placeholder*="digitar"]')) score = 70;
    else if ((_l = element.matches) == null ? void 0 : _l.call(element, '[contenteditable="true"]')) score = 45;
    else if ((_m = element.matches) == null ? void 0 : _m.call(element, '[role="textbox"]')) score = 35;
    else if ((_n = element.matches) == null ? void 0 : _n.call(element, "textarea")) score = 20;
    if (score < 0) return -1;
    if ((_o = element.closest) == null ? void 0 : _o.call(element, "form")) score += 25;
    if ((_p = element.closest) == null ? void 0 : _p.call(element, ".message-container")) score += 15;
    if ((_q = element.closest) == null ? void 0 : _q.call(element, ".input-group")) score += 10;
    if ((_r = element.closest) == null ? void 0 : _r.call(element, "query-box")) score += 10;
    if ((_s = element.closest) == null ? void 0 : _s.call(element, ".bottom-container")) score += 5;
    return score;
  }
  function getSubmitButtonScore(button, composerTextarea = null) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
    if (!button || !isVisible(button) || isInsideShadowPanel(button)) return -1;
    const labelText = getNormalizedControlText(button);
    let score = -1;
    if ((_a = button.matches) == null ? void 0 : _a.call(button, 'button.submit-button[aria-label="Submit"]')) score = 120;
    else if ((_b = button.matches) == null ? void 0 : _b.call(button, 'button.submit-button[aria-label="Enviar"]')) score = 120;
    else if ((_c = button.matches) == null ? void 0 : _c.call(button, "button.submit-button")) score = 100;
    else if ((_d = button.matches) == null ? void 0 : _d.call(button, 'button[type="submit"]')) score = 90;
    else if (/^(submit|enviar)$/.test(labelText)) score = 80;
    else if (labelText.includes("submit") || labelText.includes("enviar") || labelText.includes("arrow_forward")) score = 60;
    else if ((_e = button.matches) == null ? void 0 : _e.call(button, "button")) score = 20;
    if (score < 0) return -1;
    if (score === 20 && !((_f = button.closest) == null ? void 0 : _f.call(button, "form")) && !((_g = button.closest) == null ? void 0 : _g.call(button, ".bottom-right-container")) && !((_h = button.closest) == null ? void 0 : _h.call(button, ".message-container")) && !((_i = button.closest) == null ? void 0 : _i.call(button, ".input-group"))) {
      return -1;
    }
    if ((_j = button.closest) == null ? void 0 : _j.call(button, "form")) score += 25;
    if ((_k = button.closest) == null ? void 0 : _k.call(button, ".bottom-right-container")) score += 15;
    if ((_l = button.closest) == null ? void 0 : _l.call(button, ".message-container")) score += 10;
    if ((_m = button.closest) == null ? void 0 : _m.call(button, ".input-group")) score += 10;
    if (composerTextarea && ((_n = button.closest) == null ? void 0 : _n.call(button, "form")) === ((_o = composerTextarea.closest) == null ? void 0 : _o.call(composerTextarea, "form"))) {
      score += 20;
    }
    return score;
  }
  function getBestSubmitButton(root, composerTextarea = null) {
    var _a;
    const buttons = queryAllDeep('button, [role="button"]', root || document);
    const candidates = [];
    for (const element of buttons) {
      const score = getSubmitButtonScore(element, composerTextarea);
      if (score < 0) continue;
      candidates.push({ element, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return ((_a = candidates[0]) == null ? void 0 : _a.element) || null;
  }
  function getComposeContext() {
    var _a;
    const editors = queryAllDeep('textarea, [contenteditable="true"], [role="textbox"]');
    const candidates = [];
    for (const element of editors) {
      const score = getComposeScore(element);
      if (score < 0) continue;
      const form = ((_a = element.closest) == null ? void 0 : _a.call(element, "form")) || null;
      const button = getBestSubmitButton(form || document, element) || getBestSubmitButton(document, element);
      candidates.push({
        element,
        form,
        button,
        score: score + (button ? 15 : 0)
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] || null;
  }
  function isEnabledButton(element) {
    var _a, _b;
    if (!element) return false;
    if (element.disabled) return false;
    if ((_a = element.matches) == null ? void 0 : _a.call(element, '[disabled], [aria-disabled="true"], .mat-mdc-button-disabled')) return false;
    if (((_b = element.getAttribute) == null ? void 0 : _b.call(element, "aria-disabled")) === "true") return false;
    return true;
  }
  function getComposeTextarea() {
    var _a;
    return ((_a = getComposeContext()) == null ? void 0 : _a.element) || null;
  }
  function getSendButton() {
    var _a;
    return ((_a = getComposeContext()) == null ? void 0 : _a.button) || null;
  }
  function setTextareaValue(textarea, value) {
    var _a, _b;
    const text = String(value ?? "");
    const isTextInput = textarea instanceof HTMLTextAreaElement || textarea instanceof HTMLInputElement;
    const isContentEditable = (textarea == null ? void 0 : textarea.isContentEditable) || ((_a = textarea == null ? void 0 : textarea.getAttribute) == null ? void 0 : _a.call(textarea, "contenteditable")) === "true";
    if (isTextInput) {
      const nativeSetter = (_b = Object.getOwnPropertyDescriptor(
        textarea instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        "value"
      )) == null ? void 0 : _b.set;
      if (nativeSetter) {
        nativeSetter.call(textarea, text);
      } else {
        textarea.value = text;
      }
    } else if (isContentEditable) {
      textarea.focus();
      textarea.textContent = text;
    } else if ("value" in textarea) {
      textarea.value = text;
    } else {
      textarea.textContent = text;
    }
    textarea.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType: "insertText"
    }));
    textarea.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: text,
      inputType: "insertText"
    }));
    textarea.dispatchEvent(new Event("input", {
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    textarea.dispatchEvent(new Event("keyup", {
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    textarea.dispatchEvent(new Event("change", {
      bubbles: true,
      cancelable: true,
      composed: true
    }));
    textarea.focus();
    if (typeof textarea.setSelectionRange === "function") {
      textarea.setSelectionRange(text.length, text.length);
    }
  }
  function clickTouchTarget(button) {
    var _a;
    if (!button) return false;
    const touchTarget = (_a = button.querySelector) == null ? void 0 : _a.call(button, ".mat-mdc-button-touch-target");
    if (touchTarget && typeof touchTarget.click === "function") {
      touchTarget.click();
      return true;
    }
    if (typeof button.click === "function") {
      button.click();
      return true;
    }
    return false;
  }
  async function waitForComposeTextarea(signal) {
    return waitFor(() => getComposeTextarea(), { timeoutMs: 2e4, intervalMs: 250, signal });
  }
  async function waitForSendButton(signal) {
    return waitFor(() => {
      const button = getSendButton();
      return isEnabledButton(button) ? button : null;
    }, { timeoutMs: 1e4, intervalMs: 250, signal });
  }
  async function activateSubmitButton(button, signal) {
    var _a, _b, _c, _d;
    if (!button) return false;
    const form = ((_a = button.closest) == null ? void 0 : _a.call(button, "form")) || null;
    const touchTarget = (_b = button.querySelector) == null ? void 0 : _b.call(button, ".mat-mdc-button-touch-target");
    let submitSeen = false;
    try {
      (_c = button.focus) == null ? void 0 : _c.call(button, { preventScroll: true });
    } catch {
      (_d = button.focus) == null ? void 0 : _d.call(button);
    }
    const onSubmit = () => {
      submitSeen = true;
    };
    form == null ? void 0 : form.addEventListener("submit", onSubmit, { capture: true, once: true });
    const attempt = async (action) => {
      if (submitSeen || (signal == null ? void 0 : signal.aborted)) return;
      try {
        action == null ? void 0 : action();
      } catch {
      }
      await delay(75, signal);
    };
    await attempt(() => {
      var _a2;
      if (touchTarget && typeof touchTarget.click === "function") {
        touchTarget.click();
        return;
      }
      (_a2 = button.click) == null ? void 0 : _a2.call(button);
    });
    await attempt(() => {
      var _a2;
      (_a2 = button.click) == null ? void 0 : _a2.call(button);
    });
    if (!submitSeen && (form == null ? void 0 : form.requestSubmit)) {
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
        form.dispatchEvent(new Event("submit", {
          bubbles: true,
          cancelable: true,
          composed: true
        }));
      });
    }
    return true;
  }
  function cloneWithoutControls(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll([
      "button",
      '[role="button"]',
      "input",
      "textarea",
      "script",
      "style",
      "svg",
      "mat-icon",
      ".mat-mdc-button-touch-target",
      '[aria-hidden="true"]',
      "chat-panel-header",
      ".chat-panel-empty-state-action-bar",
      ".suggestions-container"
    ].join(", ")).forEach((node) => node.remove());
    return clone;
  }
  function getResponseRootElement(element) {
    var _a, _b;
    if (!element) return null;
    if ((_a = element.matches) == null ? void 0 : _a.call(element, ".notebook-summary")) return element;
    const directSummary = (_b = element.querySelector) == null ? void 0 : _b.call(element, ".notebook-summary");
    if (directSummary) return directSummary;
    return element;
  }
  function getResponseContainerFromButton(button) {
    var _a, _b, _c;
    const selector = [
      ".notebook-summary",
      ".chat-panel-empty-state",
      ".chat-panel-content",
      ".chat-panel-response",
      ".chat-panel-message",
      "note-card",
      ".note-card",
      "mat-card",
      "article",
      '[role="article"]',
      '[data-testid*="response"]',
      '[data-testid*="answer"]',
      '[data-testid*="note"]',
      ".message",
      ".answer",
      ".assistant-message",
      ".response"
    ].join(", ");
    const card = (_a = button.closest) == null ? void 0 : _a.call(button, selector);
    if (card) return card;
    let current = button.parentElement;
    while (current && current !== document.body) {
      if ((_b = current.matches) == null ? void 0 : _b.call(current, "section, article, mat-card, div, note-card, chat-panel-content, chat-panel")) {
        const summaryNode = (_c = current.querySelector) == null ? void 0 : _c.call(current, ".notebook-summary");
        const text = normalizeDisplayText((summaryNode == null ? void 0 : summaryNode.textContent) || current.textContent || "");
        if (text.length >= 20) return current;
      }
      current = current.parentElement;
    }
    return button.parentElement || button;
  }
  function extractResponseText(element) {
    if (!element) return "";
    const source = getResponseRootElement(element);
    const clone = cloneWithoutControls(source);
    const extracted = normalizeDisplayText(clone.innerText || clone.textContent || "");
    if (extracted) return extracted;
    return normalizeDisplayText(source.innerText || source.textContent || "");
  }
  function getCandidateSignature(element) {
    return stableHash(normalizeSignatureText(extractResponseText(element)));
  }
  function getCardContainerFromButton(button) {
    return getResponseContainerFromButton(button);
  }
  function collectResponseCandidates() {
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const addCandidate = (element) => {
      if (!element || seen.has(element) || !isVisible(element) || isInsideShadowPanel(element)) return;
      const text = extractResponseText(element);
      if (text.length < 20) return;
      candidates.push(element);
      seen.add(element);
    };
    queryAllDeep(".notebook-summary").forEach(addCandidate);
    queryAllDeep('button, [role="button"]').filter((button) => {
      if (!isVisible(button) || isInsideShadowPanel(button)) return false;
      return labelMatches(button, [/copi/, /copy/]);
    }).forEach((button) => {
      const card = getCardContainerFromButton(button);
      addCandidate(card);
    });
    queryAllDeep([
      ".chat-panel-empty-state",
      ".chat-panel-content",
      ".chat-panel-response",
      ".chat-panel-message",
      "note-card",
      ".note-card",
      "mat-card",
      "article",
      '[role="article"]',
      '[data-testid*="response"]',
      '[data-testid*="answer"]',
      '[data-testid*="note"]',
      ".message",
      ".answer",
      ".assistant-message",
      ".response"
    ].join(",")).forEach(addCandidate);
    return candidates;
  }
  function snapshotResponseSignatures() {
    return [...new Set(collectResponseCandidates().map((candidate) => getCandidateSignature(candidate)).filter(Boolean))];
  }
  function findLatestResponseCandidate({ excludeSignatures = /* @__PURE__ */ new Set() } = {}) {
    var _a;
    const candidates = collectResponseCandidates();
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const candidate = candidates[index];
      const text = extractResponseText(candidate);
      if (text.length < 20) continue;
      const signature = getCandidateSignature(candidate);
      if (excludeSignatures.has(signature)) continue;
      const copyRoot = ((_a = candidate.matches) == null ? void 0 : _a.call(candidate, ".notebook-summary")) ? candidate.parentElement || candidate : candidate;
      const copyButton = [...copyRoot.querySelectorAll("button")].find((button) => labelMatches(button, [/copi/, /copy/]));
      return {
        element: candidate,
        text,
        signature,
        copyButton
      };
    }
    return null;
  }
  function clickNativeCopyButton(candidateElement) {
    var _a;
    if (!candidateElement) return false;
    const root = ((_a = candidateElement.matches) == null ? void 0 : _a.call(candidateElement, ".notebook-summary")) ? candidateElement.parentElement || candidateElement : candidateElement;
    const copyButton = [...root.querySelectorAll("button")].find((button) => {
      return labelMatches(button, [/copi/, /copy/]);
    });
    if (!copyButton) return false;
    return clickTouchTarget(copyButton);
  }
  async function sendBatchToNotebook(promptText, signal) {
    const textarea = await waitForComposeTextarea(signal);
    if (!textarea) {
      throw new Error("Não encontrei a caixa de consulta do NotebookLM.");
    }
    setTextareaValue(textarea, promptText);
    await delay(150, signal);
    const sendButton = await waitForSendButton(signal);
    if (!sendButton) {
      throw new Error("Não encontrei o botão de enviar habilitado.");
    }
    await activateSubmitButton(sendButton, signal);
    return true;
  }
  async function waitForBatchDeadline(deadlineAt, signal, onTick) {
    while (true) {
      if (signal == null ? void 0 : signal.aborted) throw createAbortError();
      const remaining = Number(deadlineAt) - Date.now();
      if (remaining <= 0) return 0;
      onTick == null ? void 0 : onTick(remaining);
      await delay(Math.min(1e3, remaining), signal);
    }
  }
  const BATCH_SIZE = 3;
  const WAIT_MS = 9e4;
  const CAPTURE_TIMEOUT_MS = 45e3;
  function formatError(error) {
    if (!error) return "Erro desconhecido.";
    if (error instanceof Error && error.message) return error.message;
    return String(error);
  }
  class ClassificacaoRunner {
    constructor({ onChange, onLog } = {}) {
      this.onChange = onChange;
      this.onLog = onLog;
      this.state = loadState();
      this.controller = null;
      this.activePromise = null;
      if (this.state.status === "running") {
        this.state = {
          ...this.state,
          status: "paused",
          running: false,
          paused: true,
          lastInfo: "A execução foi restaurada em pausa após recarregar a página."
        };
        this.persist();
      }
    }
    getState() {
      return this.state;
    }
    persist(patch = null) {
      var _a;
      if (patch) {
        this.state = {
          ...this.state,
          ...patch,
          updatedAt: Date.now()
        };
      } else {
        this.state = {
          ...this.state,
          updatedAt: Date.now()
        };
      }
      saveState(this.state);
      (_a = this.onChange) == null ? void 0 : _a.call(this, this.state);
      return this.state;
    }
    log(message, tone = "info") {
      var _a;
      (_a = this.onLog) == null ? void 0 : _a.call(this, message, tone);
    }
    setCollapsed(collapsed) {
      this.persist({ collapsed: Boolean(collapsed) });
    }
    setLauncherTop(launcherTop) {
      const top = Number(launcherTop);
      if (!Number.isFinite(top)) return;
      this.persist({ launcherTop: top });
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
        lastCapturedSignature: "",
        lastError: "",
        lastInfo: `JSON carregado com ${queue.length} itens.`,
        status: "idle",
        running: false,
        paused: false,
        runId: `run_${Date.now()}`
      });
      return queue;
    }
    async ensureDraftLoaded() {
      const draftText = normalizeDisplayText(this.state.draftText);
      if (!draftText) {
        throw new Error("Cole um JSON no painel antes de iniciar.");
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
        throw new Error("Carregue um JSON válido antes de iniciar.");
      }
      if (this.state.nextIndex >= this.state.queue.length && !this.state.currentBatch) {
        if (this.state.status === "done") {
          throw new Error("A fila já terminou. Carregue um novo JSON para recomeçar.");
        }
        if (this.state.status !== "paused" && this.state.status !== "stopped") {
          throw new Error("Não há itens pendentes para processar.");
        }
      }
      this.controller = new AbortController();
      this.persist({
        status: "running",
        running: true,
        paused: false,
        lastError: "",
        lastInfo: "Execução iniciada."
      });
      this.activePromise = this.processQueue(this.controller.signal).finally(() => {
        this.activePromise = null;
        this.controller = null;
      });
      return this.activePromise;
    }
    async pause({ collapse = false } = {}) {
      var _a;
      if (this.state.status !== "running") {
        if (collapse) this.setCollapsed(true);
        return;
      }
      this.persist({
        status: "paused",
        running: false,
        paused: true,
        lastInfo: "Execução pausada."
      });
      if (collapse) this.setCollapsed(true);
      (_a = this.controller) == null ? void 0 : _a.abort();
      try {
        await this.activePromise;
      } catch {
      }
    }
    async stop() {
      var _a;
      if (this.state.status === "idle") {
        this.persist({
          status: "stopped",
          running: false,
          paused: false,
          lastInfo: "Execução parada."
        });
        return;
      }
      this.persist({
        status: "stopped",
        running: false,
        paused: false,
        lastInfo: "Execução parada."
      });
      (_a = this.controller) == null ? void 0 : _a.abort();
      try {
        await this.activePromise;
      } catch {
      }
    }
    async resetProgress() {
      if (this.state.status === "running" || this.state.status === "paused" || this.activePromise) {
        await this.stop();
      }
      const hasQueue = Array.isArray(this.state.queue) && this.state.queue.length > 0;
      this.persist({
        status: "idle",
        running: false,
        paused: false,
        nextIndex: 0,
        history: Array.isArray(this.state.history) ? [...this.state.history] : [],
        currentBatch: null,
        lastCapturedSignature: "",
        lastError: "",
        lastInfo: hasQueue ? "Progresso zerado. A fila voltou ao item 1 sem apagar o histórico." : "Progresso zerado. Carregue um JSON para começar.",
        runId: `run_${Date.now()}`
      });
    }
    async togglePause() {
      if (this.state.status === "running") {
        return this.pause();
      }
      if (this.state.status === "paused" || this.state.status === "stopped") {
        return this.start();
      }
      return Promise.resolve();
    }
    async copyAll() {
      const text = buildHistoryClipboardText(this.state.history);
      if (!text.trim()) throw new Error("Ainda não existem respostas no histórico.");
      const ok = await copyText(text);
      if (!ok) throw new Error("Não consegui copiar o histórico.");
      this.persist({ lastInfo: "Histórico copiado." });
      return true;
    }
    async copyHistoryEntry(entryId) {
      const entry = this.state.history.find((item) => item.id === entryId);
      if (!entry) throw new Error("Resposta não encontrada no histórico.");
      const ok = await copyText(entry.responseText);
      if (!ok) throw new Error("Não consegui copiar a resposta.");
      this.persist({ lastInfo: "Resposta copiada." });
      return true;
    }
    async processQueue(signal) {
      var _a, _b, _c;
      try {
        if (((_a = this.state.currentBatch) == null ? void 0 : _a.phase) === "waiting" || ((_b = this.state.currentBatch) == null ? void 0 : _b.phase) === "capturing") {
          await this.finishCurrentBatch(signal);
        }
        while (!signal.aborted && this.state.nextIndex < this.state.queue.length) {
          const cursor = this.state.nextIndex;
          const batch = this.state.queue.slice(cursor, cursor + BATCH_SIZE);
          if (!batch.length) break;
          const batchNumber = Math.floor(cursor / BATCH_SIZE) + 1;
          const promptText = buildBatchText(batch);
          const batchId = `batch_${Date.now()}_${cursor}`;
          const baselineSignatures = snapshotResponseSignatures();
          const initialBatchState = {
            id: batchId,
            batchNumber,
            startIndex: cursor,
            endIndex: cursor + batch.length - 1,
            itemCount: batch.length,
            items: batch.map((item) => item.text),
            promptText,
            baselineSignatures,
            phase: "sending",
            sentAt: null,
            waitDeadlineAt: null,
            remainingMs: WAIT_MS
          };
          this.persist({
            currentBatch: initialBatchState,
            lastInfo: `Enviando lote ${batchNumber} (${cursor + 1}-${cursor + batch.length})...`,
            lastError: ""
          });
          await sendBatchToNotebook(promptText, signal);
          const sentAt = Date.now();
          this.persist({
            currentBatch: {
              ...this.state.currentBatch,
              phase: "waiting",
              sentAt,
              waitDeadlineAt: sentAt + WAIT_MS,
              remainingMs: WAIT_MS
            },
            lastInfo: `Lote ${batchNumber} enviado. Aguardando 90 segundos...`
          });
          await waitForBatchDeadline(this.state.currentBatch.waitDeadlineAt, signal, (remaining) => {
            this.persist({
              currentBatch: {
                ...this.state.currentBatch,
                phase: "waiting",
                remainingMs: remaining
              }
            });
          });
          this.persist({
            currentBatch: {
              ...this.state.currentBatch,
              phase: "capturing",
              remainingMs: 0
            }
          });
          const candidate = await this.captureLatestResponse(signal, baselineSignatures);
          if (!candidate) {
            throw new Error("Não encontrei uma resposta nova para o lote atual.");
          }
          const entry = {
            id: `response_${Date.now()}_${batchNumber}`,
            batchNumber,
            startIndex: cursor,
            endIndex: cursor + batch.length - 1,
            itemCount: batch.length,
            items: batch.map((item) => item.text),
            promptText,
            responseText: candidate.text,
            responseSignature: candidate.signature,
            capturedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          this.persist({
            history: [...this.state.history, entry],
            lastCapturedSignature: candidate.signature,
            nextIndex: cursor + batch.length,
            currentBatch: null,
            lastInfo: `Lote ${batchNumber} capturado.`,
            lastError: ""
          });
          clickNativeCopyButton(candidate.element);
        }
        if (!signal.aborted) {
          this.persist({
            status: "done",
            running: false,
            paused: false,
            currentBatch: null,
            lastInfo: "Fila concluída.",
            lastError: ""
          });
        }
      } catch (error) {
        if (signal.aborted && (this.state.status === "paused" || this.state.status === "stopped" || this.state.status === "idle")) {
          return;
        }
        const message = formatError(error);
        this.persist({
          status: "error",
          running: false,
          paused: false,
          lastError: message,
          lastInfo: ""
        });
        this.log(message, "error");
      } finally {
        if (((_c = this.controller) == null ? void 0 : _c.signal) === signal) {
          this.controller = null;
        }
      }
    }
    async finishCurrentBatch(signal) {
      const current = this.state.currentBatch;
      if (!current) return;
      const baselineSignatures = Array.isArray(current.baselineSignatures) ? current.baselineSignatures : [];
      if (current.phase === "waiting" && current.waitDeadlineAt) {
        await waitForBatchDeadline(current.waitDeadlineAt, signal, (remaining) => {
          this.persist({
            currentBatch: {
              ...this.state.currentBatch,
              remainingMs: remaining
            }
          });
        });
      }
      const candidate = await this.captureLatestResponse(signal, baselineSignatures);
      if (!candidate) {
        throw new Error("Não encontrei uma resposta nova para o lote retomado.");
      }
      const entry = {
        id: `response_${Date.now()}_${current.batchNumber}`,
        batchNumber: current.batchNumber,
        startIndex: current.startIndex,
        endIndex: current.endIndex,
        itemCount: current.itemCount,
        items: current.items,
        promptText: current.promptText,
        responseText: candidate.text,
        responseSignature: candidate.signature,
        capturedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.persist({
        history: [...this.state.history, entry],
        lastCapturedSignature: candidate.signature,
        nextIndex: current.endIndex + 1,
        currentBatch: null,
        status: "running",
        running: true,
        paused: false,
        lastInfo: `Lote ${current.batchNumber} retomado e capturado.`,
        lastError: ""
      });
      clickNativeCopyButton(candidate.element);
    }
    async captureLatestResponse(signal, baselineSignatures = []) {
      const excluded = new Set([
        this.state.lastCapturedSignature,
        ...baselineSignatures
      ].filter(Boolean).map((value) => String(value)));
      const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
      while (!signal.aborted && Date.now() < deadline) {
        const candidate = findLatestResponseCandidate({
          excludeSignatures: excluded
        });
        if (candidate) {
          const normalizedText = normalizeDisplayText(candidate.text);
          const signature = candidate.signature;
          if (signature && !excluded.has(signature) && normalizedText.length >= 20) {
            return candidate;
          }
        }
        await delay(1e3, signal);
      }
      return null;
    }
    async maybeResumeCurrentBatch() {
      var _a, _b;
      if (((_a = this.state.currentBatch) == null ? void 0 : _a.phase) === "waiting" || ((_b = this.state.currentBatch) == null ? void 0 : _b.phase) === "capturing") {
        return this.start();
      }
      return this.startFromDraft();
    }
  }
  const PANEL_WIDTH = 392;
  const LAUNCHER_SIZE = 56;
  const DEFAULT_LAUNCHER_TOP = 120;
  function createElement(tag, className, textContent) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  }
  function makeButton(label, tone = "secondary") {
    const button = createElement("button", `nlm-btn nlm-btn-${tone}`);
    button.type = "button";
    button.textContent = label;
    return button;
  }
  function formatRange(startIndex, endIndex) {
    return `${startIndex + 1}-${endIndex + 1}`;
  }
  function setChipContent(container, primaryText, secondaryText = "") {
    container.replaceChildren();
    const strong = createElement("strong");
    strong.textContent = primaryText;
    container.appendChild(strong);
    if (secondaryText) {
      container.appendChild(document.createTextNode(secondaryText));
    }
  }
  class ClassificacaoPanel {
    constructor({
      onDraftChange,
      onLoadJson,
      onStart,
      onTogglePause,
      onStop,
      onReset,
      onCopyAll,
      onCopyEntry,
      onToggleCollapsed,
      onLauncherTopChange,
      onImportFile,
      onDownloadExample
    } = {}) {
      this.onDraftChange = onDraftChange;
      this.onLoadJson = onLoadJson;
      this.onStart = onStart;
      this.onTogglePause = onTogglePause;
      this.onStop = onStop;
      this.onReset = onReset;
      this.onCopyAll = onCopyAll;
      this.onCopyEntry = onCopyEntry;
      this.onToggleCollapsed = onToggleCollapsed;
      this.onLauncherTopChange = onLauncherTopChange;
      this.onImportFile = onImportFile;
      this.onDownloadExample = onDownloadExample;
      this.state = null;
      this.ignoreEditorEvents = false;
      this.isCollapsed = false;
      this.launcherTop = DEFAULT_LAUNCHER_TOP;
      this.launcherDragState = null;
      this.launcherDragCleanup = null;
      this.suppressLauncherClick = false;
      this.host = document.createElement("div");
      this.host.id = "nlm-classificacao-host";
      this.host.setAttribute("aria-live", "polite");
      this.shadow = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = this.buildStyles();
      this.shadow.appendChild(style);
      this.shell = createElement("div", "nlm-shell");
      this.panel = createElement("aside", "nlm-panel");
      this.panel.id = "nlm-classificacao-panel";
      this.rail = createElement("div", "nlm-rail");
      this.rail.id = "nlm-classificacao-rail";
      this.railButton = createElement("button", "nlm-rail-button");
      this.railButton.type = "button";
      this.railButton.title = "Abrir painel e arrastar para mover";
      this.railButton.setAttribute("aria-label", "Abrir painel do Classificacao");
      const railBadge = createElement("span", "nlm-rail-badge");
      railBadge.textContent = "NLM";
      const railHint = createElement("span", "nlm-rail-hint");
      railHint.textContent = "↕";
      this.railButton.append(railBadge, railHint);
      this.rail.append(this.railButton);
      this.railButton.tabIndex = -1;
      this.railButton.setAttribute("aria-hidden", "true");
      this.content = createElement("div", "nlm-content");
      this.header = this.buildHeader();
      this.notice = createElement("div", "nlm-notice");
      this.controls = this.buildControls();
      this.editor = this.buildEditor();
      this.stats = this.buildStats();
      this.history = this.buildHistory();
      this.footer = this.buildFooter();
      this.content.append(
        this.header,
        this.notice,
        this.controls,
        this.editor,
        this.stats,
        this.history,
        this.footer
      );
      this.panel.append(this.content);
      this.shell.append(this.panel, this.rail);
      this.shadow.append(this.shell);
      this.bindEvents();
      this.applyLauncherTop(this.launcherTop, { persist: false });
    }
    buildStyles() {
      return `
      :host {
        all: initial;
      }

      * {
        box-sizing: border-box;
      }

      .nlm-shell {
        position: fixed;
        inset: 0 auto 0 0;
        width: 0;
        z-index: 2147483647;
        pointer-events: none;
        overflow: visible;
        font-family: "Google Sans Text", "Google Sans", "Segoe UI", sans-serif;
        color: #eef2ff;
        --nlm-launcher-top: ${DEFAULT_LAUNCHER_TOP}px;
        --nlm-launcher-size: ${LAUNCHER_SIZE}px;
      }

      .nlm-panel {
        position: fixed;
        inset: 0 auto 0 0;
        width: min(${PANEL_WIDTH}px, calc(100vw - 16px));
        pointer-events: auto;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.16), transparent 30%),
          radial-gradient(circle at bottom right, rgba(251, 191, 36, 0.12), transparent 30%),
          linear-gradient(180deg, rgba(11, 15, 28, 0.95), rgba(7, 11, 20, 0.98));
        border-right: 1px solid rgba(148, 163, 184, 0.18);
        box-shadow: 12px 0 48px rgba(2, 6, 23, 0.36);
        backdrop-filter: blur(16px);
        overflow: hidden;
        transform: translateX(0);
        transition:
          transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
          box-shadow 220ms ease,
          background 220ms ease;
        will-change: transform, opacity;
      }

      .nlm-shell.is-collapsed .nlm-panel {
        background: transparent;
        border-right-color: transparent;
        box-shadow: none;
        transform: translateX(calc(-100% - 16px));
        pointer-events: none;
      }

      .nlm-content {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px 14px 14px 14px;
        overflow: hidden;
        transition: opacity 160ms ease, transform 180ms ease;
      }

      .nlm-shell.is-collapsed .nlm-content {
        opacity: 0;
        pointer-events: none;
        transform: translateX(-12px);
      }

      .nlm-rail {
        position: fixed;
        left: 12px;
        top: var(--nlm-launcher-top);
        width: calc(var(--nlm-launcher-size) + 6px);
        height: calc(var(--nlm-launcher-size) + 6px);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        opacity: 1;
        transition: opacity 160ms ease, transform 180ms ease;
        z-index: 2;
      }

      .nlm-shell:not(.is-collapsed) .nlm-rail {
        opacity: 0;
        pointer-events: none;
        transform: translateX(-10px) scale(0.92);
      }

      .nlm-shell.is-collapsed .nlm-rail,
      .nlm-shell.is-collapsed .nlm-rail-button {
        pointer-events: auto;
      }

      .nlm-rail-button {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 20px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background:
          radial-gradient(circle at 25% 20%, rgba(255, 255, 255, 0.3), transparent 36%),
          linear-gradient(180deg, rgba(14, 165, 233, 0.96), rgba(37, 99, 235, 0.94) 58%, rgba(15, 23, 42, 0.98));
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        letter-spacing: 0.14em;
        font-size: 10px;
        font-weight: 800;
        cursor: grab;
        box-shadow:
          0 14px 30px rgba(15, 23, 42, 0.38),
          0 0 0 1px rgba(255, 255, 255, 0.1) inset;
        transform: translateY(0) scale(1);
        transition: transform 160ms ease, box-shadow 180ms ease, filter 180ms ease, opacity 180ms ease;
        overflow: hidden;
        touch-action: none;
        user-select: none;
        z-index: 1;
      }

      .nlm-rail-button::before {
        content: "";
        position: absolute;
        inset: 1px;
        border-radius: inherit;
        background:
          radial-gradient(circle at 28% 24%, rgba(255, 255, 255, 0.4), transparent 42%),
          radial-gradient(circle at 70% 82%, rgba(56, 189, 248, 0.18), transparent 46%);
        opacity: 0.9;
        pointer-events: none;
      }

      .nlm-rail-button:hover {
        filter: brightness(1.04);
        box-shadow:
          0 16px 30px rgba(15, 23, 42, 0.42),
          0 0 0 1px rgba(255, 255, 255, 0.14) inset,
          0 0 0 8px rgba(56, 189, 248, 0.09);
      }

      .nlm-rail-button:active {
        cursor: grabbing;
        transform: translateY(1px) scale(0.98);
      }

      .nlm-shell.is-collapsed .nlm-rail-button {
        animation:
          nlm-button-float 4.8s ease-in-out infinite,
          nlm-button-pulse 5.4s ease-in-out infinite;
      }

      .nlm-shell.is-collapsed .nlm-rail-button:hover {
        filter: brightness(1.08);
        box-shadow:
          0 18px 36px rgba(15, 23, 42, 0.48),
          0 0 0 1px rgba(255, 255, 255, 0.16) inset,
          0 0 0 10px rgba(56, 189, 248, 0.08);
      }

      .nlm-shell.is-launcher-dragging .nlm-rail-button {
        animation-play-state: paused;
        cursor: grabbing;
      }

      .nlm-rail-badge,
      .nlm-rail-hint {
        position: relative;
        z-index: 1;
        line-height: 1;
        text-transform: uppercase;
      }

      .nlm-rail-badge {
        font-size: 11px;
        letter-spacing: 0.14em;
      }

      .nlm-rail-hint {
        font-size: 11px;
        letter-spacing: 0.02em;
        opacity: 0.9;
      }

      .nlm-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 2px 2px 0 2px;
      }

      .nlm-title-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .nlm-kicker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: rgba(191, 219, 254, 0.86);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .nlm-title {
        margin: 0;
        font-size: 18px;
        line-height: 1.15;
        font-weight: 700;
        color: #f8fafc;
      }

      .nlm-subtitle {
        margin: 0;
        color: rgba(226, 232, 240, 0.72);
        font-size: 12px;
        line-height: 1.4;
      }

      .nlm-top-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .nlm-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.5);
        color: #e2e8f0;
      }

      .nlm-chip[data-tone="running"] { color: #67e8f9; }
      .nlm-chip[data-tone="paused"] { color: #fbbf24; }
      .nlm-chip[data-tone="done"] { color: #86efac; }
      .nlm-chip[data-tone="error"] { color: #fca5a5; }

      .nlm-notice {
        min-height: 18px;
        color: rgba(226, 232, 240, 0.82);
        font-size: 12px;
        line-height: 1.45;
      }

      .nlm-notice.is-error {
        color: #fca5a5;
      }

      .nlm-notice.is-success {
        color: #86efac;
      }

      .nlm-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .nlm-controls .nlm-btn {
        flex: 1 1 112px;
      }

      .nlm-btn {
        appearance: none;
        border: 0;
        border-radius: 14px;
        padding: 10px 12px;
        min-height: 40px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #fff;
      }

      .nlm-btn:hover { transform: translateY(-1px); }
      .nlm-btn:active { transform: translateY(0); }
      .nlm-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

      .nlm-btn-primary {
        background: linear-gradient(180deg, #0ea5e9, #2563eb);
        box-shadow: 0 10px 24px rgba(37, 99, 235, 0.24);
      }

      .nlm-btn-secondary {
        background: rgba(30, 41, 59, 0.95);
        border: 1px solid rgba(148, 163, 184, 0.18);
      }

      .nlm-btn-ghost {
        background: rgba(15, 23, 42, 0.5);
        border: 1px solid rgba(148, 163, 184, 0.18);
      }

      .nlm-btn-warm {
        background: linear-gradient(180deg, #f59e0b, #ea580c);
        box-shadow: 0 10px 24px rgba(249, 115, 22, 0.18);
      }

      .nlm-btn-danger {
        background: linear-gradient(180deg, #ef4444, #be123c);
        box-shadow: 0 10px 24px rgba(239, 68, 68, 0.16);
      }

      .nlm-editor-wrap {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 150px;
      }

      .nlm-section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: rgba(226, 232, 240, 0.8);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .nlm-textarea {
        width: 100%;
        min-height: 148px;
        max-height: 220px;
        resize: vertical;
        border-radius: 16px;
        padding: 12px 14px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(2, 6, 23, 0.74);
        color: #f8fafc;
        font-family: "Google Sans Code", Consolas, monospace;
        font-size: 12px;
        line-height: 1.45;
        outline: none;
      }

      .nlm-textarea:focus {
        border-color: rgba(56, 189, 248, 0.8);
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14);
      }

      .nlm-inline-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .nlm-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .nlm-mini {
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.52);
        border: 1px solid rgba(148, 163, 184, 0.15);
        font-size: 12px;
        color: #e2e8f0;
      }

      .nlm-mini strong {
        color: #fff;
      }

      .nlm-progress {
        width: 100%;
        height: 10px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.58);
        border: 1px solid rgba(148, 163, 184, 0.14);
        overflow: hidden;
      }

      .nlm-progress-bar {
        height: 100%;
        width: 0%;
        border-radius: 999px;
        background: linear-gradient(90deg, #38bdf8, #a78bfa, #f59e0b);
        transition: width 180ms ease;
      }

      .nlm-history {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
        flex: 1;
      }

      .nlm-history-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow: auto;
        padding-right: 4px;
        min-height: 0;
      }

      .nlm-entry {
        border-radius: 16px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(15, 23, 42, 0.58);
        padding: 12px;
      }

      .nlm-entry-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .nlm-entry-title {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .nlm-entry-title strong {
        color: #f8fafc;
        font-size: 13px;
      }

      .nlm-entry-meta {
        color: rgba(226, 232, 240, 0.68);
        font-size: 11px;
      }

      .nlm-entry-items {
        margin: 0 0 8px 0;
        color: rgba(191, 219, 254, 0.92);
        font-size: 11px;
        line-height: 1.5;
      }

      .nlm-entry-response {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 220px;
        overflow: auto;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(2, 6, 23, 0.62);
        border: 1px solid rgba(148, 163, 184, 0.12);
        color: #e5eefc;
        font-size: 12px;
        line-height: 1.55;
      }

      .nlm-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        padding-top: 2px;
        color: rgba(226, 232, 240, 0.72);
        font-size: 11px;
      }

      .nlm-muted {
        color: rgba(226, 232, 240, 0.54);
      }

      .nlm-link {
        color: #93c5fd;
        cursor: pointer;
      }

      .nlm-spacer {
        flex: 1;
      }

      @keyframes nlm-button-float {
        0%, 100% {
          transform: translateY(0) scale(1);
        }
        50% {
          transform: translateY(-5px) scale(1.01);
        }
      }

      @keyframes nlm-button-pulse {
        0%, 100% {
          box-shadow:
            0 12px 28px rgba(15, 23, 42, 0.34),
            0 0 0 1px rgba(255, 255, 255, 0.08) inset;
        }
        50% {
          box-shadow:
            0 16px 34px rgba(15, 23, 42, 0.44),
            0 0 0 1px rgba(255, 255, 255, 0.14) inset,
            0 0 0 10px rgba(56, 189, 248, 0.06);
        }
      }
    `;
    }
    buildHeader() {
      const header = createElement("div", "nlm-header");
      const titleWrap = createElement("div", "nlm-title-wrap");
      const kicker = createElement("div", "nlm-kicker");
      kicker.textContent = "NotebookLM Runner";
      const title = createElement("h2", "nlm-title");
      title.textContent = "Classificação em lotes";
      const subtitle = createElement("p", "nlm-subtitle");
      subtitle.textContent = "JSON flexível, envio em blocos de 3 e histórico com cópia rápida.";
      titleWrap.append(kicker, title, subtitle);
      const topActions = createElement("div", "nlm-top-actions");
      this.collapseButton = makeButton("Recolher", "ghost");
      this.collapseButton.title = "Recolher ou abrir o painel";
      topActions.append(this.collapseButton);
      header.append(titleWrap, topActions);
      return header;
    }
    buildControls() {
      const wrap = createElement("div", "nlm-controls");
      this.loadButton = makeButton("Carregar JSON", "secondary");
      this.startButton = makeButton("Start", "primary");
      this.pauseButton = makeButton("Pause", "warm");
      this.stopButton = makeButton("Stop", "danger");
      this.resetButton = makeButton("Zerar progresso", "ghost");
      this.copyAllButton = makeButton("Copiar tudo", "secondary");
      this.downloadExampleButton = makeButton("Exemplo", "ghost");
      this.importFileButton = makeButton("Arquivo", "ghost");
      wrap.append(
        this.loadButton,
        this.startButton,
        this.pauseButton,
        this.stopButton,
        this.resetButton,
        this.copyAllButton,
        this.downloadExampleButton,
        this.importFileButton
      );
      return wrap;
    }
    buildEditor() {
      const wrap = createElement("div", "nlm-editor-wrap");
      const titleRow = createElement("div", "nlm-section-title");
      const left = createElement("span");
      left.textContent = "Entrada JSON";
      const right = createElement("span", "nlm-muted");
      right.textContent = "Aceita array ou { items: [] }";
      titleRow.append(left, right);
      this.textarea = createElement("textarea", "nlm-textarea");
      this.textarea.placeholder = `[
  { "text": "Item 1" },
  { "text": "Item 2" },
  { "text": "Item 3" }
]`;
      const row = createElement("div", "nlm-inline-actions");
      this.loadNowButton = makeButton("Carregar agora", "secondary");
      this.clearButton = makeButton("Limpar", "ghost");
      row.append(this.loadNowButton, this.clearButton);
      wrap.append(titleRow, this.textarea, row);
      return wrap;
    }
    buildStats() {
      const wrap = createElement("div", "nlm-stats");
      this.statusChip = createElement("div", "nlm-chip");
      this.statusChip.dataset.tone = "idle";
      this.statusChip.textContent = "IDLE";
      this.progressChip = createElement("div", "nlm-mini");
      setChipContent(this.progressChip, "0", " itens carregados");
      this.currentChip = createElement("div", "nlm-mini");
      setChipContent(this.currentChip, "Pronto", " para iniciar");
      this.progressBar = createElement("div", "nlm-progress");
      this.progressBarFill = createElement("div", "nlm-progress-bar");
      this.progressBar.appendChild(this.progressBarFill);
      wrap.append(this.statusChip, this.progressChip, this.currentChip, this.progressBar);
      return wrap;
    }
    buildHistory() {
      const wrap = createElement("div", "nlm-history");
      const title = createElement("div", "nlm-section-title");
      const left = createElement("span");
      left.textContent = "Histórico";
      this.historyCount = createElement("span", "nlm-muted");
      this.historyCount.textContent = "0 respostas";
      title.append(left, this.historyCount);
      this.historyList = createElement("div", "nlm-history-list");
      wrap.append(title, this.historyList);
      return wrap;
    }
    buildFooter() {
      const footer = createElement("div", "nlm-footer");
      this.footerText = createElement("div", "nlm-muted");
      this.footerText.textContent = "Esc pausa e recolhe o painel";
      this.footerInfo = createElement("div", "nlm-muted");
      this.footerInfo.textContent = "90s por lote";
      footer.append(this.footerText, this.footerInfo);
      return footer;
    }
    bindEvents() {
      this.collapseButton.addEventListener("click", () => {
        var _a;
        (_a = this.onToggleCollapsed) == null ? void 0 : _a.call(this, !this.isCollapsed);
      });
      this.railButton.addEventListener("click", (event) => {
        var _a;
        if (this.suppressLauncherClick) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (this.isCollapsed) {
          (_a = this.onToggleCollapsed) == null ? void 0 : _a.call(this, false);
        }
      });
      this.startButton.addEventListener("click", () => {
        var _a;
        return (_a = this.onStart) == null ? void 0 : _a.call(this);
      });
      this.pauseButton.addEventListener("click", () => {
        var _a;
        return (_a = this.onTogglePause) == null ? void 0 : _a.call(this);
      });
      this.stopButton.addEventListener("click", () => {
        var _a;
        return (_a = this.onStop) == null ? void 0 : _a.call(this);
      });
      this.resetButton.addEventListener("click", () => {
        var _a;
        return (_a = this.onReset) == null ? void 0 : _a.call(this);
      });
      this.copyAllButton.addEventListener("click", () => {
        var _a;
        return (_a = this.onCopyAll) == null ? void 0 : _a.call(this);
      });
      this.loadButton.addEventListener("click", () => {
        var _a;
        return (_a = this.onLoadJson) == null ? void 0 : _a.call(this);
      });
      this.loadNowButton.addEventListener("click", () => {
        var _a;
        return (_a = this.onLoadJson) == null ? void 0 : _a.call(this);
      });
      this.clearButton.addEventListener("click", () => {
        var _a;
        this.setEditorValue("");
        (_a = this.onDraftChange) == null ? void 0 : _a.call(this, "");
        this.setNotice("Entrada limpa.", "success");
      });
      this.downloadExampleButton.addEventListener("click", () => {
        var _a;
        return (_a = this.onDownloadExample) == null ? void 0 : _a.call(this);
      });
      this.importFileButton.addEventListener("click", () => {
        var _a;
        return (_a = this.fileInput) == null ? void 0 : _a.click();
      });
      this.railButton.addEventListener("pointerdown", (event) => {
        var _a, _b;
        if (!this.isCollapsed) return;
        if (event.button !== 0) return;
        event.preventDefault();
        const pointerId = event.pointerId;
        const startTop = this.launcherTop;
        const startY = event.clientY;
        const dragState = {
          pointerId,
          startY,
          startTop,
          moved: false
        };
        this.launcherDragState = dragState;
        this.shell.classList.add("is-launcher-dragging");
        const handleMove = (moveEvent) => {
          if (!this.launcherDragState || moveEvent.pointerId !== pointerId) return;
          const delta = moveEvent.clientY - startY;
          if (Math.abs(delta) > 4) {
            this.launcherDragState.moved = true;
          }
          this.applyLauncherTop(startTop + delta, { persist: false });
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", handleMove, true);
          window.removeEventListener("pointerup", handleUp, true);
          window.removeEventListener("pointercancel", handleCancel, true);
          this.shell.classList.remove("is-launcher-dragging");
          this.launcherDragCleanup = null;
        };
        const handleUp = (upEvent) => {
          var _a2, _b2, _c;
          if (upEvent.pointerId !== pointerId) return;
          cleanup();
          const wasMoved = Boolean((_a2 = this.launcherDragState) == null ? void 0 : _a2.moved);
          this.launcherDragState = null;
          if (wasMoved) {
            this.suppressLauncherClick = true;
            window.setTimeout(() => {
              this.suppressLauncherClick = false;
            }, 0);
            (_b2 = this.onLauncherTopChange) == null ? void 0 : _b2.call(this, this.launcherTop);
            return;
          }
          (_c = this.onToggleCollapsed) == null ? void 0 : _c.call(this, false);
        };
        const handleCancel = (cancelEvent) => {
          if (cancelEvent.pointerId !== pointerId) return;
          cleanup();
          this.launcherDragState = null;
        };
        try {
          (_b = (_a = this.railButton).setPointerCapture) == null ? void 0 : _b.call(_a, pointerId);
        } catch {
        }
        window.addEventListener("pointermove", handleMove, true);
        window.addEventListener("pointerup", handleUp, true);
        window.addEventListener("pointercancel", handleCancel, true);
        this.launcherDragCleanup = cleanup;
      });
      this.textarea.addEventListener("input", () => {
        var _a;
        if (this.ignoreEditorEvents) return;
        (_a = this.onDraftChange) == null ? void 0 : _a.call(this, this.textarea.value);
      });
      this.textarea.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
      });
      this.fileInput = document.createElement("input");
      this.fileInput.type = "file";
      this.fileInput.accept = ".json,application/json";
      this.fileInput.hidden = true;
      this.fileInput.addEventListener("change", async () => {
        var _a, _b;
        const file = (_a = this.fileInput.files) == null ? void 0 : _a[0];
        this.fileInput.value = "";
        if (!file) return;
        (_b = this.onImportFile) == null ? void 0 : _b.call(this, file);
      });
      this.shadow.appendChild(this.fileInput);
      this.handleWindowResize = () => {
        var _a;
        const clamped = this.clampLauncherTop(this.launcherTop);
        if (clamped !== this.launcherTop) {
          (_a = this.onLauncherTopChange) == null ? void 0 : _a.call(this, clamped);
          return;
        }
        this.applyLauncherTop(clamped, { persist: false });
      };
      window.addEventListener("resize", this.handleWindowResize, { passive: true });
    }
    mount() {
      if (!document.body) return;
      if (!document.body.contains(this.host)) {
        document.body.appendChild(this.host);
      }
    }
    destroy() {
      var _a;
      (_a = this.launcherDragCleanup) == null ? void 0 : _a.call(this);
      window.removeEventListener("resize", this.handleWindowResize);
      this.host.remove();
    }
    setCollapsed(collapsed) {
      this.isCollapsed = Boolean(collapsed);
      this.shell.classList.toggle("is-collapsed", this.isCollapsed);
      this.collapseButton.textContent = this.isCollapsed ? "Abrir" : "Recolher";
      this.railButton.tabIndex = this.isCollapsed ? 0 : -1;
      this.railButton.setAttribute("aria-hidden", this.isCollapsed ? "false" : "true");
      this.railButton.title = this.isCollapsed ? "Clique para abrir ou arraste para mover" : "Painel aberto";
    }
    getLauncherButtonHeight() {
      var _a;
      return ((_a = this.railButton) == null ? void 0 : _a.offsetHeight) || 60;
    }
    clampLauncherTop(top) {
      var _a;
      const parsed = Number(top);
      const viewportHeight = Math.max(window.innerHeight || ((_a = document.documentElement) == null ? void 0 : _a.clientHeight) || 0, 0);
      const buttonHeight = this.getLauncherButtonHeight();
      const minTop = 12;
      const maxTop = Math.max(minTop, viewportHeight - buttonHeight - 12);
      if (!Number.isFinite(parsed)) {
        return this.launcherTop || DEFAULT_LAUNCHER_TOP;
      }
      return Math.min(maxTop, Math.max(minTop, Math.round(parsed)));
    }
    applyLauncherTop(top, { persist = true } = {}) {
      var _a;
      const safeTop = this.clampLauncherTop(top);
      this.launcherTop = safeTop;
      this.shell.style.setProperty("--nlm-launcher-top", `${safeTop}px`);
      if (persist) {
        (_a = this.onLauncherTopChange) == null ? void 0 : _a.call(this, safeTop);
      }
      return safeTop;
    }
    setNotice(text, tone = "info") {
      const normalized = String(text ?? "").trim();
      this.notice.textContent = normalized;
      this.notice.classList.toggle("is-error", tone === "error");
      this.notice.classList.toggle("is-success", tone === "success");
    }
    setEditorValue(text) {
      this.ignoreEditorEvents = true;
      this.textarea.value = String(text ?? "");
      this.ignoreEditorEvents = false;
    }
    getEditorValue() {
      return this.textarea.value;
    }
    render(state) {
      this.state = state;
      this.setCollapsed(state.collapsed);
      this.applyLauncherTop(Number.isFinite(state.launcherTop) ? state.launcherTop : this.launcherTop, { persist: false });
      const statusTone = state.status || "idle";
      this.statusChip.dataset.tone = statusTone;
      this.statusChip.textContent = statusTone.toUpperCase();
      const loadedCount = Array.isArray(state.queue) ? state.queue.length : 0;
      const historyCount = Array.isArray(state.history) ? state.history.length : 0;
      setChipContent(this.progressChip, String(loadedCount), " itens carregados");
      this.historyCount.textContent = `${historyCount} resposta${historyCount === 1 ? "" : "s"}`;
      const current = state.currentBatch;
      if (current) {
        const statusLabel = {
          sending: `Enviando lote ${current.batchNumber}`,
          waiting: `Aguardando ${formatDuration(current.remainingMs ?? 0)}`,
          capturing: `Capturando lote ${current.batchNumber}`
        }[current.phase] || `Lote ${current.batchNumber}`;
        setChipContent(this.currentChip, statusLabel, ` · itens ${formatRange(current.startIndex, current.endIndex)}`);
        const progress = loadedCount > 0 ? Math.min(100, (current.endIndex + 1) / loadedCount * 100) : 0;
        this.progressBarFill.style.width = `${progress}%`;
      } else if (state.status === "done") {
        setChipContent(this.currentChip, "Concluído", " · pronto para novo JSON");
        this.progressBarFill.style.width = "100%";
      } else if (state.status === "paused") {
        setChipContent(this.currentChip, "Pausado", " · pode retomar do mesmo ponto");
        const progress = loadedCount > 0 ? Math.min(state.nextIndex, loadedCount) / loadedCount * 100 : 0;
        this.progressBarFill.style.width = `${progress}%`;
      } else if (state.status === "error") {
        setChipContent(this.currentChip, "Erro", " · revise a DOM ou o JSON");
      } else {
        setChipContent(this.currentChip, "Pronto", " para iniciar");
        const progress = loadedCount > 0 ? Math.min(state.nextIndex, loadedCount) / loadedCount * 100 : 0;
        this.progressBarFill.style.width = `${progress}%`;
      }
      const pauseLabel = state.status === "running" ? "Pause" : "Resume";
      this.pauseButton.textContent = pauseLabel;
      this.pauseButton.disabled = !(state.status === "running" || state.status === "paused" || state.status === "stopped");
      this.startButton.disabled = state.status === "running";
      this.stopButton.disabled = !(state.status === "running" || state.status === "paused" || state.status === "stopped");
      this.resetButton.disabled = !loadedCount && historyCount === 0 && !current;
      this.copyAllButton.disabled = historyCount === 0;
      if (state.lastError) {
        this.setNotice(state.lastError, "error");
      } else if (state.lastInfo) {
        this.setNotice(state.lastInfo, state.status === "done" ? "success" : "info");
      } else {
        this.setNotice("", "info");
      }
      if (this.shadow.activeElement !== this.textarea) {
        this.setEditorValue(state.draftText || "");
      }
      this.renderHistory(state.history || []);
      this.footerText.textContent = state.collapsed ? "Botão flutuante recolhido. Arraste para mudar de posição." : "Esc pausa e recolhe o painel.";
      this.footerInfo.textContent = state.status === "running" && (current == null ? void 0 : current.phase) === "waiting" ? `Aguardando: ${formatDuration(current.remainingMs ?? 0)}` : `90s por lote · ${formatDateTime(state.updatedAt) || "sem data"}`;
    }
    renderHistory(history) {
      const nodes = [];
      if (!history.length) {
        const empty = createElement("div", "nlm-mini");
        empty.textContent = "Nenhuma resposta capturada ainda.";
        nodes.push(empty);
        this.historyList.replaceChildren(...nodes);
        return;
      }
      history.forEach((entry, index) => {
        var _a;
        const article = createElement("article", "nlm-entry");
        const head = createElement("div", "nlm-entry-head");
        const titleWrap = createElement("div", "nlm-entry-title");
        const title = createElement("strong");
        title.textContent = `Lote ${entry.batchNumber ?? index + 1}`;
        const meta = createElement("div", "nlm-entry-meta");
        meta.textContent = `Itens ${formatRange(entry.startIndex, entry.endIndex)} · ${formatDateTime(entry.capturedAt) || "sem data"}`;
        titleWrap.append(title, meta);
        const copyButton = makeButton("Copiar", "ghost");
        copyButton.addEventListener("click", () => {
          var _a2;
          return (_a2 = this.onCopyEntry) == null ? void 0 : _a2.call(this, entry.id);
        });
        head.append(titleWrap, copyButton);
        const items = createElement("div", "nlm-entry-items");
        items.textContent = `Enviado: ${((_a = entry.items) == null ? void 0 : _a.join(" | ")) || ""}`;
        const response = createElement("pre", "nlm-entry-response");
        response.textContent = entry.responseText || "";
        article.append(head, items, response);
        nodes.push(article);
      });
      this.historyList.replaceChildren(...nodes);
    }
    promptDownloadExample() {
      downloadText("notebooklm-classificacao-example.json", createExampleJson(), "application/json;charset=utf-8");
    }
  }
  let app = null;
  let panel = null;
  let lastPath = window.location.pathname;
  function isNotebookRoute() {
    return window.location.pathname.startsWith("/notebook/");
  }
  function teardown() {
    if (panel) {
      panel.destroy();
      panel = null;
    }
    app = null;
  }
  function ensureApp() {
    if (!isNotebookRoute()) {
      teardown();
      return;
    }
    if (panel && app) {
      panel.mount();
      return;
    }
    app = new ClassificacaoRunner({
      onChange: (state) => panel == null ? void 0 : panel.render(state),
      onLog: (message, tone = "info") => panel == null ? void 0 : panel.setNotice(message, tone)
    });
    panel = new ClassificacaoPanel({
      onDraftChange: (text) => app.updateDraftText(text),
      onLoadJson: async () => {
        try {
          await app.loadDraftAndReset(panel.getEditorValue());
          panel.setNotice("JSON carregado com sucesso.", "success");
        } catch (error) {
          panel.setNotice((error == null ? void 0 : error.message) || String(error), "error");
        }
      },
      onStart: async () => {
        try {
          await app.startFromDraft();
        } catch (error) {
          panel.setNotice((error == null ? void 0 : error.message) || String(error), "error");
        }
      },
      onTogglePause: async () => {
        try {
          await app.togglePause();
        } catch (error) {
          panel.setNotice((error == null ? void 0 : error.message) || String(error), "error");
        }
      },
      onStop: async () => {
        try {
          await app.stop();
        } catch (error) {
          panel.setNotice((error == null ? void 0 : error.message) || String(error), "error");
        }
      },
      onReset: async () => {
        try {
          await app.resetProgress();
        } catch (error) {
          panel.setNotice((error == null ? void 0 : error.message) || String(error), "error");
        }
      },
      onCopyAll: async () => {
        try {
          await app.copyAll();
          panel.setNotice("Histórico copiado para a área de transferência.", "success");
        } catch (error) {
          panel.setNotice((error == null ? void 0 : error.message) || String(error), "error");
        }
      },
      onCopyEntry: async (entryId) => {
        try {
          await app.copyHistoryEntry(entryId);
          panel.setNotice("Resposta copiada.", "success");
        } catch (error) {
          panel.setNotice((error == null ? void 0 : error.message) || String(error), "error");
        }
      },
      onToggleCollapsed: (collapsed) => {
        app.setCollapsed(collapsed);
      },
      onLauncherTopChange: (top) => {
        app.setLauncherTop(top);
      },
      onImportFile: async (file) => {
        try {
          const text = await file.text();
          panel.setEditorValue(text);
          app.updateDraftText(text);
          panel.setNotice(`Arquivo carregado: ${file.name}`, "success");
        } catch (error) {
          panel.setNotice((error == null ? void 0 : error.message) || String(error), "error");
        }
      },
      onDownloadExample: () => panel.promptDownloadExample()
    });
    panel.mount();
    panel.render(app.getState());
    panel.setEditorValue(app.getState().draftText || createExampleJson());
    app.updateDraftText(panel.getEditorValue());
  }
  function onGlobalKeyDown(event) {
    if (event.key !== "Escape") return;
    if (!app) return;
    event.preventDefault();
    event.stopPropagation();
    app.pause({ collapse: true });
  }
  window.addEventListener("keydown", onGlobalKeyDown, true);
  function syncRoute() {
    const currentPath = window.location.pathname;
    if (!isNotebookRoute()) {
      if (app || panel) teardown();
      return;
    }
    if (currentPath !== lastPath) {
      lastPath = currentPath;
      teardown();
    }
    ensureApp();
  }
  setInterval(syncRoute, 1e3);
  function boot() {
    syncRoute();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 800), { once: true });
  } else {
    setTimeout(boot, 800);
  }

})();