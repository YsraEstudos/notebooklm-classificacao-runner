import { describe, expect, it } from 'vitest';

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

    expect(shell.classList.contains('is-collapsed')).toBe(true);
    expect(rail).not.toBeNull();
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('NLM');
    expect(button.getAttribute('aria-hidden')).toBe('false');

    panel.destroy();
  });
});
