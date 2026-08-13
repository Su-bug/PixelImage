(function () {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileName = document.getElementById("file-name");
  const sizeMode = document.getElementById("size-mode");
  const blockControls = document.getElementById("block-controls");
  const gridControls = document.getElementById("grid-controls");
  const blockSizeInput = document.getElementById("block-size");
  const blockValue = document.getElementById("block-value");
  const maxOutputSelect = document.getElementById("max-output");
  const blockMeta = document.getElementById("block-meta");
  const widthInput = document.getElementById("width-input");
  const heightInput = document.getElementById("height-input");
  const lockRatio = document.getElementById("lock-ratio");
  const sampleSelect = document.getElementById("sample-select");
  const outlineToggle = document.getElementById("outline-toggle");
  const reconnectToggle = document.getElementById("reconnect-toggle");
  const paletteSelect = document.getElementById("palette-select");
  const colorCountInput = document.getElementById("color-count");
  const colorCountValue = document.getElementById("color-count-value");
  const colorCountField = document.getElementById("color-count-field");
  const ditherToggle = document.getElementById("dither-toggle");
  const paletteStrip = document.getElementById("palette-strip");
  const scaleInput = document.getElementById("scale-input");
  const gridToggle = document.getElementById("grid-toggle");
  const generateBtn = document.getElementById("generate-btn");
  const exportSmallBtn = document.getElementById("export-small-btn");
  const exportLargeBtn = document.getElementById("export-large-btn");
  const statusText = document.getElementById("status-text");
  const sourcePreview = document.getElementById("source-preview");
  const sourcePlaceholder = document.getElementById("source-placeholder");
  const resultCanvas = document.getElementById("result-canvas");
  const resultPlaceholder = document.getElementById("result-placeholder");
  const resultMeta = document.getElementById("result-meta");
  const toolRow = document.getElementById("tool-row");
  const paintColor = document.getElementById("paint-color");
  const paintAlpha = document.getElementById("paint-alpha");
  const editMeta = document.getElementById("edit-meta");
  const undoBtn = document.getElementById("undo-btn");
  const redoBtn = document.getElementById("redo-btn");

  let sourceImage = null;
  let objectUrl = null;
  let result = null;
  let syncingRatio = false;
  let currentTool = "eyedropper";
  let selected = null;
  let painting = false;
  let colorUndoArmed = false;
  let undoStack = [];
  let redoStack = [];
  let genTimer = null;
  let autoScaleFromBlock = true;

  function setStatus(text) {
    statusText.textContent = text;
  }

  function currentSize() {
    return {
      width: Pixelate.clampInt(widthInput.value, 1, 512),
      height: Pixelate.clampInt(heightInput.value, 1, 512),
      scale: Pixelate.clampInt(scaleInput.value, 1, 64),
    };
  }

  function isBlockMode() {
    return sizeMode.value === "block";
  }

  function currentBlockGrid() {
    if (!sourceImage) return null;
    return Pixelate.computeBlockGrid(
      sourceImage.naturalWidth,
      sourceImage.naturalHeight,
      blockSizeInput.value,
      Number(maxOutputSelect.value)
    );
  }

  function updateModeUi() {
    const block = isBlockMode();
    blockControls.hidden = !block;
    gridControls.hidden = block;
    colorCountField.hidden = paletteSelect.value !== "auto";
    blockValue.textContent = String(Pixelate.clampInt(blockSizeInput.value, 1, 32));
    colorCountValue.textContent = String(Pixelate.clampInt(colorCountInput.value, 2, 256));
    const grid = currentBlockGrid();
    if (block && grid) {
      blockMeta.textContent = `约 ${grid.width}×${grid.height} 格 · 块 ${grid.block}px · 最长边 ${grid.workW}×${grid.workH}`;
    }
  }

  function scheduleGenerate() {
    updateModeUi();
    if (!sourceImage) return;
    clearTimeout(genTimer);
    genTimer = setTimeout(generate, 140);
  }

  function applyAspectFromWidth() {
    if (!sourceImage || !lockRatio.checked || syncingRatio) return;
    syncingRatio = true;
    const aspect = sourceImage.naturalWidth / sourceImage.naturalHeight;
    const w = Pixelate.clampInt(widthInput.value, 1, 512);
    heightInput.value = String(Pixelate.clampInt(Math.round(w / aspect), 1, 512));
    widthInput.value = String(w);
    syncingRatio = false;
  }

  function applyAspectFromHeight() {
    if (!sourceImage || !lockRatio.checked || syncingRatio) return;
    syncingRatio = true;
    const aspect = sourceImage.naturalWidth / sourceImage.naturalHeight;
    const h = Pixelate.clampInt(heightInput.value, 1, 512);
    widthInput.value = String(Pixelate.clampInt(Math.round(h * aspect), 1, 512));
    heightInput.value = String(h);
    syncingRatio = false;
  }

  function initSizeFromImage() {
    if (!sourceImage) return;
    syncingRatio = true;
    const aspect = sourceImage.naturalWidth / sourceImage.naturalHeight;
    const width = 64;
    const height = Pixelate.clampInt(Math.round(width / aspect), 1, 512);
    widthInput.value = String(width);
    heightInput.value = String(height);
    syncingRatio = false;
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function hexToRgb(hex) {
    const n = String(hex || "").replace("#", "");
    if (n.length !== 6) return [124, 255, 178];
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
  }

  function currentPaintRgba() {
    const [r, g, b] = hexToRgb(paintColor.value);
    const a = Pixelate.clampInt(paintAlpha.value, 0, 255);
    paintAlpha.value = String(a);
    return [r, g, b, a];
  }

  function pixelIndex(x, y) {
    return (y * result.width + x) * 4;
  }

  function getPixel(x, y) {
    const i = pixelIndex(x, y);
    const d = result.imageData.data;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  function setPixel(x, y, rgba) {
    const i = pixelIndex(x, y);
    const d = result.imageData.data;
    d[i] = rgba[0];
    d[i + 1] = rgba[1];
    d[i + 2] = rgba[2];
    d[i + 3] = rgba[3];
  }

  function cloneImageData(imageData) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }

  function updateUndoButtons() {
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
  }

  function pushUndo() {
    if (!result) return;
    undoStack.push(cloneImageData(result.imageData));
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
  }

  function undo() {
    if (!undoStack.length || !result) return;
    redoStack.push(cloneImageData(result.imageData));
    result.imageData = undoStack.pop();
    updateUndoButtons();
    renderPreview();
    syncPickerFromSelected();
    setStatus("已撤销");
  }

  function redo() {
    if (!redoStack.length || !result) return;
    undoStack.push(cloneImageData(result.imageData));
    result.imageData = redoStack.pop();
    updateUndoButtons();
    renderPreview();
    syncPickerFromSelected();
    setStatus("已重做");
  }

  function setTool(tool) {
    currentTool = tool;
    toolRow.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    resultCanvas.classList.remove("tool-brush", "tool-eyedropper", "tool-fill", "tool-eraser");
    resultCanvas.classList.add("tool-" + tool);
  }

  function syncPickerFromSelected() {
    if (!result || !selected) return;
    const [r, g, b, a] = getPixel(selected.x, selected.y);
    paintColor.value = rgbToHex(r, g, b);
    paintAlpha.value = String(a);
    editMeta.textContent = `(${selected.x}, ${selected.y})  rgba(${r}, ${g}, ${b}, ${a})`;
  }

  function highlightSelection(ctx, scale) {
    if (!selected) return;
    const x = selected.x * scale;
    const y = selected.y * scale;
    ctx.save();
    ctx.lineWidth = Math.max(2, Math.floor(scale / 8));
    ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(x + 1, y + 1, scale - 2, scale - 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(x + 0.5, y + 0.5, scale - 1, scale - 1);
    ctx.restore();
  }

  function renderPaletteStrip(palette) {
    paletteStrip.replaceChildren();
    if (!palette || !palette.length) return;
    const frag = document.createDocumentFragment();
    palette.forEach((c) => {
      const swatch = document.createElement("span");
      swatch.title = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      swatch.style.background = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      swatch.addEventListener("click", () => {
        paintColor.value = rgbToHex(c[0], c[1], c[2]);
        paintAlpha.value = "255";
        paletteStrip.querySelectorAll("span").forEach((el) => el.classList.remove("active"));
        swatch.classList.add("active");
        if (selected && currentTool === "eyedropper") {
          pushUndo();
          setPixel(selected.x, selected.y, [c[0], c[1], c[2], 255]);
          renderPreview();
          syncPickerFromSelected();
          setStatus(`已把 (${selected.x}, ${selected.y}) 改成色盘色`);
        } else {
          setTool("brush");
          setStatus("已选色盘颜色，可用画笔涂");
        }
      });
      frag.appendChild(swatch);
    });
    paletteStrip.appendChild(frag);
  }

  function renderPreview() {
    if (!result) return;
    const { scale } = currentSize();
    const showGrid = gridToggle.checked;
    const ctx = resultCanvas.getContext("2d");
    Pixelate.drawUpscaled(ctx, result.imageData, scale, showGrid);
    highlightSelection(ctx, scale);
    resultCanvas.hidden = false;
    resultPlaceholder.hidden = true;
    resultCanvas.classList.add("tool-" + currentTool);
    const sel = selected ? ` · (${selected.x}, ${selected.y})` : "";
    resultMeta.textContent = `${result.width}×${result.height} · ×${scale}${showGrid ? " · 格线" : ""}${sel}`;
  }

  function canvasToPixel(event) {
    if (!result) return null;
    const rect = resultCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const { scale } = currentSize();
    const x = ((event.clientX - rect.left) / rect.width) * resultCanvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * resultCanvas.height;
    const px = Math.floor(x / scale);
    const py = Math.floor(y / scale);
    if (px < 0 || py < 0 || px >= result.width || py >= result.height) return null;
    return { x: px, y: py };
  }

  function floodFill(x, y, rgba) {
    const w = result.width;
    const h = result.height;
    const d = result.imageData.data;
    const start = pixelIndex(x, y);
    const sr = d[start];
    const sg = d[start + 1];
    const sb = d[start + 2];
    const sa = d[start + 3];
    if (sr === rgba[0] && sg === rgba[1] && sb === rgba[2] && sa === rgba[3]) return false;
    const stack = [[x, y]];
    const seen = new Uint8Array(w * h);
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const idx = cy * w + cx;
      if (seen[idx]) continue;
      const i = idx * 4;
      if (d[i] !== sr || d[i + 1] !== sg || d[i + 2] !== sb || d[i + 3] !== sa) continue;
      seen[idx] = 1;
      d[i] = rgba[0];
      d[i + 1] = rgba[1];
      d[i + 2] = rgba[2];
      d[i + 3] = rgba[3];
      if (cx > 0) stack.push([cx - 1, cy]);
      if (cx + 1 < w) stack.push([cx + 1, cy]);
      if (cy > 0) stack.push([cx, cy - 1]);
      if (cy + 1 < h) stack.push([cx, cy + 1]);
    }
    return true;
  }

  function applyAt(pos, tool, rgba) {
    if (!pos) return false;
    selected = pos;
    if (tool === "eyedropper") {
      syncPickerFromSelected();
      return false;
    }
    if (tool === "brush") {
      setPixel(pos.x, pos.y, rgba);
      return true;
    }
    if (tool === "eraser") {
      setPixel(pos.x, pos.y, [0, 0, 0, 0]);
      return true;
    }
    if (tool === "fill") {
      return floodFill(pos.x, pos.y, rgba);
    }
    return false;
  }

  function generate() {
    if (!sourceImage) {
      setStatus("请先上传一张图片");
      return;
    }

    const { width, height, scale } = currentSize();
    widthInput.value = String(width);
    heightInput.value = String(height);
    if (isBlockMode() && autoScaleFromBlock) {
      const block = Pixelate.clampInt(blockSizeInput.value, 1, 32);
      scaleInput.value = String(Math.max(1, Math.min(16, block)));
    } else {
      scaleInput.value = String(scale);
    }

    setStatus("正在生成…");
    result = Pixelate.pixelateImage(sourceImage, {
      sizeMode: sizeMode.value,
      width,
      height,
      blockSize: blockSizeInput.value,
      maxOutput: Number(maxOutputSelect.value),
      palette: paletteSelect.value,
      colorCount: colorCountInput.value,
      sample: sampleSelect.value,
      outline: outlineToggle.checked,
      reconnect: reconnectToggle.checked,
      dither: ditherToggle.checked,
    });
    selected = null;
    undoStack = [];
    redoStack = [];
    updateUndoButtons();
    renderPaletteStrip(result.palette);
    renderPreview();
    exportSmallBtn.disabled = false;
    exportLargeBtn.disabled = false;
    editMeta.textContent = "点右侧格子选中，再改颜色。画笔可拖着涂，填充改整片同色。重新生成会覆盖手改。";
    updateModeUi();
    setStatus(`已生成 ${result.width}×${result.height} 像素图，可点格子手改`);
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("请选择图片文件");
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      sourcePreview.src = objectUrl;
      sourcePreview.hidden = false;
      sourcePlaceholder.hidden = true;
      fileName.textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight}`;
      initSizeFromImage();
      generate();
    };
    img.onerror = () => setStatus("图片读取失败，请换一张试试");
    img.src = objectUrl;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "");
        const comma = text.indexOf(",");
        resolve(comma >= 0 ? text.slice(comma + 1) : text);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function downloadBlob(blob, filename) {
    if (window.PixelBridge && typeof window.PixelBridge.saveFile === "function") {
      const base64 = await blobToBase64(blob);
      window.PixelBridge.saveFile(filename, base64, blob.type || "image/png");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportSmall() {
    if (!result) return;
    const canvas = Pixelate.imageDataToCanvas(result.imageData);
    const blob = await Pixelate.canvasToBlob(canvas);
    await downloadBlob(blob, `pixel-${result.width}x${result.height}.png`);
    setStatus(`已导出 pixel-${result.width}x${result.height}.png`);
  }

  async function exportLarge() {
    if (!result) return;
    const { scale } = currentSize();
    const canvas = document.createElement("canvas");
    Pixelate.drawUpscaled(canvas.getContext("2d"), result.imageData, scale, gridToggle.checked);
    const blob = await Pixelate.canvasToBlob(canvas);
    await downloadBlob(blob, `pixel-${result.width}x${result.height}-x${scale}.png`);
    setStatus(`已导出 pixel-${result.width}x${result.height}-x${scale}.png`);
  }

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) loadFile(file);
  });

  sizeMode.addEventListener("change", () => {
    autoScaleFromBlock = isBlockMode();
    updateModeUi();
    if (sourceImage) generate();
  });
  blockSizeInput.addEventListener("input", () => {
    autoScaleFromBlock = true;
    scheduleGenerate();
  });
  maxOutputSelect.addEventListener("change", () => {
    autoScaleFromBlock = true;
    if (sourceImage) generate();
  });
  widthInput.addEventListener("change", () => {
    applyAspectFromWidth();
    if (sourceImage) generate();
  });
  heightInput.addEventListener("change", () => {
    applyAspectFromHeight();
    if (sourceImage) generate();
  });
  lockRatio.addEventListener("change", () => {
    if (lockRatio.checked) applyAspectFromWidth();
    if (sourceImage) generate();
  });
  sampleSelect.addEventListener("change", () => {
    if (sourceImage) generate();
  });
  outlineToggle.addEventListener("change", () => {
    if (sourceImage) generate();
  });
  reconnectToggle.addEventListener("change", () => {
    if (sourceImage) generate();
  });
  paletteSelect.addEventListener("change", () => {
    updateModeUi();
    if (sourceImage) generate();
  });
  colorCountInput.addEventListener("input", scheduleGenerate);
  ditherToggle.addEventListener("change", () => {
    if (sourceImage) generate();
  });
  scaleInput.addEventListener("change", () => {
    autoScaleFromBlock = false;
    scaleInput.value = String(Pixelate.clampInt(scaleInput.value, 1, 64));
    renderPreview();
  });
  gridToggle.addEventListener("change", renderPreview);
  generateBtn.addEventListener("click", generate);
  exportSmallBtn.addEventListener("click", () => {
    exportSmall().catch(() => setStatus("导出失败"));
  });
  exportLargeBtn.addEventListener("click", () => {
    exportLarge().catch(() => setStatus("导出失败"));
  });

  toolRow.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tool]");
    if (!btn) return;
    setTool(btn.dataset.tool);
  });

  paintColor.addEventListener("focus", () => {
    colorUndoArmed = true;
  });
  paintAlpha.addEventListener("focus", () => {
    colorUndoArmed = true;
  });
  function applyPickerToSelected() {
    if (!result || !selected || currentTool !== "eyedropper") return;
    if (colorUndoArmed) {
      pushUndo();
      colorUndoArmed = false;
    }
    setPixel(selected.x, selected.y, currentPaintRgba());
    renderPreview();
    syncPickerFromSelected();
  }
  paintColor.addEventListener("input", applyPickerToSelected);
  paintAlpha.addEventListener("input", applyPickerToSelected);
  paintColor.addEventListener("change", () => {
    colorUndoArmed = false;
  });
  paintAlpha.addEventListener("change", () => {
    colorUndoArmed = false;
  });

  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);

  resultCanvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const pos = canvasToPixel(e);
    if (!pos) return;
    selected = pos;
    setTool("eyedropper");
    syncPickerFromSelected();
    renderPreview();
    setStatus(`已吸取 (${pos.x}, ${pos.y})`);
  });

  resultCanvas.addEventListener("pointerdown", (e) => {
    if (!result || e.button === 2) return;
    const pos = canvasToPixel(e);
    if (!pos) return;
    e.preventDefault();
    resultCanvas.setPointerCapture(e.pointerId);
    const altEyedrop = e.altKey || e.shiftKey;
    const tool = altEyedrop ? "eyedropper" : currentTool;
    if (tool !== "eyedropper") pushUndo();
    painting = tool === "brush" || tool === "eraser";
    const changed = applyAt(pos, tool, currentPaintRgba());
    if (tool === "eyedropper") {
      setStatus(`已选中 (${pos.x}, ${pos.y})，改左侧颜色即可`);
    } else if (changed) {
      setStatus(`已修改 (${pos.x}, ${pos.y})`);
    }
    renderPreview();
    if (tool !== "eyedropper") syncPickerFromSelected();
  });

  resultCanvas.addEventListener("pointermove", (e) => {
    if (!painting || !result) return;
    const pos = canvasToPixel(e);
    if (!pos) return;
    if (selected && selected.x === pos.x && selected.y === pos.y) return;
    applyAt(pos, currentTool, currentPaintRgba());
    renderPreview();
  });

  function stopPaint(e) {
    if (e && resultCanvas.hasPointerCapture(e.pointerId)) {
      resultCanvas.releasePointerCapture(e.pointerId);
    }
    painting = false;
  }
  resultCanvas.addEventListener("pointerup", stopPaint);
  resultCanvas.addEventListener("pointercancel", stopPaint);
  resultCanvas.addEventListener("lostpointercapture", () => {
    painting = false;
  });

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === "i" || key === "d") setTool("eyedropper");
    if (key === "b") setTool("brush");
    if (key === "g" || key === "f") setTool("fill");
    if (key === "e") setTool("eraser");
  });

  setTool("eyedropper");
  updateModeUi();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
