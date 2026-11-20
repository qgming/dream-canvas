import type { IMediaRecorderConstructor } from "extendable-media-recorder";

let recorderConstructor: Promise<IMediaRecorderConstructor> | undefined;

export function loadWavRecorder(): Promise<IMediaRecorderConstructor> {
    return recorderConstructor ||= Promise.all([
        import("extendable-media-recorder"),
        import("extendable-media-recorder-wav-encoder"),
    ]).then(async ([recorder, encoder]) => {
        const port = await encoder.connect();
        try { await recorder.register(port); }
        catch (error) { await encoder.disconnect(port).catch(() => undefined); port.close(); throw error; }
        return recorder.MediaRecorder;
    }).catch((error: unknown) => { recorderConstructor = undefined; throw error; });
}
