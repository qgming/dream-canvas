/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
    // Comma-separated local development plugin URLs, refetched on every startup without caching or persistence.
    readonly VITE_DEV_PLUGINS?: string;
    // Optional self-hosted plugin registry; defaults to the local registry generated from repository plugins.
    readonly VITE_PLUGIN_REGISTRY_URL?: string;
}
