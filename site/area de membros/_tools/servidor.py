"""Servidor local dos apps (PT / EN / ES) + download dos criativos.

- /m/zuadodzn/<slug>/...  -> serve a pasta do idioma correspondente,
  reproduzindo o caminho real para manifest / service worker / instalar app.
- /baixar?url=...         -> repassa o mp4 do servidor de criativos com
  Content-Disposition: attachment (os videos nao mandam CORS, entao o
  navegador nao consegue baixa-los direto da pagina).
"""
import http.server
import os
import socketserver
import sys
import urllib.parse
import urllib.request

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PREFIX = '/m/zuadodzn/'
FOLDERS = ['apps', 'apps-en', 'apps-es']
ORIGEM_OK = 'https://eva.igorstorm.com/criativos/'

INDEX = {}
for folder in FOLDERS:
    d = os.path.join(BASE, folder)
    if not os.path.isdir(d):
        continue
    for slug in os.listdir(d):
        if os.path.isdir(os.path.join(d, slug)):
            INDEX[slug] = folder


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    # ---------- download dos criativos ----------
    def do_GET(self):
        if self.path.split('?', 1)[0] == '/baixar':
            return self.baixar()
        return super().do_GET()

    def baixar(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        url = (q.get('url') or [''])[0]
        nome = (q.get('nome') or ['video.mp4'])[0]
        nome = os.path.basename(nome).replace('"', '') or 'video.mp4'

        if not url.startswith(ORIGEM_OK):
            self.send_error(400, 'origem nao permitida')
            return
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                length = r.headers.get('Content-Length')
                if length:
                    self.send_header('Content-Length', length)
                self.send_header('Content-Disposition', 'attachment; filename="%s"' % nome)
                self.end_headers()
                while True:
                    pedaco = r.read(65536)
                    if not pedaco:
                        break
                    self.wfile.write(pedaco)
        except BrokenPipeError:
            pass
        except Exception as e:
            try:
                self.send_error(502, 'falha ao buscar: %s' % e)
            except Exception:
                pass

    # ---------- rotas dos apps ----------
    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if clean.startswith(PREFIX):
            rest = clean[len(PREFIX):]
            slug, _, tail = rest.partition('/')
            folder = INDEX.get(slug)
            if folder:
                target = os.path.join(BASE, folder, slug)
                if tail:
                    for part in tail.split('/'):
                        if part in ('', '.', '..'):
                            continue
                        target = os.path.join(target, part)
                if os.path.isdir(target):
                    target = os.path.join(target, 'index.html')
                return target
        return super().translate_path(path)

    def log_message(self, fmt, *args):
        pass


class Servidor(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    counts = {f: sum(1 for v in INDEX.values() if v == f) for f in FOLDERS}
    print('Servindo %d apps  (PT=%d  EN=%d  ES=%d)'
          % (len(INDEX), counts['apps'], counts['apps-en'], counts['apps-es']))
    print('Area de membros: http://localhost:%d/membros.html' % port)
    print('Ctrl+C para parar.')
    with Servidor(('127.0.0.1', port), Handler) as httpd:
        httpd.serve_forever()
