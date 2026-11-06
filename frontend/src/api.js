export class SignInRequired extends Error {
  constructor() {
    super('Your session has expired. Sign in again to continue.');
  }
}

export async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  if (response.status === 401) throw new SignInRequired();
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    if (response.redirected) throw new SignInRequired();
    throw new Error('The server returned an unexpected response. Please try again.');
  }
  const data = await response.json();
  if (!response.ok || data.error)
    throw new Error(data.message || `Request failed (${response.status}).`);
  return data;
}

export function post(path, data) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function validatePageRange(value, maxPage) {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized) return '';
  for (const part of normalized.split(',')) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error('Use page numbers and ranges, such as 1,3-5.');
    const first = Number(match[1]);
    const last = Number(match[2] || match[1]);
    if (first < 1 || last < first || last > 1000000) throw new Error(`Invalid page range: ${part}`);
    if (maxPage && last > maxPage) throw new Error(`This document has only ${maxPage} pages.`);
  }
  return normalized;
}

export function fileKind(name) {
  return name.split('.').pop().toLowerCase();
}

export function selectedPageCount(value, pageSet, totalPages) {
  const normalized = validatePageRange(value, totalPages);
  if (!normalized && !totalPages) return null;
  const ranges = (normalized || `1-${totalPages}`)
    .split(',')
    .map((part) => {
      const [first, last] = part.split('-').map(Number);
      return [first, last || first];
    })
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [first, last] of ranges) {
    const previous = merged.at(-1);
    if (previous && first <= previous[1] + 1) previous[1] = Math.max(previous[1], last);
    else merged.push([first, last]);
  }
  let count = 0;
  for (let [first, last] of merged) {
    if (pageSet === 'all') count += last - first + 1;
    else {
      if (first % 2 !== (pageSet === 'odd' ? 1 : 0)) first++;
      count += Math.max(0, Math.floor((last - first) / 2) + 1);
    }
  }
  if (!count) throw new Error(`No ${pageSet} pages in the selected range.`);
  if (normalized && pageSet !== 'all' && count > 10000)
    throw new Error(
      'Choose a smaller page range when selecting odd or even pages (maximum 10,000 selected pages).',
    );
  return count;
}

export function deviceLabel(device) {
  return device?.alias?.trim() || device?.name || 'No device selected';
}
