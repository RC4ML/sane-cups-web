import { describe, expect, it, vi } from 'vitest';
import { request, post, SignInRequired, selectedPageCount } from './api';

describe('print selection', () => {
  it('counts original odd/even page numbers and deduplicates overlapping ranges', () => {
    expect(selectedPageCount('2-5', 'even', 6)).toBe(2);
    expect(selectedPageCount('2-5', 'odd', 6)).toBe(2);
    expect(selectedPageCount('6,2-5,4-6', 'even', 6)).toBe(3);
    expect(selectedPageCount('1-3,2-5', 'all', 6)).toBe(5);
    expect(selectedPageCount('', 'odd', 5)).toBe(3);
    expect(selectedPageCount('', 'even', 5)).toBe(2);
    expect(selectedPageCount('', 'all', null)).toBeNull();
  });
  it('rejects empty, out-of-document, or oversized selections', () => {
    expect(() => selectedPageCount('1,3,5', 'even', 6)).toThrow('No even pages');
    expect(() => selectedPageCount('', 'even', 1)).toThrow('No even pages');
    expect(() => selectedPageCount('2-7', 'even', 6)).toThrow('only 6 pages');
    expect(() => selectedPageCount('1-1000000', 'odd', null)).toThrow('10,000');
  });
});

describe('proxy and request failures', () => {
  it('does not retry a write on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
    await expect(post('/api/scan', { device_id: 'hp' })).rejects.toThrow('Network unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('recognizes a login HTML redirect without attempting to parse it as JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        redirected: true,
        headers: new Headers({ 'content-type': 'text/html' }),
      }),
    );
    await expect(request('/api/scans')).rejects.toBeInstanceOf(SignInRequired);
  });
  it('reports the server error instead of pretending the operation succeeded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: true, message: 'Scanner is busy' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(post('/api/scan', {})).rejects.toThrow('Scanner is busy');
  });
});
