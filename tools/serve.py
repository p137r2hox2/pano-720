# -*- coding: utf-8 -*-
"""本地预览服务器：多线程 + 缓存，避免浏览器并发拉六面图时被拒连接。
用法: python tools/serve.py [端口]
"""
import http.server
import socketserver
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8712


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
    })

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 64


if __name__ == '__main__':
    print('')
    print('  720 pano preview server')
    print('  http://localhost:%d/' % PORT)
    print('  Ctrl+C to stop')
    print('')
    with Server(('0.0.0.0', PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
