/* 台灣土地／建物登記謄本欄位解析（純前端，不含 OCR） */
(function (root) {
  "use strict";

  var M2_TO_PING = 0.3025;
  var CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  function normalize(s) {
    s = String(s == null ? "" : s);
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 0x3000) out += " ";
      else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0);
      else out += s.charAt(i);
    }
    return out
      .replace(/[～〜]/g, "~")
      .replace(/[—–]/g, "-")
      .replace(/台北/g, "臺北")
      .replace(/平方米/g, "平方公尺")
      .replace(/平方公呎/g, "平方公尺")
      .replace(/㎡|m²|m2/gi, "平方公尺")
      .replace(/／/g, "/");
  }

  function compact(s) {
    return normalize(s).replace(/[\s\u00a0\u200b]+/g, "");
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
    var t = normalize(String(s || "")).trim();
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

  function parseNumber(raw) {
    if (raw == null || raw === "") return null;
    var t = normalize(String(raw)).replace(/,/g, "").trim();
    if (!t) return null;
    var n = Number(t);
    return isFinite(n) ? n : null;
  }

  function m2ToPing(m2) {
    if (m2 == null || !isFinite(m2)) return null;
    return Math.round(m2 * M2_TO_PING * 100) / 100;
  }

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  function parseShare(raw) {
    var t = compact(raw || "");
    if (!t) return null;
    if (/全部|所有權全部|^1\/1$/.test(t)) return { value: 1, text: "全部" };
    var m = t.match(/([0-9]+)分之([0-9]+)/);
    if (m) {
      var den = parseNumber(m[1]);
      var num = parseNumber(m[2]);
      if (den && num != null) return { value: round4(num / den), text: m[1] + "分之" + m[2] };
    }
    m = t.match(/([0-9]+(?:\.[0-9]+)?)\/([0-9]+(?:\.[0-9]+)?)/);
    if (m) {
      var a = parseNumber(m[1]);
      var b = parseNumber(m[2]);
      if (a != null && b) return { value: round4(a / b), text: m[1] + "/" + m[2] };
    }
    m = t.match(/([0-9]+(?:\.[0-9]+)?)[%％]/);
    if (m) {
      var p = parseNumber(m[1]);
      if (p != null) return { value: round4(p / 100), text: m[1] + "%" };
    }
    return null;
  }

  function fieldAfter(text, labelRe, stopRe) {
    var m = text.match(labelRe);
    if (!m) return null;
    var rest = text.slice(m.index + m[0].length);
    var stop = rest.search(stopRe);
    if (stop >= 0) rest = rest.slice(0, stop);
    rest = rest.replace(/^[:：、.．]+/, "").trim();
    return rest || null;
  }

  var STOP = /主要用途|主要建材|層數|層次|建築完成|建物坐落|建物門牌|建號|門牌|附屬建物|共有部分|主建物|土地面積|土地標示|建物總面積|總面積|權利範圍|所有權人|登記日期|登記原因/;

  function firstArea(chunk) {
    if (!chunk) return null;
    var m = String(chunk).match(/([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+\.[0-9]+|[0-9]+(?:\.[0-9]+)?)平方公尺/);
    if (!m) m = String(chunk).match(/([0-9]{1,6}(?:\.[0-9]+)?)/);
    return m ? parseNumber(m[1]) : null;
  }

  function areasIn(chunk, parking) {
    var main = 0;
    var park = 0;
    var found = false;
    if (!chunk) return { main: null, park: 0, found: false };
    var re = /([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+\.[0-9]+|[0-9]+)平方公尺/g;
    var m;
    while ((m = re.exec(chunk))) {
      var val = parseNumber(m[1]);
      if (val == null) continue;
      found = true;
      var start = Math.max(0, m.index - 12);
      var ctx = chunk.slice(start, m.index);
      if (/停車|車位|車庫/.test(ctx)) park += val;
      else main += val;
    }
    if (!found) return { main: null, park: 0, found: false };
    if (parking) return { main: main, park: park, found: true };
    return { main: main + park, park: 0, found: true };
  }

  function findShares(text) {
    var out = [];
    var re = /權利範圍[:：]?((?:全部|所有權全部)|(?:[0-9]+分之[0-9]+)|(?:[0-9.]+\/[0-9.]+)|(?:[0-9.]+[%％]))/g;
    var m;
    while ((m = re.exec(text))) {
      var sh = parseShare(m[1]);
      if (sh) out.push({ index: m.index, value: sh.value, text: sh.text });
    }
    return out;
  }

  function nearestShare(shares, index, maxDist) {
    var best = null;
    var bestD = maxDist;
    for (var i = 0; i < shares.length; i++) {
      var d = shares[i].index - index;
      if (d < -20) continue;
      if (d < 0) d = -d;
      if (d <= bestD) {
        bestD = d;
        best = shares[i];
      }
    }
    return best;
  }

  function parseCompleteDate(text) {
    var m = text.match(/建築完成日期[:：]?(?:中華)?(?:民.?國)?([0-9]{2,3})年([0-9]{1,2})月(?:([0-9]{1,2})日)?/);
    if (!m) m = text.match(/(?:中華)?民國([0-9]{2,3})年([0-9]{1,2})月(?:([0-9]{1,2})日)?/);
    if (!m) return null;
    var roc = parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    var day = m[3] ? parseInt(m[3], 10) : null;
    if (roc < 1 || roc > 200) return null;
    return {
      rocYear: roc,
      year: roc + 1911,
      month: month,
      day: day,
      raw: "民國" + roc + "年" + month + "月" + (day ? day + "日" : ""),
    };
  }

  function ageFromDate(date, asOf) {
    if (!date) return null;
    asOf = asOf || new Date();
    var y = asOf.getFullYear();
    var mo = asOf.getMonth() + 1;
    var d = asOf.getDate();
    var age = y - date.year;
    if (date.month && (mo < date.month || (mo === date.month && date.day && d < date.day))) age -= 1;
    if (age < 0) return 0;
    return age;
  }

  function parseStories(text) {
    var m = text.match(/層數[:：]?(?:地上)?([0-9一二三四五六七八九十廿兩]+)層(?:地下([0-9一二三四五六七八九十廿兩]+)層)?/);
    if (!m) return { raw: null, above: null, below: null };
    var above = cnNum(m[1]);
    var below = m[2] ? cnNum(m[2]) : 0;
    var raw = "地上" + (above != null ? above : m[1]) + "層" + (below ? "地下" + below + "層" : "");
    return { raw: raw, above: above, below: below || 0 };
  }

  function parseFloorLevel(text) {
    var m = text.match(/層次[:：]?(地下)?第?([0-9一二三四五六七八九十廿兩]+)[層樓]/);
    if (!m) return null;
    var n = cnNum(m[2]);
    if (n == null) return null;
    if (m[1] || (m[0].indexOf("地下") >= 0)) return -Math.abs(n);
    return n;
  }

  function parseAddress(text) {
    var chunk = fieldAfter(text, /建物門牌/, STOP) || fieldAfter(text, /門牌/, STOP);
    if (!chunk) {
      var m = text.match(/((?:臺北市|新北市|基隆市|桃園市|臺中市|臺南市|高雄市|新竹市|嘉義市)[^層數用途建材]{4,60}?[0-9]+號(?:[0-9]+樓)?)/);
      return m ? m[1] : null;
    }
    chunk = chunk.replace(/[;；].*$/, "");
    var m2 = chunk.match(/((?:[^，,。]{2,60}?)(?:[0-9]+(?:之[0-9]+)?號)(?:之[0-9]+)?(?:[0-9一二三四五六七八九十]+[樓層])?(?:之[0-9]+)?)/);
    return (m2 ? m2[1] : chunk).replace(/[:：]/g, "");
  }

  function suggestType(storiesAbove, use, material, floorRaw) {
    var blob = (use || "") + (material || "") + (floorRaw || "");
    if (/透天/.test(blob)) return "透天厝";
    if (storiesAbove == null) return null;
    if (storiesAbove >= 11) return "住宅大樓";
    if (storiesAbove >= 6) return "華廈";
    if (storiesAbove <= 5) {
      if (/加強磚|磚造/.test(material || "")) return "公寓";
      return "公寓";
    }
    return null;
  }

  function parseTranscript(raw, options) {
    options = options || {};
    var asOf = options.asOf || new Date();
    var text = compact(raw);
    var warnings = [];
    var empty = !text;
    var address = empty ? null : parseAddress(text);
    var use = empty ? null : fieldAfter(text, /主要用途/, STOP);
    var material = empty ? null : fieldAfter(text, /主要建材/, STOP);
    if (use) use = use.replace(/[:：]/g, "").slice(0, 30);
    if (material) material = material.replace(/[:：]/g, "").slice(0, 30);

    var stories = empty ? { raw: null, above: null, below: null } : parseStories(text);
    var floor = empty ? null : parseFloorLevel(text);
    if (floor == null && address) {
      var fm = address.match(/(地下)?([0-9一二三四五六七八九十廿兩]+)[樓層]/);
      if (fm) {
        var fn = cnNum(fm[2]);
        if (fn != null) floor = fm[1] ? -Math.abs(fn) : fn;
      }
    }

    var completeDate = empty ? null : parseCompleteDate(text);
    var age = ageFromDate(completeDate, asOf);

    var officialTotal = null;
    if (!empty) {
      var totChunk = fieldAfter(text, /建物總面積/, STOP) || fieldAfter(text, /總面積/, /主建物|附屬建物|共有部分|土地面積|權利範圍|建物門牌/);
      officialTotal = firstArea(totChunk);
    }

    var mainM2 = null;
    var attachedM2 = null;
    var attachedPark = 0;
    var commonM2 = null;
    var commonPark = 0;
    if (!empty) {
      var mainChunk = fieldAfter(text, /主建物/, /附屬建物|共有部分|權利範圍|土地面積|土地標示|所有權/);
      var mainAreas = areasIn(mainChunk, true);
      if (mainAreas.found) mainM2 = mainAreas.main;

      var attChunk = fieldAfter(text, /附屬建物/, /共有部分|權利範圍|土地面積|土地標示|所有權|建物總面積/);
      var attAreas = areasIn(attChunk, true);
      if (attAreas.found) {
        attachedM2 = attAreas.main;
        attachedPark = attAreas.park;
      }

      var comChunk = fieldAfter(text, /共有部分/, /土地面積|土地標示|所有權人|主建物|附屬建物|建物門牌|建物總面積/);
      var comAreas = areasIn(comChunk, true);
      if (comAreas.found) {
        commonM2 = comAreas.main;
        commonPark = comAreas.park;
      }
    }

    var shares = empty ? [] : findShares(text);
    var commonShare = null;
    var landShare = null;
    if (!empty) {
      var cIdx = text.search(/共有部分/);
      var lIdx = text.search(/土地面積|土地標示/);
      if (cIdx >= 0) commonShare = nearestShare(shares, cIdx, 220);
      if (lIdx >= 0) landShare = nearestShare(shares, lIdx, 220);
      if (!commonShare && shares.length === 1) commonShare = shares[0];
    }

    var landM2 = null;
    if (!empty) {
      var landChunk = fieldAfter(text, /土地面積/, STOP);
      if (!landChunk) {
        var lm = text.match(/土地標示.{0,120}?面積[:：]?([0-9]+(?:\.[0-9]+)?)平方公尺/);
        if (lm) landM2 = parseNumber(lm[1]);
      } else landM2 = firstArea(landChunk);
      if (!landShare && shares.length === 1 && landM2 != null) landShare = shares[0];
    }

    var parkM2 = (attachedPark || 0) + (commonPark || 0);
    var shareVal = commonShare ? commonShare.value : null;
    if (commonM2 != null && shareVal == null) {
      warnings.push("找到共有部分面積，但沒有對應的權利範圍（持分），總坪暫不計入共有部分。");
    }

    var mainPing = m2ToPing(mainM2);
    var attachedPing = m2ToPing(attachedM2);
    var commonShareM2 = commonM2 != null && shareVal != null ? commonM2 * shareVal : null;
    var commonSharePing = m2ToPing(commonShareM2);
    var parkingPing = parkM2 ? m2ToPing(parkM2) : null;

    var totalM2 = null;
    if (mainM2 != null || attachedM2 != null || commonShareM2 != null) {
      totalM2 = (mainM2 || 0) + (attachedM2 || 0) + (commonShareM2 || 0);
    } else if (officialTotal != null) {
      totalM2 = officialTotal;
      warnings.push("沒有主建物／附屬／共有明細，改用謄本上的總面積換算坪數。");
    }
    var totalPing = m2ToPing(totalM2);
    var totalWithPark = parkM2 && totalM2 != null ? m2ToPing(totalM2 + parkM2) : totalPing;

    if (parkM2) warnings.push("已自總坪排除疑似車位／停車面積 " + parkM2 + " 平方公尺（約 " + parkingPing + " 坪），請再確認。");

    var landShareVal = landShare ? landShare.value : null;
    var landShareM2 = landM2 != null && landShareVal != null ? landM2 * landShareVal : landM2 != null && landShareVal == null ? null : null;
    var landPing = m2ToPing(landShareM2 != null ? landShareM2 : null);
    var landAllPing = m2ToPing(landM2);
    if (landM2 != null && landShareVal == null) {
      warnings.push("找到土地面積，但沒有對應的權利範圍，僅顯示全部面積、未換算持分後坪數。");
    }

    var suggestedType = suggestType(stories.above, use, material);

    if (!empty && !address && floor == null && totalPing == null) {
      warnings.push("無法從文字辨識出門牌或面積。請改拍更清晰的謄本，或在下方修正辨識文字後重新解析。");
    } else if (!empty) {
      warnings.unshift("辨識與解析可能有誤，請逐欄核對後再試算。");
    }

    return {
      address: address,
      use: use,
      material: material,
      stories: stories.raw,
      storiesAbove: stories.above,
      storiesBelow: stories.below,
      floor: floor,
      completeDate: completeDate,
      age: age,
      mainM2: mainM2,
      attachedM2: attachedM2,
      commonM2: commonM2,
      commonShare: shareVal,
      commonShareText: commonShare ? commonShare.text : null,
      officialTotalM2: officialTotal,
      landM2: landM2,
      landShare: landShareVal,
      landShareText: landShare ? landShare.text : null,
      parkingM2: parkM2 || null,
      mainPing: mainPing,
      attachedPing: attachedPing,
      commonSharePing: commonSharePing,
      parkingPing: parkingPing,
      totalPing: totalPing,
      totalPingWithParking: totalWithPark,
      landPing: landPing,
      landAllPing: landAllPing,
      suggestedType: suggestedType,
      warnings: warnings,
    };
  }

  var api = {
    M2_TO_PING: M2_TO_PING,
    normalize: normalize,
    compact: compact,
    parseShare: parseShare,
    parseTranscript: parseTranscript,
    m2ToPing: m2ToPing,
    ageFromDate: ageFromDate,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Transcript = api;
})(typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this);
