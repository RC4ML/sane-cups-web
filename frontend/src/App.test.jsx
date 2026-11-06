import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { request, SignInRequired, validatePageRange } from './api';

vi.mock('./Preview', () => ({ default: ({ name }) => <div>Preview: {name}</div> }));
const device = {
  id: 'hp',
  name: 'Office printer',
  alias: '科工楼 107 打印机',
  scan: { driver: 'escl' },
  print: { queue: 'Office' },
};
const saved = {
  name: 'notes.pdf',
  url: '/api/scans/notes.pdf',
  format: 'pdf',
  size_formatted: '42 KB',
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function mockAPI(overrides = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path, options = {}) => {
      calls.push({ path, options });
      if (overrides[path]) return overrides[path](options);
      if (path === '/api/devices')
        return json({
          devices: [device],
          default_device: 'hp',
          scan_defaults: { dpi: 300, format: 'pdf', mode: 'Color' },
        });
      if (path === '/api/scans') return json({ scans: [saved] });
      if (path.startsWith('/api/status'))
        return json({ scanner: { online: true }, printer: { online: true } });
      if (path.startsWith('/api/printers'))
        return json({
          jobs: [],
          default_printer: 'Office',
          status_text: 'Ready',
          default_paper_size: 'iso_a4_210x297mm',
          paper_sizes: [
            { value: 'iso_a4_210x297mm', label: 'A4 · 210 × 297 mm' },
            { value: 'iso_a5_148x210mm', label: 'A5 · 148 × 210 mm' },
          ],
        });
      if (path === '/api/print') return json({ success: true });
      throw new Error(`Unexpected API call ${path}`);
    }),
  );
  return calls;
}
async function openScan(user) {
  await screen.findByRole('combobox', { name: 'Device' });
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Device' })).toHaveTextContent('科工楼 107 打印机'),
  );
  await user.click(screen.getByRole('tab', { name: 'Scan', exact: true }));
}

describe('workspaces', () => {
  it('starts with Print and shows scan settings and saved documents together', async () => {
    mockAPI();
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Print', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await openScan(user);
    const scan = screen.getByRole('tabpanel', { name: 'Scan' });
    expect(within(scan).getByRole('heading', { name: 'Scan a document' })).toBeVisible();
    expect(within(scan).getByRole('heading', { name: 'Saved documents' })).toBeVisible();
    await user.click(within(scan).getByRole('button', { name: 'Print', exact: true }));
    expect(screen.getByRole('tab', { name: 'Print', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      within(screen.getByRole('tabpanel', { name: 'Print' })).getByText('notes.pdf'),
    ).toBeVisible();
  });

  it('keeps an unfinished multi-page session through tab changes and a failed discard', async () => {
    let page = 0;
    const calls = mockAPI({
      '/api/scan/multipage/start': () => json({ session_id: 'session-1' }),
      '/api/scan/multipage/page': () =>
        json({
          page_number: ++page,
          page_filename: `page_${page}.png`,
          url: `/api/scans/page_${page}.png`,
        }),
      '/api/scan/multipage/cancel': () =>
        json({ error: true, message: 'Cannot cancel right now' }, 500),
      '/api/scan/multipage/finish': () =>
        json({ filename: 'combined.pdf', url: '/api/scans/combined.pdf' }),
    });
    const user = userEvent.setup();
    render(<App />);
    await openScan(user);
    await user.click(screen.getByRole('radio', { name: 'Multi-page PDF' }));
    await user.click(screen.getByRole('button', { name: 'Scan page', exact: true }));
    await screen.findByAltText('Scanned page 1');
    expect(screen.getByRole('combobox', { name: 'Device' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Print', exact: true }));
    await user.click(screen.getByRole('tab', { name: 'Scan', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Scan next page' }));
    await screen.findByAltText('Scanned page 2');
    expect(calls.filter((c) => c.path === '/api/scan/multipage/start')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Discard', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Discard pages' }));
    await screen.findByText('Cannot cancel right now');
    expect(screen.getByAltText('Scanned page 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save PDF (2 pages)' }));
    await screen.findByText('Multi-page PDF saved.');
    expect(screen.queryByAltText('Scanned page 2')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Device' })).toBeEnabled();
  });

  it('validates page ranges, submits a file once, and clears it after success', async () => {
    const calls = mockAPI();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Device' })).toHaveTextContent(
        '科工楼 107 打印机',
      ),
    );
    await user.upload(
      container.querySelector('input[type="file"]'),
      new File(['%PDF-test'], 'hello.pdf', { type: 'application/pdf' }),
    );
    await user.type(screen.getByRole('textbox', { name: 'Pages' }), '5-2');
    await user.click(screen.getByRole('button', { name: 'Print document' }));
    expect(calls.filter((c) => c.path === '/api/print')).toHaveLength(0);
    await screen.findByText('Invalid page range: 5-2');
    await user.clear(screen.getByRole('textbox', { name: 'Pages' }));
    await user.type(screen.getByRole('textbox', { name: 'Pages' }), '1,3-5');
    await user.click(screen.getByRole('button', { name: 'Print document' }));
    await screen.findByText('Print job submitted.');
    const prints = calls.filter((c) => c.path === '/api/print');
    expect(prints).toHaveLength(1);
    expect(prints[0].options.body.get('page_ranges')).toBe('1,3-5');
    expect(prints[0].options.body.get('device_id')).toBe('hp');
    expect(screen.getByRole('button', { name: 'Print document' })).toBeDisabled();
  });

  it('preserves the selected document and never retries a write after a 401', async () => {
    const calls = mockAPI({ '/api/print': () => json({ message: 'Sign in' }, 401) });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Device' })).toHaveTextContent(
        '科工楼 107 打印机',
      ),
    );
    await user.upload(
      container.querySelector('input[type="file"]'),
      new File(['%PDF-test'], 'hello.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: 'Print document' }));
    expect(await screen.findByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
      'href',
      expect.stringContaining('/oauth2/start?rd='),
    );
    expect(screen.getByText('hello.pdf')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Print document' })).toBeDisabled();
    expect(calls.filter((c) => c.path === '/api/print')).toHaveLength(1);
  });

  it('uses the queue default paper size and accepts only PDF uploads', async () => {
    const calls = mockAPI();
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Paper size' })).toHaveTextContent('A4'),
    );
    await user.upload(
      container.querySelector('input[type="file"]'),
      new File(['image'], 'image.png', { type: 'image/png' }),
    );
    expect(
      await screen.findByText(
        'Only PDF documents can be printed. Export your document to PDF first.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Print document' })).toBeDisabled();
    await user.upload(
      container.querySelector('input[type="file"]'),
      new File(['%PDF-test'], 'document.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: 'Print document' }));
    await screen.findByText('Print job submitted.');
    const print = calls.find((c) => c.path === '/api/print');
    expect(print.options.body.get('paper_size')).toBe('iso_a4_210x297mm');
    expect(print.options.body.get('scaling')).toBe('fit');
  });

  it.each(['upload', 'saved'])(
    'submits parity, reverse order and collation for %s documents',
    async (kind) => {
      const calls = mockAPI();
      const user = userEvent.setup();
      const { container } = render(<App />);
      await openScan(user);
      if (kind === 'saved')
        await user.click(screen.getByRole('button', { name: 'Print', exact: true }));
      else {
        await user.click(screen.getByRole('tab', { name: 'Print', exact: true }));
        await user.upload(
          container.querySelector('input[type="file"]'),
          new File(['%PDF'], 'six-pages.pdf', { type: 'application/pdf' }),
        );
      }
      await user.click(screen.getByRole('combobox', { name: 'Paper size' }));
      await user.click(screen.getByRole('option', { name: 'A5 · 148 × 210 mm' }));
      await user.click(screen.getByRole('combobox', { name: 'Scaling' }));
      await user.click(screen.getByRole('option', { name: 'Actual size (100%)' }));
      await user.type(screen.getByRole('textbox', { name: 'Pages' }), '2-5');
      await user.click(screen.getByRole('combobox', { name: 'Print pages' }));
      await user.click(screen.getByRole('option', { name: 'Even pages only' }));
      await user.click(screen.getByRole('combobox', { name: 'Page order' }));
      await user.click(screen.getByRole('option', { name: 'Last to first' }));
      await user.clear(screen.getByRole('spinbutton', { name: 'Copies' }));
      await user.type(screen.getByRole('spinbutton', { name: 'Copies' }), '2');
      await user.click(screen.getByRole('checkbox', { name: 'Collate copies' }));
      expect(screen.getByText('2 selected pages per copy')).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Print document' }));
      await screen.findByText('Print job submitted.');
      const prints = calls.filter((c) => c.path === '/api/print');
      expect(prints).toHaveLength(1);
      const body =
        kind === 'saved'
          ? JSON.parse(prints[0].options.body)
          : Object.fromEntries(prints[0].options.body);
      expect(body).toMatchObject({
        page_ranges: '2-5',
        page_set: 'even',
        output_order: 'reverse',
        paper_size: 'iso_a5_148x210mm',
        scaling: 'actual',
      });
      expect(String(body.copies)).toBe('2');
      expect(String(body.collate)).toBe('false');
      expect(screen.getByRole('combobox', { name: 'Print pages' })).toHaveTextContent('All pages');
      expect(screen.getByRole('combobox', { name: 'Page order' })).toHaveTextContent(
        'First to last',
      );
    },
  );
});

describe('API validation', () => {
  it('rejects invalid and out-of-document page ranges', () => {
    expect(validatePageRange(' 1, 3-5 ', 5)).toBe('1,3-5');
    for (const value of ['0', '5-2', '1,,2', '1.5', '1000001', '6'])
      expect(() => validatePageRange(value, 5)).toThrow();
  });
  it('handles non-JSON proxy 401 responses as an expired session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Unauthorized', { status: 401 })),
    );
    await expect(request('/api/print', { method: 'POST' })).rejects.toBeInstanceOf(SignInRequired);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
