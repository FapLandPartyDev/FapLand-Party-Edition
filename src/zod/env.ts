import * as z from "zod";

const optionalNonEmptyString = z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
);

const ProcessEnvSchema = z.object({
    DATABASE_URL: optionalNonEmptyString,
    VITE_DEV_SERVER_URL: optionalNonEmptyString,
    FLAND_UPDATE_REPOSITORY: optionalNonEmptyString,
    FLAND_ENABLE_DEV_FEATURES: optionalNonEmptyString,
    FLAND_REMOTE_DEBUGGING_PORT: optionalNonEmptyString,
});


export type ProcessEnv = z.infer<typeof ProcessEnvSchema>;

export function parseProcessEnv(rawEnv: NodeJS.ProcessEnv = process.env): ProcessEnv {
    return ProcessEnvSchema.parse(rawEnv);
}

export function getNodeEnv(rawEnv: NodeJS.ProcessEnv = process.env) {
    const parsed = parseProcessEnv({
        ...rawEnv,
        FLAND_UPDATE_REPOSITORY: rawEnv.FLAND_UPDATE_REPOSITORY ?? import.meta.env.FLAND_UPDATE_REPOSITORY,
        FLAND_ENABLE_DEV_FEATURES:
            rawEnv.FLAND_ENABLE_DEV_FEATURES ?? import.meta.env.FLAND_ENABLE_DEV_FEATURES,
        FLAND_REMOTE_DEBUGGING_PORT: rawEnv.FLAND_REMOTE_DEBUGGING_PORT,
    });

    const remoteDebuggingPortRaw = parsed.FLAND_REMOTE_DEBUGGING_PORT?.trim();
    const remoteDebuggingPort =
        remoteDebuggingPortRaw && /^\d+$/.test(remoteDebuggingPortRaw)
            ? Number(remoteDebuggingPortRaw)
            : null;

    return {
        databaseUrl: parsed.DATABASE_URL ?? "file:dev.db",
        databaseUrlRaw: parsed.DATABASE_URL,
        viteDevServerUrl: parsed.VITE_DEV_SERVER_URL,
        updateRepository: parsed.FLAND_UPDATE_REPOSITORY,
        enableDevFeatures:
            parsed.FLAND_ENABLE_DEV_FEATURES === "1" ||
            parsed.FLAND_ENABLE_DEV_FEATURES?.toLowerCase() === "true",
        remoteDebuggingPort:
            remoteDebuggingPort !== null &&
            Number.isInteger(remoteDebuggingPort) &&
            remoteDebuggingPort >= 1 &&
            remoteDebuggingPort <= 65535
                ? remoteDebuggingPort
                : null,
    } as const;
}
