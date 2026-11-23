
(function () {
  'use strict';

  // constants, straight out of the as

  var VINE_Y      = 65;    // MainNav.vineY
  var NAV_Y       = 125;   // MainNav.navY
  var NAV_Y_NO_PLAY = 80;  // <nav data-no-play>: rows move up into the button's space
  var CONTENT_Y   = 10;    // MainNavVineBorder._contenty
  var ROW_H       = 28;    // MainNavMenu._navheight
  var TOP_H       = 170;   // topvine bitmap height
  var BOT_H       = 213;   // bottomvine bitmap height
  var MID_H       = 3;     // middlevine bitmap height (stretched)
  var LEAF_H      = 757;   // leaf_leftnav background height - hard ceiling
  var BOTTOM_PAD  = 0;     // _bottomPadding
  var MIN_H       = TOP_H + MID_H + BOT_H;
  var STAGGER     = 0.05;  // transitionIn delay per row

  var PNGTHUMB_W  = 128;   // PngThumb default _w - see the logo comment below
  var LOGO_W      = 230;   // FairiesLogo bitmap width

  var ASSETS      = '/site/nav/';
  var NAV_XML     = '/site/nav.xml';

  // soundmanager stub

  var SoundManager = {
    // the SWF referenced sound ids in a shared library; no audio in the export.
    playSound: function (id) { /* console.log('sound:', id); */ }
  };

  // data loading

  // mainnav.xml isn't well formed
  function sanitizeXml(src) {
    return src.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  }

  function loadNav() {
    return fetch(NAV_XML)
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      })
      .then(function (src) {
        var doc = new DOMParser().parseFromString(sanitizeXml(src), 'text/xml');
        var err = doc.querySelector('parsererror');
        if (err) throw new Error('mainnav.xml did not parse: ' + err.textContent);
        return parseNav(doc);
      });
  }

  // pageObject / NavObject / PromoObject
  function parseNav(doc) {
    var page = doc.getElementsByTagName('page')[0];
    var strings = {};
    Array.prototype.forEach.call(doc.getElementsByTagName('str'), function (s) {
      strings[s.getAttribute('id')] = s.textContent;
    });

    return {
      navs: childElements(page, 'nav').map(parseNavObject),
      promos: childElements(page, 'promo').map(function (p) {
        var pos = p.getAttribute('position');
        var tip = p.getElementsByTagName('tiptext')[0];
        return {
          id: p.getAttribute('id'),
          href: p.getAttribute('href') || '',
          target: p.getAttribute('target') || '',
          tiptext: tip ? tip.textContent.trim() : '',
          position: pos ? JSON.parse(pos) : null
        };
      }),
      strings: strings
    };
  }

  function parseNavObject(el) {
    // items with children carry a <title>; leaf items use their own text node.
    var titleEl = childElements(el, 'title')[0];
    var title = titleEl
      ? titleEl.textContent.trim()
      : Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3; })
          .map(function (n) { return n.nodeValue; }).join('').trim();

    return {
      id: el.getAttribute('id'),
      href: el.getAttribute('href') || '',
      target: el.getAttribute('target') || '',
      staff: el.getAttribute('staff') === 'true',
      admin: el.getAttribute('admin') === 'true',
      title: title,
      subnav: childElements(el, 'nav').map(parseNavObject)
    };
  }

  function childElements(parent, tag) {
    return Array.prototype.filter.call(parent.childNodes, function (n) {
      return n.nodeType === 1 && n.nodeName.toLowerCase() === tag;
    });
  }

  // pixie dust (pixiedust.as + dustparticle.as + starparticle.as)

  var starFrames = null;
  function loadStarFrames() {
    if (starFrames) return starFrames;
    starFrames = [];
    for (var i = 1; i <= 26; i++) {
      var img = new Image();
      img.src = ASSETS + 'star/' + i + '.png';
      starFrames.push(img);
    }
    return starFrames;
  }

  var PARTICLE_LEVEL = 112 / 255;

  // the swf's frame rate, speed and lifetime are per frame so the sim runs on a fixed 24
  var SWF_FPS = 24;
  var STEP_MS = 1000 / SWF_FPS;

  function Dust(canvas, w, h) {
    this.canvas = canvas;
    this.w = w;
    this.h = h;
    this.ctx = canvas.getContext('2d');
    canvas.width = w;
    canvas.height = h;

    // pixieDust settings as configured in MainNavBtn.init()
    this.numParticles = 5;
    this.particleFrequency = 3;
    this.starRatio = 0.1;
    this.vx = 0;
    this.vy = -0.2;
    this.decay = 0.02;
    this.radius = w;

    this.frequencyCount = 0;
    this.dust = [];
    this.stars = [];
    this.windDown = false;
    this.raf = 0;
    this.newpoint = { x: 0, y: 0 };
    this.oldpoint = { x: 0, y: 0 };
  }

  Dust.prototype.start = function () {
    loadStarFrames();
    this.windDown = false;
    if (!this.raf) {
      this.lastTime = null;
      this.acc = 0;
      this.tick(0);
    }
  };

  // pixieDust.stop(): stop spawning, let what is on screen finish.
  Dust.prototype.stop = function () { this.windDown = true; };

  Dust.prototype.tick = function (now) {
    var self = this;
    this.raf = requestAnimationFrame(function (t) { self.tick(t); });

    if (this.lastTime === null) this.lastTime = now;
    this.acc += Math.min(now - this.lastTime, 250);   // cap after a stall
    this.lastTime = now;

    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      this.step();
    }
    this.draw();

    // only give up once spawning has stopped and the last particle is gone
    if (this.windDown && !this.dust.length && !this.stars.length) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.windDown = false;
      this.ctx.clearRect(0, 0, this.w, this.h);
      if (this.onIdle) this.onIdle();
    }
  };

  Dust.prototype.step = function () {
    this.oldpoint = this.newpoint;
    this.newpoint = {
      x: Math.floor(Math.random() * 100) + 50,
      y: Math.floor(Math.random() * 200) + 50
    };

    if (!this.windDown) this.addParticles();

    var i, p;
    for (i = this.dust.length - 1; i >= 0; i--) {
      p = this.dust[i];
      p.x += this.vx * p.dir.x;
      p.y += this.vy * p.dir.y;
      p.alpha -= this.decay;
      if (p.alpha < 0.05) this.dust.splice(i, 1);
    }
    for (i = this.stars.length - 1; i >= 0; i--) {
      p = this.stars[i];
      p.x += this.vx * p.dir.x;
      p.y += this.vy * p.dir.y;
      p.frame++;
      if (p.frame >= 26) this.stars.splice(i, 1);
    }
  };

  Dust.prototype.addParticles = function () {
    if (this.particleFrequency === this.frequencyCount) {
      this.frequencyCount = 0;
      return;
    }
    this.frequencyCount++;

    var dir = { x: -1, y: -1 };
    if (this.newpoint.x - this.oldpoint.x > 0) dir.x = 2;
    else if (this.newpoint.x === this.oldpoint.x) dir.x = 1;
    if (this.newpoint.y - this.oldpoint.y > 0) dir.y = 2;
    else if (this.newpoint.y === this.oldpoint.y) dir.y = 1;

    for (var i = 0; i < this.numParticles; i++) {
      var x = this.newpoint.x - Math.random() * this.radius + Math.random() * this.radius;
      var y = this.newpoint.y - Math.random() * this.radius + Math.random() * this.radius;
      if (y < -8 || y > this.h + 8) continue;
      if (Math.random() < this.starRatio) {
        this.stars.push({ x: x, y: y, dir: dir, frame: 0 });
      } else {
        this.dust.push({ x: x, y: y, dir: dir, alpha: Math.min(1, Math.random() + 0.5) });
      }
    }
  };

  Dust.prototype.draw = function () {
    var g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    // particles are composited normally
    g.globalCompositeOperation = 'source-over';
    var i, p;
    g.fillStyle = '#fff';
    for (i = 0; i < this.dust.length; i++) {
      p = this.dust[i];
      g.globalAlpha = Math.max(0, p.alpha) * PARTICLE_LEVEL;
      g.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);   // DustParticle.draw   // DustParticle.draw
    }
    for (i = 0; i < this.stars.length; i++) {
      p = this.stars[i];
      var img = starFrames[p.frame];
      if (img && img.complete && img.naturalWidth) {
        g.globalAlpha = 1;
        g.drawImage(img, p.x - 22, p.y - 22);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  };

  // tooltip (tooltip.as)

  function ToolTip(text) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip';
    this.el.innerHTML =
      '<div class="tooltip__balloon">' +
        '<img class="tooltip__dust tooltip__dust--left" src="' + ASSETS + 'tip-dust-left.png" alt="">' +
        '<img class="tooltip__dust tooltip__dust--right" src="' + ASSETS + 'tip-dust-right.png" alt="">' +
        '<span></span>' +
      '</div>';
    this.el.querySelector('span').textContent = text;
  }
  ToolTip.prototype.show = function () { this.el.classList.add('is-on'); };
  ToolTip.prototype.hide = function () { this.el.classList.remove('is-on'); };

  // menu (mainnavmenu.as + mainnavbtn.as + mainnavsubbtn.as)

  function Menu(data, strings, onClick) {
    this.data = data;
    this.id = data.id;
    this.isOpen = false;
    this.subHeight = data.subnav.length * ROW_H;

    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.style.opacity = '0';

    this.mainbtn = buildRow(data, 'row--main', strings, onClick);
    this.el.appendChild(this.mainbtn);

    // dust layer, top level rows only
    var canvas = document.createElement('canvas');
    canvas.className = 'dust';
    this.dust = new Dust(canvas, 194, ROW_H);

    var self = this;
    var dustTimer = 0;
    var attach = function () {
      if (!canvas.parentNode) self.mainbtn.appendChild(canvas);
      self.dust.start();
    };
    this.dust.onIdle = function () {
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };

    this.mainbtn.addEventListener('mouseenter', function () {
      attach();
      // tweenMax.delayedCall(3, resetDust)
      clearTimeout(dustTimer);
      dustTimer = setTimeout(function () { self.dust.stop(); }, 3000);
    });
    this.mainbtn.addEventListener('mouseleave', function () {
      clearTimeout(dustTimer);
      self.dust.stop();
    });

    // ?dust - run the dust on every row without hovering, for tuning it.
    if (/[?&]dust\b/.test(location.search)) attach();

    if (data.subnav.length) {
      this.subEl = document.createElement('div');
      this.subEl.className = 'sub';
      var inner = document.createElement('div');
      inner.className = 'sub__inner';
      this.subRows = data.subnav.map(function (sd) {
        var row = buildRow(sd, 'row--sub', strings, onClick);
        inner.appendChild(row);
        return row;
      });
      this.subEl.appendChild(inner);
      this.el.appendChild(this.subEl);
    } else {
      this.subRows = [];
    }
  }

  Menu.prototype.open = function (path) {
    if (!this.isOpen) {
      this.isOpen = true;
      if (this.subEl) {
        this.subEl.style.height = this.subHeight + 'px';
        SoundManager.playSound('leftnav_expand');
      }
      this.mainbtn.classList.add('is-on');
    }
    this.update(path);
  };

  Menu.prototype.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.mainbtn.classList.remove('is-on');
    if (this.subEl) this.subEl.style.height = '0px';
  };

  // mainNavMenu.update: exact id match first, prefix match as a fallback.
  Menu.prototype.update = function (path) {
    if (!this.subRows.length) return;
    var self = this;
    this.data.subnav.forEach(function (s, i) {
      var on = s.id === path;
      self.subRows[i].classList.toggle('is-on', on);
      if (on) self.subRows[i].setAttribute('aria-current', 'page');
      else self.subRows[i].removeAttribute('aria-current');
    });
  };

  Menu.prototype.setY = function (y) {
    this.el.style.top = y + 'px';
  };

  function buildRow(data, cls, strings, onClick) {
    var comingSoon = data.target === 'coming_soon';
    var row = document.createElement(comingSoon ? 'div' : 'a');
    row.className = 'row ' + cls + (comingSoon ? ' row--disabled' : '');
    if (!comingSoon) row.href = data.href || '#';

    var label = document.createElement('span');
    label.className = 'label';
    label.textContent = data.title;
    row.appendChild(label);

    if (comingSoon) {
      // mainNavBtn/SubBtn swap the label for the "coming_soon" string on hover.
      var real = data.title;
      var soon = strings.coming_soon || 'Coming Soon';
      row.addEventListener('mouseenter', function () { label.textContent = soon; });
      row.addEventListener('mouseleave', function () { label.textContent = real; });
    } else {
      row.addEventListener('click', function (e) { onClick(e, data); });
    }
    return row;
  }

  // vine border (mainnavvineborder.as)

  function VineBorder() {
    this.el = document.createElement('div');
    this.el.className = 'vine';
    this.el.innerHTML =
      '<img class="vine__top"    src="' + ASSETS + 'vine-top.png" alt="">' +
      '<img class="vine__mid"    src="' + ASSETS + 'vine-mid.png" alt="">' +
      '<img class="vine__bottom" src="' + ASSETS + 'vine-bottom.png" alt="">';
    this.mid = this.el.querySelector('.vine__mid');
    this.bottom = this.el.querySelector('.vine__bottom');

    this.content = document.createElement('div');
    this.content.className = 'content';
    this.content.innerHTML = '<img class="content__leaf" src="' + ASSETS + 'leaf.png" alt="">';
  }

  VineBorder.prototype.resize = function (newheight, animate) {
    var h = newheight + CONTENT_Y * 2 + BOTTOM_PAD;
    var mid, maskH;

    if (h <= MIN_H) {
      // faithful quirk, the AS restores middleheight which is never assigned so a uint 0
      mid = 0;
      maskH = 384;
    } else {
      if (h > LEAF_H) h = LEAF_H;          // clamped by the leaf bitmap
      mid = h - (TOP_H + BOT_H);
      maskH = h - CONTENT_Y * 2 + 2;       // the +2 comes from resize()
    }

    var self = this;
    applyMaybeAnimated([this.mid, this.bottom, this.content], animate, function () {
      self.mid.style.height = mid + 'px';
      self.bottom.style.top = (TOP_H + mid) + 'px';
      self.content.style.height = maskH + 'px';
    });
    return VINE_Y + h;
  };

  // apply style changes with the transition suppressed when animate is false
  function applyMaybeAnimated(els, animate, fn) {
    if (animate) { fn(); return; }
    els.forEach(function (el) { el.style.transitionDuration = '0s'; });
    fn();
    if (els.length) void els[0].offsetHeight;   // flush styles at 0s
    els.forEach(function (el) { el.style.transitionDuration = ''; });
  }

  // main nav (mainnav.as)

  function MainNav(root, data) {
    this.root = root;
    this.data = data;
    this.root.classList.add('nav');

    this.showPlay = !root.hasAttribute('data-no-play');
    this.navY = this.showPlay ? NAV_Y : NAV_Y_NO_PLAY;

    this.vine = new VineBorder();
    this.menus = [];

    var self = this;
    var onClick = function (e, nav) { self.navClicked(e, nav); };

    data.navs.forEach(function (nav) {
      var m = new Menu(nav, data.strings, onClick);
      self.menus.push(m);
      self.vine.content.appendChild(m.el);
    });

    this.root.appendChild(this.vine.content);
    this.root.appendChild(this.vine.el);

    // logo promo - src is empty in the XML because it was baked into the SWF.
    var logoPromo = this.getPromo('mainnav_logo');
    if (logoPromo) {
      var logo = document.createElement('a');
      logo.className = 'logo';
      logo.href = logoPromo.href;
      logo.innerHTML = '<img src="' + ASSETS + 'logo.png" width="230" height="167" alt="Pixie Hollow">';
      if (logoPromo.position) {
        // the promo position places the PngThumb container
        var thumbOffsetX = (PNGTHUMB_W - LOGO_W) / 2;
        logo.style.left = (Number(logoPromo.position.x) + thumbOffsetX) + 'px';
        logo.style.top = Number(logoPromo.position.y) + 'px';
      }
      this.root.appendChild(logo);
    }

    // play button + tooltip
    var playPromo = this.showPlay && this.getPromo('playbtn');
    if (playPromo) {
      var play = document.createElement('a');
      play.className = 'playbtn';
      play.href = '#';
      play.innerHTML = '<img src="' + ASSETS + 'playbtn.png" width="173" height="55" alt="Play">';
      if (playPromo.href === 'login') play.setAttribute('data-login', '');
      else play.href = playPromo.href;
      play.addEventListener('click', function () { SoundManager.playSound('btnclick'); });
      this.root.appendChild(play);

      if (playPromo.tiptext) {
        var tip = new ToolTip(playPromo.tiptext);
        // anchored 7px above the button and centered
        tip.el.style.left = '21px';
        tip.el.style.width = '173px';
        tip.el.style.top = '130px';
        tip.el.style.transform = 'translateY(-100%)';  // grow upward
        tip.el.style.display = 'flex';
        tip.el.style.justifyContent = 'center';
        this.root.appendChild(tip.el);
        play.addEventListener('mouseenter', function () { tip.show(); });
        play.addEventListener('mouseleave', function () { tip.hide(); });
      }
    }

    this.layout(false);
    this.transitionIn();
  }

  MainNav.prototype.getPromo = function (id) {
    return this.data.promos.filter(function (p) { return p.id === id; })[0];
  };

  // menuOpened() + setOnState(): position every row, then resize the vine.
  MainNav.prototype.layout = function (animate) {
    var menus = this.menus;
    var navY = this.navY;
    var openSub = 0;

    applyMaybeAnimated(menus.map(function (m) { return m.el; }), animate, function () {
      var y = navY;
      menus.forEach(function (m) {
        m.setY(y);
        y += ROW_H;
        if (m.isOpen) {
          y += m.subHeight;
          openSub += m.subHeight;
        }
      });
    });

    var contentHeight = navY + openSub + this.menus.length * ROW_H;
    this.vine.resize(contentHeight, animate);

    // externalInterface.call(resizeCallback, totalHeight)
    var totalHeight = contentHeight + VINE_Y + 30;
    this.root.style.height = totalHeight + 'px';
  };

  MainNav.prototype.navClicked = function (e, nav) {
    SoundManager.playSound('leftnav_click');
    var menu = this.menus.filter(function (m) { return m.data === nav; })[0];
    if (menu && menu.subRows.length && !menu.isOpen) {
      e.preventDefault();
      this.openMenu(menu.id, this.currentSub);
    }
  };

  MainNav.prototype.openMenu = function (topId, subId) {
    this.menus.forEach(function (m) {
      if (m.id === topId) m.open(subId || '');
      else m.close();
    });
    this.layout(true);
  };

  // mainNav.update / setOnState - SWFAddress.getPath() becomes location.hash.
  function normalizePath(href) {
    var path = href;
    try { path = new URL(href, location.href).pathname; } catch (err) {}
    path = path.replace(/\/+$/, '').toLowerCase();
    if (path === '' || path === '/index.html' || path === '/home.html') return '/';
    if (path === '/accountmanagement.html' || path === '/accountmanagement') return '/account';
    return path;
  }

  MainNav.prototype.update = function () {
    var here = normalizePath(document.body.dataset.navPath || location.pathname);
    var topId = '';
    var subId = '';

    this.menus.forEach(function (m) {
      if (topId) return;
      m.data.subnav.forEach(function (s) {
        if (!subId && normalizePath(s.href) === here) {
          subId = s.id;
          topId = m.id;
        }
      });
      if (!topId && normalizePath(m.data.href) === here) topId = m.id;
    });

    this.currentSub = subId;
    this.openMenu(topId, subId);
    this.menus.forEach(function (m) {
      if (m.id === topId && !m.subRows.length) m.mainbtn.setAttribute('aria-current', 'page');
    });
  };

  // transitionIn: 0.2s alpha fade with a 0.05s stagger, then apply the route.
  MainNav.prototype.transitionIn = function () {
    var self = this;
    this.menus.forEach(function (m, i) {
      setTimeout(function () { m.el.style.opacity = '1'; }, i * STAGGER * 1000);
    });
    setTimeout(function () { self.update(); }, this.menus.length * STAGGER * 1000);
  };

  // boot

  function whoIsViewing() {
    if (window.site && window.site.loadMe) return window.site.loadMe().catch(function () { return null; });
    return Promise.resolve(null);
  }

  var root = document.getElementById('mainNav');
  if (!root) return;

  // an item can ask for staff or for an Administrator, at any depth
  function visibleTo(items, isStaff, isAdmin) {
    return items
      .filter(function (nav) { return (!nav.staff || isStaff) && (!nav.admin || isAdmin); })
      .map(function (nav) {
        return Object.assign({}, nav, { subnav: visibleTo(nav.subnav || [], isStaff, isAdmin) });
      });
  }

  function build(data, isStaff, isAdmin) {
    var shown = {
      navs: visibleTo(data.navs, isStaff, isAdmin),
      promos: data.promos,
      strings: data.strings
    };
    root.replaceChildren();
    return new MainNav(root, shown);
  }

  // the nav must not wait on /account/me
  loadNav().then(function (data) {
    var hasStaffItems = data.navs.some(function (nav) { return nav.staff; });
    build(data, false);
    if (!hasStaffItems) return;

    whoIsViewing().then(function (me) {
      if (me && me.isStaff) build(data, true, me.accountType === 'Administrator');
    });
  }).catch(function (err) {
    console.error(err);
  });
})();
