'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth, type ConnectedAccount } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Smartphone,
  QrCode,
  Upload,
  Phone,
  Trash2,
  Circle,
  UserRound,
  PhoneCall,

  MessageSquareOff,
  ShieldCheck,
  CircleHelp,
  Pencil,
  Loader2,
  Camera,
  Lock,
  LockKeyholeOpen,
} from 'lucide-react'

export default function AccountsSettingsPage() {
  const searchParams = useSearchParams()
  const {
    user,
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
    getAccountPhotoUrl,
  } = useAuth()

  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'qr' | 'phone' | 'session'>('qr')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingSessions, setIsCheckingSessions] = useState(false)
  const [sessionHealthByAccountId, setSessionHealthByAccountId] = useState<Record<string, { ok: boolean; needsReconnect: boolean; detail?: string | null; status?: 'good' | 'banned' | 'frozen' | 'disconnected' | 'error' | null }>>({})

  const [editingAccount, setEditingAccount] = useState<ConnectedAccount | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editUsername, setEditUsername] = useState('')
  const [originalFirstName, setOriginalFirstName] = useState('')
  const [originalLastName, setOriginalLastName] = useState('')
  const [originalUsername, setOriginalUsername] = useState('')
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null)
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null)
  const [isEditSaving, setIsEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [qrExpiresAt, setQrExpiresAt] = useState<string | null>(null)
  const [qrSecondsLeft, setQrSecondsLeft] = useState<number>(0)
  const [scanComplete, setScanComplete] = useState(false)
  const [isFinalizingConnection, setIsFinalizingConnection] = useState(false)
  const [requiresPassword, setRequiresPassword] = useState(false)
  const [twoFactorPassword, setTwoFactorPassword] = useState('')
  const [isRefreshingQr, setIsRefreshingQr] = useState(false)
  const refreshInFlight = useRef(false)

  const [sessionFiles, setSessionFiles] = useState<File[]>([])
  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneToken, setPhoneToken] = useState<string | null>(null)
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneRequiresPassword, setPhoneRequiresPassword] = useState(false)
  const [phonePassword, setPhonePassword] = useState('')
  const [phoneCodeSent, setPhoneCodeSent] = useState(false)
  const [isSendingPhoneCode, setIsSendingPhoneCode] = useState(false)


  const [pending2FAId, setPending2FAId] = useState<string | null>(null)
  const [is2FADialogOpen, setIs2FADialogOpen] = useState(false)
  const [twoFAPassword, setTwoFAPassword] = useState('')
  const [twoFAHint, setTwoFAHint] = useState('')
  const [is2FASaving, setIs2FASaving] = useState(false)
  const [twoFAError, setTwoFAError] = useState<string | null>(null)

  const accountCount = user?.connectedAccounts.length || 0
  const reconnectAccountId = useMemo(
    () => String(searchParams.get('reconnect') || '').trim(),
    [searchParams]
  )

  const qrExpireText = useMemo(() => {
    if (!qrExpiresAt) return ''
    return new Date(qrExpiresAt).toLocaleTimeString()
  }, [qrExpiresAt])

  const qrCountdownText = useMemo(() => {
    if (scanComplete || requiresPassword || isFinalizingConnection || !qrExpiresAt) return ''
    if (qrSecondsLeft <= 0) return 'Refreshing QR...'
    const minutes = Math.floor(qrSecondsLeft / 60)
    const seconds = qrSecondsLeft % 60
    return `Expires in ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }, [scanComplete, requiresPassword, isFinalizingConnection, qrExpiresAt, qrSecondsLeft])

  const refreshQrCode = useCallback(async () => {
    if (refreshInFlight.current) return
    refreshInFlight.current = true
    setIsRefreshingQr(true)
    setError(null)
    try {
      const qr = await startQrConnection()
      setQrUrl(qr.qrUrl)
      setQrToken(qr.qrToken)
      setQrExpiresAt(qr.expiresAt)
      setQrSecondsLeft(Math.max(0, Math.floor((new Date(qr.expiresAt).getTime() - Date.now()) / 1000)))
      setIsFinalizingConnection(false)
      setRequiresPassword(false)
      setTwoFactorPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate QR code')
    } finally {
      setIsRefreshingQr(false)
      refreshInFlight.current = false
    }
  }, [startQrConnection])

  useEffect(() => {
    refreshCurrentUser().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshSessionHealth = useCallback(async () => {
    setIsCheckingSessions(true)
    try {
      const items = await checkAccountSessions()
      const next: Record<string, { ok: boolean; needsReconnect: boolean; detail?: string | null; status?: 'good' | 'banned' | 'frozen' | 'disconnected' | 'error' | null; deviceCount?: number }> = {}
      for (const item of items) {
        next[item.accountId] = {
          ok: Boolean(item.ok),
          needsReconnect: Boolean(item.needsReconnect),
          detail: item.detail ?? null,
          status: item.status ?? null,
        }
      }
      setSessionHealthByAccountId(next)
      // The health check self-heals the stored 2FA flag; refresh so the lock icon reflects it.
      await refreshCurrentUser().catch(() => {})
    } catch {
      // keep silent; UI will just omit badges
    } finally {
      setIsCheckingSessions(false)
    }
  }, [checkAccountSessions, refreshCurrentUser])

  useEffect(() => {
    if (!isOpen || activeTab !== 'qr') return
    setScanComplete(false)
    setIsFinalizingConnection(false)
    setRequiresPassword(false)
    setTwoFactorPassword('')
    setIsSubmitting(true)
    refreshQrCode().finally(() => {
      setIsSubmitting(false)
    })
  }, [isOpen, activeTab, refreshQrCode])

  useEffect(() => {
    if (!qrExpiresAt || !isOpen || activeTab !== 'qr' || scanComplete || requiresPassword || isFinalizingConnection) {
      if (!qrExpiresAt) setQrSecondsLeft(0)
      return
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((new Date(qrExpiresAt).getTime() - Date.now()) / 1000))
      setQrSecondsLeft(remaining)
    }

    updateCountdown()
    const tick = setInterval(updateCountdown, 1000)
    return () => clearInterval(tick)
  }, [qrExpiresAt, isOpen, activeTab, scanComplete, requiresPassword, isFinalizingConnection])

  const lastPollErrorRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isOpen || activeTab !== 'qr' || !qrToken || scanComplete || requiresPassword || isFinalizingConnection) return
    lastPollErrorRef.current = null
    let pollStopped = false
    let isPolling = false

    const poll = async () => {
      if (pollStopped || isPolling) return
      isPolling = true
      try {
        const status = await completeQrConnection(qrToken)
        if (pollStopped) return
        if (status === 'connected') {
          closeModal()
          refreshCurrentUser().catch(() => {})
          return
        }
        if (status === 'password_required') {
          setRequiresPassword(true)
        }
        lastPollErrorRef.current = null
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to complete QR connection'
        if (message.toLowerCase().includes('expired')) {
          await refreshQrCode()
        } else if (message !== lastPollErrorRef.current) {
          lastPollErrorRef.current = message
          setError(message)
        }
      } finally {
        isPolling = false
      }
    }

    const intervalId = setInterval(poll, 2500)
    return () => {
      pollStopped = true
      clearInterval(intervalId)
    }
  }, [
    isOpen,
    activeTab,
    qrToken,
    scanComplete,
    requiresPassword,
    isFinalizingConnection,
    completeQrConnection,
    refreshCurrentUser,
    refreshQrCode,
  ])

  const resetModal = () => {
    setActiveTab('qr')
    setError(null)
    setIsSubmitting(false)
    setQrUrl(null)
    setQrToken(null)
    setQrExpiresAt(null)
    setQrSecondsLeft(0)
    setScanComplete(false)
    setIsFinalizingConnection(false)
    setRequiresPassword(false)
    setTwoFactorPassword('')
    setIsRefreshingQr(false)
    refreshInFlight.current = false
    setSessionFiles([])
    setPhoneNumber('')
    setPhoneToken(null)
    setPhoneCode('')
    setPhoneRequiresPassword(false)
    setPhonePassword('')
    setPhoneCodeSent(false)
    setIsSendingPhoneCode(false)
  }

  const openModal = () => {
    resetModal()
    setIsOpen(true)
  }

  const closeModal = () => {
    setIsOpen(false)
    resetModal()
  }

  const handleSessionConnect = async () => {
    if (!sessionFiles.length) {
      setError('Select at least one .session file')
      return
    }

    const invalid = sessionFiles.find((f) => !f.name.toLowerCase().endsWith('.session'))
    if (invalid) {
      setError(`Only .session files are allowed: ${invalid.name}`)
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await connectSessionFile(sessionFiles)
      await refreshCurrentUser().catch(() => {})
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect session')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSendPhoneCode = async () => {
    if (!phoneNumber.trim()) {
      setError('Enter a phone number')
      return
    }
    setError(null)
    setIsSendingPhoneCode(true)
    try {
      const result = await sendPhoneCode(phoneNumber.trim())
      setPhoneToken(result.phoneToken)
      setPhoneCodeSent(true)
      setPhoneRequiresPassword(false)
      setPhoneCode('')
      setPhonePassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setIsSendingPhoneCode(false)
    }
  }

  const handleVerifyPhoneCode = async () => {
    if (!phoneNumber.trim() || !phoneCode.trim() || !phoneToken) {
      setError('Enter the verification code')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      const status = await verifyPhoneCode(phoneNumber.trim(), phoneCode.trim(), phoneToken)
      if (status === 'password_required') {
        setPhoneRequiresPassword(true)
      } else {
        closeModal()
        refreshCurrentUser().catch(() => {})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitPhonePassword = async () => {
    if (!phoneNumber.trim() || !phonePassword.trim() || !phoneToken) {
      setError('Enter your Telegram 2FA password')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await submitPhonePassword(phoneNumber.trim(), phonePassword.trim(), phoneToken)
      closeModal()
      refreshCurrentUser().catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify 2FA password')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitTwoFactorPassword = async () => {
    if (!qrToken) {
      setError('QR session missing. Generate a new QR code.')
      return
    }
    if (!twoFactorPassword.trim()) {
      setError('Enter your Telegram 2FA password')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await submitQrPassword(qrToken, twoFactorPassword)
      closeModal()
      refreshCurrentUser().catch(() => {})
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to verify Telegram 2FA password'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const lastClickedIdxRef = useRef<number | null>(null)

  const clearAccountSelection = () => setSelectedAccountIds(new Set())

  const selectAllAccounts = () => {
    if (!user?.connectedAccounts) return
    setSelectedAccountIds(new Set(user.connectedAccounts.map(a => a.id)))
  }

  const handleBatchExclude = async (exclude: boolean) => {
    if (selectedAccountIds.size === 0) return
    setError(null)
    try {
      await batchToggleExcludeChats(Array.from(selectedAccountIds), exclude)
      setSelectedAccountIds(new Set())
      await refreshCurrentUser()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update accounts')
    }
  }

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const handleRemoveAccountConfirm = async () => {
    if (!pendingDeleteId) return
    setError(null)
    try {
      await removeConnectedAccount(pendingDeleteId)
      await refreshCurrentUser()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove account')
    } finally {
      setPendingDeleteId(null)
    }
  }

  const handleToggleExclude = async (accountId: string) => {
    setError(null)
    try {
      await toggleExcludeChats(accountId)
      await refreshCurrentUser()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account')
    }
  }

  const handleOpen2FA = (account: ConnectedAccount) => {
    setPending2FAId(account.id)
    setTwoFAPassword('')
    setTwoFAHint('')
    setTwoFAError(null)
    setIs2FADialogOpen(true)
  }

  const handleClose2FA = () => {
    setIs2FADialogOpen(false)
    setPending2FAId(null)
    setTwoFAPassword('')
    setTwoFAHint('')
    setTwoFAError(null)
    setIs2FASaving(false)
  }

  const handleSet2FA = async () => {
    if (!pending2FAId || !twoFAPassword.trim()) return
    setIs2FASaving(true)
    setTwoFAError(null)
    try {
      await setAccount2FA(pending2FAId, twoFAPassword.trim(), twoFAHint.trim() || undefined)
      await refreshCurrentUser()
      handleClose2FA()
    } catch (err) {
      setTwoFAError(err instanceof Error ? err.message : 'Failed to enable 2FA')
    } finally {
      setIs2FASaving(false)
    }
  }

  const handleRemove2FA = async () => {
    if (!pending2FAId || !twoFAPassword.trim()) return
    setIs2FASaving(true)
    setTwoFAError(null)
    try {
      await removeAccount2FA(pending2FAId, twoFAPassword.trim())
      await refreshCurrentUser()
      handleClose2FA()
    } catch (err) {
      setTwoFAError(err instanceof Error ? err.message : 'Failed to disable 2FA')
    } finally {
      setIs2FASaving(false)
    }
  }

  const handleOpenEdit = (account: ConnectedAccount) => {
    setEditingAccount(account)
    const first = account.displayName?.split(' ')[0] || ''
    const last = account.displayName?.split(' ').slice(1).join(' ') || ''
    setEditFirstName(first)
    setEditLastName(last)
    setEditUsername(account.username)
    setOriginalFirstName(first)
    setOriginalLastName(last)
    setOriginalUsername(account.username)
    setEditPhotoFile(null)
    setEditPhotoPreview(null)
    setEditError(null)
    setIsEditOpen(true)
  }

  const handleCloseEdit = () => {
    setIsEditOpen(false)
    setEditingAccount(null)
    setEditPhotoPreview(null)
    setEditPhotoFile(null)
  }

  const handleEditPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setEditPhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setEditPhotoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleSaveEdit = async () => {
    if (!editingAccount) return
    setIsEditSaving(true)
    setEditError(null)
    try {
      const changed: { firstName?: string; lastName?: string; username?: string } = {}
      if (editFirstName !== originalFirstName) changed.firstName = editFirstName || undefined
      if (editLastName !== originalLastName) changed.lastName = editLastName || undefined
      if (editUsername !== originalUsername) changed.username = editUsername || undefined
      if (Object.keys(changed).length > 0) {
        await updateAccountProfile(editingAccount.id, changed)
      }
      if (editPhotoFile) {
        await updateAccountPhoto(editingAccount.id, editPhotoFile)
      }
      await refreshCurrentUser()
      handleCloseEdit()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update account')
    } finally {
      setIsEditSaving(false)
    }
  }

  const onlineCount = user?.connectedAccounts.filter(a => a.status === 'online').length || 0
  const offlineCount = accountCount - onlineCount
  const twofaCount = user?.connectedAccounts.filter(a => a.twofaEnabled).length || 0
  const healthValues = Object.values(sessionHealthByAccountId)
  const goodSessions = healthValues.filter(h => h.status === 'good').length
  const frozenSessions = healthValues.filter(h => h.status === 'frozen').length
  const bannedSessions = healthValues.filter(h => h.status === 'banned').length
  const disconnectedSessions = healthValues.filter(h => h.status === 'disconnected').length
  const errorSessions = healthValues.filter(h => h.status === 'error').length
  const hasSessionHealth = healthValues.length > 0

  const renderSessionHealthBadge = (accountId: string) => {
    const h = sessionHealthByAccountId[accountId]
    if (!h) return null
    const s = h?.status
    if (s === 'banned') return <span title={h?.detail || ''} className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-red-500/15 text-red-300'><Circle className='w-1.5 h-1.5 sm:w-2 sm:h-2 fill-current' /> Banned</span>
    if (s === 'frozen') return <span title={h?.detail || ''} className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-amber-500/15 text-amber-200'><Circle className='w-1.5 h-1.5 sm:w-2 sm:h-2 fill-current' /> Frozen</span>
    if (s === 'disconnected') return <span title={h?.detail || ''} className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-slate-500/15 text-slate-300'><Circle className='w-1.5 h-1.5 sm:w-2 sm:h-2 fill-current' /> Disconnected</span>
    if (s === 'error') return <span title={h?.detail || ''} className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-red-500/15 text-red-300'><Circle className='w-1.5 h-1.5 sm:w-2 sm:h-2 fill-current' /> Error</span>
    if (s === 'good') return <span title={h?.detail || ''} className='inline-flex items-center gap-1 rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium bg-emerald-500/15 text-emerald-300'><Circle className='w-1.5 h-1.5 sm:w-2 sm:h-2 fill-current' /> Good</span>
    return <span title={h?.detail || ''} className={'inline-flex items-center gap-1 rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium ' + (h?.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200')}>{h?.ok ? 'Session OK' : 'Reconnect required'}</span>
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4 sm:space-y-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold mb-2">Accounts</h2>
          <p className="text-gray-400 text-sm sm:text-base max-w-3xl">
            Connect and manage your Telegram accounts. Each Telegram account runs on a dedicated
            route with separate session context.
          </p>
        </div>

            {error && !isOpen && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 sm:p-4 text-sm text-red-300">
            <p>{error}</p>
            {activeTab === 'session' && (
              <p className="mt-2 text-xs text-red-200/90">
                Use a logged-in `.session` SQLite file (same format as files under session uploads).
              </p>
            )}
            {activeTab === 'phone' && (
              <p className="mt-2 text-xs text-red-200/90">
                Make sure the phone number is in international format (e.g. +1234567890).
              </p>
            )}
          </div>
        )}

        {reconnectAccountId && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 sm:p-4 text-sm text-amber-100 space-y-2">
            <p className="font-medium">Reconnect requested for a disconnected account</p>
            <p className="text-xs sm:text-sm">
              Account ID: <span className="font-mono text-xs">{reconnectAccountId}</span>
            </p>
            <p className="text-amber-200/90 text-xs sm:text-sm">
              Use QR or `.session` to reconnect this Telegram account, then return to Campaigns.
            </p>
            <Button onClick={openModal} className="bg-amber-600 hover:bg-amber-700 text-sm">
              Reconnect Account
            </Button>
          </div>
        )}

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur">
          <div className="border-b border-slate-800 px-4 sm:px-6 py-4 sm:py-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                <Smartphone className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300" />
                Connected Telegram Accounts
              </h3>
              <p className="text-xs sm:text-sm text-gray-400 mt-1">
                Import `.session` files, use phone number, or scan QR to add accounts instantly.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-300">
                {accountCount} account{accountCount === 1 ? '' : 's'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={refreshSessionHealth}
                disabled={isCheckingSessions}
                className="border-slate-700 hover:bg-slate-800 text-xs sm:text-sm"
              >
                {isCheckingSessions ? 'Checking...' : 'Check sessions'}
              </Button>
              <Button size="sm" onClick={openModal} className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm">
                Connect More
              </Button>
            </div>
          </div>

           <div className="p-3 sm:p-4 md:p-6 space-y-3">
            {accountCount > 0 && selectedAccountIds.size === 0 ? (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-400 hover:text-slate-200 transition-colors">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => selectAllAccounts()}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                  />
                  Select All ({accountCount} accounts)
                </label>
              </div>
            ) : null}
            {selectedAccountIds.size > 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 sm:px-4 py-2.5 sm:py-3">
                <input
                  type="checkbox"
                  checked={selectedAccountIds.size === (user?.connectedAccounts?.length ?? 0)}
                  onChange={(e) => e.target.checked ? selectAllAccounts() : clearAccountSelection()}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 cursor-pointer accent-blue-600"
                />
                <span className="text-sm text-blue-200 font-medium">
                  {selectedAccountIds.size} selected
                </span>
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 hover:bg-slate-800 text-xs h-8"
                    onClick={() => handleBatchExclude(true)}
                  >
                    <MessageSquareOff className="mr-1.5 h-3 w-3" />
                    Exclude Selected
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-700 hover:bg-slate-800 text-xs h-8"
                    onClick={() => handleBatchExclude(false)}
                  >
                    Include Selected
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-400 hover:text-white text-xs h-8"
                    onClick={clearAccountSelection}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            ) : null}
            {accountCount === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 sm:px-6 py-8 sm:py-12 text-center">
                <p className="text-gray-400 mb-4 text-sm sm:text-base">No Telegram account connected yet.</p>
                <Button onClick={openModal} className="bg-blue-600 hover:bg-blue-700 text-sm">
                  Connect Your First Account
                </Button>
              </div>
            ) : (
              user?.connectedAccounts.map((account) => (
                <div
                  key={account.id}
                  onClick={(e) => {
                    const accounts = user?.connectedAccounts
                    if (!accounts) return
                    const idx = accounts.findIndex(a => a.id === account.id)
                    if (idx === -1) return
                    if (e.shiftKey && lastClickedIdxRef.current !== null) {
                      const [start, end] = lastClickedIdxRef.current < idx
                        ? [lastClickedIdxRef.current, idx]
                        : [idx, lastClickedIdxRef.current]
                      const rangeIds = accounts.slice(start, end + 1).map(a => a.id)
                      setSelectedAccountIds(prev => {
                        const next = new Set(prev)
                        for (const id of rangeIds) next.add(id)
                        return next
                      })
                    } else {
                      lastClickedIdxRef.current = idx
                      setSelectedAccountIds(prev => {
                        const next = new Set(prev)
                        if (next.has(account.id)) next.delete(account.id)
                        else next.add(account.id)
                        return next
                      })
                    }
                  }}
                  className={`rounded-xl border p-3 sm:p-4 md:p-5 transition-colors cursor-pointer ${
                    selectedAccountIds.has(account.id)
                      ? 'border-blue-500/50 bg-slate-900/90'
                      : 'border-slate-800 bg-slate-950/70'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.has(account.id)}
                          readOnly
                          className="pointer-events-none h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-600 accent-blue-600"
                        />
                        <Avatar className="h-10 w-10 sm:h-11 sm:w-11 rounded-full">
                        <AvatarImage src={getAccountPhotoUrl(account.id)} alt={account.username} className="object-cover" />
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-fuchsia-500 text-black font-semibold text-sm sm:text-base rounded-full">
                          {account.username.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                      <div className="space-y-1 sm:space-y-2 min-w-0">
                        <p className="font-semibold text-white text-sm sm:text-base truncate">
                          {account.displayName || account.username}
                        </p>
                        <div className="flex flex-wrap gap-2 sm:gap-3 text-xs sm:text-sm text-gray-400">
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="w-3 h-3 sm:w-4 sm:h-4" />@{account.username}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <PhoneCall className="w-3 h-3 sm:w-4 sm:h-4" />
                            {account.phone || `ID ${account.telegramId}`}
                          </span>

                        </div>
                        <div className="flex flex-wrap gap-1.5 sm:gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium ${
                              account.status === 'online'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-rose-500/15 text-rose-300'
                            }`}
                          >
                            <Circle className="w-1.5 h-1.5 sm:w-2 sm:h-2 fill-current" />
                            {account.status === 'online' ? 'Online' : 'Offline'}
                          </span>
                          {renderSessionHealthBadge(account.id)}
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium text-slate-300">
                            {account.source === 'session' ? 'Session File' : account.source === 'phone' ? 'Phone Number' : 'QR Connected'}
                          </span>
                          {account.excludeChats && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium text-amber-300">
                              Chats Excluded
                            </span>
                          )}
                          {account.twofaEnabled && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[10px] sm:text-xs font-medium text-emerald-300">
                              <Lock className="w-2.5 h-2.5" /> 2FA
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 sm:h-9 sm:w-9 ${
                          account.excludeChats
                            ? 'text-amber-400 hover:bg-amber-500/10 hover:text-amber-300'
                            : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'
                        }`}
                        onClick={(e) => { e.stopPropagation(); handleToggleExclude(account.id) }}
                      >
                        <MessageSquareOff className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 sm:h-9 sm:w-9 ${
                          account.twofaEnabled
                            ? 'text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300'
                            : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'
                        }`}
                        onClick={(e) => { e.stopPropagation(); handleOpen2FA(account) }}
                      >
                        {account.twofaEnabled ? (
                          <Lock className="h-3 w-3 sm:h-4 sm:w-4" />
                        ) : (
                          <LockKeyholeOpen className="h-3 w-3 sm:h-4 sm:w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-slate-500 hover:bg-slate-700/50 hover:text-slate-300 h-8 w-8 sm:h-9 sm:w-9"
                        onClick={(e) => { e.stopPropagation(); handleOpenEdit(account) }}
                      >
                        <Pencil className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-400 hover:bg-red-500/10 hover:text-red-300 h-8 w-8 sm:h-9 sm:w-9"
                        onClick={(e) => { e.stopPropagation(); setPendingDeleteId(account.id) }}
                      >
                        <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
            <ConfirmDialog
              open={pendingDeleteId !== null}
              onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
              title="Delete Account"
              description="Delete this account permanently? This cannot be undone."
              confirmLabel="Delete Account"
              onConfirm={handleRemoveAccountConfirm}
            />

            <Dialog open={is2FADialogOpen} onOpenChange={(open) => { if (!open) handleClose2FA() }}>
              <DialogContent className="max-w-md border-slate-700 bg-slate-900 text-white mx-4 sm:mx-auto">
                <DialogHeader>
                  <DialogTitle>
                    {user?.connectedAccounts.find((a) => a.id === pending2FAId)?.twofaEnabled
                      ? 'Disable 2FA'
                      : 'Enable 2FA'}
                  </DialogTitle>
                  <DialogDescription className="text-slate-400 text-sm">
                    {user?.connectedAccounts.find((a) => a.id === pending2FAId)?.twofaEnabled
                      ? 'Enter your current 2FA password to disable it on this Telegram account.'
                      : 'Set a cloud password (2FA) on this Telegram account to protect it.'}
                  </DialogDescription>
                </DialogHeader>

                {twoFAError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {twoFAError}
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="2fa-password" className="text-sm text-slate-300">
                      {user?.connectedAccounts.find((a) => a.id === pending2FAId)?.twofaEnabled
                        ? 'Current 2FA Password'
                        : 'New 2FA Password'}
                    </Label>
                    <Input
                      id="2fa-password"
                      type="password"
                      value={twoFAPassword}
                      onChange={(e) => setTwoFAPassword(e.target.value)}
                      className="border-slate-700 bg-slate-800 text-white text-sm h-9"
                      placeholder={
                        user?.connectedAccounts.find((a) => a.id === pending2FAId)?.twofaEnabled
                          ? 'Enter current password'
                          : 'Enter a strong password'
                      }
                    />
                  </div>

                  {!user?.connectedAccounts.find((a) => a.id === pending2FAId)?.twofaEnabled && (
                    <div className="space-y-2">
                      <Label htmlFor="2fa-hint" className="text-sm text-slate-300">
                        Hint (optional)
                      </Label>
                      <Input
                        id="2fa-hint"
                        value={twoFAHint}
                        onChange={(e) => setTwoFAHint(e.target.value)}
                        className="border-slate-700 bg-slate-800 text-white text-sm h-9"
                        placeholder="e.g. My account password"
                      />
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-slate-600 hover:bg-slate-800 text-xs sm:text-sm"
                    onClick={handleClose2FA}
                    disabled={is2FASaving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className={
                      user?.connectedAccounts.find((a) => a.id === pending2FAId)?.twofaEnabled
                        ? 'bg-red-600 hover:bg-red-700 text-xs sm:text-sm'
                        : 'bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm'
                    }
                    onClick={
                      user?.connectedAccounts.find((a) => a.id === pending2FAId)?.twofaEnabled
                        ? handleRemove2FA
                        : handleSet2FA
                    }
                    disabled={is2FASaving || !twoFAPassword.trim()}
                  >
                    {is2FASaving ? (
                      <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Processing...</>
                    ) : user?.connectedAccounts.find((a) => a.id === pending2FAId)?.twofaEnabled ? (
                      'Disable 2FA'
                    ) : (
                      'Enable 2FA'
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="border-t border-slate-800 px-6 py-4 flex flex-wrap items-center gap-4 text-sm text-slate-400">
            <ShieldCheck className="w-4 h-4 text-blue-300" />
            <span>
              Session data is stored securely and linked to this workspace user only.
            </span>
            <CircleHelp className="w-4 h-4 text-slate-500" />
          </div>
        </section>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <UserRound className="w-4 h-4" />
                Account Summary
              </h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Total accounts</span>
                  <span className="text-white font-medium">{accountCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Online</span>
                  <span className="text-emerald-400 font-medium">{onlineCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Offline</span>
                  <span className="text-rose-400 font-medium">{offlineCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">2FA enabled</span>
                  <span className="text-emerald-400 font-medium">{twofaCount}</span>
                </div>
              </div>
            </div>

            {hasSessionHealth && (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-5">
                <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Session Health
                </h3>
                <div className="space-y-2.5 text-sm">
                  {goodSessions > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Good</span>
                      <span className="text-emerald-400 font-medium">{goodSessions}</span>
                    </div>
                  )}
                  {frozenSessions > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Frozen</span>
                      <span className="text-amber-400 font-medium">{frozenSessions}</span>
                    </div>
                  )}
                  {bannedSessions > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Banned</span>
                      <span className="text-red-400 font-medium">{bannedSessions}</span>
                    </div>
                  )}
                  {disconnectedSessions > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Disconnected</span>
                      <span className="text-slate-400 font-medium">{disconnectedSessions}</span>
                    </div>
                  )}
                  {errorSessions > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Errors</span>
                      <span className="text-red-400 font-medium">{errorSessions}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : closeModal())}>
        <DialogContent className="max-w-xl border-slate-700 bg-slate-900 text-white mx-4 sm:mx-auto">
          <DialogHeader>
            <DialogTitle>Connect Telegram</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Choose how you want to authorize this Telegram account.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 sm:p-4 text-sm text-red-300 mb-4">
              <p>{error}</p>
              {activeTab === 'session' && (
                <p className="mt-2 text-xs text-red-200/90">
                  Use a logged-in `.session` SQLite file (same format as files under session uploads).
                </p>
              )}
              {activeTab === 'phone' && (
                <p className="mt-2 text-xs text-red-200/90">
                  Make sure the phone number is in international format (e.g. +1234567890).
                </p>
              )}
            </div>
          )}

          <div className="flex justify-center -mx-6 px-6 pb-4">
            <div className="bg-slate-800/40 rounded-lg p-1 inline-flex gap-1">
              <button
                onClick={() => setActiveTab('qr')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'qr'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <QrCode className="w-4 h-4" /> QR Code
              </button>
              <button
                onClick={() => setActiveTab('phone')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'phone'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Phone className="w-4 h-4" /> Phone
              </button>
              <button
                onClick={() => setActiveTab('session')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'session'
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Upload className="w-4 h-4" /> Session
              </button>
            </div>
          </div>

          <div className="pt-4">
            {activeTab === 'qr' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 sm:p-4">
                  <p className="font-semibold text-sm sm:text-base">Scan QR Code with Telegram</p>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    Open Telegram on your phone and go to Settings → Devices → Link Desktop Device.
                  </p>
                </div>

                {qrUrl ? (
                  <div className="rounded-xl border border-slate-700 bg-white p-4 flex justify-center">
                    <img src={qrUrl} alt="Telegram QR" className="h-48 w-48 sm:h-72 sm:w-72" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6 sm:p-10 text-center">
                    <p className="text-slate-400 text-sm">Generating QR code...</p>
                  </div>
                )}

                <div className="text-center text-xs sm:text-sm text-slate-400">
                  {isFinalizingConnection
                    ? 'Scan detected. Syncing account...'
                    : scanComplete
                    ? 'Scan complete, account connected.'
                    : requiresPassword
                    ? 'Telegram requires your 2FA password to finish login.'
                    : 'Waiting for scan from Telegram...'}
                  {qrCountdownText ? ` ${qrCountdownText}.` : ''}
                  {isRefreshingQr ? ' Generating a fresh QR code.' : ''}
                </div>

                {requiresPassword && (
                  <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/40 p-3 sm:p-4">
                    <p className="font-semibold text-sm sm:text-base">Telegram Two-Step Verification</p>
                    <p className="text-xs sm:text-sm text-slate-400">
                      Enter the Telegram cloud password for this account.
                    </p>
                    <input
                      type="password"
                      value={twoFactorPassword}
                      onChange={(event) => setTwoFactorPassword(event.target.value)}
                      placeholder="Telegram 2FA password"
                      className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 h-9 sm:h-10"
                    />
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700 h-9 sm:h-10 text-sm"
                      onClick={handleSubmitTwoFactorPassword}
                      disabled={isSubmitting || !twoFactorPassword.trim()}
                    >
                      {isSubmitting ? 'Verifying...' : 'Submit Password'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'phone' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 sm:p-4">
                  <p className="font-semibold text-sm sm:text-base">Log in with Phone Number</p>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    Enter your phone number in international format (e.g. +1234567890). You will receive a verification code in Telegram.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm text-slate-300">Phone Number</label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+1234567890"
                    className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 h-9 sm:h-10"
                  />
                </div>

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 h-9 sm:h-10 text-sm"
                  onClick={handleSendPhoneCode}
                  disabled={isSendingPhoneCode || !phoneNumber.trim()}
                >
                  {isSendingPhoneCode ? 'Sending Code...' : 'Send Code'}
                </Button>

                {phoneCodeSent && !phoneRequiresPassword && (
                  <>
                    <div className="border-t border-slate-700 pt-4 space-y-4">
                      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 sm:p-4">
                        <p className="font-semibold text-sm sm:text-base">Enter Verification Code</p>
                        <p className="text-xs sm:text-sm text-slate-400 mt-1">
                          A verification code has been sent to your Telegram app. Enter it below.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-slate-300">Verification Code</label>
                        <input
                          type="text"
                          value={phoneCode}
                          onChange={(e) => setPhoneCode(e.target.value)}
                          placeholder="12345"
                          className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 h-9 sm:h-10"
                        />
                      </div>

                      <Button
                        className="w-full bg-blue-600 hover:bg-blue-700 h-9 sm:h-10 text-sm"
                        onClick={handleVerifyPhoneCode}
                        disabled={isSubmitting || !phoneCode.trim()}
                      >
                        {isSubmitting ? 'Verifying...' : 'Verify Code'}
                      </Button>
                    </div>
                  </>
                )}

                {phoneCodeSent && phoneRequiresPassword && (
                  <>
                    <div className="border-t border-slate-700 pt-4 space-y-4">
                      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 sm:p-4">
                        <p className="font-semibold text-sm sm:text-base">Telegram Two-Step Verification</p>
                        <p className="text-xs sm:text-sm text-slate-400 mt-1">
                          This account has 2FA enabled. Enter your Telegram cloud password.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm text-slate-300">2FA Password</label>
                        <input
                          type="password"
                          value={phonePassword}
                          onChange={(e) => setPhonePassword(e.target.value)}
                          placeholder="Telegram 2FA password"
                          className="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 h-9 sm:h-10"
                        />
                      </div>

                      <Button
                        className="w-full bg-blue-600 hover:bg-blue-700 h-9 sm:h-10 text-sm"
                        onClick={handleSubmitPhonePassword}
                        disabled={isSubmitting || !phonePassword.trim()}
                      >
                        {isSubmitting ? 'Verifying...' : 'Submit Password'}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'session' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 sm:p-4">
                  <p className="font-semibold text-sm sm:text-base">Upload Telegram Session Files</p>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    Select one or more `.session` files to import. Max size per file: 10MB.
                  </p>
                </div>

                <label className="block rounded-xl border-dashed border-slate-600 bg-slate-800/20 p-6 sm:p-8 text-center cursor-pointer hover:bg-slate-800/40 transition">
                  <input
                    type="file"
                    accept=".session"
                    multiple
                    className="hidden"
                    onChange={(event) => setSessionFiles(Array.from(event.target.files || []))}
                  />
                  <Upload className="mx-auto mb-2 h-5 w-5 sm:h-6 sm:w-6 text-slate-400" />
                  <p className="text-xs sm:text-sm text-slate-400">
                    {sessionFiles.length > 0
                      ? `${sessionFiles.length} file(s) selected`
                      : 'Click to upload .session files'}
                  </p>
                </label>

                {sessionFiles.length > 0 && (
                  <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 sm:p-4">
                    <p className="text-xs sm:text-sm text-slate-300 font-medium mb-2">Selected files:</p>
                    <ul className="space-y-1">
                      {sessionFiles.map((f, i) => (
                        <li key={i} className="text-xs text-slate-400 truncate">{f.name}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 h-9 sm:h-10 text-sm"
                  onClick={handleSessionConnect}
                  disabled={isSubmitting || !sessionFiles.length}
                >
                  {isSubmitting ? 'Connecting...' : `Connect Session File${sessionFiles.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={(open) => { if (!open) handleCloseEdit() }}>
        <DialogContent className="max-w-lg border-slate-700 bg-slate-900 text-white mx-4 sm:mx-auto">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription className="text-slate-400 text-sm">
              Update your Telegram profile name, username, or photo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {editError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                {editError}
              </div>
            )}

            <div className="flex flex-col items-center gap-3">
              <label className="relative cursor-pointer group">
                <Avatar className="h-20 w-20 rounded-full ring-2 ring-slate-600">
                  <AvatarImage
                    src={editPhotoPreview || (editingAccount ? getAccountPhotoUrl(editingAccount.id) : '')}
                    alt="Profile"
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-fuchsia-500 text-black font-bold text-xl rounded-full">
                    {(editFirstName || editingAccount?.username || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="w-6 h-6 text-white" />
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleEditPhotoChange}
                />
              </label>
              <p className="text-xs text-slate-400">Click photo to change</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-first-name" className="text-sm text-slate-300">First Name</Label>
                <Input
                  id="edit-first-name"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white text-sm h-9"
                  placeholder="First name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-last-name" className="text-sm text-slate-300">Last Name</Label>
                <Input
                  id="edit-last-name"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white text-sm h-9"
                  placeholder="Last name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-username" className="text-sm text-slate-300">Username</Label>
                <Input
                  id="edit-username"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="border-slate-700 bg-slate-800 text-white text-sm h-9"
                  placeholder="Username"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="border-slate-600 hover:bg-slate-800 text-xs sm:text-sm"
                onClick={handleCloseEdit}
                disabled={isEditSaving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm"
                onClick={handleSaveEdit}
                disabled={isEditSaving}
              >
                {isEditSaving ? (
                  <><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Saving...</>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
