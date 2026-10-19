/* 720° 全景查看器 —— Three.js 立方体贴图 + krpano 热点几何
 * 数据源: scenes.json（由原方案解析而来）
 * 面图命名: show_l / show_f / show_r / show_b / show_u / show_d（同名覆盖即可换图）
 */
(function () {
  'use strict';

  var FOV_DEFAULT = 85, FOV_MIN = 65, FOV_MAX = 110;
  var PITCH_LIMIT = 85 * Math.PI / 180;

  // 调试：?still=1 关闭所有过渡动画（供无头截图校验用）
  if (/[?&]still=1/.test(location.search)) document.body.classList.add('no-anim');

  var els = {
    canvas: document.getElementById('pano'),
    hotspots: document.getElementById('hotspots'),
    thumbs: document.getElementById('thumbs'),
    loading: document.getElementById('loading'),
    loadingText: document.getElementById('loading-text'),
    title: document.getElementById('title'),
    logo: document.getElementById('logo'),
    mapbox: document.getElementById('mapbox'),
    mapimg: document.getElementById('mapimg'),
    mappins: document.getElementById('mappins'),
    hint: document.getElementById('hint'),
    toast: document.getElementById('toast')
  };

  var S = {
    data: null,
    index: 0,
    yaw: 0,
    pitch: 0,
    fov: FOV_DEFAULT,
    targetFov: FOV_DEFAULT,
    vYaw: 0,
    vPitch: 0,
    dragging: false,
    autoRotate: false,
    busy: false,
    tex: null,
    ready: false
  };

  var renderer, scene, camera;
  var hsNodes = [];           // {el, ath, atv, next}
  var tmpV = null, tmpV2 = null, tmpProj = null;

  /* ---------------- 启动 ---------------- */

  fetch('scenes.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      S.data = data;
      document.title = data.title || '720°全景';
      els.title.textContent = data.title || '720°全景';
      if (data.logo) els.logo.src = data.logo;
      if (data.map) els.mapimg.src = data.map;
      initGL();
      buildThumbs();
      buildMapPins();
      var startIdx = indexOfScene(data.startScene);
      openScene(startIdx < 0 ? 0 : startIdx, true);
      animate();
    })
    .catch(function (e) {
      els.loadingText.textContent = '加载失败：' + e.message + '（请用 start.bat 通过本地服务器打开）';
    });

  function indexOfScene(id) {
    for (var i = 0; i < S.data.scenes.length; i++) if (S.data.scenes[i].id === id) return i;
    return -1;
  }

  /* ---------------- 渲染器 ---------------- */

  function initGL() {
    tmpV = new THREE.Vector3();
    tmpV2 = new THREE.Vector3();
    tmpProj = new THREE.Vector3();

    renderer = new THREE.WebGLRenderer({
      canvas: els.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(S.fov, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(0, 0, 0);

    window.addEventListener('resize', onResize);
    bindControls();
    bindUI();
  }

  function onResize() {
    if (!renderer) return;
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---------------- 视角 ---------------- */

  // 方向：ath=0 指向前图(f)中心(+Z)，ath 增大朝 +X（与立方体贴图一致）
  function dirOf(ath, atv, out) {
    var cp = Math.cos(atv);
    return out.set(Math.sin(ath) * cp, Math.sin(atv), Math.cos(ath) * cp);
  }

  function applyCamera() {
    dirOf(S.yaw, S.pitch, tmpV);
    camera.fov = S.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(tmpV.x * 100, tmpV.y * 100, tmpV.z * 100);
  }

  /* ---------------- 场景加载 ---------------- */

  function faceUrls(sc) {
    var f = sc.faces;
    // three.js CubeTexture 面顺序: px, nx, py, ny, pz, nz
    return [f.r, f.l, f.u, f.d, f.f, f.b];
  }

  // 一张一张加载六面图，带 3 次重试（弱网/国外 CDN 抗干扰）
  function loadCubeSerial(urls, onProgress) {
    return new Promise(function (resolve, reject) {
      var images = new Array(urls.length);
      var i = 0;

      function next() {
        if (i >= urls.length) {
          var tex = new THREE.CubeTexture(images);
          tex.needsUpdate = true;
          resolve(tex);
          return;
        }
        var idx = i;
        var tries = 0;
        (function attempt() {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function () {
            images[idx] = img;
            i++;
            if (onProgress) onProgress(i, urls.length);
            setTimeout(next, 30);
          };
          img.onerror = function () {
            tries++;
            if (tries < 4) {
              setTimeout(attempt, 700 * tries);
            } else {
              reject(new Error('六面图加载失败'));
            }
          };
          var sep = urls[idx].indexOf('?') >= 0 ? '&' : '?';
          img.src = urls[idx] + (tries ? sep + '_r=' + tries : '');
        })();
      }
      next();
    });
  }

  function openScene(idx, first) {
    if (S.busy) return;
    S.busy = true;
    var sc = S.data.scenes[idx];
    els.loadingText.textContent = first ? '正在加载全景…' : (sc.title || '加载中…');
    if (first) els.loading.classList.remove('hide');

    var urls = faceUrls(sc);

    // 串行加载（一张接一张，带重试）：国外 CDN / 弱网下并发拉 6 张会被重置，串行成功率高很多
    loadCubeSerial(urls, function (n, total) {
      if (!first) els.loadingText.textContent = (sc.title || '') + ' ' + Math.round(n / total * 100) + '%';
    }).then(function (tex) {
      if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;

      if (S.tex) S.tex.dispose();
      S.tex = tex;
      scene.background = tex;

      S.index = idx;
      S.ready = true;
      S.busy = false;
      S.vYaw = S.vPitch = 0;

      buildHotspots(sc);
      markActiveThumb(idx);
      markActivePin(idx);
      applyCamera();

      els.loading.classList.add('hide');
      setTimeout(function () { hideHint(); }, 3200);
    }).catch(function (err) {
      S.busy = false;
      els.loadingText.textContent = '图片加载失败：' + (sc.title || '') + '（' + (err && err.message ? err.message : '网络') + '）';
      console.error('load fail', sc, err);
      els.loading.classList.remove('hide');
    });
  }

  function goScene(id) {
    var i = indexOfScene(id);
    if (i < 0 || i === S.index) return;
    openScene(i, false);
  }

  /* ---------------- 热点 ---------------- */

  function buildHotspots(sc) {
    els.hotspots.innerHTML = '';
    hsNodes = [];
    (sc.hotspots || []).forEach(function (h) {
      var el = document.createElement('div');
      el.className = 'hs';
      el.innerHTML =
        '<div class="ring"></div>' +
        '<svg viewBox="0 0 24 24"><path d="M11 4h2v11.2l4.1-4.1 1.4 1.4L12 19l-6.5-6.5 1.4-1.4L11 15.2z"/></svg>' +
        '<div class="label"></div>';
      var target = S.data.scenes[indexOfScene(h.next)];
      el.querySelector('.label').textContent = target ? target.title : '';
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        goScene(h.next);
      });
      els.hotspots.appendChild(el);
      hsNodes.push({ el: el, ath: h.ath * Math.PI / 180, atv: h.atv * Math.PI / 180, next: h.next });
    });
  }

  function updateHotspots() {
    if (!hsNodes.length) return;
    var w = window.innerWidth, h = window.innerHeight;
    dirOf(S.yaw, S.pitch, tmpV);                   // 相机前方
    for (var i = 0; i < hsNodes.length; i++) {
      var hs = hsNodes[i];
      dirOf(hs.ath, hs.atv, tmpV2);
      if (tmpV.dot(tmpV2) <= 0.12) {               // 背后 / 大角度外
        hs.el.classList.remove('show');
        continue;
      }
      var p = tmpProj.copy(tmpV2).multiplyScalar(10).project(camera);
      if (p.z > 1) { hs.el.classList.remove('show'); continue; }
      var x = (p.x * 0.5 + 0.5) * w;
      var y = (-p.y * 0.5 + 0.5) * h;
      if (x < -60 || x > w + 60 || y < -60 || y > h + 60) {
        hs.el.classList.remove('show');
      } else {
        hs.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        hs.el.classList.add('show');
      }
    }
  }

  /* ---------------- 交互 ---------------- */

  function bindControls() {
    var cv = els.canvas;
    var lastX = 0, lastY = 0, pid = null;
    var pinchDist = 0, pinchFov = FOV_DEFAULT;

    cv.addEventListener('pointerdown', function (e) {
      if (pid !== null) return;
      pid = e.pointerId;
      S.dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      S.vYaw = S.vPitch = 0;
      cv.classList.add('grabbing');
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      hideHint();
    });

    cv.addEventListener('pointermove', function (e) {
      if (!S.dragging || e.pointerId !== pid) return;
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;

      var k = (S.fov / window.innerHeight) * (Math.PI / 180) * 1.15;
      S.yaw += dx * k;      // 向右拖动 -> 视角左移（内容跟随手指）
      S.pitch += dy * k;
      clampPitch();
      S.vYaw = dx * k * 0.55;
      S.vPitch = dy * k * 0.55;
      applyCamera();
    });

    function endDrag(e) {
      if (e && e.pointerId !== undefined && e.pointerId !== pid) return;
      pid = null;
      S.dragging = false;
      cv.classList.remove('grabbing');
    }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('pointerleave', endDrag);

    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      S.targetFov = clamp(S.targetFov + (e.deltaY > 0 ? 4 : -4), FOV_MIN, FOV_MAX);
      hideHint();
    }, { passive: false });

    // 双指缩放
    cv.addEventListener('touchstart', function (e) {
      if (e.touches.length >= 2) {
        S.dragging = false;
        pid = null;
        S.vYaw = S.vPitch = 0;
        pinchDist = touchDist(e.touches);
        pinchFov = S.targetFov;
      }
    }, { passive: true });

    cv.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && pinchDist > 0) {
        e.preventDefault();
        var d = touchDist(e.touches);
        S.targetFov = clamp(pinchFov * (pinchDist / Math.max(d, 1)), FOV_MIN, FOV_MAX);
      }
    }, { passive: false });

    cv.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) pinchDist = 0;
    }, { passive: true });

    window.addEventListener('keydown', function (e) {
      var step = 4 * Math.PI / 180;
      if (e.key === 'ArrowLeft') S.yaw -= step;
      else if (e.key === 'ArrowRight') S.yaw += step;
      else if (e.key === 'ArrowUp') { S.pitch += step; clampPitch(); }
      else if (e.key === 'ArrowDown') { S.pitch -= step; clampPitch(); }
      else if (e.key === 'Escape') els.mapbox.classList.remove('open');
      else return;
      applyCamera();
    });
  }

  function touchDist(t) {
    var dx = t[0].clientX - t[1].clientX;
    var dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clampPitch() { S.pitch = clamp(S.pitch, -PITCH_LIMIT, PITCH_LIMIT); }

  function hideHint() { els.hint.classList.add('hide'); }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.classList.remove('show'); }, 1600);
  }

  /* ---------------- UI ---------------- */

  function buildThumbs() {
    els.thumbs.innerHTML = '';
    S.data.scenes.forEach(function (sc, i) {
      var d = document.createElement('div');
      d.className = 'thumb';
      d.innerHTML = '<img loading="lazy" src="' + (sc.dir + 'thumb.jpg') + '" alt=""><span>' + sc.title + '</span>';
      d.addEventListener('click', function () { openScene(i, false); });
      els.thumbs.appendChild(d);
    });
  }

  function markActiveThumb(i) {
    var kids = els.thumbs.children;
    for (var k = 0; k < kids.length; k++) kids[k].classList.toggle('active', k === i);
    var el = kids[i];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function buildMapPins() {
    els.mappins.innerHTML = '';
    S.data.scenes.forEach(function (sc, i) {
      var p = document.createElement('div');
      p.className = 'mappin';
      p.style.left = sc.lng + '%';
      p.style.top = sc.lat + '%';
      p.setAttribute('data-title', sc.title);
      p.addEventListener('click', function () {
        els.mapbox.classList.remove('open');
        openScene(i, false);
      });
      els.mappins.appendChild(p);
    });
  }

  function markActivePin(i) {
    var kids = els.mappins.children;
    for (var k = 0; k < kids.length; k++) kids[k].classList.toggle('active', k === i);
  }

  function bindUI() {
    document.getElementById('btn-map').addEventListener('click', function () {
      els.mapbox.classList.toggle('open');
    });
    document.getElementById('map-close').addEventListener('click', function () {
      els.mapbox.classList.remove('open');
    });
    els.mapbox.addEventListener('click', function (e) {
      if (e.target === els.mapbox) els.mapbox.classList.remove('open');
    });

    document.getElementById('btn-full').addEventListener('click', function () {
      if (!document.fullscreenElement) {
        (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
      } else {
        document.exitFullscreen && document.exitFullscreen();
      }
    });

    document.getElementById('btn-rotate').addEventListener('click', function () {
      S.autoRotate = !S.autoRotate;
      this.classList.toggle('on', S.autoRotate);
      toast(S.autoRotate ? '自动旋转已开启' : '自动旋转已关闭');
    });

    document.getElementById('btn-share').addEventListener('click', function () {
      var url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { toast('链接已复制'); }, function () { toast(url); });
      } else {
        toast(url);
      }
    });
  }

  /* ---------------- 主循环 ---------------- */

  function animate() {
    requestAnimationFrame(animate);
    if (!S.ready) return;

    // 惯性
    if (!S.dragging && (Math.abs(S.vYaw) > 1e-5 || Math.abs(S.vPitch) > 1e-5)) {
      S.yaw += S.vYaw;
      S.pitch += S.vPitch;
      S.vYaw *= 0.93;
      S.vPitch *= 0.93;
      if (Math.abs(S.vYaw) < 1e-5) S.vYaw = 0;
      if (Math.abs(S.vPitch) < 1e-5) S.vPitch = 0;
      clampPitch();
    }

    // 自动旋转
    if (S.autoRotate && !S.dragging) {
      S.yaw += 0.0016;
    }

    // 平滑缩放
    if (Math.abs(S.fov - S.targetFov) > 0.05) {
      S.fov += (S.targetFov - S.fov) * 0.22;
      applyCamera();
    }

    updateHotspots();
    renderer.render(scene, camera);
  }

  // 暴露一点调试接口，方便校验/改图
  window.PANO = {
    get state() { return S; },
    go: goScene,
    scenes: function () { return S.data ? S.data.scenes.map(function (s) { return { id: s.id, title: s.title }; }) : []; }
  };
})();
