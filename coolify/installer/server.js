import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT ?? 3000);
const repo = (process.env.SPARK_REPO ?? 'tiagovicente2/spark').trim();
const sparkServer = (process.env.SPARK_SERVER ?? '').trim();
const installScriptPath = path.join(__dirname, '..', '..', 'install.sh');

let installScriptTemplate = '';
try {
  installScriptTemplate = fs.readFileSync(installScriptPath, 'utf8');
} catch (err) {
  console.error(`Error reading install.sh at ${installScriptPath}:`, err.message);
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function buildInstallScript(repoName, serverUrl) {
  const shebang = '#!/usr/bin/env bash\n';
  let scriptBody = installScriptTemplate.startsWith(shebang)
    ? installScriptTemplate.slice(shebang.length)
    : installScriptTemplate;

  let header = `${shebang}`;
  header += `SPARK_REPO=${shellQuote(repoName)}\n`;
  header += `export SPARK_REPO\n`;
  if (serverUrl) {
    header += `SPARK_SERVER=${shellQuote(serverUrl)}\n`;
    header += `export SPARK_SERVER\n`;
  }

  return header + scriptBody;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok\n');
    return;
  }

  if (url.pathname === '/install.sh') {
    res.writeHead(200, {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(buildInstallScript(repo, sparkServer));
    return;
  }

  // If request comes from curl/wget/fetch, serve the shell script directly so "curl | bash" works on root
  const userAgent = req.headers['user-agent'] || '';
  if (userAgent.includes('curl') || userAgent.includes('wget') || userAgent.includes('fetch')) {
    res.writeHead(200, {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(buildInstallScript(repo, sparkServer));
    return;
  }

  // Browser request: show command instructions
  const installUrl = `${url.origin}/install.sh`;
  const body = [
    '⚡ SPARK CLI Installer Service ⚡',
    '================================',
    '',
    'To install the Spark CLI, run the following command in your terminal:',
    '',
    `  curl -fsSL ${installUrl} | bash`,
    '',
  ].join('\n');

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
});

server.listen(port, () => {
  console.log(`installer server listening on http://localhost:${port}`);
});
