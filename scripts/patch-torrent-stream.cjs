// Script de patching de alto desempenho para torrent-stream
// Expõe engine._critical, engine._pieces e engine._reservations para controle cirúrgico de seek
const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'node_modules', 'torrent-stream', 'index.js');

try {
  if (fs.existsSync(targetPath)) {
    let content = fs.readFileSync(targetPath, 'utf8');
    let modified = false;

    if (!content.includes('engine._critical = critical')) {
      content = content.replace('var critical = []\n', 'var critical = []\n  engine._critical = critical\n');
      modified = true;
    }

    if (!content.includes('engine._reservations = reservations')) {
      content = content.replace(
        'var reservations = torrent.pieces.map(function () {',
        'engine._pieces = pieces\n    engine._reservations = reservations\n    var reservations = torrent.pieces.map(function () {'
      );
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(targetPath, content, 'utf8');
      console.log('[Popoca Patch] torrent-stream ajustado com sucesso para seek instantâneo!');
    }
  }
} catch (err) {
  console.warn('[Popoca Patch] Não foi possível ajustar torrent-stream:', err.message);
}
