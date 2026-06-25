'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ConnectedAccount {
  id: string
  username: string
  displayName?: string
  phone?: string
  telegramId: string
  status: 'online' | 'offline'
  location?: string
  sessionFile?: string
  source?: 'session' | 'qr' | 'phone'
  excludeChats?: boolean
  photoUrl?: string
  twofaEnabled?: boolean
  sessionStatus?: 'good' | 'banned' | 'frozen' | 'disconnected' | 'error' | 'unknown' | null
}

export interface AccountSessionHealthItem {
  accountId: string
  ok: boolean
  needsReconnect: boolean
  detail?: string | null
  status?: 'good' | 'banned' | 'frozen' | 'disconnected' | 'error' | null
}

export interface User {
  id: string
  email: string
  name: string
  avatar: string
  notificationSettings: {
    newMessages: boolean
    notificationSound: boolean
    desktopNotifications: boolean
  }
  connectedAccounts: ConnectedAccount[]
}

export interface MessageConversation {
  id: string
  accountId: string
  accountLabel: string
  chatId: string
  chatTitle: string
  chatUsername?: string | null
  lastMessage: string
  lastSenderName?: string | null
  lastMessageOutgoing?: boolean
  draft?: string | null
  timestamp?: string | null
  unreadCount: number
  isGroup: boolean
  isChannel: boolean
  isUser?: boolean
  isBot?: boolean
  chatPhoto?: boolean
  filterTag?: string | null
}

export interface MessageFolder {
  id: string
  title: string
  emoticon?: string
  color?: number | null
  pinnedPeersCount?: number
  includePeersCount?: number
}

export interface CustomFolder {
  id: string
  user_id: string
  name: string
  icon: string
  sort_order: number
  created_at: string
  folder_type?: string
  draft_text?: string
  watch_account_id?: string
  watch_chat_id?: string
  watch_chat_title?: string
}

export interface FolderChatEntry {
  account_id: string
  chat_id: string
  added_at: string
  filter_tag?: string | null
}

export interface GroupPreset {
  id: string
  user_id: string
  name: string
  admin_usernames: string[]
  created_at: string
  updated_at: string
}

export interface UnreadNotification {
  id: string
  accountId: string
  chatId: string
  chatTitle: string
  lastMessage: string
  timestamp?: string | null
  unreadCount: number
  isUser: boolean
  isBot: boolean
}

export interface UnreadSummaryResponse {
  total_unread: number
  items: UnreadNotification[]
}

export interface StoredMessage {
  id: string
  userId: string
  type: 'text' | 'photo' | 'file'
  content: string
  fileName?: string | null
  fileMimeType?: string | null
  fileSize?: number | null
  createdAt: string
}

export interface CreateGroupResult {
  ok: boolean
  chat_id: string
  title: string
  admin_promoted: number
  admin_failed: string[]
  members_added: number
  members?: Array<{
    chat_id: string
    status: 'added_directly' | 'added_via_helper' | 'failed'
    helper_account_id?: string
    error?: string
  }>
}

export interface MassGroupEvent {
  at: string
  type: string
  status?: string
  username?: string
  title?: string
  chatId?: string
  accountId?: string
  accountLabel?: string
  adminPromoted?: number
  message?: string
}

export interface MassGroupFailure {
  username: string
  reason: string
  at: string
}

export interface MassGroupCampaign {
  id: string
  userId: string
  name: string
  status: 'idle' | 'running' | 'stopped' | 'done'
  titleTemplate: string
  adminAccountIds: string[]
  creatorAccountIds: string[]
  usernames: string[]
  delaySeconds: number
  stats: {
    totalUsernames: number
    groupsCreated: number
    failed: number
    processed: number
    activeUsername?: string | null
  }
  events: MassGroupEvent[]
  failures: MassGroupFailure[]
  createdAt: string
  updatedAt: string
  lastStartedAt?: string | null
  lastFinishedAt?: string | null
}

export interface MessageItem {
  id: number
  accountId: string
  chatId: string
  text: string
  timestamp?: string | null
  outgoing: boolean
  senderName?: string | null
  hasMedia: boolean
  mediaType?: 'photo' | 'video' | 'file' | null
  mediaMimeType?: string | null
  mediaFileName?: string | null
}

export interface FollowUpStep {
  delayHours: number
  message: string
}

export interface FollowUpConfig {
  enabled: boolean
  steps: FollowUpStep[]
}

export interface CampaignStartPayload {
  name: string
  accountIds: string[]
  dailyMessageLimitPerAccount: number
  messages: string[]
  targetsCsv: string
  sourceGroup?: string
  sourceFolder?: string
  resolutionGroup?: string
  folderFilterTags?: string[]
  blacklistedUsers?: string[]
  messageIntervalSeconds?: number
  campaignType?: string
  sortByActivity?: string
  skipMessaged?: boolean
  followUp?: FollowUpConfig | null
}

export interface CampaignAssignment {
  accountId: string
  accountLabel: string
  assignedTargets: string[]
  resolvableTargets: string[]
  unresolvedTargets: string[]
}

export interface CampaignUnresolvedTarget {
  accountId: string
  accountLabel: string
  target: string
  reason: string
}

export interface CampaignLead {
  campaignId: string
  campaignName: string
  target: string
  chatId?: string | null
  accountId?: string
  accountLabel?: string
  sentAt?: string
  replied?: boolean
  replyMessages?: number
  lastReplyAt?: string | null
  error?: string
  success?: boolean
  seen?: boolean
  seenAt?: string
}

export interface CampaignPreviouslyMessagedTarget {
  accountId: string
  accountLabel: string
  target: string
  reason: string
}

export interface CampaignActivityEvent {
  at: string
  type?: string
  level?: string
  stage?: string
  message: string
  accountId?: string | null
  accountLabel?: string | null
  target?: string | null
}

export interface CampaignAccountStats {
  accountId: string
  accountLabel: string
  assignedTargets: number
  resolvedTargets: number
  unresolvedTargets: number
  attemptedTargets: number
  sentCount: number
  sendFailures: number
  sendFailed?: number
  skippedCount?: number
  resolveFailures?: number
  state?: string
  restSeconds?: number
  restUntil?: string | null
  restReason?: string | null
  pendingTargets?: number
  added?: number
  failed?: number
  repliedTargets: number
  replyMessages: number
  lastReplyAt?: string | null
}

export interface CampaignSentItem {
  accountId: string
  accountLabel: string
  target: string
  message?: string
  chatId?: string | null
  messageId?: number | null
  sentAt: string
  replied?: boolean
  replyMessages?: number
  lastReplyAt?: string | null
  error?: string
  success?: boolean
}

export interface CampaignStartResponse {
  ok: boolean
  campaignId: string
  name?: string | null
  createdAt: string
  dailyMessageLimitPerAccount: number
  messageRotation: string[]
  messageIntervalSeconds?: number
  totalTargets: number
  resolvedTargets: number
  unresolvedTargets: number
  previouslyMessagedTargets: number
  assignments: CampaignAssignment[]
  unresolved: CampaignUnresolvedTarget[]
  previouslyMessaged: CampaignPreviouslyMessagedTarget[]
  activityLog: CampaignActivityEvent[]
  accountStats: CampaignAccountStats[]
  sentItems: CampaignSentItem[]
  messagesPlannedToday?: number
  messagesLeftToday?: number
  remainingAccountsToMessage?: number
  sentCount?: number
  sendFailures?: number
  skippedCount?: number
  nextMessageAt?: string | null
  nextMessageAccountId?: string | null
  nextMessageAccountLabel?: string | null
  repliedTargets?: number
  replyMessages?: number
  lastReplyAt?: string | null
  status?: string
}

export interface CampaignReplyStatsResponse {
  ok: boolean
  campaignId: string
  generatedAt: string
  totalSent: number
  repliedTargets: number
  unrepliedTargets: number
  replyMessages: number
  accountStats: CampaignAccountStats[]
  targetStats: CampaignSentItem[]
}

export interface CampaignSeenStatsResponse {
  ok: boolean
  campaignId: string
  generatedAt: string
  seen: number
  total: number
}

export interface CampaignRecord {
  id: string
  userId: string
  name: string
  status: string
  accountIds: string[]
  dailyMessageLimitPerAccount: number
  messages: string[]
  targetsCsv: string
  createdAt: string
  updatedAt: string
  lastStartedAt?: string | null
  lastFinishedAt?: string | null
  lastRunSummary?: CampaignStartResponse | null
  sourceGroup?: string | null
  sourceFolder?: string | null
  resolutionGroup?: string | null
  folderFilterTags?: string[]
  blacklistedUsers?: string[]
  messageIntervalSeconds?: number
  campaignType?: string
  sortByActivity?: string | null
  skipMessaged?: boolean
  scrapedTargets?: Array<{
    userId: string
    username?: string | null
    displayName?: string
    accessHash?: string
    phone?: string
    activityPriority?: number
    lastSeen?: string | null
  }> | null
  sentCount?: number
  seenCount?: number
  repliedCount?: number
  followUp?: FollowUpConfig | null
}

export interface ScrapedMember {
  user_id: string
  username: string
  full_name: string
  phone: string
  access_hash?: string
}
export interface GroupScraperGroup {
  id: string
  title: string
  username?: string | null
  isChannel: boolean
  isMegagroup: boolean
}

export interface GroupScraperFailure {
  accountId: string
  accountLabel: string
  member: string
  reason: string
  at?: string | null
}

export interface GroupScraperCampaignEvent {
  at: string
  type: string
  accountId?: string | null
  accountLabel?: string | null
  accountState?: string | null
  group?: string | null
  member?: string | null
  message?: string | null
  restReason?: string | null
  restSeconds?: number | null
  restUntil?: string | null
  remainingCandidates?: number | null
  pendingCandidates?: number | null
  initialTargetGroupMembers?: number | null
  targetGroupMembers?: number | null
  status?: string | null
  scrapedCount?: number | null
  totalScraped?: number | null
}

export interface GroupScraperAccountState {
  accountId: string
  accountLabel: string
  state: string
  attempted: number
  added: number
  skipped: number
  failed: number
  restSeconds: number
  restUntil?: string | null
  restReason?: string | null
  lastMember?: string | null
  lastMessage?: string | null
  lastEventAt?: string | null
  pendingCandidates: number
}

export interface GroupScraperCampaignStats {
  joinedAccounts: number
  totalAccounts: number
  scrapedCount: number
  totalCandidates: number
  remainingCandidates: number
  attempted: number
  added: number
  skipped: number
  failed: number
  blockedAccounts: string[]
  activeAccountId?: string | null
  activeAccountLabel?: string | null
  activePhase?: string | null
  activeGroup?: string | null
  initialTargetGroupMembers?: number
  targetGroupMembers?: number
  addedByCampaign?: number
  accountStates: GroupScraperAccountState[]
}

export interface GroupScraperCampaignRecord {
  id: string
  userId: string
  name: string
  status: string
  sourceAccountId: string
  inviterAccountIds: string[]
  sourceGroup: string
  targetGroup: string
  maxMembers: number
  delaySeconds: number
  createdAt: string
  updatedAt: string
  lastStartedAt?: string | null
  lastFinishedAt?: string | null
  stats: GroupScraperCampaignStats
  events: GroupScraperCampaignEvent[]
  failures: GroupScraperFailure[]
}

export interface WarmupAccountStat {
  accountId: string
  displayName: string
  state: 'active' | 'resting' | 'idle'
  sentToday: number
  groupSentToday: number
  dmSentToday: number
  dailyLimit: number
  restUntil: string | null
  restSeconds: number
  lastError: string | null
}

export interface WarmupActivityEntry {
  at: string
  accountId: string
  displayName: string
  target: string
  type: 'group' | 'dm'
  message: string
}

interface WarmupStatusResponse {
  running: boolean
  stopRequested: boolean
  totalSent: number
  dmSent: number
  accounts: number
  restingCount: number
  errorCount: number
  accountStats: WarmupAccountStat[]
  activity: WarmupActivityEntry[]
  startedAt?: string
  intervalSeconds?: number
  order?: { accountId: string; displayName: string }[]
  rotationOffset?: number
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
  startQrConnection: () => Promise<{
    qrUrl: string
    qrToken: string
    expiresAt: string
  }>
  completeQrConnection: (
    qrToken: string
  ) => Promise<'pending' | 'password_required' | 'connected'>
  submitQrPassword: (qrToken: string, password: string) => Promise<void>
  connectSessionFile: (files: File[]) => Promise<User>
  sendPhoneCode: (phone: string) => Promise<PhoneSendCodeResponse>
  verifyPhoneCode: (phone: string, code: string, phoneToken: string) => Promise<'password_required' | 'connected'>
  submitPhonePassword: (phone: string, password: string, phoneToken: string) => Promise<void>
  removeConnectedAccount: (accountId: string) => Promise<void>
  setAccount2FA: (accountId: string, password: string, hint?: string) => Promise<void>
  removeAccount2FA: (accountId: string, currentPassword: string) => Promise<void>
  toggleExcludeChats: (accountId: string) => Promise<void>
  batchToggleExcludeChats: (accountIds: string[], exclude: boolean) => Promise<void>
  updateAccountProfile: (
    accountId: string,
    data: { firstName?: string; lastName?: string; username?: string }
  ) => Promise<void>
  updateAccountPhoto: (accountId: string, file: File) => Promise<void>
  refreshCurrentUser: () => Promise<void>
  checkAccountSessions: () => Promise<AccountSessionHealthItem[]>
  listGroupsForAccount: (accountId: string, limit?: number) => Promise<GroupScraperGroup[]>
  scrapeGroupMembers: (accountId: string, groupId: string) => Promise<{members: ScrapedMember[], count: number}>
  scrapeCampaignContacts: (campaignId: string) => Promise<{
    ok: boolean
    campaignId: string
    totalContacts: number
    contacts: Array<{userId: string; username?: string | null; displayName?: string; phone?: string}>
  }>
  loadFolderCampaignTargets: (campaignId: string) => Promise<{
    ok: boolean
    campaignId: string
    totalMembers: number
    filteredMembers: number
    blacklistedCount: number
    members: Array<{userId: string; username?: string | null; displayName?: string; accessHash?: string}>
  }>
  runGroupScraper: (payload: {
    sourceAccountId: string
    inviterAccountIds: string[]
    sourceGroup: string
    targetGroup: string
    delaySeconds: number
  }) => Promise<GroupScraperCampaignRecord>
  listGroupScraperCampaigns: () => Promise<GroupScraperCampaignRecord[]>
  getGroupScraperCampaign: (campaignId: string) => Promise<GroupScraperCampaignRecord>
  startGroupScraperCampaign: (campaignId: string) => Promise<GroupScraperCampaignRecord>
  stopGroupScraperCampaign: (campaignId: string) => Promise<GroupScraperCampaignRecord>
  leaveGroupScraperGroups: (campaignId: string) => Promise<GroupScraperCampaignRecord>
  joinGroupScraperGroups: (campaignId: string) => Promise<GroupScraperCampaignRecord>
  updateGroupScraperDelay: (
    campaignId: string,
    delaySeconds: number
  ) => Promise<GroupScraperCampaignRecord>
  deleteGroupScraperCampaign: (campaignId: string) => Promise<void>
  fetchUnreadSummary: () => Promise<UnreadSummaryResponse>
  fetchMessages: (limit?: number, offset?: number, folderId?: string | null) => Promise<{
    conversations: MessageConversation[]
    errors: string[]
    hasMore: boolean
    nextOffset?: number | null
    refreshing?: boolean
  }>
  fetchFolderConversations: (folderId: string) => Promise<{
    conversations: MessageConversation[]
    errors: string[]
    refreshing?: boolean
  }>
  fetchFolders: () => Promise<{
    folders: MessageFolder[]
    errors: string[]
  }>
  createFolder: (name: string, icon?: string, sortOrder?: number, folderType?: string, draftText?: string, watch?: { accountId: string; chatId: string; chatTitle: string }) => Promise<CustomFolder>
  listCustomFolders: () => Promise<{ folders: CustomFolder[] }>
  updateFolder: (folderId: string, data: { name?: string; icon?: string; sort_order?: number; folder_type?: string; draft_text?: string }) => Promise<{ ok: boolean }>
  deleteFolder: (folderId: string) => Promise<{ ok: boolean }>
  listFolderChats: (folderId: string) => Promise<{ chats: FolderChatEntry[] }>
  addChatToFolder: (folderId: string, accountId: string, chatId: string, meta?: { username?: string | null; displayName?: string | null; accessHash?: string | null; filterTag?: string | null }) => Promise<{ ok: boolean }>
  setFolderChatFilter: (folderId: string, accountId: string, chatIds: string[], filterTag: string | null) => Promise<{ ok: boolean; updated: number }>
  removeChatFromFolder: (folderId: string, accountId: string, chatId: string) => Promise<{ ok: boolean }>
  moveChatToFolder: (chatId: string, accountId: string, toFolderId: string, fromFolderId?: string) => Promise<{ ok: boolean }>
  batchMoveChatsToFolder: (toFolderId: string, fromFolderId: string | null, chats: Array<{ account_id: string; chat_id: string }>) => Promise<{ ok: boolean; moved: number }>
  createGroup: (accountId: string | undefined, title: string, selectedUsers: Array<{ account_id: string; chat_id: string; username?: string | null }>, presetId?: string, extraAdminUsernames?: string[]) => Promise<CreateGroupResult>
  blockUser: (accountId: string, chatId: string) => Promise<{ ok: boolean }>
  batchBlockUsers: (items: Array<{ account_id: string; chat_id: string }>) => Promise<{ ok: boolean; blocked: number; errors: string[] }>
  batchLeaveChats: (chats: Array<{ account_id: string; chat_id: string }>) => Promise<{ ok: boolean; left: number; errors: string[] }>
  listGroupPresets: () => Promise<{ presets: GroupPreset[] }>
  createGroupPreset: (name: string, adminUsernames: string[]) => Promise<{ id: string; name: string; admin_usernames: string[] }>
  updateGroupPreset: (presetId: string, data: { name?: string; admin_usernames?: string[] }) => Promise<{ ok: boolean }>
  deleteGroupPreset: (presetId: string) => Promise<{ ok: boolean }>
  createMassGroupCampaign: (payload: { title_template: string; admin_account_ids: string[]; usernames: string[]; delay_seconds: number }) => Promise<MassGroupCampaign>
  listMassGroupCampaigns: () => Promise<{ campaigns: MassGroupCampaign[] }>
  getMassGroupCampaign: (campaignId: string) => Promise<MassGroupCampaign>
  startMassGroupCampaign: (campaignId: string) => Promise<MassGroupCampaign>
  stopMassGroupCampaign: (campaignId: string) => Promise<MassGroupCampaign>
  deleteMassGroupCampaign: (campaignId: string) => Promise<{ ok: boolean }>
  fetchThread: (
    accountId: string,
    chatId: string,
    limit?: number,
    beforeId?: number,
    afterId?: number
  ) => Promise<{ items: MessageItem[] }>
  sendMessage: (
    accountId: string,
    chatId: string,
    text: string
  ) => Promise<MessageItem>
  sendFileMessage: (
    accountId: string,
    chatId: string,
    file: File,
    caption?: string
  ) => Promise<MessageItem>
  forwardMessage: (
    accountId: string,
    fromChatId: string,
    toChatId: string,
    messageId: number
  ) => Promise<MessageItem>
  forwardMessageBatch: (
    accountId: string,
    fromChatId: string,
    messageId: number,
    toChatIds: string[]
  ) => Promise<ForwardBatchResult[]>
  resolveUser: (
    accountId: string,
    query: string
  ) => Promise<{ chatId: string; name: string; username: string | null }>
  listCampaigns: () => Promise<CampaignRecord[]>
  fetchCampaignLeads: () => Promise<CampaignLead[]>
  fetchConversations: () => Promise<CampaignLead[]>
  markConversation: (payload: { campaign_id: string; account_id: string; chat_id: string; target?: string }) => Promise<void>
  createCampaign: (payload: CampaignStartPayload) => Promise<CampaignRecord>
  updateCampaign: (campaignId: string, payload: CampaignStartPayload) => Promise<CampaignRecord>
  deleteCampaign: (campaignId: string) => Promise<void>
  startCampaign: (campaignId: string) => Promise<CampaignStartResponse>
  pauseCampaign: (campaignId: string) => Promise<CampaignRecord>
  joinCampaignGroup: (campaignId: string) => Promise<{ok: boolean, results: Array<{accountId: string, status: string, error?: string}>}>
  leaveCampaignGroup: (campaignId: string) => Promise<{ok: boolean, results: Array<{accountId: string, status: string, error?: string}>}>
  removeUnresolvedTargets: (campaignId: string) => Promise<CampaignRecord>
  removePreviouslyMessagedTargets: (campaignId: string) => Promise<CampaignRecord>
  refreshUnresolvedTargets: (campaignId: string) => Promise<CampaignRecord>
  refreshCampaignReplyStats: (campaignId: string) => Promise<CampaignReplyStatsResponse>
  fetchCampaignLeadsById: (campaignId: string) => Promise<CampaignLead[]>
  refreshCampaignSeenStats: (campaignId: string) => Promise<CampaignSeenStatsResponse>
  fetchMessageMediaUrl: (accountId: string, chatId: string, messageId: number) => Promise<string>
  getAccountPhotoUrl: (accountId: string) => string
  getConversationPhotoUrl: (accountId: string, chatId: string) => string
  updateNotificationSettings: (settings: Partial<User['notificationSettings']>) => void
  updateProfile: (profile: Partial<Pick<User, 'name' | 'avatar'>>) => void
  startWarmup: (accountIds: string[], intervalSeconds?: number) => Promise<void>
  stopWarmup: () => Promise<void>
  getWarmupStatus: () => Promise<WarmupStatusResponse>
  leaveChat: (accountId: string, chatId: string) => Promise<void>
  markRead: (accountId: string, chatId: string) => Promise<void>
  listStoredMessages: () => Promise<{ messages: StoredMessage[] }>
  createStoredMessage: (data: { text?: string; file?: File }) => Promise<{ message: StoredMessage }>
  deleteStoredMessage: (messageId: string) => Promise<{ ok: boolean }>
  getStoredMessageFileUrl: (messageId: string) => string
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1'

interface AuthApiResponse {
  token: string
  user: User
}

interface UserEnvelopeResponse {
  user: User
}

interface QrCompleteResponse {
  status: 'pending' | 'password_required' | 'connected'
  user: User | null
}

interface PhoneSendCodeResponse {
  phoneToken: string
  expiresAt: string
}

interface PhoneVerifyResponse {
  status: 'password_required' | 'connected'
  user: User | null
}

interface MessagesResponse {
  conversations: MessageConversation[]
  errors: string[]
  hasMore: boolean
  nextOffset?: number | null
  refreshing?: boolean
}

interface ThreadResponse {
  items: MessageItem[]
}

interface SendMessageResponse {
  ok: boolean
  item: MessageItem
}

export interface ForwardBatchResult {
  toChatId: string
  ok: boolean
  item?: MessageItem | null
  error?: string
}

interface ForwardBatchResponse {
  ok: boolean
  results: ForwardBatchResult[]
}

interface CampaignListResponse {
  campaigns: CampaignRecord[]
}

interface CampaignSaveResponse {
  campaign: CampaignRecord
}

interface GroupScraperGroupsResponse {
  groups: GroupScraperGroup[]
}

interface GroupScraperCampaignListResponse {
  campaigns: GroupScraperCampaignRecord[]
}

interface GroupScraperCampaignSaveResponse {
  campaign: GroupScraperCampaignRecord
}

interface OkResponse {
  ok: boolean
}

interface AccountsSessionHealthResponse {
  accounts: AccountSessionHealthItem[]
}

async function requestJson<T>(
  endpoint: string,
  options: RequestInit
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
    })
  } catch {
    throw new Error(`Cannot reach backend at ${API_BASE_URL}. Ensure FastAPI is running and reachable.`)
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'detail' in data
        ? String(data.detail)
        : 'Request failed. Please try again.'
    throw new Error(message)
  }

  return data as T
}

function getToken() {
  return localStorage.getItem('sessionToken') || ''
}

function getStoredUser(): User | null {
  const stored = localStorage.getItem('user')
  if (!stored) {
    return null
  }

  try {
    return JSON.parse(stored) as User
  } catch {
    localStorage.removeItem('user')
    localStorage.removeItem('sessionToken')
    return null
  }
}

async function authRequest(
  endpoint: string,
  payload: Record<string, string>
): Promise<AuthApiResponse> {
  return requestJson<AuthApiResponse>(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Initialize from localStorage and validate session
  useEffect(() => {
    const storedUser = getStoredUser()
    const storedToken = getToken()
    if (!storedUser || !storedToken) {
      setUser(null)
      setIsLoading(false)
      return
    }

    fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Invalid session')
        const data = await res.json()
        setUser(data.user)
        localStorage.setItem('user', JSON.stringify(data.user))
      })
      .catch(() => {
        setUser(null)
        localStorage.removeItem('user')
        localStorage.removeItem('sessionToken')
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const result = await authRequest('/auth/login', { email, password })
    setUser(result.user)
    localStorage.setItem('user', JSON.stringify(result.user))
    localStorage.setItem('sessionToken', result.token)
  }

  const signup = async (email: string, password: string, name: string) => {
    const result = await authRequest('/auth/signup', { email, password, name })
    setUser(result.user)
    localStorage.setItem('user', JSON.stringify(result.user))
    localStorage.setItem('sessionToken', result.token)
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('user')
    localStorage.removeItem('sessionToken')
  }

  const persistUser = (nextUser: User) => {
    setUser(nextUser)
    localStorage.setItem('user', JSON.stringify(nextUser))
  }

  const restoreSession = async (userId: string) => {
    const result = await requestJson<AuthApiResponse>('/auth/restore-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    })
    localStorage.setItem('sessionToken', result.token)
    persistUser(result.user)
  }

  const withSessionRetry = async <T,>(
    operation: () => Promise<T>,
    retryOperation: () => Promise<T>
  ) => {
    try {
      return await operation()
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.toLowerCase().includes('user not found')) {
        logout()
        router.push('/login')
        throw err
      }
      if (message.toLowerCase().includes('invalid or expired session') && user?.id) {
        await restoreSession(user.id)
        try {
          return await retryOperation()
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : ''
          if (retryMsg.toLowerCase().includes('invalid or expired session')) {
            logout()
            router.push('/login')
          }
          throw retryErr
        }
      }
      throw err
    }
  }

  const startQrConnection = async () => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<{ qrUrl: string; qrToken: string; expiresAt: string }>(
        '/accounts/connect-qr/start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ userId: user.id }),
        }
      )
    return withSessionRetry(request, request)
  }

  const completeQrConnection = async (qrToken: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<QrCompleteResponse>('/accounts/connect-qr/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, qrToken }),
      })
    const result = await withSessionRetry(request, request)
    if (result.status === 'connected' && result.user) {
      persistUser(result.user)
      return 'connected'
    }
    return result.status
  }

  const submitQrPassword = async (qrToken: string, password: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<QrCompleteResponse>('/accounts/connect-qr/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, qrToken, password }),
      })
    const result = await withSessionRetry(request, request)
    if (result.status !== 'connected' || !result.user) {
      throw new Error('Failed to complete Telegram 2FA')
    }
    persistUser(result.user)
  }

  const connectSessionFile = async (files: File[]) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    if (!files.length) {
      throw new Error('Select at least one .session file')
    }
    const form = new FormData()
    form.append('user_id', user.id)
    for (const file of files) {
      form.append('session_files', file)
    }
    const request = () =>
      requestJson<UserEnvelopeResponse>('/accounts/connect-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
        body: form,
      })
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
    return result.user
  }

  const sendPhoneCode = async (phone: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<PhoneSendCodeResponse>('/accounts/connect-phone/send-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, phone }),
      })
    return withSessionRetry(request, request)
  }

  const verifyPhoneCode = async (phone: string, code: string, phoneToken: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<PhoneVerifyResponse>('/accounts/connect-phone/verify-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, phone, code, phoneToken }),
      })
    const result = await withSessionRetry(request, request)
    if (result.status === 'connected' && result.user) {
      persistUser(result.user)
      return 'connected'
    }
    return result.status
  }

  const submitPhonePassword = async (phone: string, password: string, phoneToken: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<PhoneVerifyResponse>('/accounts/connect-phone/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, phone, password, phoneToken }),
      })
    const result = await withSessionRetry(request, request)
    if (result.status !== 'connected' || !result.user) {
      throw new Error('Failed to complete Telegram login')
    }
    persistUser(result.user)
  }

  const removeConnectedAccount = async (accountId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<UserEnvelopeResponse>(
        `/accounts/${accountId}?user_id=${encodeURIComponent(user.id)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
  }

  const setAccount2FA = async (accountId: string, password: string, hint?: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<UserEnvelopeResponse>(`/accounts/${accountId}/set-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, password, hint: hint || null }),
      })
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
  }

  const removeAccount2FA = async (accountId: string, currentPassword: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<UserEnvelopeResponse>(`/accounts/${accountId}/remove-2fa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, currentPassword }),
      })
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
  }

  const toggleExcludeChats = async (accountId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<UserEnvelopeResponse>(
        `/accounts/${accountId}/toggle-exclude-chats`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ userId: user.id }),
        }
      )
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
  }

  const batchToggleExcludeChats = async (accountIds: string[], exclude: boolean) => {
    if (!user) throw new Error('Please sign in again')
    if (!accountIds.length) return
    const request = () =>
      requestJson<UserEnvelopeResponse>('/accounts/batch-exclude', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, accountIds, exclude }),
      })
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
  }

  const updateAccountProfile = async (
    accountId: string,
    data: { firstName?: string; lastName?: string; username?: string }
  ) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<UserEnvelopeResponse>(`/accounts/${accountId}/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ userId: user.id, ...data }),
      })
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
  }

  const updateAccountPhoto = async (accountId: string, file: File) => {
    if (!user) throw new Error('Please sign in again')
    const form = new FormData()
    form.append('user_id', user.id)
    form.append('file', file)
    const request = () =>
      requestJson<UserEnvelopeResponse>(`/accounts/${accountId}/photo`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
        body: form,
      })
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
  }

  const refreshCurrentUser = async () => {
    if (!user) return
    const request = () =>
      requestJson<UserEnvelopeResponse>('/auth/me', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    const result = await withSessionRetry(request, request)
    persistUser(result.user)
  }

  const checkAccountSessions = async () => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<AccountsSessionHealthResponse>('/accounts/session-health', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    const result = await withSessionRetry(request, request)
    return result.accounts || []
  }

  const listGroupsForAccount = async (accountId: string, limit = 200) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const safeLimit = Math.max(10, Math.min(500, Math.floor(limit || 200)))
    const request = () =>
      requestJson<GroupScraperGroupsResponse>(
        `/group-scraper/groups?account_id=${encodeURIComponent(accountId)}&limit=${encodeURIComponent(String(safeLimit))}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.groups
  }

  const scrapeGroupMembers = async (accountId: string, groupId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<{members: ScrapedMember[], count: number}>(
        `/scrape-group/members?account_id=${encodeURIComponent(accountId)}&group_id=${encodeURIComponent(groupId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    return withSessionRetry(request, request)
  }

  const scrapeCampaignContacts = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<{
        ok: boolean
        campaignId: string
        totalContacts: number
        contacts: Array<{userId: string; username?: string | null; displayName?: string; phone?: string}>
      }>(
        `/campaigns/${encodeURIComponent(campaignId)}/scrape-contacts`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    return withSessionRetry(request, request)
  }

  const loadFolderCampaignTargets = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<{
        ok: boolean
        campaignId: string
        totalMembers: number
        filteredMembers: number
        blacklistedCount: number
        appliedFilterTags?: string[]
        members: Array<{userId: string; username?: string | null; displayName?: string; accessHash?: string}>
      }>(
        `/campaigns/${encodeURIComponent(campaignId)}/load-folder-targets`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    return withSessionRetry(request, request)
  }

  const runGroupScraper = async (payload: {
    sourceAccountId: string
    inviterAccountIds: string[]
    sourceGroup: string
    targetGroup: string
    delaySeconds: number
  }) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const sourceAccountId = payload.sourceAccountId.trim()
    if (!sourceAccountId) {
      throw new Error('Source account is required')
    }
    const inviterAccountIds = payload.inviterAccountIds
      .map((item) => item.trim())
      .filter(Boolean)
    if (inviterAccountIds.length === 0) {
      throw new Error('Choose at least one inviter account')
    }
    const sourceGroup = payload.sourceGroup.trim()
    const targetGroup = payload.targetGroup.trim()
    if (!sourceGroup || !targetGroup) {
      throw new Error('Source and target groups are required')
    }
    const delaySeconds = Math.max(0, Math.min(3600, Number(payload.delaySeconds) || 0))

    const request = () =>
      requestJson<GroupScraperCampaignSaveResponse>('/group-scraper/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          userId: user.id,
          sourceAccountId,
          inviterAccountIds,
          sourceGroup,
          targetGroup,
          delaySeconds,
        }),
      })
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const listGroupScraperCampaigns = async () => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<GroupScraperCampaignListResponse>('/group-scraper/campaigns', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    const result = await withSessionRetry(request, request)
    return result.campaigns
  }

  const getGroupScraperCampaign = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<GroupScraperCampaignSaveResponse>(
        `/group-scraper/campaigns/${encodeURIComponent(campaignId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const startGroupScraperCampaign = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<GroupScraperCampaignSaveResponse>(
        `/group-scraper/campaigns/${encodeURIComponent(campaignId)}/start`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const stopGroupScraperCampaign = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<GroupScraperCampaignSaveResponse>(
        `/group-scraper/campaigns/${encodeURIComponent(campaignId)}/stop`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const leaveGroupScraperGroups = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<GroupScraperCampaignSaveResponse>(
        `/group-scraper/campaigns/${encodeURIComponent(campaignId)}/leave-groups`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const joinGroupScraperGroups = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<GroupScraperCampaignSaveResponse>(
        `/group-scraper/campaigns/${encodeURIComponent(campaignId)}/join-groups`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const updateGroupScraperDelay = async (campaignId: string, delaySecondsValue: number) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const delaySeconds = Math.max(0, Math.min(3600, Number(delaySecondsValue) || 0))
    const request = () =>
      requestJson<GroupScraperCampaignSaveResponse>(
        `/group-scraper/campaigns/${encodeURIComponent(campaignId)}/delay`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ delaySeconds }),
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const deleteGroupScraperCampaign = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<OkResponse>(
        `/group-scraper/campaigns/${encodeURIComponent(campaignId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    await withSessionRetry(request, request)
  }

  const fetchUnreadSummary = async () => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<UnreadSummaryResponse>('/messages/unread-summary', {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const fetchMessages = async (limit = 80, offset = 0, folderId?: string | null) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const safeLimit = Math.max(10, Math.min(200, limit))
    const safeOffset = Math.max(0, offset)
    const folderQuery = folderId ? `&folder_id=${encodeURIComponent(String(folderId))}` : ''
    const request = () =>
      requestJson<MessagesResponse>(
        `/messages/conversations?limit=${encodeURIComponent(String(safeLimit))}&offset=${encodeURIComponent(
          String(safeOffset)
        )}${folderQuery}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    return withSessionRetry(request, request)
  }

  const fetchFolders = async () => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<{ folders: MessageFolder[]; errors: string[] }>(
        `/messages/folders`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    return withSessionRetry(request, request)
  }

  const createFolder = async (name: string, icon = 'folder', sortOrder = 0, folderType = 'standard', draftText = '', watch?: { accountId: string; chatId: string; chatTitle: string }) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<CustomFolder>('/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          name, icon, sort_order: sortOrder, folder_type: folderType, draft_text: draftText,
          watch_account_id: watch?.accountId || '', watch_chat_id: watch?.chatId || '', watch_chat_title: watch?.chatTitle || '',
        }),
      })
    return withSessionRetry(request, request)
  }

  const fetchFolderConversations = async (folderId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<{ conversations: MessageConversation[]; errors: string[]; refreshing?: boolean }>(
        `/folders/${encodeURIComponent(folderId)}/conversations`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    return withSessionRetry(request, request)
  }

  const listCustomFolders = async () => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ folders: CustomFolder[] }>('/folders', {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const updateFolder = async (folderId: string, data: { name?: string; icon?: string; sort_order?: number; folder_type?: string; draft_text?: string }) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>(`/folders/${encodeURIComponent(folderId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(data),
      })
    return withSessionRetry(request, request)
  }

  const deleteFolder = async (folderId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>(`/folders/${encodeURIComponent(folderId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const listFolderChats = async (folderId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ chats: FolderChatEntry[] }>(`/folders/${encodeURIComponent(folderId)}/chats`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const addChatToFolder = async (
    folderId: string,
    accountId: string,
    chatId: string,
    meta?: { username?: string | null; displayName?: string | null; accessHash?: string | null; filterTag?: string | null },
  ) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>(`/folders/${encodeURIComponent(folderId)}/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          account_id: accountId,
          chat_id: chatId,
          username: meta?.username ?? null,
          display_name: meta?.displayName ?? null,
          access_hash: meta?.accessHash ?? null,
          filter_tag: meta?.filterTag ?? null,
        }),
      })
    return withSessionRetry(request, request)
  }

  const setFolderChatFilter = async (
    folderId: string,
    accountId: string,
    chatIds: string[],
    filterTag: string | null,
  ) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean; updated: number }>(`/folders/${encodeURIComponent(folderId)}/chats/filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          account_id: accountId,
          chat_ids: chatIds,
          filter_tag: filterTag,
        }),
      })
    return withSessionRetry(request, request)
  }

  const removeChatFromFolder = async (folderId: string, accountId: string, chatId: string) => {
    if (!user) throw new Error('Please sign in again')
    const params = new URLSearchParams({ account_id: accountId, chat_id: chatId })
    const request = () =>
      requestJson<{ ok: boolean }>(`/folders/${encodeURIComponent(folderId)}/chats?${params.toString()}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const moveChatToFolder = async (chatId: string, accountId: string, toFolderId: string, fromFolderId?: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>('/folders/move-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ chat_id: chatId, account_id: accountId, to_folder_id: toFolderId, from_folder_id: fromFolderId }),
      })
    return withSessionRetry(request, request)
  }

  const batchMoveChatsToFolder = async (toFolderId: string, fromFolderId: string | null, chats: Array<{ account_id: string; chat_id: string }>) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean; moved: number }>('/folders/batch-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ to_folder_id: toFolderId, from_folder_id: fromFolderId, chats }),
      })
    return withSessionRetry(request, request)
  }

  const createGroup = async (
    accountId: string | undefined,
    title: string,
    selectedUsers: Array<{ account_id: string; chat_id: string; username?: string | null }>,
    presetId?: string,
    extraAdminUsernames?: string[]
  ) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<CreateGroupResult>('/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          ...(accountId ? { account_id: accountId } : {}),
          title,
          selected_users: selectedUsers.map(u => ({ account_id: u.account_id, chat_id: u.chat_id, username: u.username })),
          preset_id: presetId,
          extra_admin_usernames: extraAdminUsernames || [],
        }),
      })
    return withSessionRetry(request, request)
  }

  const blockUser = async (accountId: string, chatId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>('/messages/block-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ account_id: accountId, chat_id: chatId }),
      })
    return withSessionRetry(request, request)
  }

  const batchBlockUsers = async (items: Array<{ account_id: string; chat_id: string }>) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean; blocked: number; errors: string[] }>('/messages/batch-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ items }),
      })
    return withSessionRetry(request, request)
  }

  const listGroupPresets = async () => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ presets: GroupPreset[] }>('/groups/presets', {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const createGroupPreset = async (name: string, adminUsernames: string[]) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ id: string; name: string; admin_usernames: string[] }>('/groups/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ name, admin_usernames: adminUsernames }),
      })
    return withSessionRetry(request, request)
  }

  const updateGroupPreset = async (presetId: string, data: { name?: string; admin_usernames?: string[] }) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>(`/groups/presets/${encodeURIComponent(presetId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(data),
      })
    return withSessionRetry(request, request)
  }

  const deleteGroupPreset = async (presetId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>(`/groups/presets/${encodeURIComponent(presetId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const createMassGroupCampaign = async (payload: { title_template: string; admin_account_ids: string[]; usernames: string[]; delay_seconds: number }) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ campaign: MassGroupCampaign }>('/mass-groups/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(payload),
      })
    const res = await withSessionRetry(request, request)
    return res.campaign
  }

  const listMassGroupCampaigns = async () => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ campaigns: MassGroupCampaign[] }>('/mass-groups/campaigns', {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const getMassGroupCampaign = async (campaignId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ campaign: MassGroupCampaign }>(`/mass-groups/campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    const res = await withSessionRetry(request, request)
    return res.campaign
  }

  const startMassGroupCampaign = async (campaignId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ campaign: MassGroupCampaign }>(`/mass-groups/campaigns/${encodeURIComponent(campaignId)}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    const res = await withSessionRetry(request, request)
    return res.campaign
  }

  const stopMassGroupCampaign = async (campaignId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ campaign: MassGroupCampaign }>(`/mass-groups/campaigns/${encodeURIComponent(campaignId)}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    const res = await withSessionRetry(request, request)
    return res.campaign
  }

  const deleteMassGroupCampaign = async (campaignId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>(`/mass-groups/campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const fetchThread = async (
    accountId: string,
    chatId: string,
    limit = 100,
    beforeId?: number,
    afterId?: number
  ) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const safeLimit = Math.max(10, Math.min(200, limit))
    const params = new URLSearchParams({
      account_id: accountId,
      chat_id: chatId,
      limit: String(safeLimit),
    })
    if (typeof beforeId === 'number' && beforeId > 0) {
      params.set('before_id', String(beforeId))
    }
    if (typeof afterId === 'number' && afterId > 0) {
      params.set('after_id', String(afterId))
    }
    const request = () =>
      requestJson<ThreadResponse>(
        `/messages/thread?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    return withSessionRetry(request, request)
  }

  const sendMessage = async (accountId: string, chatId: string, text: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const clean = text.trim()
    if (!clean) {
      throw new Error('Message cannot be empty')
    }
    const request = () =>
      requestJson<SendMessageResponse>('/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ accountId, chatId, text: clean }),
      })
    const result = await withSessionRetry(request, request)
    return result.item
  }

  const sendFileMessage = async (
    accountId: string,
    chatId: string,
    file: File,
    caption = ''
  ) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    if (!file) {
      throw new Error('Please choose a file')
    }
    const form = new FormData()
    form.append('account_id', accountId)
    form.append('chat_id', chatId)
    form.append('file', file)
    form.append('caption', caption)

    const request = () =>
      requestJson<SendMessageResponse>('/messages/send-file', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
        body: form,
      })
    const result = await withSessionRetry(request, request)
    return result.item
  }

  const forwardMessage = async (
    accountId: string,
    fromChatId: string,
    toChatId: string,
    messageId: number
  ) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<SendMessageResponse>('/messages/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ accountId, fromChatId, toChatId, messageId }),
      })
    const result = await withSessionRetry(request, request)
    return result.item
  }

  const forwardMessageBatch = async (
    accountId: string,
    fromChatId: string,
    messageId: number,
    toChatIds: string[]
  ) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<ForwardBatchResponse>('/messages/forward-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ accountId, fromChatId, messageId, toChatIds }),
      })
    const result = await withSessionRetry(request, request)
    return result.results
  }

  const resolveUser = async (accountId: string, query: string) => {
    if (!user) throw new Error('Please sign in again')
    const qs = `accountId=${encodeURIComponent(accountId)}&query=${encodeURIComponent(query)}`
    const request = () =>
      requestJson<{ ok: boolean; chatId: string; name: string; username: string | null }>(
        `/messages/resolve-user?${qs}`,
        { method: 'GET', headers: { Authorization: `Bearer ${getToken()}` } }
      )
    const result = await withSessionRetry(request, request)
    return { chatId: result.chatId, name: result.name, username: result.username }
  }

  const normalizeCampaignPayload = (payload: CampaignStartPayload) => {
    if (!user) {
      throw new Error('Please sign in again')
    }

    const name = payload.name.trim()
    if (!name) {
      throw new Error('Campaign name is required')
    }

    const accountIds = payload.accountIds
      .map((item) => item.trim())
      .filter(Boolean)
    if (accountIds.length === 0) {
      throw new Error('Select at least one account')
    }

    const messages = payload.messages
      .map((item) => item.trim())
      .filter(Boolean)
    if (messages.length === 0) {
      throw new Error('Add at least one rotating message')
    }

    const dailyMessageLimitPerAccount = Math.max(
      1,
      Math.floor(payload.dailyMessageLimitPerAccount || 0)
    )

    const campType = payload.campaignType || 'group'
    const targetsCsv = payload.targetsCsv.trim()
    const sourceGroup = (payload.sourceGroup || '').trim()

    if (campType === 'group') {
      if (!sourceGroup) {
        throw new Error('Select a source group for the campaign')
      }
    } else if (campType === 'username') {
      if (!targetsCsv) {
        throw new Error('Upload a CSV file with usernames or paste them')
      }
    }
    // contact type: no validation for targetsCsv or sourceGroup (targets come from scraping)

    // Keep only well-formed follow-up steps; disable if none remain.
    let followUp: FollowUpConfig | null = null
    if (payload.followUp?.enabled) {
      const steps = (payload.followUp.steps || [])
        .map((s) => ({ delayHours: Number(s.delayHours) || 0, message: (s.message || '').trim() }))
        .filter((s) => s.message && s.delayHours > 0)
      followUp = { enabled: steps.length > 0, steps }
    }

    return {
      name,
      accountIds,
      dailyMessageLimitPerAccount,
      messages,
      targetsCsv: campType === 'username' ? targetsCsv : '',
      sourceGroup: campType === 'group' ? sourceGroup : undefined,
      sourceFolder: payload.sourceFolder || undefined,
      resolutionGroup: campType === 'folder' ? (payload.resolutionGroup || '').trim() || undefined : undefined,
      blacklistedUsers: payload.blacklistedUsers || [],
      messageIntervalSeconds: payload.messageIntervalSeconds || 5,
      campaignType: campType,
      sortByActivity: payload.sortByActivity || null,
      skipMessaged: payload.skipMessaged ?? false,
      followUp,
    }
  }

  const listCampaigns = async () => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<CampaignListResponse>('/campaigns', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    const result = await withSessionRetry(request, request)
    return result.campaigns
  }

  const fetchCampaignLeads = async () => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<{ leads: CampaignLead[] }>('/campaigns/leads', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    const result = await withSessionRetry(request, request)
    return result.leads
  }

  const fetchConversations = async () => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ conversations: CampaignLead[] }>('/campaigns/conversations', {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    const result = await withSessionRetry(request, request)
    return result.conversations
  }

  const markConversation = async (payload: { campaign_id: string; account_id: string; chat_id: string; target?: string }) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>('/campaigns/conversations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    await withSessionRetry(request, request)
  }

  const createCampaign = async (payload: CampaignStartPayload) => {
    const normalized = normalizeCampaignPayload(payload)
    const request = () =>
      requestJson<CampaignSaveResponse>('/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(normalized),
      })
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const updateCampaign = async (campaignId: string, payload: CampaignStartPayload) => {
    const normalized = normalizeCampaignPayload(payload)
    const request = () =>
      requestJson<CampaignSaveResponse>(`/campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(normalized),
      })
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const deleteCampaign = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<OkResponse>(`/campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    await withSessionRetry(request, request)
  }

  const startCampaign = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<CampaignStartResponse>(`/campaigns/${encodeURIComponent(campaignId)}/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    return withSessionRetry(request, request)
  }

  const pauseCampaign = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<CampaignSaveResponse>(`/campaigns/${encodeURIComponent(campaignId)}/pause`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const joinCampaignGroup = async (campaignId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ok: boolean, results: Array<{accountId: string, status: string, error?: string}>}>(
        `/campaigns/${encodeURIComponent(campaignId)}/join-group`,
        { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` } }
      )
    return withSessionRetry(request, request)
  }

  const leaveCampaignGroup = async (campaignId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ok: boolean, results: Array<{accountId: string, status: string, error?: string}>}>(
        `/campaigns/${encodeURIComponent(campaignId)}/leave-group`,
        { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` } }
      )
    return withSessionRetry(request, request)
  }

  const removeUnresolvedTargets = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<CampaignSaveResponse>(
        `/campaigns/${encodeURIComponent(campaignId)}/remove-unresolved`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const removePreviouslyMessagedTargets = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<CampaignSaveResponse>(
        `/campaigns/${encodeURIComponent(campaignId)}/remove-previously-messaged`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const refreshUnresolvedTargets = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<CampaignSaveResponse>(
        `/campaigns/${encodeURIComponent(campaignId)}/refresh-unresolved`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    const result = await withSessionRetry(request, request)
    return result.campaign
  }

  const refreshCampaignReplyStats = async (campaignId: string) => {
    if (!user) {
      throw new Error('Please sign in again')
    }
    const request = () =>
      requestJson<CampaignReplyStatsResponse>(
        `/campaigns/${encodeURIComponent(campaignId)}/reply-stats`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        }
      )
    return withSessionRetry(request, request)
  }

  const fetchCampaignLeadsById = async (campaignId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ leads: CampaignLead[] }>(`/campaigns/${encodeURIComponent(campaignId)}/leads`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    const result = await withSessionRetry(request, request)
    return result.leads
  }

  const refreshCampaignSeenStats = async (campaignId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<CampaignSeenStatsResponse>(
        `/campaigns/${encodeURIComponent(campaignId)}/seen-stats`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
        }
      )
    return withSessionRetry(request, request)
  }

  const fetchMessageMediaUrl = async (accountId: string, chatId: string, messageId: number): Promise<string> => {
    const params = new URLSearchParams({
      account_id: accountId,
      chat_id: chatId,
      message_id: String(messageId),
    })
    const res = await fetch(`${API_BASE_URL}/messages/media?${params.toString()}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!res.ok) throw new Error('Failed to load media')
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  }

  const getAccountPhotoUrl = (accountId: string) => {
    const params = new URLSearchParams({ token: getToken() })
    return `${API_BASE_URL}/accounts/${accountId}/photo?${params.toString()}`
  }

  const getConversationPhotoUrl = (accountId: string, chatId: string) => {
    const params = new URLSearchParams({ account_id: accountId, chat_id: chatId, token: getToken() })
    return `${API_BASE_URL}/messages/profile-photo?${params.toString()}`
  }

  const updateNotificationSettings = (
    settings: Partial<User['notificationSettings']>
  ) => {
    if (!user) return

    const updated = {
      ...user,
      notificationSettings: {
        ...user.notificationSettings,
        ...settings,
      },
    }
    setUser(updated)
    localStorage.setItem('user', JSON.stringify(updated))
  }

  const updateProfile = (
    profile: Partial<Pick<User, 'name' | 'avatar'>>
  ) => {
    if (!user) return

    const updated = {
      ...user,
      ...profile,
    }
    setUser(updated)
    localStorage.setItem('user', JSON.stringify(updated))
  }

  const startWarmup = async (accountIds: string[], intervalSeconds = 120) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>('/warmup/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ accountIds, intervalSeconds }),
      })
    await withSessionRetry(request, request)
  }

  const stopWarmup = async () => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>('/warmup/stop', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    await withSessionRetry(request, request)
  }

  const getWarmupStatus = async () => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<WarmupStatusResponse>('/warmup/status', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      })
    const result = await withSessionRetry(request, request)
    return result
  }

  const leaveChat = async (accountId: string, chatId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>('/messages/leave-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ accountId, chatId }),
      })
    await withSessionRetry(request, request)
  }

  const batchLeaveChats = async (chats: Array<{ account_id: string; chat_id: string }>) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean; left: number; errors: string[] }>('/messages/batch-leave', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ chats }),
      })
    return withSessionRetry(request, request)
  }

  const markRead = async (accountId: string, chatId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>('/messages/mark-read', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ accountId, chatId }),
      })
    await withSessionRetry(request, request)
  }

  const listStoredMessages = async () => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ messages: StoredMessage[] }>('/stored-messages', {
        method: 'GET',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const createStoredMessage = async (data: { text?: string; file?: File }) => {
    if (!user) throw new Error('Please sign in again')
    const form = new FormData()
    if (data.text) form.append('text', data.text)
    if (data.file) form.append('file', data.file)
    const request = () =>
      requestJson<{ message: StoredMessage }>('/stored-messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      })
    return withSessionRetry(request, request)
  }

  const deleteStoredMessage = async (messageId: string) => {
    if (!user) throw new Error('Please sign in again')
    const request = () =>
      requestJson<{ ok: boolean }>(`/stored-messages/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    return withSessionRetry(request, request)
  }

  const getStoredMessageFileUrl = (messageId: string) => {
    return `${API_BASE_URL}/stored-messages/${encodeURIComponent(messageId)}/file?token=${getToken()}`
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        signup,
        logout,
        startQrConnection,
        completeQrConnection,
        submitQrPassword,
        connectSessionFile,
        sendPhoneCode,
        verifyPhoneCode,
        submitPhonePassword,
        removeConnectedAccount,
        setAccount2FA,
        removeAccount2FA,
        toggleExcludeChats,
        batchToggleExcludeChats,
        updateAccountProfile,
        updateAccountPhoto,
        refreshCurrentUser,
        checkAccountSessions,
        listGroupsForAccount,
        scrapeGroupMembers,
        scrapeCampaignContacts,
        loadFolderCampaignTargets,
        runGroupScraper,
        listGroupScraperCampaigns,
        getGroupScraperCampaign,
        startGroupScraperCampaign,
        stopGroupScraperCampaign,
        leaveGroupScraperGroups,
        joinGroupScraperGroups,
        updateGroupScraperDelay,
        deleteGroupScraperCampaign,
        fetchUnreadSummary,
        fetchMessages,
        fetchFolderConversations,
        fetchFolders,
        createFolder,
        listCustomFolders,
        updateFolder,
        deleteFolder,
        listFolderChats,
        addChatToFolder,
        setFolderChatFilter,
        removeChatFromFolder,
        moveChatToFolder,
        batchMoveChatsToFolder,
        createGroup,
        listGroupPresets,
        createGroupPreset,
        updateGroupPreset,
        deleteGroupPreset,
        createMassGroupCampaign,
        listMassGroupCampaigns,
        getMassGroupCampaign,
        startMassGroupCampaign,
        stopMassGroupCampaign,
        deleteMassGroupCampaign,
        fetchThread,
        sendMessage,
        sendFileMessage,
        forwardMessage,
        forwardMessageBatch,
        resolveUser,
        listCampaigns,
        fetchCampaignLeads,
        fetchConversations,
        markConversation,
        createCampaign,
        updateCampaign,
        deleteCampaign,
        startCampaign,
        pauseCampaign,
        joinCampaignGroup,
        leaveCampaignGroup,
        removeUnresolvedTargets,
        removePreviouslyMessagedTargets,
        refreshUnresolvedTargets,
        refreshCampaignReplyStats,
        fetchCampaignLeadsById,
        refreshCampaignSeenStats,
        fetchMessageMediaUrl,
        getAccountPhotoUrl,
        getConversationPhotoUrl,
        updateNotificationSettings,
        updateProfile,
        startWarmup,
        stopWarmup,
        getWarmupStatus,
        blockUser,
        batchBlockUsers,
        leaveChat,
        batchLeaveChats,
        markRead,
        listStoredMessages,
        createStoredMessage,
        deleteStoredMessage,
        getStoredMessageFileUrl,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (undefined === context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
