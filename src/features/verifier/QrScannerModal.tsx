import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { AnyStudentCredential } from '../../types'
import {
  decodeCredentialFromQr,
  decodeQrFromImageData,
  type QrDecodeError,
} from '../../lib/qr/qrUtils'

export interface QrScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onScanSuccess: (credential: AnyStudentCredential, rawJson: string) => void
}

type ScannerTab = 'camera' | 'upload' | 'paste'

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<ScannerTab>('camera')
  const [cameraState, setCameraState] = useState<
    'idle' | 'starting' | 'active' | 'denied' | 'unavailable' | 'error' | 'timeout'
  >('idle')
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string>('')
  const [decodeError, setDecodeError] = useState<QrDecodeError | null>(null)
  const [pasteInput, setPasteInput] = useState<string>('')
  const [isProcessingImage, setIsProcessingImage] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Explicit, safe camera stream shutdown
  const stopCamera = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current)
      timeoutTimerRef.current = null
    }

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop()
        } catch {
          // Ignore track stop errors
        }
      })
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  // Process any decoded raw string (from Camera, Upload, or Paste)
  const handleProcessRawPayload = useCallback(
    (rawString: string) => {
      setDecodeError(null)
      const result = decodeCredentialFromQr(rawString)

      if (!result.success) {
        setDecodeError(result.error)
        return
      }

      // Success: shut down camera stream immediately and notify caller
      stopCamera()
      onScanSuccess(result.credential, result.rawJson)
      onClose()
    },
    [stopCamera, onScanSuccess, onClose]
  )

  // Camera Frame Scanning Loop
  const startScanningLoop = useCallback(() => {
    const scanFrame = () => {
      const video = videoRef.current
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animFrameRef.current = requestAnimationFrame(scanFrame)
        return
      }

      const width = video.videoWidth
      const height = video.videoHeight

      if (width > 0 && height > 0) {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d', { willReadFrequently: true })

          if (ctx) {
            ctx.drawImage(video, 0, 0, width, height)
            const imageData = ctx.getImageData(0, 0, width, height)
            const decodedText = decodeQrFromImageData(imageData.data, width, height)

            if (decodedText) {
              handleProcessRawPayload(decodedText)
              return // Stop scanning loop on detection
            }
          }
        } catch {
          // Frame read skipped
        }
      }

      animFrameRef.current = requestAnimationFrame(scanFrame)
    }

    animFrameRef.current = requestAnimationFrame(scanFrame)
  }, [handleProcessRawPayload])

  // Explicit start camera trigger
  const startCamera = useCallback(async () => {
    stopCamera()
    setCameraState('starting')
    setCameraErrorMessage('')
    setDecodeError(null)

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable')
      setCameraErrorMessage(
        'MediaDevices camera API is not supported in this browser environment. Please use image upload or paste.'
      )
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      setCameraState('active')
      startScanningLoop()

      // 30s scan timeout for guidance
      timeoutTimerRef.current = setTimeout(() => {
        setCameraState('timeout')
      }, 30000)
    } catch (err: unknown) {
      stopCamera()
      const errorName = err instanceof Error ? err.name : 'UnknownError'
      const errorMessage = err instanceof Error ? err.message : String(err)

      if (
        errorName === 'NotAllowedError' ||
        errorName === 'PermissionDeniedError' ||
        errorMessage.includes('Permission denied')
      ) {
        setCameraState('denied')
        setCameraErrorMessage(
          'Camera access was denied by the user or system permissions. Grant camera permission or use the Upload/Paste tabs.'
        )
      } else if (
        errorName === 'NotFoundError' ||
        errorName === 'DevicesNotFoundError' ||
        errorName === 'OverconstrainedError'
      ) {
        setCameraState('unavailable')
        setCameraErrorMessage(
          'No compatible optical video camera was detected on this device. Use QR Image Upload or Paste instead.'
        )
      } else {
        setCameraState('error')
        setCameraErrorMessage(`Unable to initialize camera video stream: ${errorMessage}`)
      }
    }
  }, [stopCamera, startScanningLoop])

  // Stop camera stream when modal is closed or unmounts
  useEffect(() => {
    if (!isOpen) {
      stopCamera()
    }
    return () => {
      stopCamera()
    }
  }, [isOpen, stopCamera])

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCamera()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, stopCamera])

  if (!isOpen) return null

  // Handle Image Upload Scan
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setDecodeError(null)
    setIsProcessingImage(true)

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || img.width
          canvas.height = img.naturalHeight || img.height
          const ctx = canvas.getContext('2d', { willReadFrequently: true })

          if (!ctx) {
            setDecodeError({
              code: 'MALFORMED_FORMAT',
              message: 'Failed to initialize 2D canvas context for uploaded image.',
            })
            setIsProcessingImage(false)
            return
          }

          ctx.drawImage(img, 0, 0)
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const qrText = decodeQrFromImageData(
            imageData.data,
            canvas.width,
            canvas.height
          )

          setIsProcessingImage(false)

          if (!qrText) {
            setDecodeError({
              code: 'MALFORMED_FORMAT',
              message:
                'No readable QR code found in this image. Ensure the barcode is clear, adequately lit, and uncropped.',
            })
            return
          }

          handleProcessRawPayload(qrText)
        } catch (err) {
          setIsProcessingImage(false)
          setDecodeError({
            code: 'MALFORMED_FORMAT',
            message: `Failed to process image: ${err instanceof Error ? err.message : 'Unknown image error'}.`,
          })
        }
      }

      img.onerror = () => {
        setIsProcessingImage(false)
        setDecodeError({
          code: 'MALFORMED_FORMAT',
          message: 'The selected file could not be parsed as a valid image format.',
        })
      }

      img.src = event.target?.result as string
    }

    reader.readAsDataURL(file)
  }

  // Handle Paste Submit
  const handlePasteSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!pasteInput.trim()) {
      setDecodeError({
        code: 'EMPTY_PAYLOAD',
        message: 'Please paste a QR payload string or raw JSON credential.',
      })
      return
    }
    handleProcessRawPayload(pasteInput)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#1C201D]/70 backdrop-blur-xs overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopCamera()
          onClose()
        }
      }}
    >
      <div className="relative w-full max-w-xl my-auto bg-[#FFFFFF] border border-[#D4CEBF] rounded-xs shadow-2xl overflow-hidden focus:outline-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E7E3DA] bg-[#FAF8F5] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#264D3B]" aria-hidden="true" />
            <h2
              id="qr-scanner-title"
              className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]"
            >
              Verification Desk • Optical QR Scanner
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera()
              onClose()
            }}
            aria-label="Close QR scanner"
            className="flex h-7 w-7 items-center justify-center rounded-xs border border-[#D4CEBF] bg-[#FFFFFF] text-[#525753] hover:text-[#1C201D] hover:bg-[#FAF8F5] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#E7E3DA] bg-[#FAF8F5]/60 px-5 pt-2 gap-2 text-xs font-mono uppercase tracking-wider">
          <button
            type="button"
            onClick={() => {
              setActiveTab('camera')
              setDecodeError(null)
            }}
            className={`px-3 py-2 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeTab === 'camera'
                ? 'border-[#264D3B] text-[#264D3B]'
                : 'border-transparent text-[#787E78] hover:text-[#1C201D]'
            }`}
          >
            Optical Camera
          </button>
          <button
            type="button"
            onClick={() => {
              stopCamera()
              setActiveTab('upload')
              setDecodeError(null)
            }}
            className={`px-3 py-2 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeTab === 'upload'
                ? 'border-[#264D3B] text-[#264D3B]'
                : 'border-transparent text-[#787E78] hover:text-[#1C201D]'
            }`}
          >
            Upload QR Image
          </button>
          <button
            type="button"
            onClick={() => {
              stopCamera()
              setActiveTab('paste')
              setDecodeError(null)
            }}
            className={`px-3 py-2 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeTab === 'paste'
                ? 'border-[#264D3B] text-[#264D3B]'
                : 'border-transparent text-[#787E78] hover:text-[#1C201D]'
            }`}
          >
            Paste JSON / URI
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* TAB 1: Live Optical Camera */}
          {activeTab === 'camera' && (
            <div className="space-y-4">
              <div className="relative w-full aspect-4/3 max-h-72 bg-[#1C201D] border border-[#D4CEBF] rounded-xs overflow-hidden flex items-center justify-center">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${
                    cameraState === 'active' || cameraState === 'timeout' ? 'block' : 'hidden'
                  }`}
                />

                {/* Reticle targeting viewfinder overlay when active */}
                {(cameraState === 'active' || cameraState === 'timeout') && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                    <div className="w-48 h-48 sm:w-56 sm:h-56 border-2 border-dashed border-[#FFFFFF]/80 rounded-xs relative">
                      {/* Viewfinder corners */}
                      <span className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-[#FFFFFF]" />
                      <span className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-[#FFFFFF]" />
                      <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-[#FFFFFF]" />
                      <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-[#FFFFFF]" />
                    </div>
                  </div>
                )}

                {/* State: Starting / Requesting permission */}
                {cameraState === 'starting' && (
                  <div className="flex flex-col items-center justify-center space-y-2 text-[#FAF8F5] p-4 text-center">
                    <svg className="animate-spin h-6 w-6 text-[#CADACF]" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="font-mono text-xs uppercase tracking-wider">
                      Requesting Camera Authorization...
                    </span>
                    <p className="text-[11px] text-[#A8B0A9] max-w-xs">
                      Please allow browser webcam permissions when prompted.
                    </p>
                  </div>
                )}

                {/* State: Permission Denied */}
                {cameraState === 'denied' && (
                  <div className="p-6 text-center space-y-2 text-[#FAF8F5]">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#A84835]/30 text-[#E8C8C0] border border-[#E8C8C0]">
                      ✕
                    </div>
                    <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#FFFFFF]">
                      Camera Permission Denied
                    </h3>
                    <p className="text-[11px] text-[#A8B0A9] max-w-sm leading-relaxed">
                      {cameraErrorMessage}
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={startCamera}
                        className="px-3 py-1.5 bg-[#FFFFFF] text-[#1C201D] text-xs font-mono uppercase tracking-wider rounded-xs cursor-pointer hover:bg-[#FAF8F5]"
                      >
                        Try Again
                      </button>
                    </div>
                  </div>
                )}

                {/* State: Camera Unavailable / Error */}
                {(cameraState === 'unavailable' || cameraState === 'error') && (
                  <div className="p-6 text-center space-y-2 text-[#FAF8F5]">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#C4A44D]/30 text-[#F0E6D2] border border-[#C4A44D]">
                      !
                    </div>
                    <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-[#FFFFFF]">
                      Camera Video Input Unavailable
                    </h3>
                    <p className="text-[11px] text-[#A8B0A9] max-w-sm leading-relaxed">
                      {cameraErrorMessage}
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={() => setActiveTab('upload')}
                        className="px-3 py-1.5 bg-[#FFFFFF] text-[#1C201D] text-xs font-mono uppercase tracking-wider rounded-xs cursor-pointer hover:bg-[#FAF8F5]"
                      >
                        Switch to Upload QR Image →
                      </button>
                    </div>
                  </div>
                )}

                {/* State: Idle / Stopped */}
                {cameraState === 'idle' && (
                  <div className="p-8 text-center space-y-3 text-[#FAF8F5]">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center border border-[#383F39] bg-[#2A302B] rounded-xs text-[#CADACF]">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </div>
                    <div className="space-y-1 max-w-xs mx-auto">
                      <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-[#FFFFFF]">
                        Camera Optical Viewfinder
                      </h4>
                      <p className="text-[11px] text-[#A8B0A9] leading-relaxed">
                        Click below to grant camera access and scan a student credential QR code in real-time.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={startCamera}
                      className="px-4 py-2 bg-[#264D3B] text-[#FFFFFF] text-xs font-mono uppercase tracking-wider font-semibold border border-[#1B382B] rounded-xs cursor-pointer hover:bg-[#1B382B] transition-colors shadow-xs focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
                    >
                      Activate Camera Scanner →
                    </button>
                  </div>
                )}
              </div>

              {cameraState === 'active' && (
                <div className="flex items-center justify-between text-[11px] font-mono text-[#525753] px-1">
                  <span className="flex items-center gap-1.5 text-[#264D3B]">
                    <span className="h-2 w-2 rounded-full bg-[#264D3B] animate-pulse" />
                    Optical viewfinder active • Centering QR code...
                  </span>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="text-[#A84835] hover:underline font-semibold cursor-pointer"
                  >
                    Pause Camera
                  </button>
                </div>
              )}

              {/* Timeout Warning & Instructions */}
              {cameraState === 'timeout' && (
                <div className="p-3 bg-[#FAF8F5] border border-[#D4CEBF] rounded-xs text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-[#C4A44D] font-mono text-[11px] uppercase font-semibold">
                    <span>Scan Window Elapsed</span>
                  </div>
                  <p className="text-[#525753] leading-relaxed text-[11px]">
                    No credential QR code was detected within 30 seconds. Ensure the barcode is centered, well-lit, and in focus, or switch to Upload / Paste.
                  </p>
                  <button
                    type="button"
                    onClick={startCamera}
                    className="mt-1 text-[11px] font-mono uppercase text-[#264D3B] underline font-semibold cursor-pointer"
                  >
                    Restart Camera Stream
                  </button>
                </div>
              )}

              <p className="text-[11px] text-[#787E78] text-center">
                Point your webcam or mobile camera at the student's Holder Wallet QR presentation.
              </p>
            </div>
          )}

          {/* TAB 2: Upload QR Image */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              <label
                htmlFor="qr-file-upload"
                className="border-2 border-dashed border-[#D4CEBF] hover:border-[#264D3B] bg-[#FAF8F5] hover:bg-[#EDF3EE]/50 p-8 rounded-xs text-center flex flex-col items-center justify-center space-y-3 cursor-pointer transition-colors"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xs border border-[#D4CEBF] bg-[#FFFFFF] text-[#264D3B]">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <div className="space-y-1">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#1C201D]">
                    {isProcessingImage ? 'Analyzing QR Image...' : 'Click to Upload Credential QR Image'}
                  </span>
                  <p className="text-[11px] text-[#787E78]">
                    PNG, JPEG, WebP or SVG format screenshot from mobile or desktop
                  </p>
                </div>
                <input
                  id="qr-file-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileChange}
                  disabled={isProcessingImage}
                  className="sr-only"
                />
              </label>

              <p className="text-[11px] text-[#787E78] text-center">
                Captures and parses the credential barcode directly in browser memory without server uploads.
              </p>
            </div>
          )}

          {/* TAB 3: Paste JSON or URI */}
          {activeTab === 'paste' && (
            <form onSubmit={handlePasteSubmit} className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="paste-qr-input"
                  className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-[#1C201D]"
                >
                  Credential Payload (dice:credential:v1:... or Raw JSON)
                </label>
                <textarea
                  id="paste-qr-input"
                  rows={6}
                  value={pasteInput}
                  onChange={(e) => setPasteInput(e.target.value)}
                  placeholder={`dice:credential:v1:eyJpZCI6... \n\nOR\n\n{\n  "id": "cred-...",\n  "type": "StudentCredential",\n  ...\n}`}
                  className="w-full p-3 font-mono text-xs bg-[#FAF8F5] border border-[#D4CEBF] rounded-xs focus:ring-2 focus:ring-[#264D3B] focus:outline-none leading-relaxed"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#264D3B] text-[#FFFFFF] text-xs font-mono uppercase tracking-wider font-semibold border border-[#1B382B] hover:bg-[#1B382B] transition-colors rounded-xs shadow-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#264D3B] focus-visible:outline-none"
                >
                  Decode & Present for Audit →
                </button>
              </div>
            </form>
          )}

          {/* Inline Decode Error Banner */}
          {decodeError && (
            <div
              role="alert"
              className="p-3.5 bg-[#FAF0ED] border border-[#E8C8C0] rounded-xs space-y-1 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase font-bold text-[#A84835] bg-[#FFFFFF] px-1.5 py-0.5 border border-[#E8C8C0] rounded-2xs">
                  {decodeError.code}
                </span>
                <span className="font-semibold text-[#8A3726]">Credential Decoding Rejected</span>
              </div>
              <p className="text-[#8A3726] leading-relaxed text-[11px]">
                {decodeError.message}
              </p>
            </div>
          )}

          {/* Cryptographic Pipeline Notice */}
          <div className="p-3 bg-[#FAF8F5] border border-[#E7E3DA] rounded-xs text-[11px] text-[#525753] leading-relaxed space-y-1">
            <span className="font-mono uppercase font-semibold text-[#1C201D] block">
              Direct Audit Pipeline
            </span>
            <span>
              Scanning extracts the presented credential in client memory and immediately routes it to the authoritative Edge Function verification engine.
              <strong> The credential is never saved to Holder browser storage</strong>.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#E7E3DA] bg-[#FAF8F5] px-5 py-3 flex items-center justify-between">
          <span className="font-mono text-[10px] text-[#787E78] uppercase">
            STATE: {cameraState.toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() => {
              stopCamera()
              onClose()
            }}
            className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider font-semibold bg-[#1C201D] text-[#FFFFFF] hover:bg-[#383F39] transition-colors rounded-xs cursor-pointer"
          >
            Cancel / Close
          </button>
        </div>
      </div>
    </div>
  )
}
