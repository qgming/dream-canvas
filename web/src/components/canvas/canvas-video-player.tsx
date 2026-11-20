import { useRef, useState } from "react";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function CanvasVideoPlayer({ src, poster, nodeId, className, onError }: { src?: string; poster?: string; nodeId?: string; className?: string; onError: () => void }) {
    const { t } = useTranslation();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [started, setStarted] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [starting, setStarting] = useState(false);
    const [coverFailed, setCoverFailed] = useState(false);
    const [playFailed, setPlayFailed] = useState(false);
    const showCover = Boolean(poster && !coverFailed && !started);
    const play = async () => {
        if (!videoRef.current || starting) return;
        setStarting(true);
        setPlayFailed(false);
        try { await videoRef.current.play(); }
        catch { setPlayFailed(true); }
        finally { setStarting(false); }
    };

    return <div className="relative size-full overflow-hidden rounded-xl">
        <video ref={videoRef} src={src} playsInline controls={started} preload={showCover ? "none" : "metadata"} className={className} data-canvas-video={nodeId} data-canvas-no-zoom data-canvas-shortcuts-ignore
            onPlay={() => { setStarted(true); setPlaying(true); setPlayFailed(false); }} onPause={() => setPlaying(false)}
            onEnded={(event) => { event.currentTarget.currentTime = 0; setStarted(false); setPlaying(false); }} onError={onError}
            onPointerDown={(event) => { if (started) event.stopPropagation(); }} onMouseDown={(event) => { if (started) event.stopPropagation(); }}
            onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} />
        {showCover ? <img src={poster} alt="" loading="lazy" draggable={false} className="pointer-events-none absolute inset-0 size-full select-none object-contain" onError={() => setCoverFailed(true)} /> : null}
        {!playing ? <Button variant="ghost" size="icon" className="absolute left-1/2 top-1/2 z-10 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/65 hover:text-white focus-visible:ring-white focus-visible:ring-offset-0 [&_svg]:size-6" data-ui-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore
            icon={<Play className="ml-0.5 fill-current" strokeWidth={0} />} loading={starting} title={t("canvas.videoPlayer.play")} aria-label={t("canvas.videoPlayer.play")}
            onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void play(); }} /> : null}
        {playFailed ? <p role="alert" className="absolute inset-x-2 bottom-2 rounded-md bg-black/65 px-2 py-1 text-center text-xs text-white">{t("canvas.videoPlayer.failed")}</p> : null}
    </div>;
}
