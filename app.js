/* 台北市簡易估價：官方實價登錄比較（純前端） */
(function () {
  "use strict";

  var TIER_NAME = ["", "同路段近號", "同路段", "同路其他段", "行政區近似"];
  var DEFAULT_ADDR = "台北市內湖區民權東路六段173號9樓";
  var CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  var data = null;

  function fw(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 0x3000) out += " ";
      else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0);
      else out += s.charAt(i);
    }
    out = out.split("～").join("~").split("—").join("-").split("台北市").join("臺北市");
    var res = "";
    for (var j = 0; j < out.length; j++) {
      if (
        j > 0 &&
        j + 1 < out.length &&
        out.charAt(j) === "至" &&
        out.charAt(j - 1) >= "0" &&
        out.charAt(j - 1) <= "9" &&
        out.charAt(j + 1) >= "0" &&
        out.charAt(j + 1) <= "9"
      ) {
        res += "~";
      } else {
        res += out.charAt(j);
      }
    }
    return res;
  }

  function compact(s) {
    var o = "";
    var t = fw(s);
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) o += t.charAt(i);
    }
    return o;
  }

  function isIntStr(s) {
    if (!s) return false;
    var i = 0;
    if (s.charAt(0) === "-") i = 1;
    if (i >= s.length) return false;
    for (; i < s.length; i++) {
      if (s.charAt(i) < "0" || s.charAt(i) > "9") return false;
    }
    return true;
  }

  function cnNum(s) {
    var t = fw(s).trim();
    if (!t) return null;
    if (isIntStr(t)) return parseInt(t, 10);
    var n = 0;
    var rest = t;
    if (rest.indexOf("廿") === 0) {
      n = 20;
      rest = rest.slice(1);
    }
    var ten = rest.indexOf("十");
    if (ten >= 0) {
      var leftS = rest.slice(0, ten);
      var rightS = rest.slice(ten + 1);
      var left = leftS === "" ? 1 : CN.hasOwnProperty(leftS) ? CN[leftS] : Number(leftS);
      var right = rightS === "" ? 0 : CN.hasOwnProperty(rightS) ? CN[rightS] : Number(rightS);
      if (!isFinite(left) || !isFinite(right)) return null;
      return n + left * 10 + right;
    }
    if (CN.hasOwnProperty(rest)) return n + CN[rest];
    return null;
  }

  function parseFloorToken(s) {
    var t = fw(s);
    var under = t.indexOf("地下");
    if (under >= 0) {
      var j = under + 2;
      var tok = "";
      while (j < t.length && t.charAt(j) !== "樓" && t.charAt(j) !== "層") {
        tok += t.charAt(j);
        j++;
      }
      var n = tok ? cnNum(tok) : 1;
      return n ? -Math.abs(n) : -1;
    }
    var marks = ["樓", "層", "F", "f"];
    for (var m = 0; m < marks.length; m++) {
      var i = t.indexOf(marks[m]);
      if (i <= 0) continue;
      var k = i - 1;
      var tok2 = "";
      while (k >= 0 && "一二三四五六七八九十廿0123456789".indexOf(t.charAt(k)) >= 0) {
        tok2 = t.charAt(k) + tok2;
        k--;
      }
      if (tok2) return cnNum(tok2);
    }
    return null;
  }

  function parseNum(s) {
    var t = fw(String(s || "")).trim();
    if (!t) return null;
    var n = Number(t);
    return isFinite(n) ? n : null;
  }

  function stemOf(road) {
    var marks = "一二三四五六七八九十0123456789";
    if (road.slice(-1) !== "段") return road;
    var i = road.length - 2;
    while (i >= 0 && marks.indexOf(road.charAt(i)) >= 0) i--;
    return road.slice(0, i + 1);
  }

  function rangeDist(a0, a1, b0, b1) {
    if (a1 < b0) return b0 - a1;
    if (b1 < a0) return a0 - b1;
    return 0;
  }

  function pct(arr, p) {
    var a = arr.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return NaN;
    var i = (a.length - 1) * p;
    var lo = Math.floor(i);
    var hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }

  function fmt1(n) {
    return (Math.round(n * 10) / 10).toLocaleString("zh-Hant-TW", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  function fmt0(n) {
    return Math.round(n).toLocaleString("zh-Hant-TW");
  }

  function ymLabel(ym) {
    var m = String(ym % 100);
    return String(Math.floor(ym / 100)) + "/" + (m.length < 2 ? "0" + m : m);
  }

  function floorLabel(fl, fh) {
    if (fl === -99) return "—";
    function one(n) {
      return n < 0 ? "地下" + String(Math.abs(n)) : String(n) + "樓";
    }
    if (fl === fh) return one(fl);
    if (fl < 0 && fh > 0) return "地下" + String(Math.abs(fl)) + "–" + String(fh) + "樓";
    return one(fl).replace("樓", "") + "–" + one(fh);
  }

  function inferDist(road, stem, sec) {
    var hits = {};
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      var name = data.roads[r[1]];
      if (name === road || (!sec && (name === stem || name.indexOf(stem) === 0))) {
        hits[data.dists[r[0]]] = true;
      }
    }
    var list = Object.keys(hits);
    if (list.length === 1) return { dist: list[0] };
    if (list.length > 1) return { dist: null, err: "此路段出現在" + list.join("、") + "，請補上行政區" };
    return { dist: null, err: "請補上行政區（例如內湖區）。目前僅涵蓋臺北市十二區。" };
  }

  function parseAddress(raw) {
    var empty = { dist: null, road: null, roadStem: null, sec: "", lane: null, alley: null, n0: null, n1: null, floor: null };
    var t0 = compact(raw);
    if (!t0) return Object.assign({}, empty, { err: "請輸入門牌，例如臺北市內湖區民權東路六段173號9樓" });
    var dm = t0.match(/臺北市?([^市 ]{2,3}區)/) || t0.match(/([^市 ]{2,3}區)/);
    var dist = dm ? dm[1] : null;
    var loc = t0;
    if (dm) loc = t0.slice(t0.indexOf(dm[0]) + dm[0].length);
    var rm = loc.match(/([^ 0-9巷弄號]+?(?:路|街|大道|道))((?:[一二三四五六七八九十0-9]+段)?)/);
    var floor = parseFloorToken(t0);
    if (!rm) return Object.assign({}, empty, { dist: dist, floor: floor, err: "無法辨識路名，請至少輸入行政區與路名" });
    var stem = rm[1];
    var sec = rm[2] || "";
    var rest = loc.slice(loc.indexOf(rm[0]) + rm[0].length);
    var lm = rest.match(/([0-9]+)巷/);
    var am = rest.match(/([0-9]+)弄/);
    var n0 = null;
    var n1 = null;
    var nm = rest.match(/([0-9]+)(?:~([0-9]+))?號/);
    if (nm) {
      var a = parseInt(nm[1], 10);
      var b = nm[2] ? parseInt(nm[2], 10) : a;
      n0 = Math.min(a, b);
      n1 = Math.max(a, b);
    }
    var road = stem + sec;
    var parsed = {
      dist: dist,
      road: road,
      roadStem: stem,
      sec: sec,
      lane: lm ? Number(lm[1]) : null,
      alley: am ? Number(am[1]) : null,
      n0: n0,
      n1: n1,
      floor: floor,
    };
    if (dist && data.dists.indexOf(dist) < 0) {
      parsed.err = "目前僅涵蓋臺北市十二區";
      return parsed;
    }
    if (!dist) {
      var inferred = inferDist(road, stem, sec);
      parsed.dist = inferred.dist;
      if (!parsed.dist) parsed.err = inferred.err;
    }
    return parsed;
  }

  function evaluate(parsed, ping, floor, age, typ, includeSpecial) {
    if (parsed.err) return { error: parsed.err, used: [], usedTier: 0, typeRelaxed: false, sizeNote: false, trimmed: false, p25: NaN, med: NaN, p75: NaN, nUnits: 0, trend: [] };
    if (!parsed.dist || !parsed.road) return { error: "請輸入行政區與路名", used: [], usedTier: 0, typeRelaxed: false, sizeNote: false, trimmed: false, p25: NaN, med: NaN, p75: NaN, nUnits: 0, trend: [] };
    var di = data.dists.indexOf(parsed.dist);
    if (di < 0) return { error: "目前僅涵蓋臺北市十二區", used: [], usedTier: 0, typeRelaxed: false, sizeNote: false, trimmed: false, p25: NaN, med: NaN, p75: NaN, nUnits: 0, trend: [] };
    var stem = parsed.roadStem || stemOf(parsed.road);
    var wantType = typ !== "不限" ? typ : "";
    var all = [];
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      if (r[0] !== di) continue;
      var flag = r[14];
      if (!includeSpecial && (flag & 1)) continue;
      var rname = data.roads[r[1]];
      var rstem = stemOf(rname);
      var n0 = r[2];
      var n1 = r[3];
      var lane = r[4];
      var ym = r[5];
      var fl = r[6];
      var fh = r[7];
      var ti = r[9];
      var recAge = r[10];
      var recPing = r[11] / 10;
      var unit = r[12] / 10;
      var tot = r[13];
      var recType = ti >= 0 ? data.types[ti] : "—";
      var sameSec = rname === parsed.road;
      var sameStem = rstem === stem;
      var userHasLane = parsed.lane != null;
      var recHasLane = lane >= 0;
      var laneExact = (userHasLane && recHasLane && lane === parsed.lane) || (!userHasLane && !recHasLane);
      var tier = 4;
      var score = 0;
      if (sameSec) {
        var nd = 9999;
        if (parsed.n0 != null && n0 >= 0) {
          nd = rangeDist(n0, n1 >= 0 ? n1 : n0, parsed.n0, parsed.n1 != null ? parsed.n1 : parsed.n0);
        }
        if (laneExact && nd <= 30) { tier = 1; score = 1000 - nd; }
        else if (laneExact && nd <= 80) { tier = 1; score = 850 - nd; }
        else if (laneExact) { tier = 2; score = 700 - Math.min(nd, 500) / 10; }
        else if (!userHasLane && recHasLane) { tier = 2; score = 500; }
        else if (userHasLane && !recHasLane) { tier = 2; score = 480; }
        else { tier = 2; score = 420; }
      } else if (sameStem) {
        tier = 3;
        score = 250;
      } else {
        tier = 4;
        if (ping != null && recPing > 0) {
          var ratio = recPing / ping;
          if (ratio < 0.5 || ratio > 2) continue;
          score = 80 - Math.abs(Math.log(ratio)) * 40;
        } else score = 50;
      }
      if (wantType && recType === wantType) score += 25;
      else if (wantType && recType !== wantType && tier === 4) continue;
      if (age != null && recAge >= 0) {
        var dAge = Math.abs(recAge - age);
        if (dAge <= 10) score += 12;
        else if (dAge <= 20) score += 6;
        else if (tier === 4) score -= 10;
      }
      if (floor != null && fl !== -99) {
        var mid = (fl + (fh === -99 ? fl : fh)) / 2;
        var dFl = Math.abs(mid - floor);
        if (dFl <= 2) score += 8;
        else if (dFl <= 5) score += 4;
      }
      score += (ym - 200000) / 500;
      all.push({
        addr: String(r[15]),
        dist: data.dists[di],
        road: rname,
        ym: ym,
        typ: recType,
        fl: floorLabel(fl, fh),
        age: recAge >= 0 ? String(recAge) : "—",
        ping: recPing,
        unit: unit,
        tot: tot,
        special: !!(flag & 1),
        park: !!(flag & 2),
        tier: tier,
        score: score,
      });
    }
    all.sort(function (a, b) {
      return a.tier - b.tier || b.score - a.score || b.ym - a.ym;
    });
    var pool = all;
    var typeRelaxed = false;
    if (wantType) {
      var typedRoad = all.filter(function (c) { return c.typ === wantType && c.tier <= 3; });
      var anyRoad = all.filter(function (c) { return c.tier <= 3; });
      if (typedRoad.length >= 3) pool = all.filter(function (c) { return c.typ === wantType || c.tier === 4; });
      else if (anyRoad.length > typedRoad.length) typeRelaxed = true;
    }
    var used = pool.filter(function (c) { return c.tier <= 2; });
    if (used.length < 3) used = pool.filter(function (c) { return c.tier <= 3; });
    if (used.length < 3) used = used.concat(pool.filter(function (c) { return c.tier === 4; }).slice(0, 15));
    else used = used.slice(0, 40);
    var usedTier = 0;
    for (var u = 0; u < used.length; u++) if (used[u].tier > usedTier) usedTier = used[u].tier;
    var estBase = used;
    var sizeNote = false;
    if (ping != null && used.length >= 4) {
      var close = used.filter(function (c) { return c.ping >= ping * 0.6 && c.ping <= ping * 1.7; });
      if (close.length >= 3) {
        estBase = close;
        sizeNote = close.length < used.length;
      }
    }
    var units = estBase.map(function (c) { return c.unit; }).filter(function (v) { return v > 0; });
    var trimmed = false;
    if (units.length >= 5) {
      var midU = pct(units, 0.5);
      var kept = units.filter(function (v) { return v >= midU * 0.55 && v <= midU * 1.8; });
      if (kept.length >= 3 && kept.length < units.length) {
        units = kept;
        trimmed = true;
      }
    }
    var byYm = {};
    for (var t = 0; t < used.length; t++) {
      var key = used[t].ym;
      if (!byYm[key]) byYm[key] = [];
      byYm[key].push(used[t].unit);
    }
    var yms = Object.keys(byYm).map(Number).sort(function (a, b) { return a - b; });
    var trend = yms.map(function (ym) {
      return { label: ymLabel(ym), value: Math.round(pct(byYm[ym], 0.5) * 10) / 10 };
    });
    return {
      used: used,
      usedTier: usedTier,
      typeRelaxed: typeRelaxed,
      sizeNote: sizeNote,
      trimmed: trimmed,
      p25: units.length ? pct(units, 0.25) : NaN,
      med: units.length ? pct(units, 0.5) : NaN,
      p75: units.length ? pct(units, 0.75) : NaN,
      nUnits: units.length,
      trend: trend,
    };
  }

  function el(id) { return document.getElementById(id); }

  function setHtml(id, html) { el(id).innerHTML = html; }

  function escapeHtml(s) {
    return String(s)
      .split("&").join("&amp;")
      .split("<").join("&lt;")
      .split(">").join("&gt;")
      .split('"').join("&quot;");
  }

  function drawTrend(points) {
    var box = el("trend-box");
    if (!points || points.length < 2) {
      box.innerHTML = '<p class="muted">比較案例的時間點不足，無法畫走勢。</p>';
      return;
    }
    var w = 720, h = 260, padL = 48, padR = 16, padT = 16, padB = 36;
    var maxV = 0;
    for (var i = 0; i < points.length; i++) if (points[i].value > maxV) maxV = points[i].value;
    var ceil = Math.max(10, Math.ceil((maxV * 1.15) / 5) * 5);
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    function x(i) { return padL + (points.length === 1 ? innerW / 2 : (i * innerW) / (points.length - 1)); }
    function y(v) { return padT + innerH * (1 - v / ceil); }
    var d = "";
    for (var p = 0; p < points.length; p++) {
      d += (p === 0 ? "M" : "L") + x(p).toFixed(1) + " " + y(points[p].value).toFixed(1) + " ";
    }
    var dots = "";
    var labels = "";
    for (var q = 0; q < points.length; q++) {
      dots += '<circle cx="' + x(q).toFixed(1) + '" cy="' + y(points[q].value).toFixed(1) + '" r="3.5" fill="#0f6e56"/>';
      var show = points.length <= 8 || q === 0 || q === points.length - 1 || q % Math.ceil(points.length / 8) === 0;
      if (show) {
        labels += '<text x="' + x(q).toFixed(1) + '" y="' + (h - 12) + '" text-anchor="middle" class="axis">' + escapeHtml(points[q].label) + "</text>";
      }
    }
    var grid = "";
    for (var g = 0; g <= 4; g++) {
      var gv = (ceil * g) / 4;
      var gy = y(gv);
      grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + gy.toFixed(1) + '" class="grid"/>';
      grid += '<text x="' + (padL - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" class="axis">' + fmt0(gv) + "</text>";
    }
    box.innerHTML =
      '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="月中位單價走勢">' +
      grid +
      '<path d="' + d + '" fill="none" stroke="#0f6e56" stroke-width="2"/>' +
      dots +
      labels +
      "</svg>" +
      '<p class="muted">單位：萬/坪；以已選比較案例的月中位單價繪製，不是全市走勢。</p>';
  }

  function render() {
    if (!data) return;
    var addr = el("addr").value;
    var ping = parseNum(el("ping").value);
    var floorIn = parseNum(el("floor").value);
    var age = parseNum(el("age").value);
    var typ = el("typ").value;
    var includeSpecial = el("special").checked;
    var parsed = parseAddress(addr);
    if (floorIn == null) floorIn = parsed.floor;

    var noRange = "";
    if (parsed.n0 != null) {
      noRange = String(parsed.n0) + (parsed.n1 != null && parsed.n1 !== parsed.n0 ? "–" + String(parsed.n1) : "") + "號";
    }
    var laneAlley = "";
    if (parsed.lane != null) laneAlley += String(parsed.lane) + "巷";
    if (parsed.alley != null) laneAlley += String(parsed.alley) + "弄";
    el("parse-dist").textContent = parsed.dist || "—";
    el("parse-road").textContent = parsed.road || "—";
    el("parse-no").textContent = (laneAlley + noRange) || "—";
    el("parse-floor").textContent = parsed.floor != null ? String(parsed.floor) + "樓" : "—";

    var notes = el("notes");
    notes.innerHTML = "";
    var result = evaluate(parsed, ping, floorIn, age, typ, includeSpecial);
    var hasEstimate = !result.error && result.nUnits > 0;

    if (parsed.err) {
      notes.innerHTML = '<div class="callout danger"><strong>無法試算。</strong> ' + escapeHtml(parsed.err) + "</div>";
    }

    if (result.error && !parsed.err) {
      setHtml("metrics", "<p>" + escapeHtml(result.error) + "</p>");
    } else if (!hasEstimate) {
      setHtml(
        "metrics",
        '<div class="callout warn"><strong>找不到比較案例。</strong> 本批官方資料中，此地址所在區與篩選條件下沒有可用的房地買賣。請改路段、取消類型篩選，或納入特殊交易再試。不會填造數字。</div>'
      );
    } else {
      var unitRange = result.nUnits >= 2 ? fmt1(result.p25) + "–" + fmt1(result.p75) : "僅 1 筆，不作區間";
      var total =
        ping != null && result.nUnits >= 2
          ? fmt0(result.p25 * ping) + "–" + fmt0(result.p75 * ping) + " 萬"
          : ping != null && result.nUnits === 1
            ? "約 " + fmt0(result.med * ping) + " 萬"
            : "請補上坪數";
      var midTotal = ping != null && result.nUnits >= 2 ? "中位約 " + fmt0(result.med * ping) + " 萬" : "不含車位價（若已拆淨）";
      setHtml(
        "metrics",
        '<div class="metrics">' +
          '<div class="metric"><div class="k">單價中位數</div><div class="v">' + fmt1(result.med) + ' 萬/坪</div><div class="d">依 ' + result.nUnits + " 筆比較案例</div></div>" +
          '<div class="metric' + (result.nUnits >= 3 ? "" : " warn") + '"><div class="k">單價區間</div><div class="v">' + escapeHtml(unitRange) + '</div><div class="d">' + (result.nUnits >= 3 ? "第 25–75 百分位，萬/坪" : "樣本偏少，僅供參考") + "</div></div>" +
          '<div class="metric"><div class="k">' + (ping != null ? "總價估計（" + fmt1(ping) + " 坪）" : "總價估計") + '</div><div class="v">' + escapeHtml(total) + '</div><div class="d">' + escapeHtml(midTotal) + "</div></div>" +
          '<div class="metric"><div class="k">比較層級</div><div class="v">' + escapeHtml(TIER_NAME[result.usedTier] || "—") + '</div><div class="d">表列 ' + result.used.length + " 筆</div></div>" +
          "</div>"
      );
      var extra = "";
      if (result.usedTier >= 3) {
        extra += '<div class="callout warn"><strong>比較層級較寬。</strong> 同路段、相近門牌的案例不足，已退到「' + escapeHtml(TIER_NAME[result.usedTier]) + "」。區間僅供參考，不宜當作精確估價。</div>";
      }
      if (result.typeRelaxed) extra += "<p>所選類型的同路段案例不足，已放寬為不限類型。</p>";
      if (result.sizeNote) extra += "<p>單價區間主要參照與輸入坪數較接近的案例（0.6–1.7 倍）；下表仍列出全部已選比較成交。</p>";
      if (result.trimmed) extra += "<p>估算時已除掉與中位數相差過大的極端單價，仍保留在比較表供查。</p>";
      if (parsed.road === "民權東路六段" && parsed.n0 === 173 && !parsed.lane) {
        extra += '<div class="callout info"><strong>關於這個範例地址。</strong> 本批官方資料未見內湖區民權東路六段173號（大衛朵夫）2021、2024 年成交，僅能以同路段其他號或巷弄為參考，戶型與樓中樓差異可能很大。</div>';
      }
      notes.innerHTML += extra;
    }

    var rows = result.used || [];
    if (!rows.length) {
      setHtml("comps", '<p class="muted">沒有可列的比較成交。</p>');
    } else {
      var html = '<div class="table-wrap"><table><thead><tr><th>成交年月</th><th>門牌</th><th>類型</th><th>樓層</th><th>屋齡</th><th>坪數</th><th>單價</th><th>總價</th><th>比較層</th><th>註記</th></tr></thead><tbody>';
      for (var r = 0; r < rows.length; r++) {
        var c = rows[r];
        var note = [c.special ? "特殊交易" : "", c.park ? "車位未拆淨" : ""].filter(Boolean).join("；") || "—";
        html +=
          "<tr><td>" +
          escapeHtml(ymLabel(c.ym)) +
          "</td><td>" +
          escapeHtml(c.dist + c.addr) +
          "</td><td>" +
          escapeHtml(c.typ) +
          '</td><td class="num">' +
          escapeHtml(c.fl) +
          '</td><td class="num">' +
          escapeHtml(c.age) +
          '</td><td class="num">' +
          fmt1(c.ping) +
          '</td><td class="num">' +
          fmt1(c.unit) +
          '</td><td class="num">' +
          fmt0(c.tot) +
          "</td><td>" +
          escapeHtml(TIER_NAME[c.tier]) +
          "</td><td>" +
          escapeHtml(note) +
          "</td></tr>";
      }
      html += "</tbody></table></div>";
      setHtml("comps", html);
    }
    drawTrend(result.trend || []);
  }

  function fillCoverage() {
    var years = Object.keys(data.meta.years).sort().map(function (y) {
      return y + "年 " + data.meta.years[y] + " 筆";
    }).join("、");
    var dists = data.dists.map(function (d) {
      return d + " " + (data.meta.distCounts[d] || 0);
    }).join("、");
    el("cov-n").textContent = String(data.meta.n);
    el("cov-roads").textContent = String(data.roads.length);
    el("cov-years").textContent = ymLabel(data.meta.ym[0]) + "–" + ymLabel(data.meta.ym[1]) + "；按年：" + years + "。";
    el("cov-dists").textContent = dists + "。";
  }

  function resetExample() {
    el("addr").value = DEFAULT_ADDR;
    el("ping").value = "123.66";
    el("floor").value = "9";
    el("age").value = "20";
    el("typ").value = "不限";
    el("special").checked = false;
    render();
  }

  function bind() {
    ["addr", "ping", "floor", "age", "typ", "special"].forEach(function (id) {
      el(id).addEventListener("input", render);
      el(id).addEventListener("change", render);
    });
    el("reset").addEventListener("click", function (e) {
      e.preventDefault();
      resetExample();
    });
  }

  fetch("data/taipei_sales.json")
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (json) {
      data = json;
      el("loading").hidden = true;
      el("app").hidden = false;
      fillCoverage();
      resetExample();
      bind();
    })
    .catch(function () {
      el("loading").hidden = true;
      el("load-error").hidden = false;
    });
})();
