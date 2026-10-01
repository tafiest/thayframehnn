/*
 * Thay avatar – ghép ảnh người dùng dưới khung (frame) PNG trong suốt.
 *
 * Hệ toạ độ: mọi thứ tính trong "toạ độ frame" (pixel của file frame gốc, 0..S).
 * Ảnh người dùng được đặt bởi: tâm (cx, cy), tỉ lệ s (px frame / px ảnh),
 * góc xoay theta, lật ngang flip. Một điểm (u, v) tính từ tâm ảnh nằm tại
 *     p = C + R(theta) · (flip ? -s·u : s·u, s·v)
 * Xem trước và xuất ảnh dùng CHUNG hàm render(), chỉ khác kích thước canvas,
 * nên ảnh tải về khớp tuyệt đối với những gì người dùng thấy.
 */
(function () {
  'use strict';

  var CFG = Object.assign({
    pageTitle: 'Thay avatar',
    heading: 'Thay avatar',
    subheading: '',
    steps: [],
    caption: '',
    colors: {},
    frameSrc: 'assets/frame.png',
    downloadFileName: 'avatar.png',
    maxZoom: 5,
    footer: '',
  }, window.APP_CONFIG || {});

  // Giới hạn ảnh nguồn: đủ nét cho mức phóng to tối đa, an toàn bộ nhớ trên iPhone.
  var MAX_SOURCE_SIDE = 4096;
  var MAX_SOURCE_PIXELS = 16000000;
  var HOLE_MARGIN = 1; // nới vùng cần phủ thêm 1px để mép ảnh không lộ đường viền mảnh
  var PREVIEW_BG = '#e3efe6';

  // ---------------------------------------------------------------- DOM
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    stage: $('stage'), preview: $('preview'), pickOverlay: $('pickOverlay'),
    dropHint: $('dropHint'), loading: $('loading'), controls: $('controls'),
    zoom: $('zoom'), rotate: $('rotate'), rotateValue: $('rotateValue'),
    rotLeft: $('rotLeft'), rotRight: $('rotRight'), flip: $('flip'),
    reset: $('reset'), change: $('change'), pickBtn: $('pickBtn'),
    downloadBtn: $('downloadBtn'), file: $('file'), steps: $('steps'),
    captionBox: $('captionBox'), captionText: $('captionText'), copyCaption: $('copyCaption'),
    footer: $('footer'), modal: $('resultModal'), resultImg: $('resultImg'),
    resultHint: $('resultHint'), resultDownload: $('resultDownload'),
    resultClose: $('resultClose'), toast: $('toast'), heading: $('heading'),
    subheading: $('subheading'),
  };
  var pctx = el.preview.getContext('2d');

  // ---------------------------------------------------------------- Trạng thái
  var frame = null;       // HTMLImageElement của frame
  var S = 1200;           // kích thước frame (vuông) = kích thước ảnh xuất
  var hole = null;        // {x0, y0, x1, y1} vùng trong suốt cần ảnh phủ kín
  var frameCache = null;  // frame đã thu nhỏ sẵn theo cỡ xem trước
  var src = null;         // {levels: [canvas...], w, h} ảnh người dùng (kim tự tháp thu nhỏ)
  var st = null;          // {cx, cy, s, quarter, fine, flip}
  var previewSize = 0;
  var renderQueued = false;

  // ---------------------------------------------------------------- Hình học
  function clamp(v, lo, hi) { return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)); }
  function rot(x, y, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  }
  function thetaOf(state) { return (state.quarter * 90 + state.fine) * Math.PI / 180; }
  function holeCenter() { return [(hole.x0 + hole.x1) / 2, (hole.y0 + hole.y1) / 2]; }

  // Chiếu 4 góc vùng cần phủ vào hệ trục của ảnh đã xoay.
  // Ảnh (rộng s·w, cao s·h) phủ kín vùng <=> mọi góc nằm trong hình chữ nhật của ảnh.
  function coverInfo(theta) {
    var xs = [hole.x0, hole.x1], ys = [hole.y0, hole.y1];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
      var q = rot(xs[i], ys[j], -theta);
      minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
      minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
    }
    return {
      minX: minX, maxX: maxX, minY: minY, maxY: maxY,
      sMin: Math.max((maxX - minX) / src.w, (maxY - minY) / src.h),
    };
  }

  // Ép trạng thái về hợp lệ: đủ lớn để phủ kín và tâm nằm trong miền cho phép.
  // Miền cho phép của tâm (trong hệ trục ảnh đã xoay) là một hình chữ nhật -> kẹp chính xác.
  function constrain(state) {
    var theta = thetaOf(state);
    var info = coverInfo(theta);
    state.s = clamp(state.s, info.sMin, info.sMin * CFG.maxZoom);
    var hw = state.s * src.w / 2, hh = state.s * src.h / 2;
    var c = rot(state.cx, state.cy, -theta);
    c[0] = clamp(c[0], info.maxX - hw, info.minX + hw);
    c[1] = clamp(c[1], info.maxY - hh, info.minY + hh);
    c = rot(c[0], c[1], theta);
    state.cx = c[0]; state.cy = c[1];
    return state;
  }

  function initialState() {
    var state = { cx: 0, cy: 0, s: 0, quarter: 0, fine: 0, flip: false };
    var hc = holeCenter();
    state.s = coverInfo(0).sMin;
    // Đưa điểm ở 40% chiều cao ảnh vào giữa khung: mặt thường nằm phía trên ảnh,
    // và khối chữ của frame che phần dưới vòng tròn.
    state.cx = hc[0];
    state.cy = hc[1] + 0.1 * state.s * src.h;
    return constrain(state);
  }

  // Phóng to/thu nhỏ quanh điểm P (toạ độ frame): điểm ảnh dưới P đứng yên.
  function zoomAt(px, py, factor) {
    var target = st.s * factor;
    var info = coverInfo(thetaOf(st));
    target = clamp(target, info.sMin, info.sMin * CFG.maxZoom);
    var k = target / st.s;
    st.cx = px + (st.cx - px) * k;
    st.cy = py + (st.cy - py) * k;
    st.s = target;
    constrain(st);
  }

  // Xoay quanh tâm khung, giữ nguyên mức phóng to tương đối.
  function setRotation(quarter, fine) {
    var oldTheta = thetaOf(st);
    var zRel = st.s / coverInfo(oldTheta).sMin;
    st.quarter = ((quarter % 4) + 4) % 4;
    st.fine = fine;
    var newTheta = thetaOf(st);
    var hc = holeCenter();
    var d = rot(st.cx - hc[0], st.cy - hc[1], newTheta - oldTheta);
    st.cx = hc[0] + d[0];
    st.cy = hc[1] + d[1];
    st.s = zRel * coverInfo(newTheta).sMin;
    constrain(st);
  }

  // Lật ngang qua trục dọc đi qua tâm khung (đúng như soi gương những gì đang thấy).
  function flipHorizontal() {
    var hc = holeCenter();
    st.cx = 2 * hc[0] - st.cx;
    st.quarter = (4 - st.quarter) % 4;
    st.fine = -st.fine;
    st.flip = !st.flip;
    constrain(st);
  }

  // ---------------------------------------------------------------- Vẽ
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // Thu nhỏ chất lượng cao: giảm từng nửa một rồi mới về đúng kích thước (tránh rỗ/răng cưa).
  function resizeHQ(image, w, h, tw, th) {
    var cur = image, cw = w, ch = h;
    while (cw / 2 >= tw && ch / 2 >= th) {
      var half = makeCanvas(cw / 2, ch / 2);
      var hctx = half.getContext('2d');
      hctx.imageSmoothingEnabled = true;
      hctx.imageSmoothingQuality = 'high';
      hctx.drawImage(cur, 0, 0, cw, ch, 0, 0, half.width, half.height);
      cur = half; cw = half.width; ch = half.height;
    }
    var out = makeCanvas(tw, th);
    var octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(cur, 0, 0, cw, ch, 0, 0, out.width, out.height);
    return out;
  }

  // Lấy tầng ảnh phù hợp: tỉ lệ vẽ thực tế luôn >= 0.5 nên thu nhỏ vẫn mịn.
  function levelFor(scale) {
    var want = Math.max(0, Math.floor(Math.log2(1 / scale)));
    while (src.levels.length <= want) {
      var prev = src.levels[src.levels.length - 1];
      if (prev.width < 64 || prev.height < 64) break;
      src.levels.push(resizeHQ(prev, prev.width, prev.height, prev.width / 2, prev.height / 2));
    }
    return src.levels[Math.min(want, src.levels.length - 1)];
  }

  function render(ctx, size, frameImg, bg) {
    var k = size / S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    if (src && st) {
      var level = levelFor(st.s * k);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.translate(st.cx, st.cy);
      ctx.rotate(thetaOf(st));
      ctx.scale(st.flip ? -st.s : st.s, st.s);
      ctx.drawImage(level, -src.w / 2, -src.h / 2, src.w, src.h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (frameImg) ctx.drawImage(frameImg, 0, 0, size, size);
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      render(pctx, previewSize, frameCache, PREVIEW_BG);
      syncControls();
    });
  }

  function resizePreview() {
    var rect = el.stage.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var size = Math.min(S, Math.max(1, Math.round(rect.width * dpr)));
    if (size === previewSize && frameCache) return;
    previewSize = size;
    el.preview.width = el.preview.height = size;
    if (frame) frameCache = size === S ? frame : resizeHQ(frame, S, S, size, size);
    requestRender();
  }

  // ---------------------------------------------------------------- Frame
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('frame')); };
      img.src = url;
    });
  }

  // Luôn hỏi lại máy chủ (cache: 'no-cache') để đổi frame là người dùng thấy ngay,
  // không bị trình duyệt giữ bản cũ. Frame không đổi thì máy chủ trả 304, không tải lại.
  function loadFrame() {
    if (!window.fetch) return loadImage(CFG.frameSrc);
    return fetch(CFG.frameSrc, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('frame');
      return res.blob();
    }).then(function (blob) {
      return loadImage(URL.createObjectURL(blob));
    }).catch(function () {
      return loadImage(CFG.frameSrc);
    });
  }

  // Tự tìm vùng trong suốt của frame (vùng ảnh người dùng phải phủ kín).
  function detectHole(img) {
    var c = makeCanvas(S, S);
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    var data = ctx.getImageData(0, 0, S, S).data;
    var x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (var y = 0; y < S; y++) {
      var row = y * S * 4;
      for (var x = 0; x < S; x++) {
        if (data[row + x * 4 + 3] < 255) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) {
      console.warn('Frame không có vùng trong suốt – ảnh sẽ bị che hoàn toàn.');
      return { x0: 0, y0: 0, x1: S, y1: S };
    }
    return {
      x0: Math.max(0, x0 - HOLE_MARGIN), y0: Math.max(0, y0 - HOLE_MARGIN),
      x1: Math.min(S, x1 + 1 + HOLE_MARGIN), y1: Math.min(S, y1 + 1 + HOLE_MARGIN),
    };
  }

  // ---------------------------------------------------------------- Ảnh người dùng
  function decodeFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        // Trình duyệt hiện đại tự xoay đúng chiều theo EXIF khi vẽ <img>.
        var done = function () { URL.revokeObjectURL(url); resolve(img); };
        if (img.decode) img.decode().then(done, done); else done();
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function prepareSource(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('decode');
    var f = Math.min(1, MAX_SOURCE_SIDE / Math.max(w, h), Math.sqrt(MAX_SOURCE_PIXELS / (w * h)));
    var tw = Math.max(1, Math.round(w * f)), th = Math.max(1, Math.round(h * f));
    var base = f < 1 ? resizeHQ(img, w, h, tw, th) : resizeHQ(img, w, h, w, h);
    return { levels: [base], w: base.width, h: base.height };
  }

  function isHeic(file) {
    return /\.(heic|heif)$/i.test(file.name || '') || /heic|heif/i.test(file.type || '');
  }

  function loadFile(file) {
    if (!file) return Promise.resolve();
    if (file.type && !/^image\//.test(file.type)) {
      toast('File này không phải ảnh. Hãy chọn ảnh JPG hoặc PNG.');
      return Promise.resolve();
    }
    el.loading.hidden = false;
    return decodeFile(file).then(function (img) {
      src = prepareSource(img);
      st = initialState();
      el.stage.classList.remove('empty');
      el.pickOverlay.hidden = true;
      el.controls.hidden = false;
      el.pickBtn.hidden = true;
      el.downloadBtn.hidden = false;
      requestRender();
    }).catch(function () {
      toast(isHeic(file)
        ? 'Trình duyệt này chưa đọc được ảnh HEIC. Hãy chọn ảnh JPG/PNG hoặc mở bằng Safari.'
        : 'Không đọc được ảnh này. Hãy thử ảnh khác (JPG hoặc PNG).');
    }).then(function () {
      el.loading.hidden = true;
      el.file.value = '';
    });
  }

  // ---------------------------------------------------------------- Điều khiển
  function syncControls() {
    if (!st) return;
    var sMin = coverInfo(thetaOf(st)).sMin;
    var t = CFG.maxZoom > 1 ? Math.log(st.s / sMin) / Math.log(CFG.maxZoom) : 0;
    el.zoom.value = String(Math.round(Math.min(1, Math.max(0, t)) * 1000));
    el.rotate.value = String(st.fine);
    var total = ((st.quarter * 90 + st.fine) % 360 + 360) % 360;
    if (total > 180) total -= 360;
    el.rotateValue.textContent = (Math.round(total * 10) / 10) + '°';
  }

  function toFrame(clientX, clientY) {
    var r = el.stage.getBoundingClientRect();
    return [(clientX - r.left) / r.width * S, (clientY - r.top) / r.height * S];
  }

  // Mỗi ngón đang chạm: vị trí hiện tại (toạ độ frame) + điểm bắt đầu (px màn hình)
  // để biết ngón đó có thật sự di chuyển không.
  var pointers = new Map();
  var pinching = false;      // đã vào chế độ chụm 2 ngón chưa
  var PINCH_START_PX = 8;    // cả 2 ngón phải đi quá 8px mới tính là chụm
  var gestureStartState = null;

  // Bắt đầu lại cử chỉ: lấy vị trí hiện tại làm mốc cho mọi ngón.
  function resetGesture() {
    pinching = false;
    gestureStartState = st && Object.assign({}, st);
    pointers.forEach(function (p) { p.sx = p.cx; p.sy = p.cy; p.p0 = p.p.slice(); });
  }

  function onPointerDown(e) {
    if (!st) return; // khung trống: sự kiện click bên dưới sẽ mở chọn ảnh
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    // Ngón "chính" = không còn ngón nào khác đang chạm -> mọi ngón còn lưu là ngón kẹt
    // (trình duyệt không báo nhấc tay). Xoá đi để không bị hiểu nhầm thành chụm.
    if (e.isPrimary) pointers.clear();
    try { el.stage.setPointerCapture(e.pointerId); } catch (_) { /* bỏ qua */ }
    pointers.set(e.pointerId, { p: toFrame(e.clientX, e.clientY), cx: e.clientX, cy: e.clientY, sx: 0, sy: 0 });
    resetGesture();
    el.stage.classList.add('dragging');
  }

  function onPointerMove(e) {
    var cur = pointers.get(e.pointerId);
    if (!st || !cur) return;
    e.preventDefault();
    var prev = cur.p;
    var ids = Array.from(pointers.keys());
    var a = pointers.get(ids[0]), b = ids.length > 1 ? pointers.get(ids[1]) : null;
    var prevMid = b && [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
    var prevDist = b && Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);

    cur.p = toFrame(e.clientX, e.clientY);
    cur.cx = e.clientX;
    cur.cy = e.clientY;

    if (b && !pinching) {
      // Chỉ chụm khi CẢ HAI ngón cùng di chuyển. Một ngón đứng yên (vd. ngón cái đang
      // cầm máy chạm vào mép khung) thì vẫn là kéo bằng ngón còn lại.
      var movedA = Math.hypot(a.cx - a.sx, a.cy - a.sy) > PINCH_START_PX;
      var movedB = Math.hypot(b.cx - b.sx, b.cy - b.sy) > PINCH_START_PX;
      pinching = movedA && movedB;
      if (pinching) {
        // Vừa xác nhận là chụm: tính lại từ lúc 2 ngón bắt đầu chạm để ảnh bám đúng
        // theo ngón tay (bỏ phần kéo tạm trong lúc chưa phân biệt được).
        st = Object.assign({}, gestureStartState);
        var mid0 = [(a.p0[0] + b.p0[0]) / 2, (a.p0[1] + b.p0[1]) / 2];
        var dist0 = Math.hypot(a.p0[0] - b.p0[0], a.p0[1] - b.p0[1]);
        prevMid = mid0;
        prevDist = dist0;
      }
    }

    if (b && pinching && (e.pointerId === ids[0] || e.pointerId === ids[1])) {
      var mid = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
      var dist = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]);
      if (prevDist > 0 && dist > 0) zoomAt(prevMid[0], prevMid[1], dist / prevDist);
      st.cx += mid[0] - prevMid[0];
      st.cy += mid[1] - prevMid[1];
    } else {
      st.cx += cur.p[0] - prev[0];
      st.cy += cur.p[1] - prev[1];
    }
    constrain(st);
    requestRender();
  }

  function onPointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    resetGesture();
    if (!pointers.size) el.stage.classList.remove('dragging');
  }

  function onWheel(e) {
    if (!st) return;
    e.preventDefault();
    var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    var p = toFrame(e.clientX, e.clientY);
    zoomAt(p[0], p[1], Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
    requestRender();
  }

  function onKey(e) {
    if (!st) return;
    var step = e.shiftKey ? 50 : 10, hc = holeCenter(), handled = true;
    switch (e.key) {
      case 'ArrowLeft': st.cx -= step; break;
      case 'ArrowRight': st.cx += step; break;
      case 'ArrowUp': st.cy -= step; break;
      case 'ArrowDown': st.cy += step; break;
      case '+': case '=': zoomAt(hc[0], hc[1], 1.1); break;
      case '-': case '_': zoomAt(hc[0], hc[1], 1 / 1.1); break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    constrain(st);
    requestRender();
  }

  function onZoomSlider() {
    if (!st) return;
    var sMin = coverInfo(thetaOf(st)).sMin;
    var target = sMin * Math.pow(CFG.maxZoom, Number(el.zoom.value) / 1000);
    var hc = holeCenter();
    zoomAt(hc[0], hc[1], target / st.s);
    requestRender();
  }

  function onRotateSlider() {
    if (!st) return;
    setRotation(st.quarter, Number(el.rotate.value));
    requestRender();
  }

  // ---------------------------------------------------------------- Xuất ảnh
  function exportBlob() {
    return new Promise(function (resolve, reject) {
      var c = makeCanvas(S, S);
      render(c.getContext('2d'), S, frame, '#ffffff');
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('export')); }, 'image/png');
    });
  }

  var ua = navigator.userAgent || '';
  var IS_IOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Zalo|Line\/|MicroMessenger|TikTok|musical_ly/i.test(ua);

  var lastBlob = null;

  function triggerDownload(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = CFG.downloadFileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function onDownload() {
    if (!st) return;
    el.downloadBtn.disabled = true;
    exportBlob().then(function (blob) {
      lastBlob = blob;
      if (IN_APP || IS_IOS) {
        // Zalo/Facebook chặn tải file; iPhone tải file sẽ vào app Tệp thay vì Ảnh.
        // -> hiện ảnh để người dùng nhấn giữ và "Lưu vào Ảnh".
        return blobToDataURL(blob).then(function (dataUrl) {
          el.resultImg.src = dataUrl;
          el.resultHint.textContent = IS_IOS
            ? 'Nhấn giữ vào ảnh → chọn “Lưu vào Ảnh”.'
            : 'Nhấn giữ vào ảnh → chọn “Tải ảnh xuống” / “Lưu ảnh”.';
          el.resultDownload.hidden = IN_APP;
          el.modal.hidden = false;
        });
      }
      triggerDownload(blob);
      toast('Đã tải ảnh về máy');
    }).catch(function () {
      toast('Có lỗi khi tạo ảnh. Hãy tải lại trang và thử lại.');
    }).then(function () {
      el.downloadBtn.disabled = false;
    });
  }

  // ---------------------------------------------------------------- Tiện ích
  var toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3500);
  }

  function openPicker() { el.file.click(); }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { /* bỏ qua */ }
      ta.remove();
      ok ? resolve() : reject(new Error('copy'));
    });
  }

  function applyConfig() {
    document.title = CFG.pageTitle;
    el.heading.textContent = CFG.heading;
    el.subheading.textContent = CFG.subheading;
    el.subheading.hidden = !CFG.subheading;
    el.steps.innerHTML = '';
    (CFG.steps || []).forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      el.steps.appendChild(li);
    });
    el.steps.hidden = !(CFG.steps && CFG.steps.length);
    el.captionBox.hidden = !CFG.caption;
    el.captionText.textContent = CFG.caption;
    el.footer.textContent = CFG.footer;
    el.footer.hidden = !CFG.footer;
    var c = CFG.colors || {}, root = document.documentElement.style;
    if (c.primary) root.setProperty('--primary', c.primary);
    if (c.primaryDark) root.setProperty('--primary-dark', c.primaryDark);
    if (c.background) root.setProperty('--bg', c.background);
    if (c.text) root.setProperty('--text', c.text);
  }

  // ---------------------------------------------------------------- Khởi động
  function bind() {
    el.pickBtn.addEventListener('click', openPicker);
    el.pickOverlay.addEventListener('click', function (e) { e.stopPropagation(); openPicker(); });
    el.pickOverlay.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    el.change.addEventListener('click', openPicker);
    el.file.addEventListener('change', function () { loadFile(el.file.files && el.file.files[0]); });

    el.stage.addEventListener('click', function () { if (!st) openPicker(); });
    el.stage.addEventListener('pointerdown', onPointerDown);
    el.stage.addEventListener('pointermove', onPointerMove);
    el.stage.addEventListener('pointerup', onPointerUp);
    el.stage.addEventListener('pointercancel', onPointerUp);
    el.stage.addEventListener('lostpointercapture', onPointerUp);
    el.stage.addEventListener('wheel', onWheel, { passive: false });
    el.stage.addEventListener('keydown', onKey);
    // Chặn cử chỉ phóng to cả trang của Safari khi chụm trong khung
    ['gesturestart', 'gesturechange'].forEach(function (t) {
      el.stage.addEventListener(t, function (e) { e.preventDefault(); });
    });

    el.zoom.addEventListener('input', onZoomSlider);
    el.rotate.addEventListener('input', onRotateSlider);
    el.rotLeft.addEventListener('click', function () { if (st) { setRotation(st.quarter - 1, st.fine); requestRender(); } });
    el.rotRight.addEventListener('click', function () { if (st) { setRotation(st.quarter + 1, st.fine); requestRender(); } });
    el.flip.addEventListener('click', function () { if (st) { flipHorizontal(); requestRender(); } });
    el.reset.addEventListener('click', function () { if (src) { st = initialState(); requestRender(); } });
    el.downloadBtn.addEventListener('click', onDownload);

    el.resultClose.addEventListener('click', function () { el.modal.hidden = true; });
    el.modal.addEventListener('click', function (e) { if (e.target === el.modal) el.modal.hidden = true; });
    el.resultDownload.addEventListener('click', function () { if (lastBlob) triggerDownload(lastBlob); });
    el.copyCaption.addEventListener('click', function () {
      copyText(CFG.caption).then(function () { toast('Đã sao chép caption'); },
        function () { toast('Không sao chép được, hãy nhấn giữ để chọn chữ'); });
    });

    // Kéo thả ảnh (máy tính)
    var dragDepth = 0;
    el.stage.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; el.dropHint.hidden = false; });
    el.stage.addEventListener('dragover', function (e) { e.preventDefault(); });
    el.stage.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; el.dropHint.hidden = true; } });
    el.stage.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      el.dropHint.hidden = true;
      loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    // Dán ảnh (Ctrl+V)
    document.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.files) || [];
      for (var i = 0; i < items.length; i++) {
        if (/^image\//.test(items[i].type)) { loadFile(items[i]); break; }
      }
    });

    if (window.ResizeObserver) new ResizeObserver(resizePreview).observe(el.stage);
    else window.addEventListener('resize', resizePreview);
  }

  function start() {
    applyConfig();
    el.stage.classList.add('empty');
    bind();
    loadFrame().then(function (img) {
      frame = img;
      S = img.naturalWidth;
      try {
        hole = detectHole(img);
      } catch (_) {
        // Mở trực tiếp file:// sẽ bị trình duyệt chặn đọc điểm ảnh
        toast('Hãy mở trang qua web (http/https), không mở trực tiếp file trên máy.');
        hole = { x0: 0, y0: 0, x1: S, y1: S };
      }
      // Đặt nút "Chọn ảnh" vào giữa vùng ảnh
      var hc = holeCenter();
      el.pickOverlay.style.left = (hc[0] / S * 100) + '%';
      el.pickOverlay.style.top = (hc[1] / S * 100) + '%';
      frameCache = null;
      resizePreview();
    }).catch(function () {
      toast('Không tải được khung ảnh. Hãy tải lại trang.');
    });
  }

  // Cho kiểm thử tự động
  window.__frameApp = {
    getState: function () { return st && Object.assign({}, st); },
    getHole: function () { return hole && Object.assign({}, hole); },
    getSource: function () { return src && { w: src.w, h: src.h }; },
    frameSize: function () { return S; },
    exportBlob: exportBlob,
    loadFile: loadFile,
    coverInfo: function () { return coverInfo(thetaOf(st)); },
  };

  start();
})();
