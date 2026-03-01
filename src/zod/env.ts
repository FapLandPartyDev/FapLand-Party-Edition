import * as z from "zod";

const optionalNonEmptyString = z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
);

const ProcessEnvSchema = z.object({
    DATABASE_URL: optionalNonEmptyString,
    VITE_DEV_SERVER_URL: optionalNonEmptyString,
    FLAND_UPDATE_REPOSITORY: optionalNonEmptyString,
});


export type ProcessEnv = z.infer<typeof ProcessEnvSchema>;

export function parseProcessEnv(rawEnv: NodeJS.ProcessEnv = process.env): ProcessEnv {
    return ProcessEnvSchema.parse(rawEnv);
}

export function getNodeEnv(rawEnv: NodeJS.ProcessEnv = process.env) {
    const parsed = parseProcessEnv({
        ...rawEnv,
        FLAND_UPDATE_REPOSITORY: rawEnv.FLAND_UPDATE_REPOSITORY ?? import.meta.env.FLAND_UPDATE_REPOSITORY,
    });

    return {
        databaseUrl: parsed.DATABASE_URL ?? "file:dev.db",
        databaseUrlRaw: parsed.DATABASE_URL,
        viteDevServerUrl: parsed.VITE_DEV_SERVER_URL,
        updateRepository: parsed.FLAND_UPDATE_REPOSITORY,
    } as const;
}
