/**
 * Popoca Streaming - Service Worker Video Chunk Cache (IndexedDB + Zero-Latency Stream Tee)
 * Intercepta requisições HTTP 206 Range de streams de vídeo (/api/stream) na sessão atual:
 * - Se o chunk de 2MB já estiver salvo no IndexedDB, responde em < 2ms sem redownload P2P (seek instantâneo)
 * - Em caso de cache miss alinhado (ex: bytes=0-), faz streaming direto via ReadableStream.tee() com latência ZERO
 *   para o <video> começar a tocar no primeiro pacote, enquanto salva o chunk completo no IndexedDB em paralelo!
 */

const DB_NAME = 'popoca_video_chunks_session_db';
const DB_VERSION = 1;
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_SESSION_CHUNKS = 180;
const BROADCAST_CHANNEL_NAME = 'popoca_idb_chunks';

let currentSessionId = 'sw-session';
let dbPromise = null;
const inFlightChunkRequests = new Map();

const broadcast =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(BROADCAST_CHANNEL_NAME) : null;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_SESSION_ID' && event.data.sessionId) {
    currentSessionId = event.data.sessionId;
  }
});

function openChunkDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = self.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('chunks')) {
          const store = db.createObjectStore('chunks', { keyPath: 'key' });
          store.createIndex('by_stream', 'streamKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('manifests')) {
          db.createObjectStore('manifests', { keyPath: 'streamKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function readChunkFromIDB(db, streamKey, chunkIndex) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction('chunks', 'readonly');
      const req = tx.objectStore('chunks').get(`${streamKey}_${chunkIndex}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function saveChunkToIDB(db, record) {
  return new Promise((resolve) => {
    if (!db || !record || !record.data) return resolve();
    try {
      const tx = db.transaction(['chunks', 'manifests'], 'readwrite');
      const chunkStore = tx.objectStore('chunks');
      const manifestStore = tx.objectStore('manifests');

      chunkStore.put(record);

      const getMan = manifestStore.get(record.streamKey);
      getMan.onsuccess = () => {
        const existing = getMan.result;
        const cachedMeta = existing && existing.cachedMeta ? { ...existing.cachedMeta } : {};
        cachedMeta[record.chunkIndex] = {
          startByte: record.startByte,
          endByte: record.endByte,
          sizeBytes: record.sizeBytes
        };
        manifestStore.put({
          streamKey: record.streamKey,
          totalBytes: Math.max(record.totalBytes, (existing && existing.totalBytes) || 0),
          chunkSize: CHUNK_SIZE,
          cachedMeta,
          sessionId: currentSessionId,
          updatedAt: Date.now()
        });
      };

      const countReq = chunkStore.count();
      countReq.onsuccess = () => {
        if (countReq.result > MAX_SESSION_CHUNKS) {
          const candidates = [];
          const curReq = chunkStore.openCursor();
          curReq.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const v = cursor.value;
              if (v.chunkIndex !== 0 && Math.abs(v.chunkIndex - record.chunkIndex) > 6) {
                candidates.push({ key: v.key, updatedAt: v.updatedAt || 0 });
              }
              cursor.continue();
            } else {
              candidates.sort((a, b) => a.updatedAt - b.updatedAt);
              candidates.slice(0, 10).forEach((c) => chunkStore.delete(c.key));
            }
          };
        }
      };

      tx.oncomplete = () => {
        if (broadcast) {
          try {
            broadcast.postMessage({ streamKey: record.streamKey, chunkIndex: record.chunkIndex });
          } catch {}
        }
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function extractStreamKey(url) {
  const explicitKey = url.searchParams.get('_sk');
  if (explicitKey) return explicitKey;

  const magnet = url.searchParams.get('magnet') || '';
  const hashMatch = magnet.match(/btih:([a-fA-F0-9]{40})/i) || magnet.match(/([a-fA-F0-9]{40})/i);
  if (hashMatch) {
    return `btih_${hashMatch[1].toLowerCase()}`;
  }

  const tmdbMatch = url.pathname.match(/\/api\/stream\/(\d+)/);
  if (tmdbMatch) {
    const s = url.searchParams.get('season');
    const e = url.searchParams.get('episode');
    return `tmdb_${tmdbMatch[1]}${s && e ? `_s${s}e${e}` : ''}`;
  }

  return `url_${url.pathname}`;
}

async function downloadChunkArrayBuffer(db, streamKey, chunkIndex, requestUrl) {
  const inflightKey = `${streamKey}_${chunkIndex}`;
  if (inFlightChunkRequests.has(inflightKey)) {
    return inFlightChunkRequests.get(inflightKey);
  }

  const fetchPromise = (async () => {
    const chunkStart = chunkIndex * CHUNK_SIZE;
    const chunkMaxEnd = chunkStart + CHUNK_SIZE - 1;

    const upstreamRes = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        Range: `bytes=${chunkStart}-${chunkMaxEnd}`,
        'X-Popoca-Bypass-SW': '1'
      }
    });

    if (upstreamRes.status !== 206) {
      return { nonRangeResponse: upstreamRes };
    }

    const contentRange = upstreamRes.headers.get('Content-Range') || '';
    const crMatch = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
    if (!crMatch) {
      return { nonRangeResponse: upstreamRes };
    }

    const actualStart = parseInt(crMatch[1], 10);
    const actualEnd = parseInt(crMatch[2], 10);
    const totalBytes = parseInt(crMatch[3], 10);
    const contentType = upstreamRes.headers.get('Content-Type') || 'video/mp4';
    const ab = await upstreamRes.arrayBuffer();

    const record = {
      key: `${streamKey}_${chunkIndex}`,
      streamKey,
      chunkIndex,
      startByte: actualStart,
      endByte: actualEnd,
      totalBytes,
      sizeBytes: ab.byteLength,
      contentType,
      data: ab,
      sessionId: currentSessionId,
      updatedAt: Date.now()
    };

    if (ab.byteLength > 0) {
      saveChunkToIDB(db, record).catch(() => {});
    }

    return { chunk: record, fromCache: false };
  })();

  inFlightChunkRequests.set(inflightKey, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightChunkRequests.delete(inflightKey);
  }
}

async function handleVideoRangeRequest(request, url) {
  const rangeHeader = request.headers.get('range') || request.headers.get('Range');
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return fetch(request);
  }

  const parts = rangeHeader.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const requestedEnd = parts[1] && parts[1].trim() !== '' ? parseInt(parts[1], 10) : null;

  if (isNaN(start) || start < 0) {
    return fetch(request);
  }

  const streamKey = extractStreamKey(url);
  const chunkIndex = Math.floor(start / CHUNK_SIZE);
  const chunkStart = chunkIndex * CHUNK_SIZE;
  const chunkMaxEnd = chunkStart + CHUNK_SIZE - 1;
  const db = await openChunkDB();

  try {
    // 1. Verifica HIT instantâneo no IndexedDB (< 2ms!)
    const cached = await readChunkFromIDB(db, streamKey, chunkIndex);
    if (cached && cached.data && cached.data.byteLength > 0 && cached.totalBytes > 0) {
      const relStart = start - cached.startByte;

      if (
        requestedEnd !== null &&
        requestedEnd > cached.endByte &&
        cached.endByte < cached.totalBytes - 1 &&
        requestedEnd - start <= CHUNK_SIZE
      ) {
        const nextCached = await readChunkFromIDB(db, streamKey, chunkIndex + 1);
        const secondChunk =
          nextCached && nextCached.data
            ? nextCached
            : (await downloadChunkArrayBuffer(db, streamKey, chunkIndex + 1, request.url)).chunk;

        if (secondChunk && secondChunk.data) {
          const part1 = new Uint8Array(cached.data.slice(relStart));
          const maxSecondEnd = Math.min(requestedEnd, secondChunk.endByte);
          const relSecondEndExclusive = maxSecondEnd - secondChunk.startByte + 1;
          const part2 = new Uint8Array(secondChunk.data.slice(0, relSecondEndExclusive));

          const merged = new Uint8Array(part1.byteLength + part2.byteLength);
          merged.set(part1, 0);
          merged.set(part2, part1.byteLength);

          const finalEnd = start + merged.byteLength - 1;
          return new Response(merged.buffer, {
            status: 206,
            headers: {
              'Content-Type': cached.contentType || 'video/mp4',
              'Accept-Ranges': 'bytes',
              'Content-Range': `bytes ${start}-${finalEnd}/${cached.totalBytes}`,
              'Content-Length': String(merged.byteLength),
              'Cache-Control': 'no-cache',
              'X-Popoca-IDB-Cache': 'HIT'
            }
          });
        }
      }

      const effectiveEnd =
        requestedEnd !== null ? Math.min(requestedEnd, cached.endByte) : cached.endByte;
      const relEndExclusive = Math.min(cached.data.byteLength, effectiveEnd - cached.startByte + 1);
      const slicedBuffer = cached.data.slice(relStart, relEndExclusive);
      const actualServedEnd = start + slicedBuffer.byteLength - 1;

      return new Response(slicedBuffer, {
        status: 206,
        headers: {
          'Content-Type': cached.contentType || 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${actualServedEnd}/${cached.totalBytes}`,
          'Content-Length': String(slicedBuffer.byteLength),
          'Cache-Control': 'no-cache',
          'X-Popoca-IDB-Cache': 'HIT'
        }
      });
    }

    // 2. CACHE MISS com Zero-Latency Stream Tee quando alinhado ou início do vídeo (start === chunkStart)
    if (start === chunkStart && (requestedEnd === null || requestedEnd >= chunkMaxEnd)) {
      const upstreamRes = await fetch(request.url, {
        method: 'GET',
        headers: {
          Range: `bytes=${chunkStart}-${chunkMaxEnd}`,
          'X-Popoca-Bypass-SW': '1'
        }
      });

      if (upstreamRes.status !== 206 || !upstreamRes.body) {
        return upstreamRes;
      }

      const contentRange = upstreamRes.headers.get('Content-Range') || '';
      const crMatch = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
      if (!crMatch) {
        return upstreamRes;
      }

      const actualStart = parseInt(crMatch[1], 10);
      const actualEnd = parseInt(crMatch[2], 10);
      const totalBytes = parseInt(crMatch[3], 10);
      const expectedLen = actualEnd - actualStart + 1;
      const contentType = upstreamRes.headers.get('Content-Type') || 'video/mp4';

      const [streamForVideo, streamForCache] = upstreamRes.body.tee();

      // Persiste em background no IndexedDB assim que o chunk terminar de passar pelo stream
      new Response(streamForCache)
        .arrayBuffer()
        .then((ab) => {
          if (ab && ab.byteLength === expectedLen && ab.byteLength > 0) {
            return saveChunkToIDB(db, {
              key: `${streamKey}_${chunkIndex}`,
              streamKey,
              chunkIndex,
              startByte: actualStart,
              endByte: actualEnd,
              totalBytes,
              sizeBytes: ab.byteLength,
              contentType,
              data: ab,
              sessionId: currentSessionId,
              updatedAt: Date.now()
            });
          }
        })
        .catch(() => {});

      return new Response(streamForVideo, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${actualStart}-${actualEnd}/${totalBytes}`,
          'Content-Length': String(expectedLen),
          'Cache-Control': 'no-cache',
          'X-Popoca-IDB-Cache': 'STREAM-TEE'
        }
      });
    }

    // 3. CACHE MISS para sub-ranges internos (ex: seek para o meio de um chunk ou probe do átomo moov no fim do arquivo)
    const targetEnd =
      requestedEnd !== null
        ? Math.min(requestedEnd, chunkMaxEnd)
        : chunkMaxEnd;

    // Se o navegador pediu apenas o finalzinho do arquivo (ex: moov atom nos últimos KBs), busca exatamente de start até chunkMaxEnd sem baixar bytes anteriores desnecessários!
    if (start > chunkStart + 256 * 1024 && requestedEnd === null) {
      return fetch(request.url, {
        method: 'GET',
        headers: {
          Range: rangeHeader,
          'X-Popoca-Bypass-SW': '1'
        }
      });
    }

    const dl = await downloadChunkArrayBuffer(db, streamKey, chunkIndex, request.url);
    if (dl.nonRangeResponse) {
      return fetch(request.url, {
        method: 'GET',
        headers: {
          Range: rangeHeader,
          'X-Popoca-Bypass-SW': '1'
        }
      });
    }

    const firstChunk = dl.chunk;
    if (!firstChunk || start > firstChunk.endByte) {
      return fetch(request);
    }

    const relStart = start - firstChunk.startByte;
    const effectiveEnd =
      requestedEnd !== null ? Math.min(targetEnd, firstChunk.endByte) : firstChunk.endByte;
    const relEndExclusive = Math.min(firstChunk.data.byteLength, effectiveEnd - firstChunk.startByte + 1);
    const slicedBuffer = firstChunk.data.slice(relStart, relEndExclusive);
    const actualServedEnd = start + slicedBuffer.byteLength - 1;

    return new Response(slicedBuffer, {
      status: 206,
      headers: {
        'Content-Type': firstChunk.contentType || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${actualServedEnd}/${firstChunk.totalBytes}`,
        'Content-Length': String(slicedBuffer.byteLength),
        'Cache-Control': 'no-cache',
        'X-Popoca-IDB-Cache': 'MISS'
      }
    });
  } catch {
    return fetch(request);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.headers.get('X-Popoca-Bypass-SW') === '1') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  const isTorrentStreamRoute =
    url.pathname === '/api/stream' || /^\/api\/stream\/\d+$/.test(url.pathname);
  if (!isTorrentStreamRoute) return;

  if (
    url.searchParams.get('transcode') === 'true' ||
    url.searchParams.get('audioOnly') === 'true' ||
    url.searchParams.has('seek') ||
    url.searchParams.has('audioTrack')
  ) {
    return;
  }

  event.respondWith(handleVideoRangeRequest(request, url));
});
