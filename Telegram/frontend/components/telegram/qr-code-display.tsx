'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface QRCodeDisplayProps {
  onConnected: (account: any) => Promise<void>
  isConnecting: boolean
}

export function QRCodeDisplay({ onConnected, isConnecting }: QRCodeDisplayProps) {
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waitingForScan, setWaitingForScan] = useState(false)
  const [username, setUsername] = useState('')
  const [showManualEntry, setShowManualEntry] = useState(false)

  const generateQRCode = async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Simulate generating QR code from Telegram Bot API
      // In production, this would call your backend to generate a real QR code
      const mockQRData = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=tg://login?token=${Date.now()}`
      setQrCode(mockQRData)
      setWaitingForScan(true)

      // Simulate waiting for user to scan (in production, this would poll the Telegram API)
      setTimeout(() => {
        setWaitingForScan(false)
        setUsername(`user_${Math.random().toString(36).substr(2, 9)}`)
        // Automatically connect after simulating scan
        handleAutoConnect()
      }, 3000)
    } catch (err) {
      setError('Failed to generate QR code. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAutoConnect = async () => {
    const mockUsername = `user_${Math.random().toString(36).substr(2, 9)}`
    await onConnected({
      username: mockUsername,
      telegramId: Math.floor(Math.random() * 1000000000).toString(),
    })
  }

  const handleManualConnect = async () => {
    if (!username.trim()) {
      setError('Please enter a username')
      return
    }

    await onConnected({
      username: username,
      telegramId: Math.floor(Math.random() * 1000000000).toString(),
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-300 mb-4">
          Scan this QR code with Telegram on your mobile device to authorize the connection.
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {!qrCode ? (
          <Button
            onClick={generateQRCode}
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? 'Generating QR Code...' : 'Generate QR Code'}
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center p-6 bg-slate-800 rounded-lg">
              <img
                src={qrCode}
                alt="Telegram QR Code"
                className="w-64 h-64"
              />
            </div>

            {waitingForScan && (
              <div className="text-center">
                <div className="inline-block">
                  <div className="w-8 h-8 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
                </div>
                <p className="text-sm text-gray-400 mt-2">Waiting for scan...</p>
              </div>
            )}

            {username && !waitingForScan && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
                <p className="text-green-400 font-medium">Successfully authenticated!</p>
                <p className="text-sm text-gray-400 mt-1">Username: {username}</p>
              </div>
            )}

            <Button
              onClick={() => {
                setQrCode(null)
                setWaitingForScan(false)
                setUsername('')
                setShowManualEntry(false)
              }}
              variant="outline"
              className="w-full border-slate-600 hover:bg-slate-800"
            >
              Generate New QR Code
            </Button>
          </div>
        )}

        <div className="mt-6 border-t border-slate-700 pt-6">
          <button
            onClick={() => setShowManualEntry(!showManualEntry)}
            className="text-sm text-blue-400 hover:text-blue-300 transition"
          >
            {showManualEntry ? 'Use QR Code Instead' : 'Can\'t scan? Enter details manually'}
          </button>

          {showManualEntry && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Telegram Username</label>
                <Input
                  type="text"
                  placeholder="@username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white placeholder-gray-500"
                />
              </div>
              <Button
                onClick={handleManualConnect}
                disabled={isConnecting}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {isConnecting ? 'Connecting...' : 'Connect Account'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
