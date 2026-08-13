(function () {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  const fileName = document.getElementById("file-name");
  const widthInput = document.getElementById("width-input");
  const heightInput = document.getElementById("height-input");
  const lockRatio = document.getElementById("lock-ratio");
  const sampleSelect = document.getElementById("sample-select");
  const outlineToggle = document.getElementById("outline-toggle");
  const reconnectToggle = document.getElementById("reconnect-toggle");
  const paletteSelect = document.getElementById("palette-select");
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

  let sourceImage = null;
  let objectUrl = null;
  let result = null;
  let syncingRatio = false;

  function setStatus(text) {
    statusText.textContent = text;
  }

  function currentSize() {
    return {
      width: Pixelate.clampInt(widthInput.value, 1, 256),
      height: Pixelate.clampInt(heightInput.value, 1, 256),
      scale: Pixelate.clampInt(scaleInput.value, 1, 64),
    };
  }

  function applyAspectFromWidth() {
    if (!sourceImage || !lockRatio.checked || syncingRatio) return;
    syncingRatio = true;
    const aspect = sourceImage.naturalWidth / sourceImage.naturalHeight;
    const w = Pixelate.clampInt(widthInput.value, 1, 256);
    heightInput.value = String(Pixelate.clampInt(Math.round(w / aspect), 1, 256));
    widthInput.value = String(w);
    syncingRatio = false;
  }

  function applyAspectFromHeight() {
    if (!sourceImage || !lockRatio.checked || syncingRatio) return;
    syncingRatio = true;
    const aspect = sourceImage.naturalWidth / sourceImage.naturalHeight;
    const h = Pixelate.clampInt(heightInput.value, 1, 256);
    widthInput.value = String(Pixelate.clampInt(Math.round(h * aspect), 1, 256));
    heightInput.value = String(h);
    syncingRatio = false;
  }

  function initSizeFromImage() {
    if (!sourceImage) return;
    syncingRatio = true;
    const aspect = sourceImage.naturalWidth / sourceImage.naturalHeight;
    const width = 32;
    const height = Pixelate.clampInt(Math.round(width / aspect), 1, 256);
    widthInput.value = String(width);
    heightInput.value = String(height);
    syncingRatio = false;
  }

  function renderPaletteStrip(palette) {
    paletteStrip.replaceChildren();
    if (!palette || !palette.length) return;
    const frag = document.createDocumentFragment();
    palette.forEach((c) => {
      const swatch = document.createElement("span");
      swatch.title = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      swatch.style.background = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
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
    resultCanvas.hidden = false;
    resultPlaceholder.hidden = true;
    resultMeta.textContent = `${result.width}×${result.height} · ×${scale}${showGrid ? " · 格线" : ""}`;
  }

  function generate() {
    if (!sourceImage) {
      setStatus("请先上传一张图片");
      return;
    }

    const { width, height, scale } = currentSize();
    widthInput.value = String(width);
    heightInput.value = String(height);
    scaleInput.value = String(scale);

    setStatus("正在生成…");
    result = Pixelate.pixelateImage(sourceImage, {
      width,
      height,
      palette: paletteSelect.value,
      sample: sampleSelect.value,
      outline: outlineToggle.checked,
      reconnect: reconnectToggle.checked,
    });
    renderPaletteStrip(result.palette);
    renderPreview();
    exportSmallBtn.disabled = false;
    exportLargeBtn.disabled = false;
    setStatus(`已生成 ${result.width}×${result.height} 像素图`);
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
    if (sourceImage) generate();
  });
  scaleInput.addEventListener("change", () => {
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

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
