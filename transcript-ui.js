/* 拍照讀謄本介面。TRANSCRIPT_OCR_V1：不上傳、不寫入 localStorage。 */
(function () {
  "use strict";

  function el(id) { return document.getElementById(id); }

  function fmtNum(n, digits) {
    if (n == null || n === "" || !isFinite(Number(n))) return "";
    var d = digits == null ? 2 : digits;
    return String(Math.round(Number(n) * Math.pow(10, d)) / Math.pow(10, d));
  }

  function setVal(id, value) {
    var n = el(id);
    if (n) n.value = value == null || value === "" ? "" : String(value);
  }

  function numOf(id) {
    var T = window.Transcript;
    var v = T && T.normalize ? T.normalize(el(id).value) : el(id).value;
    v = String(v || "").replace(/,/g, "").trim();
    if (!v) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function fillForm(parsed, rawText, opts) {
    opts = opts || {};
    setVal("tr-address", parsed.address || "");
    setVal("tr-use", parsed.use || "");
    setVal("tr-material", parsed.material || "");
    setVal("tr-stories", parsed.stories || "");
    setVal("tr-floor", parsed.floor == null ? "" : parsed.floor);
    setVal("tr-date", parsed.completeDate && parsed.completeDate.raw ? parsed.completeDate.raw : "");
    setVal("tr-age", parsed.age == null ? "" : parsed.age);
    setVal("tr-type", parsed.suggestedType || "");
    setVal("tr-main-m2", parsed.mainM2 == null ? "" : parsed.mainM2);
    setVal("tr-main-ping", parsed.mainPing == null ? "" : parsed.mainPing);
    setVal("tr-att-m2", parsed.attachedM2 == null ? "" : parsed.attachedM2);
    setVal("tr-att-ping", parsed.attachedPing == null ? "" : parsed.attachedPing);
    setVal("tr-common-m2", parsed.commonM2 == null ? "" : parsed.commonM2);
    setVal("tr-common-share", parsed.commonShareText || (parsed.commonShare != null ? String(parsed.commonShare) : ""));
    setVal("tr-common-ping", parsed.commonSharePing == null ? "" : parsed.commonSharePing);
    setVal("tr-total-ping", parsed.totalPing == null ? "" : parsed.totalPing);
    setVal("tr-parking-m2", parsed.parkingM2 == null ? "" : parsed.parkingM2);
    setVal("tr-land-m2", parsed.landM2 == null ? "" : parsed.landM2);
    setVal("tr-land-share", parsed.landShareText || (parsed.landShare != null ? String(parsed.landShare) : ""));
    setVal("tr-land-ping", parsed.landPing == null ? "" : parsed.landPing);
    if (!opts.keepRaw) setVal("tr-raw", rawText || "");

    var box = el("tr-warnings");
    box.innerHTML = "";
    (parsed.warnings || []).forEach(function (w) {
      var p = document.createElement("div");
      p.className = "callout warn";
      p.textContent = w;
      box.appendChild(p);
    });
    el("transcript-result").hidden = false;
  }

  function recomputeFromFields() {
    var T = window.Transcript;
    if (!T) return;
    var mainM2 = numOf("tr-main-m2");
    var attM2 = numOf("tr-att-m2");
    var comM2 = numOf("tr-common-m2");
    var parkM2 = numOf("tr-parking-m2");
    var landM2 = numOf("tr-land-m2");
    var share = T.parseShare(el("tr-common-share").value);
    var landShare = T.parseShare(el("tr-land-share").value);
    if (mainM2 != null) setVal("tr-main-ping", T.m2ToPing(mainM2));
    if (attM2 != null) setVal("tr-att-ping", T.m2ToPing(attM2));
    if (comM2 != null && share) setVal("tr-common-ping", T.m2ToPing(comM2 * share.value));
    else if (comM2 == null && !el("tr-common-share").value) setVal("tr-common-ping", "");
    var total = 0;
    var has = false;
    if (mainM2 != null) { total += mainM2; has = true; }
    if (attM2 != null) { total += attM2; has = true; }
    if (comM2 != null && share) { total += comM2 * share.value; has = true; }
    if (has) setVal("tr-total-ping", T.m2ToPing(total));
    if (landM2 != null && landShare) setVal("tr-land-ping", T.m2ToPing(landM2 * landShare.value));
    void parkM2;
  }

  function applyToValuation() {
    if (!window.ValuationApp || !window.ValuationApp.applyFields) return;
    var typ = el("tr-type").value.trim();
    var allowed = { 不限: 1, 住宅大樓: 1, 華廈: 1, 公寓: 1, 透天厝: 1 };
    window.ValuationApp.applyFields({
      address: el("tr-address").value.trim(),
      ping: el("tr-total-ping").value.trim(),
      floor: el("tr-floor").value.trim(),
      age: el("tr-age").value.trim(),
      typ: allowed[typ] ? typ : undefined,
    });
    var form = document.getElementById("addr");
    if (form && form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearTranscript() {
    var raw = el("tr-raw");
    if (raw) raw.value = "";
    [
      "tr-address", "tr-use", "tr-material", "tr-stories", "tr-floor", "tr-date", "tr-age", "tr-type",
      "tr-main-m2", "tr-main-ping", "tr-att-m2", "tr-att-ping", "tr-common-m2", "tr-common-share",
      "tr-common-ping", "tr-total-ping", "tr-parking-m2", "tr-land-m2", "tr-land-share", "tr-land-ping",
    ].forEach(function (id) { setVal(id, ""); });
    el("tr-warnings").innerHTML = "";
    el("transcript-result").hidden = true;
    el("ocr-progress").hidden = true;
    el("transcript-camera").value = "";
    el("transcript-file").value = "";
  }

  function showProgress(info) {
    var box = el("ocr-progress");
    box.hidden = false;
    el("ocr-progress-text").textContent = (info && info.message) || "處理中…";
    var bar = el("ocr-progress-bar");
    if (info && typeof info.progress === "number") bar.style.width = Math.round(Math.max(0, Math.min(1, info.progress)) * 100) + "%";
    else bar.style.width = "15%";
  }

  function hideProgress() {
    el("ocr-progress").hidden = true;
  }

  function handleFile(file) {
    if (!file) return;
    showProgress({ message: "正在本機讀取檔案（不會上傳）…", progress: 0 });
    window.TranscriptOcr.extractFromFile(file, showProgress)
      .then(function (result) {
        var text = (result && result.text) || "";
        var parsed = window.Transcript.parseTranscript(text);
        fillForm(parsed, text);
        hideProgress();
        applyToValuation();
      })
      .catch(function (err) {
        hideProgress();
        el("transcript-result").hidden = false;
        el("tr-warnings").innerHTML = "";
        var p = document.createElement("div");
        p.className = "callout danger";
        p.textContent = (err && err.message) ? err.message : "辨識失敗。請改選較清晰的照片或可複製文字的 PDF。謄本未被上傳。";
        el("tr-warnings").appendChild(p);
      })
      .then(function () {
        el("transcript-camera").value = "";
        el("transcript-file").value = "";
      });
  }

  function bind() {
    el("transcript-camera").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      handleFile(f);
    });
    el("transcript-file").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      handleFile(f);
    });
    el("tr-apply").addEventListener("click", function (e) {
      e.preventDefault();
      recomputeFromFields();
      applyToValuation();
    });
    el("tr-reparse").addEventListener("click", function (e) {
      e.preventDefault();
      var text = el("tr-raw").value;
      var parsed = window.Transcript.parseTranscript(text);
      fillForm(parsed, text, { keepRaw: true });
      applyToValuation();
    });
    el("tr-clear").addEventListener("click", function (e) {
      e.preventDefault();
      clearTranscript();
    });
    ["tr-main-m2", "tr-att-m2", "tr-common-m2", "tr-common-share", "tr-land-m2", "tr-land-share"].forEach(function (id) {
      el(id).addEventListener("input", recomputeFromFields);
    });
    window.addEventListener("pagehide", clearTranscript);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
