"""Server statis untuk pengujian lokal dengan antrean koneksi besar.

Pemakaian: python3 tests/serve.py PORT
http.server bawaan hanya punya antrean 5 koneksi, sehingga banyak modul ES yang dimuat
bersamaan kadang gagal dengan ERR_CONNECTION_RESET.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Handler, directory=ROOT)
    with Server(("127.0.0.1", port), handler) as httpd:
        httpd.serve_forever()
