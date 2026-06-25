from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LoginPayload(BaseModel):
    email: str
    password: str


class SignupPayload(LoginPayload):
    name: str


class RestoreSessionPayload(BaseModel):
    userId: str


class QrStartPayload(BaseModel):
    userId: str
    apiId: int | None = None
    apiHash: str | None = None


class QrCompletePayload(BaseModel):
    userId: str
    qrToken: str


class QrPasswordPayload(QrCompletePayload):
    password: str


class PhoneSendCodePayload(BaseModel):
    userId: str
    phone: str
    apiId: int | None = None
    apiHash: str | None = None


class PhoneVerifyCodePayload(BaseModel):
    userId: str
    phone: str
    code: str
    phoneToken: str


class PhonePasswordPayload(BaseModel):
    userId: str
    phone: str
    phoneToken: str
    password: str


class ToggleAccountPayload(BaseModel):
    userId: str


class BatchExcludePayload(BaseModel):
    userId: str
    accountIds: list[str]
    exclude: bool


class Set2FAPayload(BaseModel):
    userId: str
    password: str
    hint: str | None = None


class Remove2FAPayload(BaseModel):
    userId: str
    currentPassword: str


class UpdateProfilePayload(BaseModel):
    userId: str
    firstName: str | None = None
    lastName: str | None = None
    username: str | None = None


class ContactImportPayload(BaseModel):
    source_account_id: str
    target_account_id: str


class FollowUpStep(BaseModel):
    delayHours: float  # hours AFTER the original message was sent
    message: str


class FollowUpConfig(BaseModel):
    enabled: bool = False
    steps: list[FollowUpStep] = []


class CampaignPayload(BaseModel):
    name: str
    accountIds: list[str]
    dailyMessageLimitPerAccount: int
    messages: list[str]
    targetsCsv: str
    sourceGroup: str | None = None
    sourceFolder: str | None = None
    resolutionGroup: str | None = None
    folderFilterTags: list[str] | None = None
    blacklistedUsers: list[str] | None = None
    messageIntervalSeconds: int = 5
    campaignType: str = 'csv'
    sortByActivity: str | None = None
    skipMessaged: bool = False
    followUp: FollowUpConfig | None = None


class SendMessagePayload(BaseModel):
    accountId: str
    chatId: str
    text: str


class ForwardMessagePayload(BaseModel):
    accountId: str
    fromChatId: str
    toChatId: str
    messageId: int


class ForwardBatchPayload(BaseModel):
    accountId: str
    fromChatId: str
    messageId: int
    toChatIds: list[str]  # each is a chatId OR @username OR phone — resolved by _resolve_entity


class ForwardContactTarget(BaseModel):
    userId: str
    accessHash: str | None = None
    fullName: str = ""


class ForwardContactsStartPayload(BaseModel):
    accountId: str  # scraping account; owns DM history + cached access-hashes
    groupId: str  # destination chat — chatId OR @username, resolved by _resolve_entity
    groupTitle: str | None = None  # friendly label for the jobs list / export filenames
    intervalSeconds: int = 5
    targets: list[ForwardContactTarget]


class LeaveChatPayload(BaseModel):
    accountId: str
    chatId: str


class MarkReadPayload(BaseModel):
    accountId: str
    chatId: str


class GroupRunPayload(BaseModel):
    userId: str
    sourceAccountId: str
    inviterAccountIds: list[str]
    sourceGroup: str
    targetGroup: str
    delaySeconds: int = 0


class GroupDelayPayload(BaseModel):
    delaySeconds: int


class WarmupStartPayload(BaseModel):
    accountIds: list[str]
    intervalSeconds: int = 120


class ConnectedAccount(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    username: str
    displayName: str | None = None
    phone: str | None = None
    telegramId: str
    status: str
    location: str | None = None
    sessionFile: str | None = None
    source: str
    excludeChats: bool = False
    photoUrl: str | None = None


class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: str = "folder"
    sort_order: int = 0
    folder_type: str = "standard"
    draft_text: str = ""
    watch_account_id: str = ""
    watch_chat_id: str = ""
    watch_chat_title: str = ""


class FolderUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    folder_type: str | None = None
    draft_text: str | None = None
    watch_account_id: str | None = None
    watch_chat_id: str | None = None
    watch_chat_title: str | None = None


class FolderChatAdd(BaseModel):
    account_id: str
    chat_id: str
    username: str | None = None
    display_name: str | None = None
    access_hash: str | None = None
    filter_tag: str | None = None


class FolderChatFilterSet(BaseModel):
    account_id: str
    chat_ids: list[str]
    filter_tag: str | None = None


class FolderChatMove(BaseModel):
    chat_id: str
    account_id: str
    from_folder_id: str | None = None
    to_folder_id: str


class BatchChatEntry(BaseModel):
    account_id: str
    chat_id: str


class FolderChatBatchMove(BaseModel):
    to_folder_id: str
    from_folder_id: str | None = None
    chats: list[BatchChatEntry]


class SelectedUser(BaseModel):
    account_id: str
    chat_id: str
    username: str | None = None


class CreateGroupPayload(BaseModel):
    account_id: str | None = None
    title: str = Field(..., min_length=1, max_length=100)
    selected_users: list[SelectedUser] = []
    preset_id: str | None = None
    extra_admin_usernames: list[str] = []


class BlockUserPayload(BaseModel):
    account_id: str
    chat_id: str

class BatchBlockPayload(BaseModel):
    items: list[BatchChatEntry]

class BatchLeaveChatsPayload(BaseModel):
    chats: list[BatchChatEntry]


class MassGroupRunPayload(BaseModel):
    title_template: str = Field(..., min_length=1, max_length=100)
    admin_account_ids: list[str] = []
    usernames: list[str] = []
    delay_seconds: int = 30


class GroupPresetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    admin_usernames: list[str]


class GroupPresetUpdate(BaseModel):
    name: str | None = None
    admin_usernames: list[str] | None = None
