# Marin Unzipper

Browser-only MarinOS app for decrypting and decompressing ZIP files locally with the official vendored zip.js native browser build and Marin App Shell.

## Security

Marin Unzipper follows the [MarinOS security standard](https://github.com/marincountygov/marin-digital-standards/blob/main/security/standard.md). See [`SECURITY.md`](SECURITY.md) to report an issue, or the app's own `#security` section for a plain-language summary.

## Files

- `index.html` - MarinOS shell web components (`marin-os-banner`, `marin-app-header`, `marin-app-info`, `marin-app-footer`, `marin-app-feedback`), ZIP extraction form, file list table, and download controls.
- `assets/app.css` - App-specific styles.
- `assets/app.js` - File selection, full-page drag-and-drop, password handling, ZIP decryption/extraction, progress, cancellation, individual file downloads, and unencrypted ZIP repackaging.
- `assets/vendor/zip.js/zip-native.min.js` - Official vendored zip.js native browser build.
- `vendor/marinos/` - Vendored Marin App Shell release (do not edit vendored shell files directly).
- `vendor/fonts/open-sans/OFL.txt` - Open Sans license file.

## Local-first runtime assets

Marin Unzipper serves required runtime CSS, JavaScript, and font references from local first-party paths. Do not add Google Fonts, Adobe Fonts, jsDelivr, unpkg, cdnjs, or other runtime CDN/static asset references.

Required local font files:

```text
vendor/fonts/Jost-wght.ttf
vendor/fonts/open-sans/OpenSans-VariableFont_wdth,wght.woff2
vendor/fonts/open-sans/OFL.txt
```

The Open Sans WOFF2 file and Jost TTF file must be present before publishing. They may be omitted from AI-generated transfer zips and then copied back into the paths above.

## MarinOS integration

The app vendors Marin App Shell under `vendor/marinos/`, and the pinned shell version is recorded in `marin.yml`. The shell owns shared MarinOS structure and behavior while application-specific logic remains in the app's own files.

## Notes

- Files selected for extraction are processed locally in the browser and are not uploaded by this page.
- `assets/vendor/zip.js/zip-native.min.js` is local to this bundle. No zip.js CDN dependency is required.
- The Updates page loads release information via the shell.
- Browser memory limits can affect very large ZIP files because extracted file blobs are held in browser memory until the ZIP is cleared or the page is reloaded.
