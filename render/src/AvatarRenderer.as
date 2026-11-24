// ---------------------------------------------------------------------------
// AvatarRenderer
//
// The half of the bust renderer that runs inside Flash. bustHarness.swf boots
// the real client -- fonts, containerLib, environ.xml, config.xml, framework,
// the standalone PageController -- and then finishes with:
//
//   cls = ApplicationDomain.currentDomain.getDefinition("AvatarRenderer");
//   this._renderer = new cls(this);
//
// So this class must be top level (no package), named exactly AvatarRenderer,
// and take the harness as its only argument. From the harness it reads
// `params` (the flashvars the worker passed) and `say()` for logging, which
// goes to the on-stage TextField and to trace().
//
// It draws the fairy, PNG-encodes it and POSTs the bytes to
// /fairies/api/internal/renderResult?name=<hash>, which writes
// web/rendered/<hash>.png. A failure posts ?error= instead, so the worker
// learns the difference between "broken" and "still going" without waiting out
// its own 90s timeout.
//
// EVERY FRAMEWORK CLASS IS LOOKED UP BY NAME rather than imported. The client
// only exists here as decompiled source -- there are no .swc files to compile
// against -- and the harness has already loaded the real ones into
// ApplicationDomain.currentDomain by the time this constructor runs. Resolving
// them dynamically keeps this SWF at zero linkage: it cannot drift from the
// framework's types, and it cannot collide with a definition already loaded.
// The cost is that mistakes here are runtime errors, not compile errors, so
// every call is wrapped and reported rather than left to surface as a hang.
// ---------------------------------------------------------------------------

package
{
   import flash.display.BitmapData;
   import flash.display.DisplayObject;
   import flash.display.Sprite;
   import flash.events.Event;
   import flash.geom.Matrix;
   import flash.geom.Rectangle;
   import flash.events.IOErrorEvent;
   import flash.events.SecurityErrorEvent;
   import flash.events.TimerEvent;
   import flash.display.Loader;
   import flash.net.URLLoader;
   import flash.net.URLLoaderDataFormat;
   import flash.net.URLRequest;
   import flash.net.URLRequestMethod;
   import flash.system.ApplicationDomain;
   import flash.system.LoaderContext;
   import flash.utils.ByteArray;
   import flash.utils.Timer;

   public class AvatarRenderer extends Sprite
   {
      // Caddy proxies /fairies/api/* to web-api on 8013, and the harness SWF is
      // served from the same origin, so this needs no host and trips no
      // crossdomain check.
      private static const RESULT_URL:String = "/fairies/api/internal/renderResult";

      // The managers come up asynchronously after PageController is built, so
      // the first render has to wait for them rather than assume them.
      private static const INIT_POLL_MS:Number = 100;
      private static const INIT_TIMEOUT_MS:Number = 30000;

      // Well inside the worker's RENDER_TIMEOUT_MS (90s). Reporting our own
      // failure is worth a lot more than being killed silently: the worker
      // records the reason and stops retrying a fairy that can never render.
      private static const RENDER_TIMEOUT_MS:Number = 60000;

      // The scale a full body is meant to be drawn at. A bust has its own --
      // AvatarController.typicalBustScale, which is what the site's fairy
      // picker uses -- so it is read from the framework rather than repeated
      // here.
      //
      // These two are not arbitrary: 0.685 produces a 123x178 bust and 1.0 a
      // roughly 315x681 full body, which are exactly the sizes web-api serves
      // as placeholders. Matching them is what keeps a page from reflowing
      // when the real image replaces the placeholder.
      private static const DEFAULT_FULL_SCALE:Number = 1.0;

      // The home viewer's window, and so the size a house is drawn at. These
      // are homeViewer.swf's own viewport, which is what the Pixie Page's
      // frame was traced from -- and they must stay equal to web-api's
      // PLACEHOLDER_SIZE.home, or the page reflows when the render lands.
      private static const HOME_WIDTH:Number = 880;
      private static const HOME_HEIGHT:Number = 379;

      // HomeDisplay and HomeDisplayRequest ship in the panel, not the
      // framework, so the harness has not loaded them.
      private static const HOME_VIEWER_SWF:String = "swf/panel_code/homeViewer.swf";

      // Long enough for the room's layers to have drawn. A readiness signal
      // would be better; the shipped code does not expose one.
      private static const HOME_SETTLE_MS:Number = 2000;

      private var _harness:Object;

      private var _name:String = "render";
      private var _mode:String = "bust";
      private var _pickle:String = "";
      private var _scale:Number = 0;

      // One result per run, whichever way it ends.
      private var _done:Boolean = false;

      private var _deadline:Timer;
      private var _initWaited:Number = 0;

      private var _controller:Object;

      // The house, unpacked from the descriptor and then held across the
      // asynchronous load of the room shell.
      private var _homeType:int = 0;
      private var _homeTalent:int = 0;
      private var _homeMember:Boolean = false;
      private var _homeItems:Array = [];
      private var _homeDisplay:Object;
      private var _ground:Object;

      // URLLoaders are collected only so the GC cannot take one mid-request,
      // which is the classic way a Flash POST silently never happens.
      private var _loaders:Array = [];

      /**
       * The harness argument is optional only because this class is also this
       * SWF's document class, and Loader.loadBytes instantiates that with no
       * arguments before the harness ever gets to call getDefinition. Without a
       * default that automatic construction throws
       * "Error #1063: Argument count mismatch", which is noise at best and, in
       * a debug projector, a dialog nobody is there to dismiss.
       *
       * So the no-argument instance is the SWF's root and deliberately does
       * nothing; the real one is the harness's `new cls(this)`.
       */
      public function AvatarRenderer(harness:Object = null)
      {
         super();

         if(harness == null)
         {
            return;
         }

         this._harness = harness;

         try
         {
            this.start();
         }
         catch(e:Error)
         {
            this.fail("startup: " + e.message);
         }
      }

      private function start() : void
      {
         var params:Object = this._harness.params;

         if(params == null)
         {
            params = {};
         }

         if(params.pickle != null)
         {
            this._pickle = String(params.pickle);
         }

         if(params.name != null)
         {
            this._name = String(params.name);
         }

         this._mode = String(params.mode) == "full" || String(params.mode) == "home" || String(params.mode) == "homefull" ? String(params.mode) : "bust";

         // 0 means "not given"; the mode picks its own default below. Sent as a
         // string through flashvars, so it is parsed rather than cast.
         if(params.scale != null)
         {
            this._scale = Number(params.scale);
         }

         if(this._scale != this._scale || this._scale < 0)
         {
            this._scale = 0;
         }

         if(this._pickle.length == 0)
         {
            this.fail("no pickle flashvar");
            return;
         }

         this.say("mode " + this._mode + ", name " + this._name + ", scale " + (this._scale > 0 ? String(this._scale) : "default"));

         this._deadline = new Timer(RENDER_TIMEOUT_MS,1);
         this._deadline.addEventListener(TimerEvent.TIMER,this.onDeadline);
         this._deadline.start();

         this.waitForManagers();
      }

      private function onDeadline(event:TimerEvent) : void
      {
         this.fail("no image within " + RENDER_TIMEOUT_MS + "ms");
      }

      private function definition(name:String) : Class
      {
         return ApplicationDomain.currentDomain.getDefinition(name) as Class;
      }

      /**
       * Hold off until AvatarManager has read its tables.
       *
       * AvatarController pulls clothing through ItemRequest and the media
       * managers, and those are only usable once the config tables are in. The
       * harness builds PageController but does not wait for that to settle, so
       * rendering immediately races the boot and fails on a fairy whose items
       * are not resolvable yet.
       *
       * Timing out here is deliberately not fatal: isInitialized is a
       * convenience, and a render that would have worked should not be thrown
       * away because one flag never flipped.
       */
      private function waitForManagers() : void
      {
         var ready:Boolean = false;

         try
         {
            ready = Boolean(this.definition("com.disney.fairies.managers.AvatarManager")["getInstance"]().isInitialized);
         }
         catch(e:Error)
         {
            ready = false;
         }

         if(ready)
         {
            this.say("managers ready after " + this._initWaited + "ms");
            this.render();
            return;
         }

         if(this._initWaited >= INIT_TIMEOUT_MS)
         {
            this.say("AvatarManager still not initialized after " + INIT_TIMEOUT_MS + "ms; rendering anyway");
            this.render();
            return;
         }

         var poll:Timer = new Timer(INIT_POLL_MS,1);
         poll.addEventListener(TimerEvent.TIMER,function(event:TimerEvent):void
         {
            _initWaited += INIT_POLL_MS;
            waitForManagers();
         });
         poll.start();
      }

      private function render() : void
      {
         if(this._done)
         {
            return;
         }

         try
         {
            // A house is not an avatar, so it never goes near AvatarDNA --
            // createFromPickle would throw on the descriptor before the house
            // was ever drawn.
            if(this._mode == "home" || this._mode == "homefull")
            {
               this.renderHome();
               return;
            }

            var dna:Object = this.definition("com.disney.fairies.avatar.AvatarDNA")["createFromPickle"](this._pickle);

            if(this._mode == "full")
            {
               this.renderFull(dna);
            }
            else
            {
               this.renderBust(dna);
            }
         }
         catch(e:Error)
         {
            this.fail("render: " + e.message);
         }
      }

      /**
       * The bust, via the same request the site's fairy picker uses.
       *
       * AvatarBustBitmapRequest crops to the `bustBitmapBounds` marker baked
       * into the avatar art, which is why every fairy's bust comes out the same
       * size. Reusing it rather than cropping by hand is what keeps this
       * renderer's output identical to what the client would have drawn.
       */
      private function renderBust(dna:Object) : void
      {
         var controllerClass:Class = this.definition("com.disney.fairies.avatar.AvatarController");
         var requestClass:Class = this.definition("com.disney.fairies.media.AvatarBustBitmapRequest");

         var scale:Number = this._scale > 0 ? this._scale : Number(controllerClass["typicalBustScale"]);

         var request:Object = new requestClass(dna,scale,this.onBust);
         request.queueRequest();
      }

      private function onBust(request:Object, ok:Boolean) : void
      {
         if(!ok)
         {
            this.fail("bust request failed: " + request.error);
            return;
         }

         var bitmap:Object = request.bitmap;

         if(bitmap == null)
         {
            this.fail("bust request produced no bitmap");
            return;
         }

         this.deliver(bitmap.bitmapData as BitmapData);
      }

      /**
       * Full body: there is no shipped request for it, so the avatar is built
       * and rastered directly. Its size follows the fairy's height proportion,
       * which is why the server's placeholder for `full` is nominal.
       */
      private function renderFull(dna:Object) : void
      {
         var controllerClass:Class = this.definition("com.disney.fairies.avatar.AvatarController");

         // false: not bust mode, so nothing is cropped away.
         this._controller = new controllerClass(dna,false,false);

         var scale:Number = this._scale > 0 ? this._scale : DEFAULT_FULL_SCALE;

         this._controller.scaleX = scale;
         this._controller.scaleY = scale;
         this._controller.cacheAsBitmap = false;

         var holder:Sprite = new Sprite();
         holder.addChild(this._controller as DisplayObject);

         if(this._controller.displayed)
         {
            this.rasterFull(holder);
            return;
        }

         this._controller.addEventListener(String(controllerClass["DISPLAYED"]),function(event:Event):void
         {
            rasterFull(holder);
         });
      }

      private function rasterFull(holder:Sprite) : void
      {
         try
         {
            // smoothDraw sizes the bitmap from the holder's own bounds and
            // builds the matching matrix, so the fairy is neither clipped nor
            // padded whatever her proportions are.
            var request:Object = this.definition("com.disney.fairies.media.RasterRequest")["smoothDraw"](holder,this.onFull);
            request.queueRequest();
         }
         catch(e:Error)
         {
            this.fail("full raster: " + e.message);
         }
      }

      private function onFull(request:Object, ok:Boolean) : void
      {
         if(!ok)
         {
            this.fail("full request failed: " + request.error);
            return;
         }

         this.deliver(request.bitmapData as BitmapData);
      }

      /**
       * Her home, drawn by the client's own home viewer.
       *
       * This is the same sequence panel_code/homeViewer.swf's HomeViewer ran
       * on the live Pixie Page -- request the room shell for her home type,
       * add each piece of furniture where she left it, centre on room 1 -- so
       * what comes out is the picture the game would have shown, not an
       * approximation of it. The one thing left out is the fairy herself, who
       * is a separate <img> on the page and so can be cached separately.
       *
       * HomeDisplay and HomeDisplayRequest live in that panel's SWF rather
       * than in the framework, so it is loaded first, into this same
       * application domain. The harness does not know about it: everything
       * here is looked up by name after the fact, exactly as the avatar path
       * looks up AvatarController.
       */
      private function renderHome() : void
      {
         var parts:Array = this._pickle.split(";");

         if(parts.length < 1 || String(parts[0]).length == 0)
         {
            this.fail("home: malformed descriptor");
            return;
         }

         var head:Array = String(parts[0]).split(",");

         this._homeType = int(head[0]);
         this._homeTalent = int(head[1]);
         this._homeMember = String(head[2]) == "1";
         this._homeItems = String(parts[1] || "").length > 0 ? String(parts[1]).split("|") : [];

         this.say("home type " + this._homeType + ", " + this._homeItems.length + " items");

         // Already loaded if a previous render in this process pulled it in;
         // hasDefinition keeps a second load from racing the first.
         if(ApplicationDomain.currentDomain.hasDefinition("com.disney.fairies.display.HomeDisplayRequest"))
         {
            this.requestHome();
            return;
         }

         this.loadSWF(HOME_VIEWER_SWF,this.onHomeViewerLoaded);
      }

      /**
       * Load a SWF into this application domain so its classes join the ones
       * the harness already put there.
       *
       * The harness has a function of the same shape but keeps it private, and
       * this is the only caller, so it is duplicated rather than the harness
       * being rebuilt -- bustHarness.swf has no source in the tree and is
       * recovered by decompiling, which is not a step to add to a render path.
       *
       * Fetched as bytes and then loadBytes()d, exactly as the harness does:
       * a plain Loader.load of a local file under a debug projector hits the
       * security sandbox, while bytes it has already read do not.
       */
      private function loadSWF(url:String, done:Function) : void
      {
         var bytes:URLLoader = new URLLoader();
         this._loaders.push(bytes);
         bytes.dataFormat = URLLoaderDataFormat.BINARY;

         bytes.addEventListener(Event.COMPLETE,function(event:Event):void
         {
            var loader:Loader = new Loader();
            var context:LoaderContext = new LoaderContext(false,ApplicationDomain.currentDomain);
            context.allowCodeImport = true;
            _loaders.push(loader);
            loader.contentLoaderInfo.addEventListener(Event.COMPLETE,done);
            loader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR,function(event:IOErrorEvent):void
            {
               fail("could not init " + url + ": " + event.text);
            });
            loader.loadBytes(bytes.data as ByteArray,context);
         });

         bytes.addEventListener(IOErrorEvent.IO_ERROR,function(event:IOErrorEvent):void
         {
            fail("could not load " + url + ": " + event.text);
         });

         bytes.load(new URLRequest(url));
      }

      private function onHomeViewerLoaded(event:Event) : void
      {
         if(!ApplicationDomain.currentDomain.hasDefinition("com.disney.fairies.display.HomeDisplayRequest"))
         {
            this.fail("home: " + HOME_VIEWER_SWF + " loaded but HomeDisplayRequest is not defined");
            return;
         }

         this.requestHome();
      }

      private function requestHome() : void
      {
         try
         {
            var requestClass:Class = this.definition("com.disney.fairies.display.HomeDisplayRequest");

            // HomeItemDescription teaches ItemManager how to read furniture;
            // without it createItem returns something that cannot be placed.
            // HomeViewer.init called this before doing anything else.
            this.definition("com.disney.fairies.meadow.HomeItemDescription")["addToItemManager"]();

            var request:Object = new requestClass(this._homeType,this._homeMember,this._homeTalent,this.onHomeContent);
            request.queueRequest();
         }
         catch(e:Error)
         {
            this.fail("home request: " + e.message);
         }
      }

      private function onHomeContent(request:Object, ok:Boolean) : void
      {
         if(!ok)
         {
            this.fail("home content failed: " + request.error);
            return;
         }

         try
         {
            var display:Object = request.homeDisplay;

            if(display == null)
            {
               this.fail("home content produced no display");
               return;
            }

            // "home" is the Pixie Page's window onto the room. "homefull" is the whole room, for printing
            // and saving, so it is not given the window's size: see rasterHomeFull.
            if(this._mode == "homefull")
            {
               this._ground = this.findGround(display);

               if(this._ground == null)
               {
                  this.fail("homefull: could not find the room's ground layer");
                  return;
               }

               display.setViewportDimensions(this._ground.layerWidth,this._ground.layerHeight);
            }
            else
            {
               display.setViewportDimensions(HOME_WIDTH,HOME_HEIGHT);
            }

            var itemManager:Object = this.definition("com.disney.fairies.managers.ItemManager")["getInstance"]();
            var placed:int = 0;

            for each(var row:String in this._homeItems)
            {
               // itemId:c1:c2:x:y:z:flip:scale -- utils/housePickle.js
               var field:Array = row.split(":");

               if(field.length < 8)
               {
                  continue;
               }

               var item:Object = itemManager.createItem(int(field[0]));

               if(item == null)
               {
                  continue;
               }

               item.setColor(1,int(field[1]));
               item.setColor(2,int(field[2]));

               // The last argument is the room, and addHomeItem draws nothing
               // for any room but 1 -- which is why the descriptor only ever
               // carries room 1.
               display.addHomeItem(item,int(field[3]),int(field[4]),int(field[5]),String(field[6]) == "1",int(field[7]),1);
               placed++;
            }

            this.say("placed " + placed + " of " + this._homeItems.length + " items");

            if(this._mode == "home")
            {
               display.centerOnRoom(1);
            }

            this._homeDisplay = display;

            // The room's layers are loaded media that may not have drawn yet.
            // One frame is not reliably enough, so this settles for a short
            // fixed wait -- well inside RENDER_TIMEOUT_MS -- rather than
            // guessing at a readiness flag the shipped code never exposed.
            var settle:Timer = new Timer(HOME_SETTLE_MS,1);
            settle.addEventListener(TimerEvent.TIMER,this._mode == "homefull" ? this.rasterHomeFull : this.rasterHome);
            settle.start();
         }
         catch(e:Error)
         {
            this.fail("home assembly: " + e.message);
         }
      }

      /**
       * The ground is the layer the furniture was added to: HomeDisplay puts its furniture container
       * in it, and a LazyItem is what that container holds. Looked up by what it holds because
       * HomeDisplay keeps its content private.
       */
      private function findGround(display:Object) : Object
      {
         var lazyItem:Class = this.definition("com.disney.fairies.display.LazyItem");
         var biggest:Object = null;

         for(var i:int = 0; i < display.numChildren; i++)
         {
            var layer:Object = display.getChildAt(i);

            if(!("layerWidth" in layer))
            {
               continue;
            }

            if(biggest == null || layer.layerWidth * layer.layerHeight > biggest.layerWidth * biggest.layerHeight)
            {
               biggest = layer;
            }

            for(var j:int = 0; j < layer.numChildren; j++)
            {
               var holder:Object = layer.getChildAt(j);

               if(holder != null && holder.numChildren > 0 && holder.getChildAt(0) is lazyItem)
               {
                  return layer;
               }
            }
         }

         // A room with nothing in it has no furniture to find the ground by
         return biggest;
      }

      /**
       * The whole room, the way the game's own print does it (MeadowView.enableHomePrintMode):
       * the other layers are scaled to the ground's size and every layer shows all of its
       * content rather than a window of it. The picture is the ground's content box.
       */
      private function rasterHomeFull(event:TimerEvent) : void
      {
         try
         {
            var display:Object = this._homeDisplay;
            var ground:Object = this._ground;

            for(var i:int = 0; i < display.numChildren; i++)
            {
               var layer:Object = display.getChildAt(i);

               if(!("enableScrollRect" in layer))
               {
                  continue;
               }

               if(layer != ground)
               {
                  layer.printBoundsOffset = 0;
                  layer.scaleX = Math.min(ground.layerWidth / layer.layerWidth,1);
                  layer.scaleY = Math.min(ground.layerHeight / layer.layerHeight,2);
               }

               layer.enableScrollRect(false);
            }

            var box:Object = ground.getBitmapBoundary();
            var width:Number = box.xMaxValue - box.xMinValue;
            var height:Number = box.yMaxValue - box.yMinValue;

            if(!(width > 0) || !(height > 0))
            {
               this.fail("homefull: the room has no size");
               return;
            }

            // A BitmapData is limited to 8191 on a side and 16,777,215 pixels
            var scale:Number = this._scale > 0 ? this._scale : 1;
            scale = Math.min(scale,8000 / width,8000 / height,Math.sqrt(16000000 / (width * height)));

            var bitmapData:BitmapData = new BitmapData(Math.max(1,Math.round(width * scale)),Math.max(1,Math.round(height * scale)),true,0);

            var matrix:Matrix = new Matrix();
            matrix.scale(scale,scale);

            bitmapData.draw(display as DisplayObject,matrix,null,null,new Rectangle(0,0,bitmapData.width,bitmapData.height),true);

            this.deliver(bitmapData);
         }
         catch(e:Error)
         {
            this.fail("homefull raster: " + e.message);
         }
      }

      private function rasterHome(event:TimerEvent) : void
      {
         try
         {
            // Drawn at a fixed size rather than from the display's own bounds:
            // the room art runs well past the window it is seen through, and
            // the viewport is what the page has a hole for. Scaled here rather
            // than in setViewportDimensions so the room is composed at its
            // intended size and only the output is resized.
            var scale:Number = this._scale > 0 ? this._scale : 1;

            var bitmapData:BitmapData = new BitmapData(Math.round(HOME_WIDTH * scale),Math.round(HOME_HEIGHT * scale),true,0);

            var matrix:Matrix = new Matrix();
            matrix.scale(scale,scale);

            bitmapData.draw(this._homeDisplay as DisplayObject,matrix,null,null,new Rectangle(0,0,bitmapData.width,bitmapData.height),true);

            this.deliver(bitmapData);
         }
         catch(e:Error)
         {
            this.fail("home raster: " + e.message);
         }
      }

      private function deliver(bitmapData:BitmapData) : void
      {
         if(bitmapData == null)
         {
            this.fail("render produced no bitmap data");
            return;
         }

         var bytes:ByteArray;

         try
         {
            // containerLib.swf, which the harness loaded before the framework.
            bytes = this.definition("com.adobe.images.PNGEncoder")["encode"](bitmapData) as ByteArray;
         }
         catch(e:Error)
         {
            this.fail("png encode: " + e.message);
            return;
         }

         if(bytes == null || bytes.length == 0)
         {
            this.fail("png encoder returned nothing");
            return;
         }

         this.say("rendered " + bitmapData.width + "x" + bitmapData.height + ", " + bytes.length + " bytes");
         this.post(bytes,null);
      }

      private function fail(message:String) : void
      {
         this.say("FAILED: " + message);
         this.post(null,message);
      }

      /**
       * Hand the result back. This is the only exit: both the image and every
       * failure leave through here, and _done makes sure only the first one
       * counts -- a late error after a good render must not overwrite it.
       */
      private function post(bytes:ByteArray, error:String) : void
      {
         if(this._done)
         {
            return;
         }

         this._done = true;

         if(this._deadline != null)
         {
            this._deadline.stop();
         }

         var url:String = RESULT_URL + "?name=" + encodeURIComponent(this._name);

         if(error != null)
         {
            url += "&error=" + encodeURIComponent(error.substr(0,500));
         }

         var body:ByteArray = bytes;

         // Flash will not POST an empty body, and an error report has no image
         // to send. The server reads ?error= before it looks at the body, so
         // this byte is only ever discarded.
         if(body == null || body.length == 0)
         {
            body = new ByteArray();
            body.writeByte(0);
         }

         var request:URLRequest = new URLRequest(url);
         request.method = URLRequestMethod.POST;
         request.contentType = "application/octet-stream";
         request.data = body;

         var loader:URLLoader = new URLLoader();
         this._loaders.push(loader);

         loader.addEventListener(Event.COMPLETE,function(event:Event):void
         {
            say("result posted");
         });

         loader.addEventListener(IOErrorEvent.IO_ERROR,function(event:IOErrorEvent):void
         {
            say("could not post result: " + event.text);
         });

         loader.addEventListener(SecurityErrorEvent.SECURITY_ERROR,function(event:SecurityErrorEvent):void
         {
            say("security error posting result: " + event.text);
         });

         loader.load(request);
      }

      private function say(message:String) : void
      {
         try
         {
            this._harness.say("[renderer] " + message);
         }
         catch(e:Error)
         {
            trace("[renderer] " + message);
         }
      }
   }
}
