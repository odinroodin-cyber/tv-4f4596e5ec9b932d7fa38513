/* 本機 OCR／PDF 文字擷取。謄本檔案不會上傳到任何伺服器。 */
(function (root) {
  "use strict";

  var TESS_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  var TESS_WORKER = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js";
  var TESS_CORE = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-lstm.wasm.js";
  var LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0_fast";
  var PDF_SRC = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
  var PDF_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  var KEYWORDS = /門牌|平方公|主要用途|主要建材|建築完成|權利範圍|層次|層數|謄本|共有部分|主建物/;
  var MAX_PAGES = 8;
  var worker = null;
  var workerLoading = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var found = document.querySelector('script[data-ocr-src="' + src + '"]');
      if (found && found.getAttribute("data-ocr-ready") === "1") return resolve();
      if (found) {
        found.addEventListener("load", function () { resolve(); });
        found.addEventListener("error", function () { reject(new Error("無法載入 " + src)); });
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.setAttribute("data-ocr-src", src);
      s.onload = function () {
        s.setAttribute("data-ocr-ready", "1");
        resolve();
      };
      s.onerror = function () { reject(new Error("無法載入辨識程式（CDN）。謄本本身並未上傳。")); };
      document.head.appendChild(s);
    });
  }

  function progress(cb, message, value) {
    if (cb) cb({ message: message, progress: value == null ? null : value });
  }

  function ensureTess(cb) {
    if (worker) return Promise.resolve(worker);
    if (workerLoading) return workerLoading;
    workerLoading = loadScript(TESS_SRC)
      .then(function () {
        progress(cb, "正在載入中文辨識語系（僅程式，不上傳謄本）…", 0);
        return window.Tesseract.createWorker("chi_tra+eng", 1, {
          workerPath: TESS_WORKER,
          corePath: TESS_CORE,
          langPath: LANG_PATH,
          logger: function (m) {
            if (!m || !cb) return;
            var label = m.status === "loading tesseract core" ? "載入辨識核心"
              : m.status === "loading language traineddata" ? "載入中文／英文語系"
              : m.status === "initializing tesseract" || m.status === "initializing api" ? "初始化辨識引擎"
              : m.status === "recognizing text" ? "正在辨識文字"
              : null;
            if (label) progress(cb, label + "…", typeof m.progress === "number" ? m.progress : null);
          },
        });
      })
      .then(function (w) {
        worker = w;
        workerLoading = null;
        return w;
      })
      .catch(function (err) {
        workerLoading = null;
        throw err;
      });
    return workerLoading;
  }

  function ensurePdf() {
    return loadScript(PDF_SRC).then(function () {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      }
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("無法讀取圖片"));
      };
      img.src = url;
    });
  }

  function imageToCanvas(img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var max = 2000;
    var scale = w > max ? max / w : 1;
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function releaseCanvas(canvas) {
    if (!canvas) return;
    canvas.width = 1;
    canvas.height = 1;
  }

  function ocrCanvas(canvas, cb, label) {
    return ensureTess(cb).then(function (w) {
      progress(cb, label || "正在辨識文字…", 0);
      return w.recognize(canvas).then(function (res) {
        return (res && res.data && res.data.text) || "";
      });
    });
  }

  function extractImage(file, cb) {
    return loadImage(file).then(function (img) {
      var canvas = imageToCanvas(img);
      img.src = "";
      return ocrCanvas(canvas, cb, "正在辨識圖片中的文字…").then(function (text) {
        releaseCanvas(canvas);
        return { text: text, source: "ocr-image" };
      });
    });
  }

  function pageText(page) {
    return page.getTextContent().then(function (tc) {
      var items = (tc && tc.items) || [];
      var parts = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].str) parts.push(items[i].str);
      }
      return parts.join(" ");
    });
  }

  function renderPage(page, scale) {
    var viewport = page.getViewport({ scale: scale || 2 });
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
      return canvas;
    });
  }

  function extractPdf(file, cb) {
    return ensurePdf()
      .then(function () {
        progress(cb, "正在讀取 PDF 文字層…", 0);
        return file.arrayBuffer();
      })
      .then(function (buf) {
        var data = new Uint8Array(buf);
        return window.pdfjsLib.getDocument({ data: data }).promise;
      })
      .then(function (pdf) {
        var n = Math.min(pdf.numPages, MAX_PAGES);
        var texts = [];
        var seq = Promise.resolve();
        var i;
        function makeText(i) {
          return function () {
            return pdf.getPage(i).then(pageText).then(function (t) {
              texts.push(t || "");
            });
          };
        }
        for (i = 1; i <= n; i++) seq = seq.then(makeText(i));
        return seq.then(function () {
          var joined = texts.join("\n");
          var hits = (joined.match(/門牌|平方公|主要用途|建築完成|權利範圍|層次|層數|共有部分|主建物/g) || []).length;
          if (joined.replace(/\s+/g, "").length >= 80 && hits >= 2) {
            progress(cb, "已使用 PDF 文字層（未做圖片辨識）", 1);
            return pdf.destroy().then(function () {
              return { text: joined, source: "pdf-text" };
            });
          }
          var ocrParts = [];
          var pages = Promise.resolve();
          function makeOcr(i) {
            return function () {
              progress(cb, "文字層不足，改在本機辨識第 " + i + "／" + n + " 頁…", (i - 1) / n);
              return pdf.getPage(i).then(function (page) {
                return renderPage(page, 2).then(function (canvas) {
                  return ocrCanvas(canvas, cb, "正在辨識第 " + i + "／" + n + " 頁…").then(function (t) {
                    releaseCanvas(canvas);
                    ocrParts.push(t || "");
                  });
                });
              });
            };
          }
          for (i = 1; i <= n; i++) pages = pages.then(makeOcr(i));
          return pages.then(function () {
            var more = pdf.numPages > MAX_PAGES ? "\n（僅辨識前 " + MAX_PAGES + " 頁）" : "";
            return pdf.destroy().then(function () {
              return { text: ocrParts.join("\n") + more, source: "ocr-pdf" };
            });
          });
        });
      });
  }

  function extractFromFile(file, cb) {
    if (!file) return Promise.reject(new Error("未選擇檔案"));
    var isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (isPdf) return extractPdf(file, cb);
    if (file.type && file.type.indexOf("image/") !== 0 && !/\.(png|jpe?g|webp|gif|bmp|tif?f)$/i.test(file.name || "")) {
      return Promise.reject(new Error("請選擇圖片或 PDF"));
    }
    return extractImage(file, cb);
  }

  window.addEventListener("pagehide", function () {
    if (worker) {
      try { worker.terminate(); } catch (e) {}
      worker = null;
    }
  });

  root.TranscriptOcr = {
    extractFromFile: extractFromFile,
    KEYWORDS: KEYWORDS,
  };
})(typeof window !== "undefined" ? window : this);
