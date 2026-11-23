import time

from direct.distributed.DistributedObjectAI import DistributedObjectAI
from direct.task.TaskManagerGlobal import taskMgr

from game.fairies.ai import AccountControl
from game.fairies.housing import PartyConstants


class DistributedPartyAI(DistributedObjectAI):

    def __init__(self, air, realm, themeId: int, nameIds: list[int],
                 startTime: int, expiration: int) -> None:
        super().__init__(air)

        self.realm = realm
        self.themeId = themeId
        self.nameIds = list(nameIds)
        self.public = 0
        self.startTime = startTime    # epoch seconds, as PublicPartyBrowser reads it
        self.expiration = expiration  # epoch seconds

        # time.monotonic() of the owner's last accepted invite, for the cooldown
        self.lastInviteAt: float | None = None

    # ------------------------------------------------------------------ required fields

    def getID(self) -> int:
        return self.realm.ownerId

    def getName(self) -> list[int]:
        return list(self.nameIds)

    def getTheme(self) -> int:
        return self.themeId

    def getPublic(self) -> int:
        return self.public

    def getStartTime(self) -> int:
        return self.startTime

    def getExpiration(self) -> int:
        return self.expiration

    # ------------------------------------------------------------------ lifetime

    def announceGenerate(self) -> None:
        super().announceGenerate()

        taskMgr.doMethodLater(
            max(0, self.expiration - int(time.time())),
            self.expireTask, self.uniqueName("expire"))

    def delete(self) -> None:
        taskMgr.remove(self.uniqueName("expire"))
        super().delete()

    def expireTask(self, task):
        if self.realm is not None:
            self.realm.endParty("it ran its full length")

        return task.done

    # ------------------------------------------------------------------ owner controls

    def isSenderOwner(self, fieldName: str) -> bool:
        senderId = self.air.getAvatarIdFromSender()

        if senderId == self.realm.ownerId:
            return True

        self.notify.warning(
            f"{fieldName} on {self.realm.ownerId}'s party from {senderId}, not the owner")
        return False

    def setPublic(self, public: int) -> None:
        # PartyPanel.publicHandler, clsend and broadcast so a refusal re-broadcasts ours
        if not self.isSenderOwner("setPublic") or public not in (0, 1):
            self.d_setPublic()
            return

        if public and self.isOwnerHomePrivate():
            # the panel refuses this itself too
            self.notify.warning(
                f"setPublic(1) from {self.realm.ownerId}, whose home is friends-only - refusing")
            self.d_setPublic()
            return

        if public == self.public:
            return

        self.public = public
        self.realm.sendPartyUpdate()

    def d_setPublic(self) -> None:
        self.sendUpdate("setPublic", [self.public])

    def isOwnerHomePrivate(self) -> bool:
        owner = self.air.mongoInterface.mongodb.fairies.find_one(
            {"_id": self.realm.ownerId}, {"moreOptions": 1}) or {}

        return PartyConstants.isHomePrivate(owner.get("moreOptions"))

    def cancelParty(self, reason: int) -> None:
        # PartyPanel.stopParty, the argument is always 0
        if not self.isSenderOwner("cancelParty"):
            return

        self.realm.endParty("the owner stopped it")

    def inviteFairies(self, avatarIds) -> None:
        # PartyPanel.inviteSelectedHandler, the owner ticked online friends and pressed send
        if not self.isSenderOwner("inviteFairies"):
            return

        now = time.monotonic()
        cooldown = PartyConstants.INVITE_COOLDOWN_SECS - PartyConstants.INVITE_COOLDOWN_SLACK_SECS

        if self.lastInviteAt is not None and now - self.lastInviteAt < cooldown:
            self.notify.warning(
                f"inviteFairies from {self.realm.ownerId} inside the invite cooldown - ignoring")
            return

        ownerId = self.realm.ownerId
        wanted = list(dict.fromkeys(a for a in avatarIds if a != ownerId))

        if len(wanted) > PartyConstants.MAX_INVITEES:
            self.notify.warning(
                f"inviteFairies from {ownerId} with {len(wanted)} fairies - only sending the first "
                f"{PartyConstants.MAX_INVITEES}")
            wanted = wanted[:PartyConstants.MAX_INVITEES]

        if not wanted:
            return

        # the panel starts its own cooldown whether or not anyone was reachable
        self.lastInviteAt = now

        invitees = self.getFriendsAmong(ownerId, wanted)

        for inviteeId in invitees:
            # receivePartyInvite is on the invitee's avatar
            self.air.sendUpdateToDoId(
                "DistributedFairyPlayer", "receivePartyInvite", inviteeId,
                [ownerId, list(self.nameIds)],
                channelId=self.GetPuppetConnectionChannel(inviteeId))

        self.notify.info(
            f"{ownerId} invited {len(invitees)} of {len(wanted)} fairies to their party")

    # the fairies in avatarIds on the owner's friends list
    def getFriendsAmong(self, ownerId: int, avatarIds: list[int]) -> list[int]:
        fairies = self.air.mongoInterface.mongodb.fairies

        owner = fairies.find_one({"_id": ownerId}, {"friends": 1, "accountId": 1, "ownerAccount": 1}) or {}

        # the friends list is the account's, an account not moved over yet still has its fairy's
        account = AccountControl.accountForFairyDoc(self.air, owner) or {}
        friends = account.get("friends")
        if not isinstance(friends, list):
            friends = owner.get("friends") or []

        friendAccounts = set()
        for accountId in friends:
            try:
                friendAccounts.add(int(accountId))
            except (TypeError, ValueError):
                continue

        if not friendAccounts:
            return []

        allowed = set()
        for doc in fairies.find({"_id": {"$in": avatarIds}}, {"accountId": 1}):
            try:
                if int(doc.get("accountId") or 0) in friendAccounts:
                    allowed.add(doc["_id"])
            except (TypeError, ValueError):
                continue

        return [avatarId for avatarId in avatarIds if avatarId in allowed]
