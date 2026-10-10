import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export type CameraState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'error'; reason: 'denied' | 'no_camera' | 'busy' | 'insecure' | 'unsupported' | 'unknown'; message: string };

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

function nativeDetector(): Detector | null {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  try {
    return BD ? new BD({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

function describe(err: unknown): CameraState {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return { kind: 'error', reason: 'denied', message: 'Camera access was blocked. Allow the camera for this site in your browser settings, or use manual lookup.' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return { kind: 'error', reason: 'no_camera', message: 'No camera was found on this device. Use manual lookup instead.' };
  if (name === 'NotReadableError' || name === 'AbortError')
    return { kind: 'error', reason: 'busy', message: 'The camera is being used by another app. Close it and try again.' };
  return { kind: 'error', reason: 'unknown', message: 'The camera could not be started. Try again or use manual lookup.' };
}

/**
 * Camera QR reader. Permission is requested only when `start()` is called.
 * `onCode` fires once per distinct payload; the same code is ignored for `dedupeMs`.
 */
export function useQrScanner(onCode: (text: string) => void, { paused, dedupeMs = 4000 }: { paused: boolean; dedupeMs?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const timer = useRef<number | null>(null);
  const last = useRef<{ text: string; at: number } | null>(null);
  const detector = useRef<Detector | null>(null);
  const busy = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const cb = useRef(onCode);
  cb.current = onCode;
  const [state, setState] = useState<CameraState>({ kind: 'idle' });

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setState((s) => (s.kind === 'error' || s.kind === 'idle' ? s : { kind: 'idle' }));
  }, []);

  const tick = useCallback(async () => {
    const v = video.current;
    if (!v || pausedRef.current || busy.current || v.readyState < 2) return;
    busy.current = true;
    try {
      let text: string | null = null;
      if (detector.current) {
        const found = await detector.current.detect(v);
        text = found[0]?.rawValue ?? null;
      } else {
        const w = Math.min(640, v.videoWidth);
        const h = Math.round((v.videoHeight / v.videoWidth) * w);
        if (!canvas.current) canvas.current = document.createElement('canvas');
        const c = canvas.current;
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          text = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
        }
      }
      if (text) {
        const now = Date.now();
        if (!last.current || last.current.text !== text || now - last.current.at > dedupeMs) {
          last.current = { text, at: now };
          cb.current(text);
        }
      }
    } catch {
      // A failed frame is not fatal; the next tick tries again.
    } finally {
      busy.current = false;
    }
  }, [dedupeMs]);

  const start = useCallback(async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState({
        kind: 'error',
        reason: window.isSecureContext ? 'unsupported' : 'insecure',
        message: window.isSecureContext
          ? 'This browser cannot access the camera. Use manual lookup instead.'
          : 'The camera only works over HTTPS (or on localhost). Open CAMPUSFLOW over a secure connection, or use manual lookup.',
      });
      return;
    }
    setState({ kind: 'starting' });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      detector.current = nativeDetector();
      const v = video.current;
      if (v) {
        v.srcObject = s;
        v.setAttribute('playsinline', 'true');
        await v.play().catch(() => undefined);
      }
      setState({ kind: 'running' });
      timer.current = window.setInterval(tick, 160);
    } catch (err) {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      setState(describe(err));
    }
  }, [tick]);

  /** Allow the same code to be read again immediately (e.g. after "retry"). */
  const forget = useCallback(() => {
    last.current = null;
  }, []);

  // Release the camera when the page is hidden or the component unmounts.
  useEffect(() => {
    const onVis = () => document.hidden && stop();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [stop]);

  return { video, state, start, stop, forget };
}
