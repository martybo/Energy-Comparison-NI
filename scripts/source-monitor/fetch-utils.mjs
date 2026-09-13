/** Thin wrappers around fetch() that enforce a timeout and fail with a clear error. */

export class SourceFetchError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SourceFetchError';
    this.details = details;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) {
      throw new SourceFetchError(`Fetching ${url} failed with HTTP ${response.status}`, {
        url,
        status: response.status
      });
    }
    return response;
  } catch (err) {
    if (err instanceof SourceFetchError) throw err;
    if (err.name === 'AbortError') {
      throw new SourceFetchError(`Fetching ${url} timed out after ${timeoutMs}ms`, { url, timeoutMs });
    }
    throw new SourceFetchError(`Fetching ${url} failed: ${err.message}`, { url, cause: err.message });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs);
  return response.text();
}

/** Returns { buffer, headers } where headers carries last-modified/etag/content-type if present. */
export async function fetchBinary(url, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs);
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    headers: {
      contentType: response.headers.get('content-type'),
      lastModified: response.headers.get('last-modified'),
      etag: response.headers.get('etag')
    }
  };
}
