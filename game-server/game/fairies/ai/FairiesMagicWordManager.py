from direct.distributed.DistributedObject import DistributedObject
from direct.directnotify import DirectNotifyGlobal
from libotp import CFSpeech, CFTimeout


class FairiesMagicWordManager(DistributedObject):
    notify = DirectNotifyGlobal.directNotify.newCategory(
        'FairiesMagicWordManager')

    def generate(self):
        DistributedObject.generate(self)
        self.cr.fairiesMagicWordManager = self

    def disable(self):
        if getattr(self.cr, 'fairiesMagicWordManager', None) is self:
            del self.cr.fairiesMagicWordManager
        DistributedObject.disable(self)

    def setMagicWordResponse(self, response):
        self.notify.info(response)
        base.localAvatar.setChatAbsolute(response, CFSpeech | CFTimeout)
        base.talkAssistant.receiveDeveloperMessage(response)
