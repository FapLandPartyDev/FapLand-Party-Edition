/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_VERSION: string;
    readonly VITE_MULTIPLAYER_DEFAULT_SUPABASE_URL?: string;
    readonly VITE_MULTIPLAYER_DEFAULT_SUPABASE_ANON_KEY?: string;
    readonly VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_URL?: string;
    readonly VITE_MULTIPLAYER_DEVELOPMENT_SUPABASE_ANON_KEY?: string;
    readonly FLAND_UPDATE_REPOSITORY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
