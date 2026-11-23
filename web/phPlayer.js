// pixie hollow player loader, ruffle when it is available and the real flash plugin when it is not
// phPlayer.embed({ container, swf, width, height, flashvars, base, bgcolor })
// order: installed flash, then the ruffle extension, then the bundled ruffle in ruffle/
// ?player=flash forces flash, ?player=bundled (or ruffle) forces the bundled ruffle
// the swf's ExternalInterface calls still work, getSWF() doesn't so use phPlayer.getPlayer

var phPlayer = (function () {
   "use strict";

   var RUFFLE_JS = "ruffle/ruffle.js";

   // the client opens a raw tcp socket to the clientagent, browsers can't, so ruffle routes it over a websocket
   // socket-bridge/bridge.js turns it back into tcp, without this the client hangs on loading (error #2002)
   // over https put the bridge behind the same origin and pass socketProxy with a wss:// url
   var GAME_SOCKET = { host: "127.0.0.1", port: 8012 };
   var BRIDGE_PORT = 9014;

   // fonts.swf has the four fonts the client uses, FontManager registers them by SharedFontN class name
   // do not put it in fontSources or defaultFonts, that blanks panel text and renders the debug console in pristina
   // render/src/aliasFonts.js writes renamed copies so every name the client asks for resolves, all three are listed
   var FONT_SOURCES = [
      "swf/fonts.swf",             // Arial 4FRTL, pixie_font.v01d, Pristina-4FRTL, HelveticaRounded LT Bold 4FRTL
      "swf/fonts-sharedname.swf",  // SharedFont0-3, which is what Ruffle reports as fontName
      "swf/fonts-unmangled.swf",   // Arial, pixie_font, Pristina, HelveticaRounded LT Bold
      "swf/fonts-variants.swf"     // further spellings seen in Ruffle's warnings
   ];

   function defaultSocketProxy() {
      var scheme = location.protocol === "https:" ? "wss" : "ws";
      var bridgeHost = location.hostname === "localhost" ? "127.0.0.1" : location.hostname;
      var isRemoteOrHttps = location.protocol === "https:" || (location.hostname !== "127.0.0.1" && location.hostname !== "localhost");
      var proxyUrl = isRemoteOrHttps
         ? scheme + "://" + location.host + "/gamesocket"
         : scheme + "://" + bridgeHost + ":" + BRIDGE_PORT;

      return [
         {
            host: "127.0.0.1",
            port: GAME_SOCKET.port,
            proxyUrl: proxyUrl
         },
         {
            host: "localhost",
            port: GAME_SOCKET.port,
            proxyUrl: proxyUrl
         }
      ];
   }

   // Matches the version the site has always asked for. Only consulted on the
   // fallback path, and only to decide between Flash and the upgrade page.
   var FLASH_VERSION = "10.0.0";

   var player = null;
   var kind = null;
   // "extension" or "bundled" while kind is "ruffle"
   var source = null;

   function log(message) {
      if (window.console && console.log) {
         console.log("[phPlayer] " + message);
      }
   }

   function applyGlobalRuffleConfig(options) {
      window.RufflePlayer = window.RufflePlayer || {};
      window.RufflePlayer.config = window.RufflePlayer.config || {};
      var cfg = window.RufflePlayer.config;

      var proxy = (options && options.socketProxy) || defaultSocketProxy();
      cfg.socketProxy = proxy;

      var base = (options && options.base) || "/";
      if (base.charAt(base.length - 1) !== "/") base += "/";
      var fonts = ((options && options.fontSources) || FONT_SOURCES).map(function (src) {
         if (src.indexOf("://") !== -1 || src.charAt(0) === "/") return src;
         return base + src.replace(/^\.\//, "");
      });
      cfg.fontSources = fonts;
      cfg.allowScriptAccess = true;
      cfg.autoplay = "on";
      cfg.unmuteOverlay = "hidden";
      cfg.splashScreen = false;
   }

   /** load ruffle.js and resolve with its player factory, or null (never rejects, failure means use flash) */
   function loadRuffle(options) {
      applyGlobalRuffleConfig(options);

      return new Promise(function (resolve) {
         // If self-hosted Ruffle with socketProxy support is already registered, use it.
         if (window.RufflePlayer && window.RufflePlayer.sources && window.RufflePlayer.sources.local) {
            return resolve(window.RufflePlayer.sources.local);
         }

         var script = document.createElement("script");
         script.src = RUFFLE_JS;

         script.onload = function () {
            // The script sets window.RufflePlayer as a side effect.
            if (window.RufflePlayer) {
               var local = window.RufflePlayer.sources && window.RufflePlayer.sources.local;
               if (local) {
                  return resolve(local);
               }
               if (window.RufflePlayer.newest) {
                  return resolve(window.RufflePlayer.newest());
               }
            }
            log("ruffle.js loaded but exposed no player");
            resolve(null);
         };

         script.onerror = function () {
            log("could not load " + RUFFLE_JS);
            resolve(null);
         };

         document.head.appendChild(script);
      });
   }

   // the ruffle extension fakes a flash plugin, hasFlash() leaves it out and handles it separately
   function isRuffleStandIn() {
      try {
         var plugin = navigator.plugins && navigator.plugins["Shockwave Flash"];
         return !!plugin && plugin.filename === "ruffle.js";
      } catch (e) {
         return false;
      }
   }

   function extensionSource() {
      var ruffle = window.RufflePlayer;
      return (ruffle && ruffle.sources && ruffle.sources.extension) || null;
   }

   // the extension's plugin shows up before its ruffle is ready, wait for it and give up after a while
   function waitForExtension(ms) {
      return new Promise(function (resolve) {
         var waited = 0;

         (function check() {
            var source = extensionSource();
            if (source || waited >= ms) {
               return resolve(source);
            }

            waited += 50;
            setTimeout(check, 50);
         })();
      });
   }

   function hasFlash() {
      if (isRuffleStandIn()) {
         return false;
      }

      // swfobject's own check, when it is on the page.
      if (window.swfobject && swfobject.hasFlashPlayerVersion) {
         return swfobject.hasFlashPlayerVersion(FLASH_VERSION);
      }

      // the detector's third argument stops it redirecting to the upgrade page, true makes it answer instead
      if (window.DetectFlash) {
         return DetectFlash(FLASH_VERSION, null, true) === true;
      }

      return false;
   }

   // a phone or tablet, the iPad included: it reports itself as a Mac but has a touch screen
   function isMobile() {
      var ua = navigator.userAgent || "";
      var touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
      return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || touchMac;
   }

   function embedRuffle(ruffle, options, from) {
      applyGlobalRuffleConfig(options);
      var container = document.getElementById(options.container);

      player = ruffle.createPlayer();
      player.id = options.id || "pixiehollowcontent";
      player.style.width = options.width + "px";
      player.style.height = options.height + "px";
      container.appendChild(player);

      player.load({
         url: options.swf,

         // flashvars. Ruffle passes these through as loaderInfo.parameters,
         // which is where the client reads session, currentUrl and base.
         parameters: options.flashvars || {},

         // the client builds asset urls from this and the page isn't always at the site root
         base: options.base,

         // like allowScriptAccess always, without it ExternalInterface is refused
         allowScriptAccess: true,

         backgroundColor: options.bgcolor,
         wmode: options.wmode || "direct",

         // See defaultSocketProxy: this is what lets the client reach the game
         // server from a browser at all.
         socketProxy: options.socketProxy || defaultSocketProxy(),

         // a game behind a login, start it without a poster or unmute prompt
         autoplay: "on",
         unmuteOverlay: "hidden",
         splashScreen: false,

         // The client has its own right-click menu. Not a boolean: Ruffle
         // takes "on", "off" or "rightClickOnly" here.
         contextMenu: "off",

         // Flash's own default. Ruffle otherwise letterboxes to fit, which
         // makes the client's layout maths disagree with what is on screen.
         scale: "noScale",
         salign: "tl",

         // Only set when a caller asks. See FONT_SOURCES for why neither is a
         // default.
         fontSources: (options.fontSources || FONT_SOURCES).map(function (src) {
            if (src.indexOf("://") !== -1 || src.charAt(0) === "/") return src;
            var base = options.base || "/";
            if (base.charAt(base.length - 1) !== "/") base += "/";
            return base + src.replace(/^\.\//, "");
         }),

         // Deliberately not set. See the note above FONT_SOURCES.
         defaultFonts: options.defaultFonts || undefined,

         // the client reports fps and memory to Playdom's weblogger, which no longer exists. Every call
         // failed to resolve and logged an error, so they go to a local endpoint that discards them
         urlRewriteRules: [
            [/^https?:\/\/weblogger-dynamic-lb\.playdom\.com\/.*$/, location.origin + "/fairies/api/FlashLog"]
         ],

         preferredRenderer: options.renderer || undefined,

         // the canvas is drawn at the screen's pixel ratio (3x on phones) and ios closes tabs that use too much memory
         // medium quality is lighter, options.quality from ?quality= beats the phone default
         // should automatically drop the quality on low-memory devices
         quality: options.quality || (isMobile() ? "medium" : undefined),

         // warn not error, missing fonts and unsupported calls show up as warnings, drop to error once it's quiet
         logLevel: options.logLevel || "error"
      });

      kind = "ruffle";
      source = from || "bundled";
      log("using " + source + " Ruffle");
      return player;
   }

   function embedFlash(options) {
      var flashparams = {
         allowScriptAccess: "always",
         bgcolor: options.bgcolor,
         wmode: options.wmode || "default",
         base: options.base
      };

      var attributes = {
         id: options.id || "pixiehollowcontent",
         name: options.id || "pixiehollowcontent"
      };

      swfobject.embedSWF(
         options.swf,
         options.container,
         String(options.width),
         String(options.height),
         FLASH_VERSION,
         null,
         options.flashvars || {},
         flashparams,
         attributes,
         function (event) {
            if (event.success) {
               player = event.ref;
            }
         }
      );

      kind = "flash";
      log("using Flash");
      return null;
   }

   function showUnsupported(options) {
      var container = document.getElementById(options.container);

      container.innerHTML =
         '<div style="color:#fff;font:14px/1.6 sans-serif;max-width:560px;' +
         'margin:80px auto;text-align:center">' +
         "<h2>Pixie Hollow could not start</h2>" +
         "<p>This browser has neither Ruffle nor Adobe Flash available, so " +
         "there is nothing here that can run the game.</p>" +
         "<p>Ruffle ships with this site, so this usually means a file failed " +
         "to load - a refresh is worth trying first.</p>" +
         "</div>";

      kind = "none";
      log("neither Ruffle nor Flash is available");
   }

   // printing from inside the game: flash's PrintJob doesn't exist in ruffle so the print buttons call this
   // (patched by tools/patch-print-buttons.js), it opens the pixie page with ?print=1 and that page prints her and her home

   var PRINT_SHEET_CSS = "/site/printSheet.css?v=20261109c";
   var PRINT_SHEET_JS = "/site/printSheet.js?v=20261109c";

   // the sheet is only needed when someone prints in place, so it is loaded then and not with the game
   function withPrintSheet(then) {
      if (window.phPrint) {
         return then();
      }

      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = PRINT_SHEET_CSS;
      document.head.appendChild(link);

      var script = document.createElement("script");
      script.src = PRINT_SHEET_JS;
      script.onload = then;
      script.onerror = function () {
         log("could not load the print sheet");
      };
      document.head.appendChild(script);
   }

   window.phPrintFromGame = function (kind, fairyId, name, extra) {
      if (kind === "flash" || phPlayer.kind === "flash") {
         return;
      }

      var id = Number(fairyId);
      if (!isFinite(id) || id <= 0) {
         log("print asked for with no fairy id: " + fairyId);
         return;
      }

      // the scrapbook's Print button prints her where she is, on the background her profile has
      if (kind === "profile") {
         withPrintSheet(function () {
            window.phPrint.printProfile({ fairyId: id, name: String(name || ""), bgId: extra });
         });
         return;
      }

      // opened now, while the click that asked for it still counts, and pointed at the page once its
      // address is known
      var tab = window.open("", "_blank");
      if (!tab) {
         log("the browser blocked the print tab");
         return;
      }

      // the journal saves her pose as it asks to print, and the picture is drawn from what is saved
      // so it is given a moment to arrive
      var wait = kind === "home" ? 0 : 1500;

      fetch("/fairies/api/pixiepage-of/" + id, { credentials: "include" })
         .then(function (res) {
            return res.ok ? res.json() : Promise.reject(new Error("no pixie page"));
         })
         .then(function (page) {
            setTimeout(function () {
               tab.location.href = "/pixiepages/" + encodeURIComponent(page.address) + "?print=1";
            }, wait);
         })
         .catch(function (e) {
            log("could not open the print page: " + e.message);
            tab.close();
         });
   };

   return {
      /** put the client on the page, returns a promise but most callers just fire and forget */
      embed: function (options) {
         var forced = null;
         try {
            var params = new URLSearchParams(window.location.search);
            forced = params.get("player");
         } catch (e) {}

         function useBundled() {
            return loadRuffle(options).then(function (ruffle) {
               if (ruffle) {
                  return embedRuffle(ruffle, options, "bundled");
               }

               showUnsupported(options);
               return null;
            });
         }

         // ?player=ruffle or ?player=bundled always runs the copy that ships with the site, whatever
         // else the browser has, which is the way to tell a bad extension from a bad bundled build
         if (forced === "ruffle" || forced === "bundled") {
            return useBundled();
         }

         if (forced === "flash") {
            if (hasFlash()) {
               return Promise.resolve(embedFlash(options));
            }
            showUnsupported(options);
            return Promise.resolve(null);
         }

         // If Flash is installed (e.g. Pale Moon with Clean Flash), prefer it as
         // the native reference implementation so the game runs without emulation issues.
         if (hasFlash()) {
            return Promise.resolve(embedFlash(options));
         }

         // the extension is the player's own ruffle, give it the same socket proxy and script access as ours
         if (isRuffleStandIn() || extensionSource()) {
            return waitForExtension(3000).then(function (extension) {
               if (extension) {
                  return embedRuffle(extension, options, "extension");
               }

               log("the Ruffle extension did not show up, using the bundled Ruffle");
               return useBundled();
            });
         }

         // Otherwise the copy of Ruffle that ships with the site.
         return useBundled();
      },

      isMobile: isMobile,

      // "ruffle", "flash", "none", or null before embed() has decided.
      get kind() {
         return kind;
      },

      // for kind "ruffle": "extension" or "bundled"
      get source() {
         return source;
      },

      /** the element the client is running in, fairies_framework.js's getSWF() defers to this */
      getPlayer: function (id) {
         if (player) {
            return player;
         }

         return document.getElementById(id || "pixiehollowcontent");
      }
   };
})();
