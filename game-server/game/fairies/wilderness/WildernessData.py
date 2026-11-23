from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from direct.directnotify import DirectNotifyGlobal

from paths import WEB, MEADOWS

notify = DirectNotifyGlobal.directNotify.newCategory("WildernessData")


@dataclass(frozen=True)
class BarrierPlacement:
    item_id: int
    x: int
    y: int
    index: Optional[int] = None  # set => dynamically removable via setActiveBarriers

    @property
    def dynamic(self) -> bool:
        return self.index is not None


# parsed meadows/adventure<zone_id>/config.xml
@dataclass
class AdventureLayout:
    zone_id: int
    name: str = ""
    audio_library: str = ""
    asset_url: str = ""
    default_spawn: tuple[int, int] = (0, 0)
    valid_area: List[tuple[float, float]] = field(default_factory=list)
    barriers: List[BarrierPlacement] = field(default_factory=list)

    @property
    def dynamicBarrierIndices(self) -> List[int]:
        return sorted({b.index for b in self.barriers if b.dynamic})

    # one removable barrier per index, in the order the party meets them
    @property
    def gates(self) -> List[BarrierPlacement]:
        byIndex: Dict[int, BarrierPlacement] = {}
        for barrier in self.barriers:
            if barrier.dynamic and barrier.index not in byIndex:
                byIndex[barrier.index] = barrier
        return [byIndex[i] for i in sorted(byIndex)]


@dataclass(frozen=True)
class AdventureDef:
    adventure_id: int
    wilderness_id: int
    exploration: bool = False


class WildernessData:
    _instance: Optional["WildernessData"] = None

    def __init__(self) -> None:
        self.adventures: Dict[int, AdventureDef] = {}
        self.adventures_by_wilderness: Dict[int, List[int]] = {}
        self.layouts_by_zone: Dict[int, AdventureLayout] = {}
        self.barrier_names: Dict[int, str] = {}
        self.loaded: bool = False

    @classmethod
    def getInstance(cls) -> "WildernessData":
        if cls._instance is None:
            cls._instance = WildernessData()
        return cls._instance

   # loads wilderness data from xml, like quests
    def loadAllWildernessData(self, force: bool = False) -> "WildernessData":
        if self.loaded and not force:
            return self
        self.loadAdventureIndex()
        self.loadBarrierNames()
        self.loadLayouts()
        self.loaded = True
        notify.info(
            "loaded %d adventures across %d wildernesses, %d layouts"
            % (len(self.adventures), len(self.adventures_by_wilderness), len(self.layouts_by_zone))
        )
        return self

    def loadAdventureIndex(self) -> None:
        path = WEB / "xml" / "adventureIndex.xml"
        try:
            root = ET.parse(path).getroot()
        except (OSError, ET.ParseError) as exc:
            notify.warning("could not read %s: %s" % (path, exc))
            return

        for node in root.findall("adventure"):
            try:
                adv = AdventureDef(
                    adventure_id=int(node.attrib["adventureID"]),
                    wilderness_id=int(node.attrib["wildernessId"]),
                    exploration=node.attrib.get("exploration", "0") not in ("0", "", None),
                )
            except (KeyError, ValueError) as exc:
                notify.warning("skipping malformed <adventure %r>: %s" % (node.attrib, exc))
                continue
            self.adventures[adv.adventure_id] = adv
            self.adventures_by_wilderness.setdefault(adv.wilderness_id, []).append(adv.adventure_id)

        for ids in self.adventures_by_wilderness.values():
            ids.sort()

    def loadBarrierNames(self) -> None:
        path = WEB / "xml" / "barrierAssets.xml"
        try:
            root = ET.parse(path).getroot()
        except (OSError, ET.ParseError) as exc:
            notify.warning("could not read %s: %s" % (path, exc))
            return

        copy = root.find("copy")
        if copy is None:
            return
        for child in copy:
            if child.tag.startswith("item") and child.tag[4:].isdigit():
                self.barrier_names[int(child.tag[4:])] = (child.text or "").strip()

    def loadLayouts(self) -> None:
        adv_dir = MEADOWS
        try:
            entries = sorted(p for p in adv_dir.iterdir() if p.name.startswith("adventure"))
        except OSError as exc:
            notify.warning("could not list %s: %s" % (adv_dir, exc))
            return

        for entry in entries:
            cfg = entry / "config.xml"
            if not cfg.is_file():
                continue
            layout = self.parseLayout(cfg)
            if layout is not None:
                self.layouts_by_zone[layout.zone_id] = layout

    @staticmethod
    def parseLayout(path) -> Optional[AdventureLayout]:
        try:
            root = ET.parse(path).getroot()
        except (OSError, ET.ParseError) as exc:
            notify.warning("could not parse layout %s: %s" % (path, exc))
            return None

        zone_text = (root.findtext("zoneID") or "").strip()
        if not zone_text.isdigit():
            notify.warning("layout %s has no numeric <zoneID>" % path)
            return None

        layout = AdventureLayout(
            zone_id=int(zone_text),
            name=(root.findtext("name") or "").strip(),
            audio_library=(root.findtext("audioLibrary") or "").strip(),
            asset_url=(root.findtext("assetURL") or "").strip(),
        )

        for loc in root.findall("./locations/location"):
            if (loc.text or "").strip() == "default":
                layout.default_spawn = (int(float(loc.attrib.get("x", 0))),
                                        int(float(loc.attrib.get("y", 0))))

        for vtx in root.findall("./clientLayout/validArea/vertex"):
            try:
                layout.valid_area.append((float(vtx.attrib["x"]), float(vtx.attrib["y"])))
            except (KeyError, ValueError):
                continue

        for bar in root.findall("./barriers/barrier"):
            try:
                idx = bar.attrib.get("index")
                layout.barriers.append(BarrierPlacement(
                    item_id=int(bar.attrib["itemId"]),
                    x=int(float(bar.attrib["x"])),
                    y=int(float(bar.attrib["y"])),
                    index=int(idx) if idx not in (None, "") else None,
                ))
            except (KeyError, ValueError) as exc:
                notify.warning("bad <barrier %r> in %s: %s" % (bar.attrib, path, exc))

        return layout

    def getAdventureDef(self, adventure_id: int) -> Optional[AdventureDef]:
        return self.adventures.get(adventure_id)

    def getLayoutForZone(self, zone_id: int) -> Optional[AdventureLayout]:
        return self.layouts_by_zone.get(zone_id)

    def getLayoutForAdventure(self, adventure_id: int) -> Optional[AdventureLayout]:
        from game.fairies.wilderness.WildernessConstants import getAdventureFolderId
        return self.layouts_by_zone.get(getAdventureFolderId(adventure_id))

    def getBarrierName(self, item_id: int) -> str:
        return self.barrier_names.get(item_id, "")
