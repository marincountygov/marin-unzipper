#!/usr/bin/env python3
"""Exercise real Marin Zipper -> Marin Unzipper AES-256 download workflows.

Fixtures are entirely synthetic and constructed in memory. Normal mode serves
both sibling repositories over loopback HTTP. --in-memory loads the same checked-in
JavaScript without navigation on locked-down browser runners.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import io
import os
from pathlib import Path
import shutil
import struct
from threading import Thread
from urllib.parse import urlsplit
import zipfile

from html_fixture import remove_from_html

UNZIPPER = Path(__file__).resolve().parents[1]
ZIPPER = UNZIPPER.parent / "marin-zipper"
PASSWORD = "Synthetic-Only-Test-Passphrase-2026!"
WRONG_PASSWORD = "Definitely-Not-The-Test-Password-2026!"
ZIP_NAME = "marin-encrypted-files.zip"
# Deliberately include UTF-8, CRLF, LF, blank lines, and all byte values.
FIXTURES = {
    "synthetic-note.txt": (
        "Fictitious regression test content only.\r\n"
        "Second line includes Caf\u00e9 and a snowman \u2603.\n"
        "Blank line follows:\r\n\r\nEnd.\n"
    ).encode("utf-8"),
    "synthetic-bytes.bin": bytes(range(256)) * 4 + bytes((0, 255, 0, 10, 13, 128)),
}
ASSETS = (
    "assets/vendor/zip.js/zip-native.min.js",
    "vendor/marinos/marinos.js",
    "assets/app.js",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def validate_repos(zipper_dir: Path, unzipper_dir: Path) -> None:
    for label, path in (("Marin Zipper", zipper_dir), ("Marin Unzipper", unzipper_dir)):
        for filename in ("index.html", *ASSETS):
            if not (path / filename).is_file():
                raise FileNotFoundError(
                    f"{label} missing {path / filename}. "
                    "Check out marin-zipper and marin-unzipper as sibling repositories."
                )


@contextmanager
def local_site(root: Path):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, *_args) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


def open_app(context, app_dir: Path, url: str | None, *, unzipper: bool):
    page = context.new_page()
    page_errors: list[str] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    if url:
        page.goto(url, wait_until="load")
    else:
        # Navigation to even localhost is blocked in some CI/sandbox browsers.
        # Inject the actual HTML, CSS, library, shell, and app scripts rather
        # than mocking the ZIP library or the application implementation.
        markup = (app_dir / "index.html").read_text(encoding="utf-8")
        markup = remove_from_html(markup, "scripts", "stylesheets")
        page.set_content(markup, wait_until="load")
        for stylesheet in ("vendor/marinos/marinos.css", "assets/app.css"):
            page.add_style_tag(content=(app_dir / stylesheet).read_text(encoding="utf-8"))
        # Optional shell catalog/updates reads must not reach the network.
        page.evaluate("""() => {
          window.fetch = async (input, init) => {
            const method = (init?.method || 'GET').toUpperCase();
            if (method !== 'GET') throw new Error(`Unexpected fetch ${method}: ${input}`);
            return new Response('{}', {status: 200,
              headers: {'Content-Type': 'application/json'}});
          };
        }""")
        for script in ASSETS:
            page.add_script_tag(content=(app_dir / script).read_text(encoding="utf-8"))
        # Unzipper deliberately registers its init() on DOMContentLoaded; the
        # document finished loading before app.js was injected in this mode.
        if unzipper:
            page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")

    page.wait_for_function("() => !!window.zip?.ZipWriter && !!window.zip?.ZipReader")
    page.locator("#app-status-message").wait_for(state="attached")
    if unzipper:
        page.locator("#open-zip-button").wait_for(state="visible")
    else:
        page.locator("#create-zip-button").wait_for(state="visible")
    return page, page_errors


def assert_aes256_zip(archive_bytes: bytes) -> None:
    """Verify WinZip AES metadata, not just ZIP filenames or a UI label."""
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        entries = archive.infolist()
        require(len(entries) == len(FIXTURES), "Unexpected ZIP member count")
        require({item.filename for item in entries} == set(FIXTURES), "ZIP member names changed")
        for item in entries:
            require(item.flag_bits & 0x0001 != 0, f"{item.filename}: entry is not encrypted")
            require(item.compress_type == 99, f"{item.filename}: not a WinZip AES entry")
            offset = 0
            aes_metadata = None
            while offset + 4 <= len(item.extra):
                field_id, size = struct.unpack_from("<HH", item.extra, offset)
                offset += 4
                value = item.extra[offset:offset + size]
                require(len(value) == size, f"{item.filename}: truncated ZIP extra data")
                offset += size
                if field_id == 0x9901:
                    aes_metadata = value
            require(aes_metadata is not None, f"{item.filename}: AES metadata missing")
            require(len(aes_metadata) == 7, f"{item.filename}: malformed AES metadata")
            require(aes_metadata[2:4] == b"AE", f"{item.filename}: AES vendor is not AE")
            require(aes_metadata[4] == 3, f"{item.filename}: not AES-256 (strength 3)")


def create_archive(page) -> bytes:
    require(page.locator("#create-zip-button").is_disabled(), "Create enabled with no input")
    page.locator("#file-input").set_input_files([
        {"name": name, "mimeType": ("text/plain" if name.endswith(".txt") else
                                     "application/octet-stream"), "buffer": content}
        for name, content in FIXTURES.items()
    ])
    page.locator("#selected-count").get_by_text("2 files").wait_for()
    require(page.locator("#create-zip-button").is_disabled(),
            "Create enabled before both passwords are entered")
    page.locator("#zip-password").fill(PASSWORD)
    page.locator("#zip-password-confirm").fill(PASSWORD)
    require(page.locator("#encryption-strength").input_value() == "3",
            "Default encryption is no longer AES-256")
    require(page.locator("#create-zip-button").is_enabled(), "Create did not enable")

    with page.expect_download(timeout=30000) as event:
        page.locator("#create-zip-button").click()
    download = event.value
    require(download.suggested_filename == ZIP_NAME,
            f"Unexpected encrypted ZIP name: {download.suggested_filename}")
    payload = download.path().read_bytes()
    require(len(payload) > 100, "Encrypted ZIP download was empty or unexpectedly small")
    page.locator("#app-status-message.app-alert--success").get_by_text(
        "Encrypted ZIP created", exact=False
    ).wait_for()
    assert_aes256_zip(payload)
    print(f"PASS: Zipper created a downloaded AES-256 ZIP ({len(payload)} bytes, 2 entries)")
    return payload


def extract_and_compare(page, archive_bytes: bytes) -> None:
    downloads = []
    page.on("download", lambda download: downloads.append(download.suggested_filename))
    require(page.locator("#open-zip-button").is_disabled(), "Unzip enabled without a ZIP")
    page.locator("#zip-input").set_input_files({
        "name": ZIP_NAME, "mimeType": "application/zip", "buffer": archive_bytes
    })
    require(page.locator("#open-zip-button").is_enabled(), "Cannot open selected ZIP")
    require(page.locator("#selected-file-name").inner_text() == ZIP_NAME,
            "Unzipper did not select the generated ZIP")

    # A wrong password must fail even though the encrypted ZIP parses correctly.
    page.locator("#zip-password").fill(WRONG_PASSWORD)
    page.locator("#open-zip-button").click()
    page.locator("#app-status-message.app-alert--danger").wait_for(timeout=20000)
    error_text = page.locator("#app-status-message").inner_text().lower()
    require("password" in error_text,
            f"Wrong password was not identified as a password failure: {error_text}")
    page.locator("#cancel-button").wait_for(state="hidden")
    require(page.locator("#results-body tr").count() == 0,
            "Wrong password exposed extracted results")
    require(page.locator("#results-card").is_hidden(), "Wrong password exposed results area")
    require(downloads == [], "Wrong password unexpectedly triggered a download")
    print("PASS: Unzipper rejected an incorrect password without exposing files")

    # Retry the same archive through the actual UI; compare downloaded bytes.
    page.locator("#zip-password").fill(PASSWORD)
    page.locator("#open-zip-button").click()
    page.locator("#app-status-message.app-alert--success").get_by_text(
        "Extracted 2 files.", exact=True
    ).wait_for(timeout=20000)
    require(page.locator("#results-body tr").count() == len(FIXTURES),
            "Unzipper results do not match the original file count")
    require(page.locator("#results-card").is_visible(), "No extracted file listing")
    page.locator("#cancel-button").wait_for(state="hidden")

    for name, original in FIXTURES.items():
        action = page.get_by_role("button", name=f"Download {name}", exact=True)
        require(action.count() == 1, f"No unique download action for {name}")
        with page.expect_download(timeout=15000) as event:
            action.click()
        download = event.value
        require(download.suggested_filename == name,
                f"Extracted download name changed: {download.suggested_filename}")
        restored = download.path().read_bytes()
        require(len(restored) == len(original), f"{name}: byte length changed")
        expected_digest = hashlib.sha256(original).hexdigest()
        actual_digest = hashlib.sha256(restored).hexdigest()
        require(restored == original and actual_digest == expected_digest,
                f"{name}: byte-for-byte round-trip failed: {actual_digest} != {expected_digest}")
        print(f"PASS: {name} ({len(original)} bytes, SHA-256 {actual_digest})")
    require(sorted(downloads) == sorted(FIXTURES), "Unexpected file downloads")


def run(zipper_dir: Path, unzipper_dir: Path, in_memory: bool) -> None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError(
            "Install browser test dependencies: python3 -m pip install "
            "-r marin-unzipper/tests/requirements.txt"
        ) from error

    validate_repos(zipper_dir, unzipper_dir)
    with ExitStack() as stack:
        if in_memory:
            zipper_url = unzipper_url = None
        else:
            zipper_url = stack.enter_context(local_site(zipper_dir))
            unzipper_url = stack.enter_context(local_site(unzipper_dir))
        with sync_playwright() as playwright:
            executable = (os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium")
                          or shutil.which("chromium-browser") or shutil.which("google-chrome"))
            launch = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
            if executable:
                launch["executable_path"] = executable
            browser = playwright.chromium.launch(**launch)
            try:
                context = browser.new_context(accept_downloads=True)
                context.set_default_timeout(12000)
                allowed_hosts = ({urlsplit(u).netloc for u in (zipper_url, unzipper_url)}
                                 if not in_memory else set())
                unexpected_writes: list[str] = []

                def block_external(route):
                    target = urlsplit(route.request.url)
                    if (target.netloc in allowed_hosts and route.request.method in ("GET", "HEAD")):
                        route.continue_()
                    else:
                        route.abort()

                context.route("**/*", block_external)
                context.on("request", lambda request: unexpected_writes.append(
                    f"{request.method} {request.url}") if request.method not in ("GET", "HEAD") else None)
                zipper_page, zipper_errors = open_app(
                    context, zipper_dir, zipper_url, unzipper=False
                )
                archive = create_archive(zipper_page)
                unzipper_page, unzipper_errors = open_app(
                    context, unzipper_dir, unzipper_url, unzipper=True
                )
                extract_and_compare(unzipper_page, archive)
                require(not unexpected_writes, f"Unexpected HTTP writes: {unexpected_writes}")
                require(not zipper_errors, f"Zipper JavaScript errors: {zipper_errors}")
                require(not unzipper_errors, f"Unzipper JavaScript errors: {unzipper_errors}")
                print(f"PASS: encrypted browser round-trip ({'in-memory' if in_memory else 'HTTP'} mode)")
            finally:
                browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zipper-dir", type=Path, default=ZIPPER)
    parser.add_argument("--unzipper-dir", type=Path, default=UNZIPPER)
    parser.add_argument("--in-memory", action="store_true",
                        help="Use in-memory browser pages when localhost navigation is blocked")
    args = parser.parse_args()
    run(args.zipper_dir.resolve(), args.unzipper_dir.resolve(), args.in_memory)


if __name__ == "__main__":
    main()
