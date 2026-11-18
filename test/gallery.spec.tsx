import fs from 'node:fs';
import { fireEvent, waitFor, within } from '@testing-library/react';

function mountPanel(directory: string, ma: object, scripts: string[]) {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const page = iframe.contentWindow as Window & typeof globalThis;
  const html = fs.readFileSync(directory + '/panel.html', 'utf8');
  page.document.open();
  page.document.write(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
  page.document.close();
  Object.assign(page, {
    ma,
    matchMedia: () => ({ matches: true }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    fetch: vi.fn(async () => ({ ok: false })),
  });
  const run = () => {
    for (const script of scripts) page.eval(fs.readFileSync(directory + '/' + script, 'utf8'));
  };
  return { iframe, page, run };
}

it('keeps the style toggle focused after saving a pick and rendering the new selection', async () => {
  let picked = false;
  const style = { id: 'B3', name: '测试风格', series: 'AG', tags: [] };
  const { iframe, page, run } = mountPanel('code-animation/panel', {
    ready: Promise.resolve(),
    on: vi.fn(),
    agent: { domain: {
      query: async (name: string) => name === 'catalog'
        ? { entries: [style], series: [{ id: 'AG', count: 1 }] }
        : { version: Number(picked), picks: picked ? ['B3'] : [], works: [] },
      command: vi.fn(async () => { picked = true; }),
    } },
  }, ['app.js']);
  try {
    run();
    const panel = within(page.document.body);
    const toggle = await panel.findByRole('button', { name: '选择 B3' });
    toggle.focus();
    fireEvent.click(toggle);
    const selected = await panel.findByRole('button', { name: '取消选择 B3' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(page.document.activeElement).toBe(selected);
  } finally { iframe.remove(); }
});
