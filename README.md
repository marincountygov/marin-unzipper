# Marin Unzipper

Marin Unzipper is a MarinOS browser application for opening ZIP files locally. It decrypts and decompresses ZIP contents in the user's browser, then lets users download files individually or select multiple extracted files and download them as a new unencrypted ZIP.

## What it does

- Accepts one `.zip` file at a time.
- Supports full-page drag-and-drop.
- Supports password-protected ZIP extraction when the correct password is provided.
- Lists extracted files after the ZIP is opened.
- Allows individual file downloads.
- Allows checked files to be repackaged into an unencrypted `.zip` file.
- Keeps file processing local to the browser.

## What it does not do

- It does not upload files.
- It does not store passwords.
- It does not create encrypted ZIP files.
- It does not write extracted files directly to the user's file system. The browser download action is used instead.
- It does not automatically fetch MarinOS catalog data or GitHub update data at runtime.

## Local dependencies

Required runtime assets are loaded from local paths:

```text
vendor/pico.min.css
shared/app-brand.css
shared/app-shell.js
assets/app.css
assets/app.js
assets/vendor/zip.js/zip-native.min.js
```

For full MarinOS typography, the shared brand bundle expects these local font files to be present in the target repository:

```text
vendor/fonts/Jost-wght.ttf
vendor/fonts/open-sans/OpenSans-VariableFont_wdth,wght.woff2
vendor/fonts/open-sans/OFL.txt
```

The page does not depend on Google Fonts, Adobe Fonts, jsDelivr, unpkg, cdnjs, or other runtime CDN/static asset hosts. zip.js is loaded locally from `assets/vendor/zip.js/zip-native.min.js`.

## Browser notes

Marin Unzipper is intended for modern browsers. Browser memory limits can affect very large ZIP files because extracted file blobs are held in browser memory until the ZIP is cleared or the page is reloaded.

The unencrypted ZIP created from selected files should be easier to use with built-in operating system archive tools than the original encrypted ZIP.

## Security notes

Users should only extract files from ZIP files they trust. Files, extracted content, and passwords stay in the browser. Do not include sensitive information in file names unless the naming format has been approved for the workflow.

## Updates

The Updates page is local-first. It does not load update data automatically. It links to the `marincountygov/marin-unzipper` commit history for release review.

## Deployment

This is a static site. Deploy these files together:

```text
index.html
assets/app.css
assets/app.js
assets/vendor/zip.js/zip-native.min.js
shared/app-brand.css
shared/app-shell.js
vendor/pico.min.css
vendor/fonts/README.md
vendor/fonts/open-sans/OFL.txt
BRAND_VERSION
README.md
```

Restore the font binaries listed above from the existing source package before publishing if the target repository does not already contain them. No server-side code is required.
