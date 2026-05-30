import os
os.chdir(os.path.dirname(os.path.abspath(__file__)) + "/..")
from http.server import HTTPServer, SimpleHTTPRequestHandler
HTTPServer(("127.0.0.1", 8731), SimpleHTTPRequestHandler).serve_forever()
