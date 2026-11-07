(function () {
  var root = document.documentElement, body = document.body;
  root.classList.add('js');
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  // ---------- toast ----------
  var toast = $('#toast'), tt;
  function say(msg) { toast.textContent = msg; toast.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { toast.classList.remove('show'); }, 1800); }

  // ---------- theme + menu ----------
  $('#theme').onclick = function () {
    var dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
    var n = dark ? 'light' : 'dark'; root.dataset.theme = n;
    try { localStorage.setItem('docs-theme', n); } catch (e) {}
  };
  $('#menu').onclick = function () { body.classList.toggle('nav-open'); };
  $$('#nav a').forEach(function (a) { a.addEventListener('click', function () { body.classList.remove('nav-open'); }); });

  // ---------- copy heading link ----------
  $$('.anchor').forEach(function (a) {
    a.addEventListener('click', function () {
      var url = location.href.split('#')[0] + a.getAttribute('href');
      try { navigator.clipboard.writeText(url).then(function () { say('Link copied'); }); } catch (e) {}
    });
  });

  // ---------- scroll spy, progress bar, back to top ----------
  var heads = $$('article h2[data-section], article h3');
  var grps = {}; $$('.grp').forEach(function (g) { grps[g.dataset.grp] = g; });
  var subLinks = {}; $$('.subs a').forEach(function (a) { subLinks[a.dataset.nav] = a; });
  var bar = $('#progress'), totop = $('#totop'), ticking = false, curSec = '', curSub = '';
  function spy() {
    ticking = false;
    var h = document.documentElement, max = h.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0) + '%';
    totop.classList.toggle('show', scrollY > 700);
    var sec = '', sub = '';
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top > 120) break;
      if (heads[i].tagName === 'H2') { sec = heads[i].id; sub = ''; } else sub = heads[i].id;
    }
    if (sec !== curSec) {
      if (grps[curSec]) grps[curSec].classList.remove('active');
      curSec = sec;
      if (grps[sec]) { grps[sec].classList.add('active'); grps[sec].scrollIntoView({ block: 'nearest' }); }
    }
    if (sub !== curSub) {
      if (subLinks[curSub]) subLinks[curSub].classList.remove('on');
      curSub = sub;
      if (subLinks[sub]) subLinks[sub].classList.add('on');
    }
  }
  addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(spy); } }, { passive: true });
  addEventListener('resize', spy); spy();
  totop.onclick = function () { scrollTo({ top: 0 }); };

  // ---------- phone frames: hide the scroll hint after the first scroll ----------
  $$('figure.phone .scroller').forEach(function (s) {
    s.addEventListener('scroll', function () { s.closest('figure').classList.add('scrolled'); }, { passive: true });
  });

  // ---------- reveal on scroll ----------
  var rev = $$('.reveal');
  if ('IntersectionObserver' in window) {
    var ro = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    rev.forEach(function (r) { ro.observe(r); });
  } else rev.forEach(function (r) { r.classList.add('in'); });

  // ---------- lightbox ----------
  var zoomables = $$('img[data-zoom]'), lb = $('#lb'), lbImg = $('#lb img'), lbCap = $('#lb .cap'), lbCnt = $('#lb .cnt'), idx = 0, closeTimer;
  function show(i) {
    idx = (i + zoomables.length) % zoomables.length;
    var im = zoomables[idx], fig = im.closest('figure');
    lbImg.src = im.currentSrc || im.src; lbImg.alt = im.alt;
    var c = fig && fig.querySelector('figcaption');
    lbCap.textContent = c ? c.textContent : im.alt;
    lbCnt.textContent = (idx + 1) + ' / ' + zoomables.length;
  }
  function resetDrag() { lb.classList.remove('drag'); lbImg.style.transform = ''; lb.style.removeProperty('--bd'); lb.style.removeProperty('--ui'); }
  function openLb(i) {
    clearTimeout(closeTimer); resetDrag(); show(i);
    lb.classList.add('open'); body.classList.add('lb-open'); lb.focus();
    void lb.offsetWidth; lb.classList.add('show');
  }
  function closeLb() {
    lb.classList.remove('show'); body.classList.remove('lb-open');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () { lb.classList.remove('open'); resetDrag(); }, 260);
  }
  zoomables.forEach(function (im, i) { im.addEventListener('click', function () { openLb(i); }); });
  $('#lb .x').onclick = closeLb; $('#lb .p').onclick = function (e) { e.stopPropagation(); show(idx - 1); }; $('#lb .n').onclick = function (e) { e.stopPropagation(); show(idx + 1); };
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });

  // swipe up (or drag up with a mouse) to dismiss: the image follows the finger, the backdrop fades, then it flies off
  var drag = null;
  lb.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), dy: 0, mode: '' };
  });
  lb.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.mode = dy < 0 && Math.abs(dy) > Math.abs(dx) ? 'up' : 'none';
      if (drag.mode === 'up') { lb.classList.add('drag'); try { lb.setPointerCapture(e.pointerId); } catch (x) {} }
    }
    if (drag.mode !== 'up') return;
    drag.dy = Math.min(0, dy);
    var p = Math.min(1, -drag.dy / (innerHeight * 0.45));
    lbImg.style.transform = 'translateY(' + drag.dy + 'px) scale(' + (1 - p * 0.1) + ')';
    lb.style.setProperty('--bd', (0.88 * (1 - p)).toFixed(3));
    lb.style.setProperty('--ui', Math.max(0, 1 - p * 1.6).toFixed(3));
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (d.mode !== 'up') return;
    lb.classList.remove('drag');
    var fast = -d.dy / Math.max(1, Date.now() - d.t) > 0.5;
    if (e.type !== 'pointercancel' && (-d.dy > 90 || fast)) {
      lbImg.style.transition = 'transform .28s cubic-bezier(.4,0,.8,.4)';
      lbImg.style.transform = 'translateY(-' + Math.round(innerHeight * 0.9) + 'px) scale(.9)';
      lb.style.setProperty('--bd', '0'); lb.style.setProperty('--ui', '0');
      closeLb();
      setTimeout(function () { lbImg.style.transition = ''; }, 320);
    } else { lbImg.style.transform = ''; lb.style.removeProperty('--bd'); lb.style.removeProperty('--ui'); }
  }
  lb.addEventListener('pointerup', endDrag); lb.addEventListener('pointercancel', endDrag);

  // ---------- hero strip: endless, slow, pauses 8 s after the reader touches it ----------
  var strip = $('.shots');
  if (strip) {
    var originals = $$('img', strip), SPEED = 28, PAUSE = 8000;
    // two extra copies so the strip can wrap in either direction without a visible jump
    for (var c = 0; c < 2; c++) originals.forEach(function (im, i) {
      var k = im.cloneNode(true); k.removeAttribute('data-zoom'); k.setAttribute('aria-hidden', 'true'); k.alt = '';
      k.addEventListener('click', function () { openLb(zoomables.indexOf(im)); });
      strip.appendChild(k);
    });
    var period = 0, pos = 0, last = 0, pausedUntil = 0, visible = true, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var measure = function () { var k = strip.children[originals.length]; period = k ? k.offsetLeft - originals[0].offsetLeft : 0; };
    var touchedNow = function () { pausedUntil = performance.now() + PAUSE; };
    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'keydown'].forEach(function (n) { strip.addEventListener(n, touchedNow, { passive: true }); });
    strip.addEventListener('scroll', function () {
      if (!period) return;
      // keep the reader inside the middle copy: wrapping by one period is invisible
      if (strip.scrollLeft >= period * 2) strip.scrollLeft -= period;
      else if (strip.scrollLeft < 1) strip.scrollLeft += period;
      pos = strip.scrollLeft;
    }, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(strip);
    var tick = function (now) {
      requestAnimationFrame(tick);
      var dt = Math.min(64, now - (last || now)); last = now;
      if (!period) { measure(); if (period) { pos = period; strip.scrollLeft = pos; } return; }
      if (reduce || !visible || document.hidden || lb.classList.contains('open') || now < pausedUntil) { pos = strip.scrollLeft; return; }
      pos += (SPEED * dt) / 1000;
      if (pos >= period * 2) pos -= period;
      strip.scrollLeft = pos;
    };
    addEventListener('resize', function () { var f = period ? strip.scrollLeft / period : 1; measure(); strip.scrollLeft = f * period; pos = strip.scrollLeft; });
    addEventListener('load', function () { var f = period ? strip.scrollLeft / period : 1; measure(); strip.scrollLeft = f * period; pos = strip.scrollLeft; });
    requestAnimationFrame(tick);
  }

  // ---------- search with snippets ----------
  var q = $('#q'), results = $('#results');
  var index = [];
  var cur = { id: '', title: '' };
  $$('article h2, article h3, article p, article li, article td, .foot').forEach(function (el) {
    if (el.closest('.demo,figcaption')) return;
    if (el.tagName === 'H2' || el.tagName === 'H3') { cur = { id: el.id, title: el.firstChild.textContent.replace(/^\d+\.\s*/, '') }; }
    var t = el.textContent.replace(/#$/, '').replace(/\s+/g, ' ').trim();
    if (t) index.push({ el: el, id: cur.id, title: cur.title, text: t, low: t.toLowerCase(), head: /^H/.test(el.tagName) });
  });
  $$('figure.shot figcaption').forEach(function (c) {
    var f = c.closest('figure'); var t = c.textContent.trim();
    var h = f.closest('.sec') && f.closest('.sec').querySelector('h2');
    var prev = f; var title = '', id = '';
    while (prev) { prev = prev.previousElementSibling; if (prev && /^H[23]$/.test(prev.tagName)) { id = prev.id; title = prev.firstChild.textContent; break; } }
    if (!id && h) { id = h.id; title = h.firstChild.textContent.replace(/^\d+\.\s*/, ''); }
    index.push({ el: f, id: id, title: title + ' · screenshot', text: t, low: t.toLowerCase(), head: false });
  });
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function snippet(text, low, v) {
    var i = low.indexOf(v), s = Math.max(0, i - 40), e = Math.min(text.length, i + v.length + 70);
    return (s ? '…' : '') + esc(text.slice(s, i)) + '<mark>' + esc(text.slice(i, i + v.length)) + '</mark>' + esc(text.slice(i + v.length, e)) + (e < text.length ? '…' : '');
  }
  function search() {
    var v = q.value.trim().toLowerCase();
    body.classList.toggle('searching', v.length > 1);
    results.classList.toggle('show', v.length > 1);
    if (v.length < 2) { results.innerHTML = ''; return; }
    var hits = index.filter(function (x) { return x.low.indexOf(v) >= 0; });
    hits.sort(function (a, b) { return (b.head ? 1 : 0) - (a.head ? 1 : 0); });
    var seen = {}, out = [];
    hits.forEach(function (h) { var k = h.text.slice(0, 60); if (!seen[k] && out.length < 14) { seen[k] = 1; out.push(h); } });
    window.__hits = out;
    results.innerHTML = out.length
      ? out.map(function (h, i) { return '<a href="#' + h.id + '" data-i="' + i + '"><small>' + esc(h.title) + '</small>' + snippet(h.text, h.low, v) + '</a>'; }).join('')
      : '<div class="none">No matches for “' + esc(q.value.trim()) + '”.</div>';
  }
  q.addEventListener('input', search);
  results.addEventListener('click', function (e) {
    var a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    var h = window.__hits[+a.dataset.i]; if (!h) return;
    body.classList.remove('nav-open');
    h.el.scrollIntoView({ block: 'center' });
    h.el.classList.remove('flash'); void h.el.offsetWidth; h.el.classList.add('flash');
  });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var a = $('#results a'); if (a) a.click(); }
    if (e.key === 'Escape') { q.value = ''; search(); q.blur(); }
  });
  addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lb.classList.contains('open')) return closeLb();
    if (lb.classList.contains('open')) {
      if (e.key === 'ArrowRight') show(idx + 1);
      if (e.key === 'ArrowLeft') show(idx - 1);
      return;
    }
    var t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); body.classList.add('nav-open'); q.focus(); q.select(); }
  });

  // ---------- live demo: double space closes the nearest open symbol ----------
  var demo = $('#demo-ds');
  if (demo) {
    var OPEN = { '(': ')', '[': ']', '{': '}', '«': '»', '“': '”', '﴿': '﴾', '‘': '’', '‹': '›' };
    var CLOSERS = {}; Object.keys(OPEN).forEach(function (k) { CLOSERS[OPEN[k]] = k; });
    var ta = $('textarea', demo), st = $('.status', demo), on = $('input[type=checkbox]', demo), prev = '';
    var blank = function (m) { return new Array(m.length + 1).join(' '); };
    function closeOnDoubleSpace(p, n, caret) {
      if (n.length !== p.length + 1 || caret < 2) return null;
      var head;
      if (n.slice(caret - 2, caret) === '  ' && n.slice(0, caret - 1) + n.slice(caret) === p) head = n.slice(0, caret - 2);
      else if (n.slice(caret - 2, caret) === '. ' && n.slice(0, caret - 2) + n.slice(caret - 1) === p && /\s$/.test(p.slice(0, caret - 1))) head = n.slice(0, caret - 2);
      else return null;
      // placeholders and tags are never brackets/quotes
      var plain = head.replace(/<[^>]*>/g, blank).replace(/%(\d+\$)?[sdfSD]/g, blank).replace(/\{\s*\d+\s*\}/g, blank);
      var stack = [];
      for (var i = 0; i < plain.length; i++) {
        var ch = plain[i];
        if (OPEN[ch]) stack.push({ idx: i, closer: OPEN[ch] });
        else if (CLOSERS[ch]) { for (var j = stack.length - 1; j >= 0; j--) if (stack[j].closer === ch) { stack.splice(j, 1); break; } }
      }
      ['"', "'"].forEach(function (qc) {
        var at = [];
        for (var k = 0; k < plain.length; k++) {
          if (plain[k] !== qc) continue;
          if (qc === "'" && /[\p{L}\p{N}]/u.test(plain[k - 1] || '') && /[\p{L}\p{N}]/u.test(plain[k + 1] || '')) continue;
          at.push(k);
        }
        if (at.length % 2 === 1) stack.push({ idx: at[at.length - 1], closer: qc });
      });
      if (!stack.length) return null;
      var nearest = stack.reduce(function (a, b) { return b.idx > a.idx ? b : a; });
      var rest = n.slice(caret).replace(/^ /, '');
      return { text: head + nearest.closer + ' ' + rest, caret: head.length + nearest.closer.length + 1, closer: nearest.closer };
    }
    ta.addEventListener('input', function () {
      var n = ta.value;
      if (on.checked) {
        var r = closeOnDoubleSpace(prev, n, ta.selectionStart);
        if (r) { ta.value = r.text; ta.setSelectionRange(r.caret, r.caret); st.textContent = 'Closed with ' + r.closer + '  — done in one double space.'; n = r.text; }
        else st.textContent = '';
      } else st.textContent = '';
      prev = n;
    });
    on.addEventListener('change', function () { st.textContent = on.checked ? '' : 'Auto-correct is off: text stays exactly as typed.'; });
    $$('.chips button', demo).forEach(function (b) {
      b.addEventListener('click', function () { ta.value = b.dataset.t; prev = ta.value; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); st.textContent = 'Now press Space twice.'; });
    });
  }
})();
