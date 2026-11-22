// Photos and voice notes in the browser: shrink photos before upload (the API accepts up to
// 6 MB, phones take 12 MP), record voice with MediaRecorder, and read files as base64.
import { useEffect, useState } from 'react'
import { api } from '../../api'

export function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] || '')
    r.onerror = () => rej(r.error)
    r.readAsDataURL(blob)
  })
}

/** Longest side 1600 px, JPEG ~0.85: a clear photo of a socket or a screen in ~300 KB. */
export async function shrinkPhoto(file: File, max = 1600): Promise<{ blob: Blob; type: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !file.type.startsWith('image/')) throw new Error('Choose a photo (JPEG, PNG or WebP).')
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.85))
    if (blob) return { blob, type: 'image/jpeg' }
  } catch { /* fall back to the original */ }
  return { blob: file, type: file.type }
}

/** Attachment content needs the auth header, so it is fetched once and kept as an object URL. */
const urls = new Map<string, Promise<string>>()
export function useAttachmentUrl(id: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    let alive = true
    if (!urls.has(id)) urls.set(id, api.attachments.contentUrl(id).catch(e => { urls.delete(id); throw e }))
    urls.get(id)!.then(u => alive && setUrl(u)).catch(() => {})
    return () => { alive = false }
  }, [id])
  return url
}

// ───── voice notes ─────
type SR = { start: () => void; stop: () => void; continuous: boolean; interimResults: boolean; lang: string; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onerror: () => void }
export function pickAudioType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  return types.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) || ''
}
export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

export function createRecorder(onTranscript?: (t: string) => void) {
  let rec: MediaRecorder | null = null, stream: MediaStream | null = null, chunks: Blob[] = [], started = 0
  let speech: SR | null = null, finalText = ''
  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const type = pickAudioType()
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
      chunks = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      rec.start(250); started = Date.now()
      // Live captions where the browser offers speech recognition (Chrome, Edge, Safari).
      const Ctor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
        || (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition
      if (Ctor && onTranscript) {
        try {
          speech = new Ctor(); speech.continuous = true; speech.interimResults = true; speech.lang = 'en-IN'
          speech.onresult = e => {
            let interim = ''; finalText = ''
            for (let k = 0; k < e.results.length; k++) { const r = e.results[k]!; if (r.isFinal) finalText += r[0]!.transcript; else interim += r[0]!.transcript }
            onTranscript((finalText + ' ' + interim).trim())
          }
          speech.onerror = () => {}; speech.start()
        } catch { speech = null }
      }
    },
    stop(): Promise<{ blob: Blob; type: string; seconds: number; transcript: string }> {
      return new Promise(res => {
        if (!rec) return
        const type = (rec.mimeType || 'audio/webm').split(';')[0]!
        rec.onstop = () => {
          stream?.getTracks().forEach(t => t.stop())
          res({ blob: new Blob(chunks, { type }), type, seconds: Math.max(1, (Date.now() - started) / 1000), transcript: finalText.trim() })
        }
        rec.stop(); try { speech?.stop() } catch { /* ignore */ }
      })
    },
    cancel() { try { rec?.stop() } catch { /* ignore */ } stream?.getTracks().forEach(t => t.stop()); try { speech?.stop() } catch { /* ignore */ } },
  }
}
