import { ClassificacaoRunner } from './runner';
import { ClassificacaoPanel } from './ui';
import { createExampleJson } from './storage';

let app = null;
let panel = null;
let lastPath = window.location.pathname;

function isNotebookRoute() {
  return window.location.pathname.startsWith('/notebook/');
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
    onChange: state => panel?.render(state),
    onLog: (message, tone = 'info') => panel?.setNotice(message, tone),
  });

  panel = new ClassificacaoPanel({
    onDraftChange: text => app.updateDraftText(text),
    onLoadJson: async () => {
      try {
        await app.loadDraftAndReset(panel.getEditorValue());
        panel.setNotice('JSON carregado com sucesso.', 'success');
      } catch (error) {
        panel.setNotice(error?.message || String(error), 'error');
      }
    },
    onStart: async () => {
      try {
        await app.startFromDraft();
      } catch (error) {
        panel.setNotice(error?.message || String(error), 'error');
      }
    },
    onTogglePause: async () => {
      try {
        await app.togglePause();
      } catch (error) {
        panel.setNotice(error?.message || String(error), 'error');
      }
    },
    onStop: async () => {
      try {
        await app.stop();
      } catch (error) {
        panel.setNotice(error?.message || String(error), 'error');
      }
    },
    onReset: async () => {
      try {
        await app.resetProgress();
      } catch (error) {
        panel.setNotice(error?.message || String(error), 'error');
      }
    },
    onCopyAll: async () => {
      try {
        await app.copyAll();
        panel.setNotice('Histórico copiado para a área de transferência.', 'success');
      } catch (error) {
        panel.setNotice(error?.message || String(error), 'error');
      }
    },
    onCopyEntry: async entryId => {
      try {
        await app.copyHistoryEntry(entryId);
        panel.setNotice('Resposta copiada.', 'success');
      } catch (error) {
        panel.setNotice(error?.message || String(error), 'error');
      }
    },
    onToggleCollapsed: collapsed => {
      app.setCollapsed(collapsed);
    },
    onLauncherTopChange: top => {
      app.setLauncherTop(top);
    },
    onImportFile: async file => {
      try {
        const text = await file.text();
        panel.setEditorValue(text);
        app.updateDraftText(text);
        panel.setNotice(`Arquivo carregado: ${file.name}`, 'success');
      } catch (error) {
        panel.setNotice(error?.message || String(error), 'error');
      }
    },
    onDownloadExample: () => panel.promptDownloadExample(),
  });

  panel.mount();
  panel.render(app.getState());
  panel.setEditorValue(app.getState().draftText || createExampleJson());
  app.updateDraftText(panel.getEditorValue());
}

function onGlobalKeyDown(event) {
  if (event.key !== 'Escape') return;
  if (!app) return;

  event.preventDefault();
  event.stopPropagation();
  app.pause({ collapse: true });
}

window.addEventListener('keydown', onGlobalKeyDown, true);

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

setInterval(syncRoute, 1000);

function boot() {
  syncRoute();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800), { once: true });
} else {
  setTimeout(boot, 800);
}
