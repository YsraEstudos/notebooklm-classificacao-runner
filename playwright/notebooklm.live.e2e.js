import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const liveUrl = process.env.NOTEBOOKLM_E2E_URL;
const storageState = process.env.NOTEBOOKLM_STORAGE_STATE;
const here = dirname(fileURLToPath(import.meta.url));
const userscriptPath = resolve(here, '..', 'dist', 'notebooklm-classificacao-runner.user.js');

function normalizeText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

async function getConversationTexts(page, selector, bodySelectors) {
  return page.evaluate(({ selector: rootSelector, bodySelectors: bodyList }) => {
    const removeSelectors = [
      'button',
      '[role="button"]',
      'input',
      'textarea',
      'script',
      'style',
      'svg',
      'mat-icon',
      'mat-card-actions',
      '.message-actions',
      '.actions-container',
      '.xap-copy-to-clipboard',
      '.suggestions-container',
      '.follow-up-chip',
      '.chat-panel-empty-state-action-bar',
      '.mat-mdc-button-touch-target',
      '[aria-hidden="true"]',
    ];
    const normalize = value => String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();

    return [...document.querySelectorAll(rootSelector)]
      .map(card => {
        let body = card;
        for (const candidate of bodyList) {
          body = card.querySelector(candidate) || body;
          if (body !== card) break;
        }

        const clone = body.cloneNode(true);
        clone.querySelectorAll(removeSelectors.join(', ')).forEach(node => node.remove());
        return normalize(clone.innerText || clone.textContent || '');
      })
      .filter(Boolean);
  }, {
    selector,
    bodySelectors,
  });
}

async function getAssistantTexts(page) {
  return getConversationTexts(page, 'mat-card.to-user-message-card-content, .to-user-message-card-content', [
    '.message-content.to-user-message-inner-content',
    '.to-user-message-inner-content',
    '.message-content',
  ]);
}

async function sendPrompt(page, prompt, previousAssistantCount) {
  const textarea = page.locator('textarea.query-box-input').first();
  const submitButton = page.locator('button.submit-button').first();

  await textarea.click();
  await textarea.fill(prompt);
  await expect(submitButton).toBeEnabled({ timeout: 20_000 });
  await submitButton.click();

  await expect.poll(async () => {
    const texts = await getAssistantTexts(page);
    return texts.length;
  }, {
    timeout: 180_000,
    message: `Esperando a resposta da IA para o prompt ${prompt}`,
  }).toBeGreaterThan(previousAssistantCount);

  await expect.poll(async () => {
    const texts = await getAssistantTexts(page);
    const lastText = normalizeText(texts.at(-1) || '');
    return !/^(reading full chapters|thinking|carregando|lendo)(\.{0,3})?$/i.test(lastText);
  }, {
    timeout: 180_000,
    message: `Esperando o texto final estabilizar para o prompt ${prompt}`,
  }).toBe(true);
}

async function injectUserscript(page) {
  const bundle = readFileSync(userscriptPath, 'utf8');
  await page.evaluate(code => {
    const run = new Function(`${code}\n//# sourceURL=notebooklm-classificacao-runner.user.js`);
    run();
  }, bundle);
  await page.waitForFunction(() => {
    const host = document.querySelector('#nlm-classificacao-host');
    return Boolean(host?.shadowRoot?.querySelector('.nlm-panel'));
  }, { timeout: 20_000 });
}

async function clickShadowButton(page, buttonText) {
  await page.evaluate(label => {
    const root = document.querySelector('#nlm-classificacao-host')?.shadowRoot;
    if (!root) throw new Error('Shadow root do painel não encontrado.');

    const button = [...root.querySelectorAll('button')].find(node => node.textContent?.includes(label));
    if (!button) throw new Error(`Botão "${label}" não encontrado no painel.`);
    button.click();
  }, buttonText);
}

async function clickLauncher(page) {
  await page.evaluate(() => {
    const root = document.querySelector('#nlm-classificacao-host')?.shadowRoot;
    const button = root?.querySelector('.nlm-rail-button');
    if (!button) throw new Error('Launcher recolhido não encontrado.');
    button.click();
  });
}

test.describe('NotebookLM live transcript capture', () => {
  test.skip(!liveUrl, 'Defina NOTEBOOKLM_E2E_URL para executar a suíte ao vivo.');
  test.skip(!storageState, 'Defina NOTEBOOKLM_STORAGE_STATE com uma sessão autenticada do NotebookLM.');

  test('copies only AI responses after reconciling the visible transcript', async ({ context, page }) => {
    test.setTimeout(12 * 60 * 1000);

    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'https://notebooklm.google.com',
    });

    await page.goto(liveUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('textarea.query-box-input').first()).toBeVisible({ timeout: 30_000 });

    let assistantCount = (await getAssistantTexts(page)).length;
    const sentPrompts = [];

    for (let index = 1; index <= 5; index += 1) {
      const prompt = `Responda apenas com NLM-E2E-${Date.now()}-${index}`;
      sentPrompts.push(prompt);
      await sendPrompt(page, prompt, assistantCount);
      assistantCount = (await getAssistantTexts(page)).length;
    }

    const assistantTexts = await getAssistantTexts(page);
    const lastFiveAssistantTexts = assistantTexts.slice(-5);

    expect(lastFiveAssistantTexts).toHaveLength(5);

    await injectUserscript(page);
    await clickShadowButton(page, 'Copiar tudo');

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());

    assistantTexts.forEach(text => {
      expect(clipboardText).toContain(text);
    });
    sentPrompts.forEach(prompt => {
      expect(clipboardText).not.toContain(prompt);
    });

    await clickShadowButton(page, 'Recolher');
    await page.waitForFunction(() => {
      const root = document.querySelector('#nlm-classificacao-host')?.shadowRoot;
      return root?.querySelector('.nlm-shell')?.classList.contains('is-collapsed');
    });

    await clickLauncher(page);
    await page.waitForFunction(() => {
      const root = document.querySelector('#nlm-classificacao-host')?.shadowRoot;
      return !root?.querySelector('.nlm-shell')?.classList.contains('is-collapsed');
    });
  });
});
