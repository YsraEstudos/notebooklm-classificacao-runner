import { describe, expect, it, vi } from 'vitest';

import { ClassificacaoPanel } from '../src/ui';
import { createDefaultState } from '../src/storage';

describe('launcher UI', () => {
  it('renders a compact collapsed launcher button', () => {
    const panel = new ClassificacaoPanel();
    panel.mount();
    panel.render({
      ...createDefaultState(),
      collapsed: true,
      draftText: '',
      queue: [],
      history: [],
    });

    const shell = panel.shadow.querySelector('.nlm-shell');
    const rail = panel.shadow.querySelector('.nlm-rail');
    const button = panel.shadow.querySelector('.nlm-rail-button');
    const panelNode = panel.shadow.querySelector('.nlm-panel');

    expect(shell.classList.contains('is-collapsed')).toBe(true);
    expect(rail).not.toBeNull();
    expect(button).not.toBeNull();
    expect(panelNode.contains(rail)).toBe(false);
    expect(shell.contains(rail)).toBe(true);
    expect(button.textContent).toContain('NLM');
    expect(button.getAttribute('aria-hidden')).toBe('false');

    panel.destroy();
  });

  it('lets the wait time be edited in seconds', () => {
    const onWaitMsChange = vi.fn();
    const panel = new ClassificacaoPanel({ onWaitMsChange });
    panel.mount();
    panel.render({
      ...createDefaultState(),
      waitMs: 120_000,
      collapsed: true,
      draftText: '',
      queue: [],
      history: [],
    });

    const waitInput = panel.shadow.querySelector('.nlm-wait-input');
    expect(waitInput).not.toBeNull();
    expect(waitInput.value).toBe('120');

    waitInput.value = '45';
    waitInput.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onWaitMsChange).toHaveBeenCalledWith(45_000);

    panel.destroy();
  });
});
