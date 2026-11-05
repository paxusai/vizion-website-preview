/* Vizion Insurance — site behaviour (no dependencies). */
(function () {
  'use strict';

  var root = document.documentElement;
  window.__vizReady = true;
  root.classList.remove('reveal-fallback');

  /* ------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------ */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ------------------------------------------------------------------
     Header: scrolled state
     ------------------------------------------------------------------ */
  var header = $('.site-header');
  if (header) {
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        header.classList.toggle('is-scrolled', window.scrollY > 8);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ------------------------------------------------------------------
     Desktop dropdown menus
     ------------------------------------------------------------------ */
  var triggers = $$('[data-dropdown-trigger]');
  function closeAllDropdowns(except) {
    triggers.forEach(function (t) {
      if (t === except) return;
      t.setAttribute('aria-expanded', 'false');
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.classList.remove('is-open');
    });
  }
  triggers.forEach(function (trigger) {
    var panel = document.getElementById(trigger.getAttribute('aria-controls'));
    var item = trigger.closest('.nav-item');
    var hoverTimer;
    function open() {
      closeAllDropdowns(trigger);
      trigger.setAttribute('aria-expanded', 'true');
      panel.classList.add('is-open');
    }
    function close() {
      trigger.setAttribute('aria-expanded', 'false');
      panel.classList.remove('is-open');
    }
    trigger.addEventListener('click', function () {
      trigger.getAttribute('aria-expanded') === 'true' ? close() : open();
    });
    var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (finePointer && item) {
      item.addEventListener('mouseenter', function () { clearTimeout(hoverTimer); open(); });
      item.addEventListener('mouseleave', function () { hoverTimer = setTimeout(close, 160); });
    }
    item.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
        close();
        trigger.focus();
      }
    });
    item.addEventListener('focusout', function (e) {
      if (!item.contains(e.relatedTarget)) close();
    });
    // Same-page product links change only the hash, so close the menu explicitly.
    $$('a', panel).forEach(function (a) { a.addEventListener('click', close); });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-item')) closeAllDropdowns();
  });

  /* ------------------------------------------------------------------
     Mobile navigation
     ------------------------------------------------------------------ */
  var mobileNav = $('#mobile-nav');
  var menuOpenBtn = $('[data-menu-open]');
  var menuCloseBtn = $('[data-menu-close]');
  function setMenu(open) {
    if (!mobileNav) return;
    mobileNav.classList.toggle('is-open', open);
    mobileNav.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('nav-open', open);
    if (menuOpenBtn) menuOpenBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      setTimeout(function () { (menuCloseBtn || mobileNav).focus(); }, 50);
    } else if (menuOpenBtn) {
      menuOpenBtn.focus();
    }
  }
  if (mobileNav && menuOpenBtn) {
    menuOpenBtn.addEventListener('click', function () { setMenu(true); });
    if (menuCloseBtn) menuCloseBtn.addEventListener('click', function () { setMenu(false); });
    mobileNav.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { setMenu(false); return; }
      if (e.key !== 'Tab') return;
      var focusables = $$('a[href], button:not([disabled]), summary', mobileNav).filter(function (el) {
        return el.offsetParent !== null;
      });
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    $$('a', mobileNav).forEach(function (a) {
      a.addEventListener('click', function () {
        mobileNav.classList.remove('is-open');
        document.body.classList.remove('nav-open');
        mobileNav.setAttribute('aria-hidden', 'true');
        menuOpenBtn.setAttribute('aria-expanded', 'false');
      });
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1080 && mobileNav.classList.contains('is-open')) setMenu(false);
    });
  }

  /* ------------------------------------------------------------------
     Office hours: Monday–Saturday, 8:00 AM – 5:00 PM, Saipan time
     (Chamorro Standard Time, UTC+10, no daylight saving).
     ------------------------------------------------------------------ */
  var OPEN_MIN = 8 * 60;
  var CLOSE_MIN = 17 * 60;
  function saipanNow() {
    var d = new Date(Date.now() + 10 * 60 * 60 * 1000);
    return { day: d.getUTCDay(), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
  function officeStatus() {
    var now = saipanNow();
    var workday = now.day >= 1 && now.day <= 6;
    if (workday && now.mins >= OPEN_MIN && now.mins < CLOSE_MIN) {
      return { open: true, text: 'Office open now · until 5:00 PM', day: now.day };
    }
    var next;
    if (workday && now.mins < OPEN_MIN) next = 'today';
    else if (now.day >= 1 && now.day <= 5) next = 'tomorrow';
    else next = 'Monday';
    return { open: false, text: 'Office closed · opens ' + next + ' at 8:00 AM', day: now.day };
  }
  function renderStatus() {
    var s = officeStatus();
    $$('[data-open-status]').forEach(function (el) {
      el.classList.toggle('is-open', s.open);
      el.classList.toggle('is-closed', !s.open);
      var label = $('.status-text', el);
      if (label) label.textContent = s.text;
      el.setAttribute('title', 'Based on Saipan time (ChST). Hours may differ on public holidays.');
    });
    $$('[data-hours-day]').forEach(function (row) {
      row.classList.toggle('is-today', Number(row.getAttribute('data-hours-day')) === s.day);
    });
  }
  if ($('[data-open-status]') || $('[data-hours-day]')) {
    renderStatus();
    setInterval(renderStatus, 60 * 1000);
  }

  /* ------------------------------------------------------------------
     Scroll reveal
     ------------------------------------------------------------------ */
  var revealEls = $$('[data-reveal], .timeline');
  if ('IntersectionObserver' in window && !prefersReducedMotion()) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* Timeline progress line follows the scroll position. */
  var timeline = $('.timeline');
  var fill = timeline && $('.timeline-fill', timeline);
  if (timeline && fill && !prefersReducedMotion()) {
    var updateTimeline = function () {
      var r = timeline.getBoundingClientRect();
      var vh = window.innerHeight;
      var p = (vh * 0.65 - r.top) / r.height;
      fill.style.setProperty('--progress', Math.max(0, Math.min(1, p)).toFixed(3));
    };
    window.addEventListener('scroll', function () { window.requestAnimationFrame(updateTimeline); }, { passive: true });
    updateTimeline();
  }

  /* ------------------------------------------------------------------
     Product explorer (tabs). Each panel's id doubles as a link target,
     so insurance.html#liability opens the Liability tab.
     ------------------------------------------------------------------ */
  $$('[data-finder]').forEach(function (finder) {
    var tabs = $$('[role="tab"]', finder);
    var panels = $$('[role="tabpanel"]', finder);
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      panels.forEach(function (p) {
        var on = p.id === tab.getAttribute('aria-controls');
        p.hidden = !on;
        if (on) {
          p.classList.remove('is-entering');
          void p.offsetWidth;
          p.classList.add('is-entering');
        }
      });
      if (focus) tab.focus();
    }
    function tabForHash() {
      var id = decodeURIComponent(window.location.hash.slice(1));
      return id ? tabs.filter(function (t) { return t.getAttribute('aria-controls') === id; })[0] : null;
    }
    function showFinder(smooth) {
      // Skip the reveal transition so the explorer is measured where it will rest.
      finder.style.transition = 'none';
      finder.classList.add('is-in');
      void finder.offsetWidth;
      finder.style.transition = '';
      // On narrow screens the panel sits below the tab buttons, so bring the panel itself into view.
      var target = window.matchMedia('(min-width: 900px)').matches ? finder : panels.filter(function (p) { return !p.hidden; })[0];
      // 'instant' rather than 'auto': the stylesheet sets smooth scrolling for the whole page.
      (target || finder).scrollIntoView({ behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'instant', block: 'start' });
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === 'Home') next = tabs[0];
        if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
    var linked = tabForHash();
    var initial = linked || tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
    if (initial) select(initial, false);
    // Wait for images and fonts so the jump lands where the explorer finally sits.
    if (linked) {
      if (document.readyState === 'complete') showFinder(false);
      else window.addEventListener('load', function () { showFinder(false); });
    }
    window.addEventListener('hashchange', function () {
      var tab = tabForHash();
      if (tab) { select(tab, false); showFinder(true); }
    });
  });

  /* ------------------------------------------------------------------
     Map: loads Google Maps only when the visitor asks for it.
     ------------------------------------------------------------------ */
  $$('[data-map]').forEach(function (wrap) {
    var btn = $('[data-map-load]', wrap);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var iframe = document.createElement('iframe');
      iframe.src = wrap.getAttribute('data-map');
      iframe.title = 'Map showing the Vizion Insurance office on Beach Road, San Jose, Saipan';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer-when-downgrade';
      iframe.setAttribute('allowfullscreen', '');
      wrap.appendChild(iframe);
      var ph = $('.map-placeholder', wrap);
      if (ph) ph.remove();
    });
  });

  /* ------------------------------------------------------------------
     Footer year
     ------------------------------------------------------------------ */
  $$('[data-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
