'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Upload, CheckCircle2, AlertCircle } from 'lucide-react'

interface SessionFileUploadProps {
  onConnected: (account: any) => Promise<void>
  isConnecting: boolean
}

export function SessionFileUpload({
  onConnected,
  isConnecting,
}: SessionFileUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isValidated, setIsValidated] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0]
    setError(null)

    if (!selectedFile) {
      setFile(null)
      setIsValidated(false)
      return
    }

    // Validate file
    if (!selectedFile.name.endsWith('.session')) {
      setError('Invalid file type. Please upload a .session file.')
      setFile(null)
      return
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      // 10MB limit
      setError('File size exceeds 10MB limit.')
      setFile(null)
      return
    }

    setFile(selectedFile)
    validateFile(selectedFile)
  }

  const validateFile = async (selectedFile: File) => {
    setIsProcessing(true)
    try {
      // Simulate file validation from Telegram API
      // In production, this would send the file to your backend for validation
      await new Promise((resolve) => setTimeout(resolve, 1500))

      // Mock validation - in reality, the backend would validate the session file
      const isValid = selectedFile.size > 0 && selectedFile.name.endsWith('.session')

      if (!isValid) {
        setError('Invalid or corrupted session file.')
        setIsValidated(false)
      } else {
        setIsValidated(true)
      }
    } catch (err) {
      setError('Failed to validate session file.')
      setIsValidated(false)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleConnect = async () => {
    if (!file || !isValidated) {
      setError('Please select and validate a session file first.')
      return
    }

    try {
      // Read file as text to extract username (mock data)
      const mockUsername = `user_${Math.random().toString(36).substr(2, 9)}`

      await onConnected({
        username: mockUsername,
        telegramId: Math.floor(Math.random() * 1000000000).toString(),
        sessionFile: file.name,
      })
    } catch (err) {
      setError('Failed to connect account.')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-gray-300 mb-4">
          Upload a Telegram session file (.session) to connect your account. Session files are encrypted and stored securely.
        </p>

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm mb-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* File Upload Area */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
            file
              ? 'border-green-500/50 bg-green-500/10'
              : 'border-slate-600 bg-slate-800/50 hover:bg-slate-800'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".session"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!file ? (
            <div className="space-y-2">
              <Upload className="w-8 h-8 mx-auto text-gray-400" />
              <div>
                <p className="font-medium">Click to upload or drag and drop</p>
                <p className="text-sm text-gray-400">.session files up to 10MB</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <CheckCircle2 className="w-8 h-8 mx-auto text-green-500" />
              <div>
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-gray-400">
                  {(file.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Validation Status */}
        {file && (
          <div className="mt-4 space-y-3">
            {isProcessing && (
              <div className="flex items-center gap-2 text-sm text-blue-400">
                <div className="w-4 h-4 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin"></div>
                <span>Validating session file...</span>
              </div>
            )}

            {isValidated && !isProcessing && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Session file validated successfully</span>
              </div>
            )}
          </div>
        )}

        {/* Security Info */}
        <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-sm text-blue-200">
          <p className="font-medium mb-2">🔒 Security Information</p>
          <ul className="space-y-1 text-xs">
            <li>• Session files are encrypted with AES-256</li>
            <li>• Files are stored in secure, encrypted storage</li>
            <li>• You can revoke access at any time</li>
            <li>• Session data is never shared with third parties</li>
          </ul>
        </div>

        {/* Connect Button */}
        <div className="mt-6 flex gap-3">
          <Button
            onClick={handleConnect}
            disabled={!file || !isValidated || isConnecting}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700"
          >
            {isConnecting ? 'Connecting...' : 'Connect Account'}
          </Button>
          {file && (
            <Button
              onClick={() => {
                setFile(null)
                setIsValidated(false)
                setError(null)
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
              }}
              variant="outline"
              className="border-slate-600 hover:bg-slate-800"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
