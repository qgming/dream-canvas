// Build repository plugins locally, or point to a self-hosted registry.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "/plugins/official/official-plugins.json";
