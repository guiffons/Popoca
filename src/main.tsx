import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { videoChunkCache } from './services/videoChunkCache.ts';
import './index.css';

// Inicializa sessão temporária do cache de chunks de vídeo no IndexedDB
videoChunkCache.initSession().catch(() => {});

// Registra o Service Worker de interceptação HTTP 206 Range + IndexedDB para seek instantâneo
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw-stream-cache.js')
      .then((reg) => {
        const sendSession = (worker: ServiceWorker | null) => {
          worker?.postMessage({
            type: 'SET_SESSION_ID',
            sessionId: videoChunkCache.getSessionId()
          });
        };
        sendSession(reg.active || reg.waiting || reg.installing);
        navigator.serviceWorker.ready.then((readyReg) => {
          sendSession(readyReg.active);
        });
      })
      .catch(() => {
        // Fallback em ambientes sem suporte a Service Worker
      });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
