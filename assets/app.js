(function () {
  "use strict";

  const DEFAULT_OUTPUT_ZIP = "marin-unzipped-files.zip";
  const LARGE_FILE_WARNING_BYTES = 250 * 1024 * 1024;
  const WINDOWS_RESERVED_FILENAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
  ]);

  const state = {
    zipFile: null,
    extractedItems: [],
    selectedIds: new Set(),
    dragDepth: 0,
    isBusy: false,
    abortController: null
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const elements = getElements();

    if (window.zip?.configure) {
      window.zip.configure({
        useWebWorkers: false,
        useCompressionStream: true
      });
    }

    setupFileControls(elements);
    setupDragAndDrop(elements);
    setupForm(elements);
    setupResultControls(elements);
    updateZipSummary(elements);
    updateResults(elements);

    if (!window.zip) {
      setStatus(elements, "The ZIP library did not load. Reload the page and try again.", "error");
    }
  }

  function getElements() {
    return {
      dropzone: document.getElementById("dropzone"),
      chooseZipButton: document.getElementById("choose-zip-button"),
      clearZipButton: document.getElementById("clear-zip-button"),
      zipInput: document.getElementById("zip-input"),
      selectedFileName: document.getElementById("selected-file-name"),
      selectedFileSize: document.getElementById("selected-file-size"),
      largeFileWarning: document.getElementById("large-file-warning"),
      zipDetails: document.getElementById("zip-details"),
      zipDetailName: document.getElementById("zip-detail-name"),
      zipDetailSize: document.getElementById("zip-detail-size"),
      form: document.getElementById("unzip-form"),
      password: document.getElementById("zip-password"),
      togglePasswordButton: document.getElementById("toggle-password-button"),
      openZipButton: document.getElementById("open-zip-button"),
      cancelButton: document.getElementById("cancel-button"),
      progressWrap: document.getElementById("progress-wrap"),
      progress: document.getElementById("unzip-progress"),
      progressText: document.getElementById("progress-text"),
      resultsCard: document.getElementById("results-card"),
      extractedCount: document.getElementById("extracted-count"),
      extractedSize: document.getElementById("extracted-size"),
      selectedCount: document.getElementById("selected-count"),
      selectAllButton: document.getElementById("select-all-button"),
      clearSelectionButton: document.getElementById("clear-selection-button"),
      outputZipName: document.getElementById("output-zip-name"),
      downloadSelectedButton: document.getElementById("download-selected-button"),
      resultsEmpty: document.getElementById("results-empty"),
      resultsBody: document.getElementById("results-body"),
      status: document.getElementById("app-status-message")
    };
  }

  function setupFileControls(elements) {
    elements.chooseZipButton.addEventListener("click", () => elements.zipInput.click());
    elements.zipInput.addEventListener("change", () => {
      const [file] = Array.from(elements.zipInput.files || []);
      if (file) selectZipFile(file, elements);
      elements.zipInput.value = "";
    });

    elements.clearZipButton.addEventListener("click", () => clearZip(elements));
    elements.password.addEventListener("input", () => updateCanOpen(elements));
    elements.outputZipName.addEventListener("input", () => updateSelectionControls(elements));

    elements.togglePasswordButton.addEventListener("click", () => {
      const show = elements.password.type === "password";
      elements.password.type = show ? "text" : "password";
      elements.togglePasswordButton.textContent = show ? "Hide password" : "Show password";
      elements.togglePasswordButton.setAttribute("aria-pressed", String(show));
    });
  }

  function setupDragAndDrop(elements) {
    const showDrag = () => {
      document.body.classList.add("is-dragging");
      elements.dropzone.dataset.active = "true";
    };
    const hideDrag = () => {
      state.dragDepth = 0;
      document.body.classList.remove("is-dragging");
      elements.dropzone.dataset.active = "false";
    };

    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      document.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });

    document.addEventListener("dragenter", () => {
      state.dragDepth += 1;
      showDrag();
    });

    document.addEventListener("dragover", (event) => {
      event.dataTransfer.dropEffect = "copy";
      showDrag();
    });

    document.addEventListener("dragleave", () => {
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) hideDrag();
    });

    document.addEventListener("drop", (event) => {
      hideDrag();
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) return;
      const zipFile = files.find((file) => isLikelyZipFile(file)) || files[0];
      selectZipFile(zipFile, elements);
      if (files.length > 1) {
        setStatus(elements, "Only one ZIP file can be opened at a time. The first ZIP-like file was selected.", "warning");
      }
    });
  }

  function setupForm(elements) {
    elements.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await openZip(elements);
    });

    elements.cancelButton.addEventListener("click", () => {
      if (state.abortController) {
        state.abortController.abort();
      }
    });
  }

  function setupResultControls(elements) {
    elements.selectAllButton.addEventListener("click", () => {
      state.selectedIds = new Set(state.extractedItems.map((item) => item.id));
      updateResults(elements);
    });

    elements.clearSelectionButton.addEventListener("click", () => {
      state.selectedIds.clear();
      updateResults(elements);
    });

    elements.downloadSelectedButton.addEventListener("click", async () => {
      await downloadSelectedAsZip(elements);
    });

    elements.resultsBody.addEventListener("change", (event) => {
      const checkbox = event.target.closest("input[type='checkbox'][data-entry-id]");
      if (!checkbox) return;
      const id = checkbox.dataset.entryId;
      if (checkbox.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      updateSelectionControls(elements);
    });

    elements.resultsBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-download-entry]");
      if (!button) return;
      const item = state.extractedItems.find((entry) => entry.id === button.dataset.downloadEntry);
      if (!item) return;
      downloadBlob(item.blob, item.downloadName);
      setStatus(elements, `Downloaded ${item.downloadName}.`, "success");
    });
  }

  function selectZipFile(file, elements) {
    clearExtractedItems();

    if (!isLikelyZipFile(file)) {
      setStatus(elements, "The selected file does not look like a ZIP file. Select a .zip file and try again.", "error");
      state.zipFile = null;
    } else {
      state.zipFile = file;
      elements.outputZipName.value = makeDefaultOutputZipName(file.name);
      setStatus(elements, `Selected ${file.name}. Enter the password if needed, then decrypt and list files.`, "info");
    }

    updateZipSummary(elements);
    updateResults(elements);
    updateCanOpen(elements);
  }

  function clearZip(elements) {
    if (state.abortController) {
      state.abortController.abort();
    }
    state.zipFile = null;
    clearExtractedItems();
    elements.password.value = "";
    elements.outputZipName.value = DEFAULT_OUTPUT_ZIP;
    elements.progressWrap.hidden = true;
    elements.progress.value = 0;
    elements.progressText.textContent = "Waiting to start.";
    setStatus(elements, "ZIP cleared.", "info");
    updateZipSummary(elements);
    updateResults(elements);
    updateCanOpen(elements);
  }

  function clearExtractedItems() {
    state.extractedItems = [];
    state.selectedIds.clear();
  }

  async function openZip(elements) {
    if (!state.zipFile || state.isBusy || !window.zip) return;

    state.isBusy = true;
    state.abortController = new AbortController();
    clearExtractedItems();
    updateResults(elements);
    updateCanOpen(elements);
    setProgress(elements, 0, "Reading ZIP file...");
    elements.progressWrap.hidden = false;
    elements.cancelButton.hidden = false;
    elements.openZipButton.disabled = true;

    let reader;
    try {
      const password = elements.password.value || undefined;
      reader = new zip.ZipReader(new zip.BlobReader(state.zipFile));
      const entries = await reader.getEntries({ filenameValidation: "balanced" });
      const fileEntries = entries.filter((entry) => !entry.directory);

      if (!fileEntries.length) {
        setProgress(elements, 100, "No files found.");
        setStatus(elements, "This ZIP file does not contain files to extract.", "warning");
        return;
      }

      const usedPaths = new Set();
      let completed = 0;
      let completedBytes = 0;
      const totalBytes = fileEntries.reduce((sum, entry) => sum + safeNumber(entry.uncompressedSize), 0);

      for (const entry of fileEntries) {
        throwIfAborted(state.abortController.signal);
        const displayName = normalizeDisplayPath(entry.filename || `file-${completed + 1}`);
        const safePath = makeUniqueEntryPath(displayName, usedPaths);
        const fileName = safeDownloadName(safePath);
        setProgress(elements, getOverallProgress(completed, fileEntries.length), `Extracting ${displayName}...`);

        const blob = await entry.getData(new zip.BlobWriter(), {
          password,
          signal: state.abortController.signal,
          onprogress: (loaded) => {
            const entrySize = safeNumber(entry.uncompressedSize);
            const totalProgress = totalBytes
              ? ((completedBytes + Math.min(loaded, entrySize)) / totalBytes) * 100
              : ((completed + Math.min(loaded / Math.max(entrySize, 1), 1)) / fileEntries.length) * 100;
            setProgress(elements, totalProgress, `Extracting ${displayName}...`);
          }
        });

        const id = makeEntryId(completed);
        state.extractedItems.push({
          id,
          originalName: displayName,
          safePath,
          downloadName: fileName,
          size: blob.size,
          blob
        });
        state.selectedIds.add(id);
        completed += 1;
        completedBytes += safeNumber(entry.uncompressedSize || blob.size);
      }

      setProgress(elements, 100, `Extracted ${state.extractedItems.length} ${pluralize("file", state.extractedItems.length)}.`);
      setStatus(elements, `Extracted ${state.extractedItems.length} ${pluralize("file", state.extractedItems.length)}.`, "success");
      updateResults(elements);
      elements.resultsCard.hidden = false;
      elements.resultsCard.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      clearExtractedItems();
      updateResults(elements);
      if (error?.name === "AbortError") {
        setStatus(elements, "Extraction canceled.", "warning");
        setProgress(elements, 0, "Canceled.");
      } else {
        handleZipError(error, elements);
      }
    } finally {
      if (reader) {
        try { await reader.close(); } catch (_) { /* no-op */ }
      }
      state.isBusy = false;
      state.abortController = null;
      elements.cancelButton.hidden = true;
      updateSelectionControls(elements);
      updateCanOpen(elements);
    }
  }

  async function downloadSelectedAsZip(elements) {
    const selectedItems = state.extractedItems.filter((item) => state.selectedIds.has(item.id));
    if (!selectedItems.length || state.isBusy || !window.zip) return;

    state.isBusy = true;
    updateSelectionControls(elements);
    setProgress(elements, 0, "Creating unencrypted ZIP...");
    elements.progressWrap.hidden = false;

    let writer;
    try {
      writer = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
      let completed = 0;
      for (const item of selectedItems) {
        await writer.add(item.safePath, new zip.BlobReader(item.blob), {
          level: 6,
          onprogress: () => {
            setProgress(elements, getOverallProgress(completed, selectedItems.length), `Adding ${item.originalName}...`);
          }
        });
        completed += 1;
        setProgress(elements, getOverallProgress(completed, selectedItems.length), `Added ${completed} of ${selectedItems.length} files...`);
      }
      const zipBlob = await writer.close();
      writer = null;
      const filename = sanitizeZipFileName(elements.outputZipName.value || DEFAULT_OUTPUT_ZIP);
      elements.outputZipName.value = filename;
      downloadBlob(zipBlob, filename);
      setProgress(elements, 100, `Created ${filename}.`);
      setStatus(elements, `Created and downloaded ${filename}.`, "success");
    } catch (error) {
      setStatus(elements, `Could not create the unencrypted ZIP: ${getErrorMessage(error)}`, "error");
    } finally {
      if (writer) {
        try { await writer.close(); } catch (_) { /* no-op */ }
      }
      state.isBusy = false;
      updateSelectionControls(elements);
      updateCanOpen(elements);
    }
  }

  function updateZipSummary(elements) {
    const file = state.zipFile;
    elements.clearZipButton.disabled = !file || state.isBusy;
    elements.openZipButton.disabled = !file || state.isBusy || !window.zip;
    elements.selectedFileName.textContent = file ? file.name : "No ZIP selected";
    elements.selectedFileSize.textContent = file ? formatBytes(file.size) : "0 bytes";
    elements.largeFileWarning.hidden = !file || file.size < LARGE_FILE_WARNING_BYTES;
    elements.zipDetails.hidden = !file;
    elements.zipDetailName.textContent = file ? file.name : "";
    elements.zipDetailSize.textContent = file ? formatBytes(file.size) : "";
  }

  function updateCanOpen(elements) {
    elements.openZipButton.disabled = !state.zipFile || state.isBusy || !window.zip;
    elements.clearZipButton.disabled = !state.zipFile || state.isBusy;
  }

  function updateResults(elements) {
    const items = state.extractedItems;
    elements.resultsCard.hidden = !items.length;
    elements.resultsEmpty.hidden = items.length > 0;
    elements.extractedCount.textContent = `${items.length} ${pluralize("file", items.length)}`;
    elements.extractedSize.textContent = formatBytes(items.reduce((sum, item) => sum + item.size, 0));
    elements.resultsBody.textContent = "";

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const row = document.createElement("tr");

      const selectCell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.entryId = item.id;
      checkbox.checked = state.selectedIds.has(item.id);
      checkbox.setAttribute("aria-label", `Select ${item.originalName}`);
      selectCell.append(checkbox);

      const fileCell = document.createElement("td");
      const fileName = document.createElement("div");
      fileName.className = "unzip-file-name";
      fileName.textContent = item.originalName;
      fileCell.append(fileName);
      if (item.safePath !== item.originalName) {
        const note = document.createElement("div");
        note.className = "unzip-file-path-note";
        note.textContent = `Safe output path: ${item.safePath}`;
        fileCell.append(note);
      }

      const sizeCell = document.createElement("td");
      sizeCell.textContent = formatBytes(item.size);

      const downloadCell = document.createElement("td");
      downloadCell.className = "unzip-file-download";
      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.className = "secondary";
      downloadButton.dataset.downloadEntry = item.id;
      downloadButton.textContent = "Download";
      downloadCell.append(downloadButton);

      row.append(selectCell, fileCell, sizeCell, downloadCell);
      fragment.append(row);
    }

    elements.resultsBody.append(fragment);
    updateSelectionControls(elements);
  }

  function updateSelectionControls(elements) {
    const selectedCount = state.selectedIds.size;
    elements.selectedCount.textContent = `${selectedCount} selected`;
    elements.downloadSelectedButton.disabled = selectedCount === 0 || state.isBusy || !window.zip;
    elements.selectAllButton.disabled = state.extractedItems.length === 0 || state.isBusy;
    elements.clearSelectionButton.disabled = selectedCount === 0 || state.isBusy;
  }

  function setStatus(elements, message, type = "info") {
    const alertType = type === "error" ? "danger" : type;
    elements.status.textContent = message;
    elements.status.className = `app-alert app-alert--${alertType}`;
  }

  function setProgress(elements, value, text) {
    const cleanValue = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
    elements.progress.value = cleanValue;
    elements.progressText.textContent = text;
  }

  function handleZipError(error, elements) {
    const message = getErrorMessage(error);
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("invalid password") || lowerMessage.includes("authentication")) {
      setStatus(elements, "The password did not work for this ZIP file. Check the password and try again.", "error");
      setProgress(elements, 0, "Password failed.");
      return;
    }
    if (lowerMessage.includes("encrypted") && !elements.password.value) {
      setStatus(elements, "This ZIP file is encrypted. Enter the password and try again.", "error");
      setProgress(elements, 0, "Password required.");
      return;
    }
    if (lowerMessage.includes("unsafe filename")) {
      setStatus(elements, "This ZIP file contains an unsafe file path. Marin Unzipper stopped before extracting it.", "error");
      setProgress(elements, 0, "Unsafe file path found.");
      return;
    }
    setStatus(elements, `Could not open this ZIP file: ${message}`, "error");
    setProgress(elements, 0, "Extraction failed.");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function isLikelyZipFile(file) {
    const name = String(file?.name || "").toLowerCase();
    const type = String(file?.type || "").toLowerCase();
    return name.endsWith(".zip") || type === "application/zip" || type === "application/x-zip-compressed";
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
    const units = ["bytes", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const decimals = unitIndex === 0 || value >= 100 ? 0 : 1;
    return `${value.toFixed(decimals)} ${units[unitIndex]}`;
  }

  function safeNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function getOverallProgress(completed, total) {
    if (!total) return 0;
    return Math.round((completed / total) * 100);
  }

  function pluralize(word, count) {
    return count === 1 ? word : `${word}s`;
  }

  function makeEntryId(index) {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `entry-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeDisplayPath(path) {
    return String(path || "file")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/+$/g, "") || "file";
  }

  function sanitizeEntrySegment(segment, fallback = "file") {
    let clean = String(segment || "")
      .replace(/[<>:"\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    clean = clean.replace(/^[. ]+|[. ]+$/g, "");
    if (!clean || clean === "." || clean === "..") clean = fallback;
    if (WINDOWS_RESERVED_FILENAMES.has(clean.toUpperCase())) clean = `${clean}-file`;
    return clean;
  }

  function normalizeEntryPath(path) {
    const value = normalizeDisplayPath(path).replace(/^[a-zA-Z]:\//, "");
    const parts = value
      .split("/")
      .map((part) => sanitizeEntrySegment(part, ""))
      .filter(Boolean);
    return parts.join("/") || "file";
  }

  function makeUniqueEntryPath(path, usedPaths) {
    const normalizedPath = normalizeEntryPath(path);
    if (!usedPaths.has(normalizedPath)) {
      usedPaths.add(normalizedPath);
      return normalizedPath;
    }

    const slashIndex = normalizedPath.lastIndexOf("/");
    const folder = slashIndex >= 0 ? `${normalizedPath.slice(0, slashIndex + 1)}` : "";
    const filename = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
    const dotIndex = filename.lastIndexOf(".");
    const hasExtension = dotIndex > 0;
    const base = hasExtension ? filename.slice(0, dotIndex) : filename;
    const extension = hasExtension ? filename.slice(dotIndex) : "";

    let counter = 2;
    let candidate = `${folder}${base} (${counter})${extension}`;
    while (usedPaths.has(candidate)) {
      counter += 1;
      candidate = `${folder}${base} (${counter})${extension}`;
    }
    usedPaths.add(candidate);
    return candidate;
  }

  function safeDownloadName(path) {
    const name = normalizeEntryPath(path).split("/").pop() || "file";
    return sanitizeEntrySegment(name, "file");
  }

  function sanitizeZipFileName(value) {
    const trimmed = String(value || DEFAULT_OUTPUT_ZIP).trim();
    const withoutUnsafe = trimmed
      .replace(/[<>:"\\|?*\x00-\x1F]/g, "_")
      .replace(/^\.+/, "")
      .trim() || DEFAULT_OUTPUT_ZIP;
    return withoutUnsafe.toLowerCase().endsWith(".zip") ? withoutUnsafe : `${withoutUnsafe}.zip`;
  }

  function makeDefaultOutputZipName(sourceName) {
    const base = String(sourceName || "marin-unzipped-files.zip")
      .replace(/\.zip$/i, "")
      .replace(/[<>:"\\|?*\x00-\x1F]/g, "_")
      .replace(/^\.+/, "")
      .trim() || "marin-unzipped-files";
    return sanitizeZipFileName(`${base}-unencrypted.zip`);
  }

  function getErrorMessage(error) {
    return error?.message || String(error || "Unknown error");
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
  }
})();
