import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Download, Mic, Pause, Play, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";
import mime from "mime";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { useDiscardChanges } from "@/hooks/use-discard-changes";
import { useDownloadMedia } from "@/hooks/use-download-media";
import { formatBytes } from "@/lib/image-utils";

function clock(milliseconds: number) {
    const seconds = Math.floor(milliseconds / 1000);
    return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function CanvasAudioRecorderDialog({ onClose, onSave }: { onClose: () => void; onSave: (file: File) => Promise<void> }) {
    const { t } = useTranslation();
    const [fileBaseName] = useState(() => t("canvas.audioRecorder.fileName"));
    const download = useDownloadMedia();
    const recorder = useAudioRecorder();
    const { phase, recording } = recorder;
    const audioRef = useRef<HTMLAudioElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const mounted = useRef(false);
    const reading = useRef(false);
    const playbackAttempt = useRef(0);
    const [previewUrl, setPreviewUrl] = useState("");
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [startingPlayback, setStartingPlayback] = useState(false);
    const [volume, setVolume] = useState(1);
    const [readingClipboard, setReadingClipboard] = useState(false);
    const [error, setError] = useState("");
    const capturing = phase === "recording" || phase === "paused";
    const waiting = phase === "preparing" || phase === "requesting" || phase === "stopping" || readingClipboard;
    const dirty = capturing || phase === "stopping" || Boolean(recording);
    const file = useMemo(() => {
        if (!recording) return null;
        const extension = mime.getExtension(recording.blob.type.split(";")[0]) || "audio";
        return new File([recording.blob], `${fileBaseName}-${Date.now()}.${extension}`, { type: recording.blob.type });
    }, [recording, fileBaseName]);
    const totalMs = duration || recording?.durationMs || 0;
    function pausePreview() {
        playbackAttempt.current++;
        audioRef.current?.pause();
        setStartingPlayback(false);
    }
    const start = useDiscardChanges(Boolean(recording), () => {
        pausePreview();
        setError("");
        void recorder.start();
    });
    const importAudio = useDiscardChanges(Boolean(recording), (blob: Blob) => {
        if (!mounted.current) return;
        pausePreview();
        if (recorder.importAudio(blob)) setError("");
        else setError(t("canvas.audioRecorder.errors.empty"));
    });

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        setPosition(0);
        setDuration(0);
        setPlaying(false);
        setStartingPlayback(false);
        if (!recording) { setPreviewUrl(""); return; }
        const url = URL.createObjectURL(recording.blob);
        setPreviewUrl(url);
        return () => {
            playbackAttempt.current++;
            const audio = audioRef.current;
            if (audio?.getAttribute("src") === url) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
            URL.revokeObjectURL(url);
        };
    }, [recording]);

    useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume, previewUrl]);

    async function togglePlayback() {
        const audio = audioRef.current;
        if (!audio || startingPlayback || phase !== "ready") return;
        if (!audio.paused) { audio.pause(); return; }
        const attempt = ++playbackAttempt.current;
        setStartingPlayback(true);
        setError("");
        try {
            if (audio.ended) audio.currentTime = 0;
            await audio.play();
        } catch { if (mounted.current && attempt === playbackAttempt.current) setError(t("canvas.audioRecorder.playbackFailed")); }
        finally { if (mounted.current && attempt === playbackAttempt.current) setStartingPlayback(false); }
    }

    async function pasteAudio() {
        if (capturing || waiting || reading.current) return;
        reading.current = true;
        setReadingClipboard(true);
        try {
            const items = await navigator.clipboard.read();
            const item = items.find((entry) => entry.types.some((type) => type.startsWith("audio/")));
            const type = item?.types.find((entry) => entry.startsWith("audio/"));
            if (!item || !type) { if (mounted.current) setError(t("canvas.audioRecorder.clipboardEmpty")); return; }
            const blob = await item.getType(type);
            if (mounted.current) importAudio(blob);
        } catch { if (mounted.current) setError(t("canvas.audioRecorder.clipboardFailed")); }
        finally { reading.current = false; if (mounted.current) setReadingClipboard(false); }
    }

    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            if (!(event.target instanceof Node) || !bodyRef.current?.closest("[data-slot='dialog-content']")?.contains(event.target)) return;
            event.stopPropagation();
            if (capturing || waiting) return;
            const audio = Array.from(event.clipboardData?.files || []).find((entry) => entry.type.startsWith("audio/"));
            if (audio) { event.preventDefault(); importAudio(audio); }
        };
        document.addEventListener("paste", onPaste);
        return () => document.removeEventListener("paste", onPaste);
    }, [capturing, waiting, importAudio]);

    return <Dialog open title={t("canvas.audioRecorder.title")} width={520} onClose={onClose} dirty={dirty}
        onConfirm={async () => { if (file && phase === "ready") { pausePreview(); await onSave(file); } }}
        confirmDisabled={!file || phase !== "ready" || readingClipboard} confirmText={t("canvas.audioRecorder.save")} cancelText={t(dirty ? "canvas.audioRecorder.discard" : "common.cancel")}>
        <div ref={bodyRef} className="space-y-3" onKeyDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-sm" role="status">
                    <Mic className={capturing && phase !== "paused" ? "size-4 text-destructive" : "size-4"} />
                    <span>{t(`canvas.audioRecorder.states.${phase}`)}</span>
                </div>
                <span className="text-3xl font-medium tabular-nums tracking-tight" aria-label={t("canvas.audioRecorder.duration")}>
                    {clock(recording ? totalMs : recorder.elapsedMs)}
                </span>
            </div>
            {previewUrl ? <div className="space-y-2">
                <audio ref={audioRef} src={previewUrl} preload="auto" hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={(event) => {
                    setPlaying(false);
                    if (!Number.isFinite(event.currentTarget.duration) && event.currentTarget.currentTime > 0) setDuration(event.currentTarget.currentTime * 1000);
                }}
                    onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime * 1000)}
                    onDurationChange={(event) => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds * 1000); }}
                    onError={() => setError(t("canvas.audioRecorder.playbackFailed"))} />
                <div className="flex items-center gap-2">
                    <Button size="icon" icon={playing ? <Pause /> : <Play />} loading={startingPlayback} disabled={phase !== "ready"} onClick={() => void togglePlayback()}
                        title={t(playing ? "canvas.audioRecorder.pausePlayback" : "canvas.audioRecorder.preview")} aria-label={t(playing ? "canvas.audioRecorder.pausePlayback" : "canvas.audioRecorder.preview")} />
                    <Slider className="min-w-0 flex-1" min={0} max={Math.max(totalMs, 1)} step={1} value={Math.min(position, totalMs)} disabled={!totalMs || phase !== "ready"}
                        aria-label={t("canvas.audioRecorder.seek")} onChange={(value) => {
                            try { if (audioRef.current) { audioRef.current.currentTime = value / 1000; setPosition(value); } }
                            catch { setError(t("canvas.audioRecorder.playbackFailed")); }
                        }} />
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{clock(position)} / {clock(totalMs)}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{file?.type.split(";")[0]} · {formatBytes(file?.size || 0)}</span>
                    <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" icon={volume === 0 ? <VolumeX /> : <Volume2 />} title={t(volume === 0 ? "canvas.audioRecorder.unmute" : "canvas.audioRecorder.mute")} aria-label={t(volume === 0 ? "canvas.audioRecorder.unmute" : "canvas.audioRecorder.mute")} onClick={() => setVolume(volume === 0 ? 1 : 0)} />
                        <Slider className="w-20" min={0} max={1} step={0.01} value={volume} aria-label={t("canvas.audioRecorder.volume")} onChange={setVolume} />
                    </div>
                </div>
            </div> : <p className="text-sm leading-5 text-muted-foreground">{t(phase === "requesting" ? "canvas.audioRecorder.permissionHint" : "canvas.audioRecorder.hint")}</p>}
            <div className="flex flex-wrap items-center gap-2">
                {capturing ? <>
                    <Button size="icon" icon={phase === "paused" ? <Mic /> : <Pause />} onClick={recorder.togglePause} title={t(phase === "paused" ? "canvas.audioRecorder.resume" : "canvas.audioRecorder.pause")} aria-label={t(phase === "paused" ? "canvas.audioRecorder.resume" : "canvas.audioRecorder.pause")} />
                    <Button size="icon" icon={<Square />} onClick={recorder.stop} title={t("canvas.audioRecorder.finish")} aria-label={t("canvas.audioRecorder.finish")} />
                </> : <>
                    <Button size="icon" icon={recording ? <RotateCcw /> : <Mic />} loading={phase === "preparing" || phase === "requesting" || phase === "stopping"} disabled={waiting} onClick={start}
                        title={t(recording ? "canvas.audioRecorder.rerecord" : "canvas.audioRecorder.start")} aria-label={t(recording ? "canvas.audioRecorder.rerecord" : "canvas.audioRecorder.start")} />
                    <Button size="icon" icon={<ClipboardPaste />} loading={readingClipboard} disabled={waiting || !navigator.clipboard?.read} onClick={() => void pasteAudio()} title={t("canvas.audioRecorder.paste")} aria-label={t("canvas.audioRecorder.paste")} />
                    {file && previewUrl ? <Button size="icon" icon={<Download />} disabled={waiting} onClick={() => void download({ url: previewUrl, mimeType: file.type }, file.name)} title={t("common.download")} aria-label={t("common.download")} /> : null}
                </>}
                <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">{t(recording ? "canvas.audioRecorder.previewHint" : "canvas.audioRecorder.localHint")}</p>
            </div>
            {recorder.error ? <p role="alert" className="text-sm leading-5 text-destructive">{t(`canvas.audioRecorder.errors.${recorder.error}`)}</p> : null}
            {error ? <p role="alert" className="text-sm leading-5 text-destructive">{error}</p> : null}
        </div>
    </Dialog>;
}
