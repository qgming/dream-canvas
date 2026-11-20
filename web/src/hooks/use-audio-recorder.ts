import { useEffect, useRef, useState } from "react";
import type { IMediaRecorder } from "extendable-media-recorder";
import { loadWavRecorder } from "@/lib/canvas/canvas-audio-recording";

type RecorderPhase = "idle" | "preparing" | "requesting" | "recording" | "paused" | "stopping" | "ready";
type RecorderError = "insecure" | "unsupported" | "encoderFailed" | "permission" | "noDevice" | "deviceBusy" | "disconnected" | "captureFailed" | "empty";
export type AudioRecording = { blob: Blob; durationMs: number };

function captureError(error: unknown): RecorderError {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "permission";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "noDevice";
    if (name === "NotReadableError" || name === "AbortError") return "deviceBusy";
    if (name === "NotSupportedError") return "unsupported";
    return "captureFailed";
}

export function useAudioRecorder() {
    const [phase, setPhase] = useState<RecorderPhase>("idle");
    const [recording, setRecording] = useState<AudioRecording | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [error, setError] = useState<RecorderError | null>(null);
    const mounted = useRef(false);
    const sequence = useRef(0);
    const requesting = useRef(false);
    const stopping = useRef(false);
    const recorder = useRef<IMediaRecorder | null>(null);
    const stream = useRef<MediaStream | null>(null);
    const chunks = useRef<Blob[]>([]);
    const elapsed = useRef(0);
    const startedAt = useRef<number | null>(null);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    function readElapsed() {
        return elapsed.current + (startedAt.current === null ? 0 : performance.now() - startedAt.current);
    }

    function pauseClock() {
        elapsed.current = readElapsed();
        startedAt.current = null;
        setElapsedMs(elapsed.current);
    }

    function releaseMicrophone() {
        if (timer.current !== null) clearInterval(timer.current);
        timer.current = null;
        stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
        stream.current = null;
    }

    function dispose() {
        sequence.current++;
        requesting.current = false;
        stopping.current = false;
        const current = recorder.current;
        recorder.current = null;
        if (current) {
            current.ondataavailable = null;
            current.onstop = null;
            current.onerror = null;
            current.onpause = null;
            current.onresume = null;
            try { if (current.state !== "inactive") current.stop(); } catch { }
        }
        releaseMicrophone();
        chunks.current = [];
        startedAt.current = null;
    }

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; dispose(); };
    }, []);

    async function start() {
        if (!mounted.current || requesting.current || recorder.current) return;
        if (!window.isSecureContext) { setError("insecure"); return; }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("unsupported"); return; }
        const currentSequence = ++sequence.current;
        requesting.current = true;
        setError(null);
        setPhase("preparing");
        let preparing = true;
        try {
            const Recorder = await loadWavRecorder();
            if (!mounted.current || currentSequence !== sequence.current) return;
            preparing = false;
            setPhase("requesting");
            const input = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            if (!mounted.current || currentSequence !== sequence.current) { input.getTracks().forEach((track) => track.stop()); return; }
            stream.current = input;
            const current = new Recorder(input, { mimeType: "audio/wav" });
            recorder.current = current;
            stopping.current = false;
            chunks.current = [];
            elapsed.current = 0;
            const active = () => mounted.current && sequence.current === currentSequence;
            current.ondataavailable = (event) => { if (active() && event.data.size) chunks.current.push(event.data); };
            current.onpause = () => { if (active() && !stopping.current && current.state === "paused") { pauseClock(); setPhase("paused"); } };
            current.onresume = () => { if (active() && !stopping.current && current.state === "recording") { startedAt.current = performance.now(); setPhase("recording"); } };
            current.onerror = () => {
                if (!active()) return;
                setError("captureFailed");
                if (current.state !== "inactive") stop();
            };
            current.onstop = () => {
                if (!active()) return;
                pauseClock();
                releaseMicrophone();
                recorder.current = null;
                stopping.current = false;
                const blob = new Blob(chunks.current, { type: current.mimeType || chunks.current[0]?.type });
                chunks.current = [];
                if (!blob.size) { setPhase("idle"); setError("empty"); return; }
                setRecording({ blob, durationMs: Math.round(elapsed.current) });
                setPhase("ready");
            };
            input.getAudioTracks().forEach((track) => {
                track.onended = () => { if (active()) { setError("disconnected"); stop(); } };
            });
            current.start();
            startedAt.current = performance.now();
            setRecording(null);
            setElapsedMs(0);
            setPhase("recording");
            timer.current = setInterval(() => { if (active()) setElapsedMs(readElapsed()); }, 250);
        } catch (failure) {
            if (!mounted.current || currentSequence !== sequence.current) return;
            dispose();
            setPhase(recording ? "ready" : "idle");
            setError(preparing ? "encoderFailed" : captureError(failure));
        } finally {
            if (currentSequence === sequence.current) requesting.current = false;
        }
    }

    function stop() {
        const current = recorder.current;
        if (!current || stopping.current || current.state === "inactive") return;
        try { stopping.current = true; pauseClock(); current.stop(); setPhase("stopping"); }
        catch { stopping.current = false; setError("captureFailed"); }
    }

    function togglePause() {
        const current = recorder.current;
        if (!current || stopping.current) return;
        try {
            if (current.state === "recording") current.pause();
            else if (current.state === "paused") current.resume();
        } catch { setError("captureFailed"); }
    }

    function importAudio(blob: Blob) {
        if (!mounted.current || requesting.current || recorder.current || !blob.size || !blob.type.startsWith("audio/")) return false;
        setRecording({ blob, durationMs: 0 });
        setElapsedMs(0);
        setPhase("ready");
        setError(null);
        return true;
    }

    return { phase, recording, elapsedMs, error, start, stop, togglePause, importAudio };
}
