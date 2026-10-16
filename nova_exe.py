"""Desktop entry point that starts NOVA's server before opening its UI."""

import threading
import time
import urllib.error
import urllib.request
import webbrowser

import nova_app


def main():
    server = threading.Thread(target=nova_app.main, name="nova-server", daemon=True)
    server.start()
    url = "http://127.0.0.1:8765"
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline and server.is_alive():
        try:
            with urllib.request.urlopen(url + "/api/status", timeout=1):
                webbrowser.open(url + "/loading.html")
                server.join()
                return
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(0.4)
    if server.is_alive():
        print("NOVA did not start in time. Check the server errors above.")
        server.join()


if __name__ == "__main__":
    main()
