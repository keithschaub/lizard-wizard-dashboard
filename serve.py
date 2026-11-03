#!/usr/bin/env python3
"""Simple HTTP server for local development with proper MIME types for Pyodide"""
import http.server
import socketserver
import os

PORT = 8001

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers for Pyodide
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
    print(f"🦎 Lizard Wizard server running at http://localhost:{PORT}")
    print(f"   Open in browser to test locally")
    httpd.serve_forever()
