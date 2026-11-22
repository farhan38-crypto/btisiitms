// Voice features
//  1. DictateButton  — speak your complaint; the words are typed into the description and
//                      (optionally) the AI fills in the rest of the form when you stop.
//  2. VoiceRecorder  — record a voice note to attach to a report ("the fan makes this noise"),
//                      with a live transcript where the browser supports speech recognition.
//     VoiceNotePlayer — plays an attached voice note, with its transcript.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Mic, Square, Play, Pause, Trash2, Check, RotateCcw, FileText } from 'lucide-react';
import api from '../api';
import { AnimatePresence, motion, DURATION, EASE_OUT } from '../motion';

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const speechSupported = Boolean(SpeechRecognition);
export const recordingSupported = typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  && typeof window.MediaRecorder !== 'undefined';

const SPEECH_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it in the browser\'s address bar and try again.',
  'service-not-allowed': 'Speech recognition is turned off in this browser.',
  network: 'Speech recognition needs an internet connection.',
  'audio-capture': 'No microphone was found.',
  'language-not-supported': 'This language is not supported for dictation.'
};

function micHelp(err) {
  if (!window.isSecureContext) return 'The microphone only works on https:// or localhost. Open the app through the ngrok link on your phone.';
  if (err?.name === 'NotAllowedError') return 'Microphone access is blocked. Allow it in the browser\'s address bar and try again.';
  if (err?.name === 'NotFoundError') return 'No microphone was found on this device.';
  return 'Could not start the microphone.';
}

export function useSpeechRecognition({ lang = 'en-IN', onFinal } = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => { rec.current?.stop(); }, []);

  const start = useCallback(({ silent = false } = {}) => {
    if (!SpeechRecognition) return false;
    const r = new SpeechRecognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = e => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) onFinalRef.current?.(text.trim());
        else partial += text;
      }
      setInterim(partial);
    };
    r.onerror = e => {
      if (!silent && e.error !== 'no-speech' && e.error !== 'aborted') toast.error(SPEECH_ERRORS[e.error] || `Dictation stopped (${e.error}).`);
    };
    r.onend = () => { setListening(false); setInterim(''); rec.current = null; };
    try {
      r.start();
      rec.current = r;
      setListening(true);
      return true;
    } catch {
      return false;
    }
  }, [lang]);

  useEffect(() => () => rec.current?.abort(), []);
  return { supported: speechSupported, listening, interim, start, stop };
}

// Mic button for a text field. `onText` gets each finished phrase; `onDone` gets everything said.
export function DictateButton({ onText, onDone, label = 'Speak' }) {
  const said = useRef([]);
  const { supported, listening, interim, start, stop } = useSpeechRecognition({
    onFinal: text => { if (text) { said.current.push(text); onText?.(text); } }
  });
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !listening && said.current.length) onDone?.(said.current.join(' '));
    wasListening.current = listening;
  }, [listening, onDone]);

  if (!supported) return null;
  const toggle = () => {
    if (listening) return stop();
    said.current = [];
    if (!start()) toast.error('Could not start dictation in this browser.');
    return undefined;
  };
  return (
    <span className="dictate">
      <button type="button" className={`mic-btn${listening ? ' live' : ''}`} onClick={toggle}
        aria-pressed={listening} title={listening ? 'Stop dictation' : 'Describe the problem by speaking'}>
        <span className="mic-icon">{listening ? <Square size={14} /> : <Mic size={15} />}</span>
        {listening ? 'Listening… tap to stop' : label}
      </button>
      <AnimatePresence>
        {listening && (
          <motion.span className="dictate-interim" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: DURATION.fast, ease: EASE_OUT }} aria-live="polite">
            {interim || 'Speak now — e.g. "The fan in Krishna Bhavan room 204 is making a grinding noise"'}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

const MIME_CHOICES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
const pickMime = () => MIME_CHOICES.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';

export const blobToBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Records a voice note. Calls onReady({kind:'voice', content_type, data_base64, duration_s, transcript}).
export function VoiceRecorder({ onReady, maxSeconds = 120, compact }) {
  const [phase, setPhase] = useState('idle');        // idle | recording | review
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState(() => Array(12).fill(0.08));
  const [preview, setPreview] = useState(null);      // { url, blob, type, duration }
  const [transcript, setTranscript] = useState('');
  const parts = useRef([]);
  const media = useRef({});
  const startedAt = useRef(0);
  const speech = useSpeechRecognition({ onFinal: t => setTranscript(prev => (prev ? `${prev} ${t}` : t)) });

  const cleanup = useCallback(() => {
    const m = media.current;
    cancelAnimationFrame(m.raf);
    clearInterval(m.timer);
    m.stream?.getTracks().forEach(t => t.stop());
    m.ctx?.close().catch(() => {});
    media.current = {};
  }, []);
  useEffect(() => cleanup, [cleanup]);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const stop = useCallback(() => {
    const rec = media.current.recorder;
    if (rec && rec.state !== 'inactive') rec.stop();
    speech.stop();
  }, [speech]);

  const start = async () => {
    if (!recordingSupported) { toast.error('Voice recording is not supported in this browser.'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast.error(micHelp(e)); return; }
    const type = pickMime();
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    parts.current = [];
    recorder.ondataavailable = e => e.data.size && parts.current.push(e.data);
    recorder.onstop = () => {
      const duration = (Date.now() - startedAt.current) / 1000;
      const blobType = (recorder.mimeType || type || 'audio/webm').split(';')[0];
      const blob = new Blob(parts.current, { type: blobType });
      cleanup();
      setPreview({ url: URL.createObjectURL(blob), blob, type: blobType, duration });
      setPhase('review');
    };
    // Live input level meter (purely informative: shows the mic is picking you up).
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: 12 }, (_, i) => Math.max(0.08, (data[i + 2] || 0) / 255));
        setLevels(bars);
        media.current.raf = requestAnimationFrame(tick);
      };
      media.current.ctx = ctx;
      media.current.raf = requestAnimationFrame(tick);
    } catch { /* meter is optional */ }
    media.current.stream = stream;
    media.current.recorder = recorder;
    startedAt.current = Date.now();
    setSeconds(0);
    setTranscript('');
    media.current.timer = setInterval(() => {
      const s = (Date.now() - startedAt.current) / 1000;
      setSeconds(s);
      if (s >= maxSeconds) stop();
    }, 250);
    recorder.start(250);
    speech.start({ silent: true });                 // transcript is a bonus; failures stay quiet
    setPhase('recording');
  };

  const discard = () => { setPreview(null); setTranscript(''); setPhase('idle'); };
  const use = async () => {
    const data_base64 = await blobToBase64(preview.blob);
    onReady?.({ kind: 'voice', content_type: preview.type, data_base64, duration_s: Math.max(0.5, Math.min(180, preview.duration)),
      transcript: transcript || undefined, previewUrl: URL.createObjectURL(preview.blob) });
    discard();
  };

  if (!recordingSupported) return null;
  return (
    <div className={`voice-recorder${compact ? ' compact' : ''}`}>
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'idle' && (
          <motion.button key="idle" type="button" className={`secondary rec-start${compact ? ' small' : ''}`} onClick={start}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: DURATION.fast }}>
            <Mic size={16} /> Record a voice note
          </motion.button>
        )}
        {phase === 'recording' && (
          <motion.div key="rec" className="rec-live" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }} transition={{ duration: DURATION.base, ease: EASE_OUT }}>
            <span className="rec-dot" aria-hidden="true" />
            <b className="rec-time">{clock(seconds)}</b>
            <span className="rec-meter" aria-hidden="true">
              {levels.map((l, i) => <i key={i} style={{ transform: `scaleY(${l})` }} />)}
            </span>
            <small className="muted">max {clock(maxSeconds)}</small>
            <button type="button" className="primary small" onClick={stop}><Square size={13} /> Stop</button>
            {speech.listening && (transcript || speech.interim) && (
              <p className="rec-transcript">{transcript} <span className="muted">{speech.interim}</span></p>
            )}
          </motion.div>
        )}
        {phase === 'review' && preview && (
          <motion.div key="review" className="rec-review" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: DURATION.base, ease: EASE_OUT }}>
            <audio src={preview.url} controls preload="metadata" />
            {transcript && <p className="rec-transcript"><FileText size={13} /> {transcript}</p>}
            <div className="rec-actions">
              <button type="button" className="primary small" onClick={use}><Check size={14} /> Attach ({clock(preview.duration)})</button>
              <button type="button" className="secondary small" onClick={() => { discard(); start(); }}><RotateCcw size={14} /> Re-record</button>
              <button type="button" className="secondary small" onClick={discard}><Trash2 size={14} /> Discard</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Loads an attachment's content (needs the auth header, so it can't be a plain <img src>).
export function useAttachmentUrl(id, fallbackUrl) {
  const [url, setUrl] = useState(fallbackUrl || null);
  useEffect(() => {
    if (!id || fallbackUrl) return undefined;
    let alive = true;
    let objectUrl;
    api.get(`/attachments/${id}/content`, { responseType: 'blob' })
      .then(r => { if (alive) { objectUrl = URL.createObjectURL(r.data); setUrl(objectUrl); } })
      .catch(() => {});
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, fallbackUrl]);
  return url;
}

export function VoiceNotePlayer({ note }) {
  const url = useAttachmentUrl(note.id, note.previewUrl);
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showText, setShowText] = useState(false);
  const duration = note.duration_s || 0;
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => toast.error('This browser cannot play this recording format.'));
    else a.pause();
  };
  return (
    <div className="voice-note">
      <button type="button" className="play-btn" onClick={toggle} disabled={!url} aria-label={playing ? 'Pause' : 'Play voice note'}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="voice-body">
        <div className="voice-track" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></div>
        <small className="muted">
          {note.uploaded_by_name ? `${note.uploaded_by_name} · ` : ''}{duration ? clock(duration) : 'voice note'}
          {note.transcript && <> · <button type="button" className="link-btn" onClick={() => setShowText(s => !s)}>{showText ? 'Hide' : 'Show'} transcript</button></>}
        </small>
        <AnimatePresence initial={false}>
          {showText && note.transcript && (
            <motion.p className="voice-transcript" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }} transition={{ duration: DURATION.fast, ease: EASE_OUT }}>
              “{note.transcript}”
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      {url && (
        <audio ref={audio} src={url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setProgress(0); }}
          onTimeUpdate={e => {
            const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : duration;
            setProgress(d ? Math.min(1, e.currentTarget.currentTime / d) : 0);
          }} />
      )}
    </div>
  );
}
