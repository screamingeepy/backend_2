# prefetches swf files used by shop modules 
# to help lag with ruffle
# currently only PPO, QB could be added
import importlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, "game-server")
WEB = os.path.join(ROOT, "web")

# shop modules in game/fairies/shop/data, add a shop here to warm it too
SHOPS = ["pixie_post_office_8"]

sys.path.insert(0, GAME)


def main() -> None:
    text = open(os.path.join(GAME, "assets", "cacheableMedia.xml"), encoding="utf-8", errors="replace").read()
    bundles = {m.group(1): m.group(2) for m in re.finditer(r'<swf id="([^"]+)" url="([^"]+)"', text)}
    art = {}

    for m in re.finditer(r'<asset type="link" id="([^"]+)" swf="([^"]+)"', text):
        art.setdefault(m.group(1).split("_")[0], set()).add(m.group(2))

    urls = set()

    for name in SHOPS:
        shop = importlib.import_module(f"game.fairies.shop.data.{name}").SHOP
        ids = set()

        for collection in shop.collections:
            ids.update(item.itemId for item in collection.items or [])
            ids.update(item.itemId for outfit in collection.outfits or [] for item in outfit.items)

        for itemId in ids:
            for bundle in art.get(str(itemId), ()):
                url = bundles.get(bundle)

                if url and os.path.exists(os.path.join(WEB, url)):
                    urls.add(url)

    with open(os.path.join(WEB, "prefetch.json"), "w", encoding="utf-8", newline="\n") as out:
        json.dump({"swf": sorted(urls)}, out, indent=1)
        out.write("\n")

    size = sum(os.path.getsize(os.path.join(WEB, url)) for url in urls)
    print(f"{len(urls)} files, {size / 1048576:.1f} MB -> web/prefetch.json")


main()
