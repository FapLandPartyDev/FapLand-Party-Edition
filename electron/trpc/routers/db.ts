import { TRPCError } from "@trpc/server";
import fs from "node:fs/promises";
import path from "node:path";
import { app, shell } from "electron";
import * as z from "zod";
import { getDb } from "../../services/db";
import { exportInstalledDatabase } from "../../services/installExport";
import { getDisabledRoundIdSet, resolveResourceUris } from "../../services/integrations";
import { getStore } from "../../services/store";
import {
    addAutoScanFolder,
    getAutoScanFolders,
    getInstallScanStatus,
    importInstallSidecarFile,
    importLegacyFolderWithPlan,
    inspectInstallFolder,
    removeAutoScanFolder,
    requestInstallScanAbort,
    scanInstallFolderOnceWithLegacySupport,
    scanInstallSources,
} from "../../services/installer";
import { publicProcedure, router } from "../trpc";
import { eq, desc, asc, inArray } from "drizzle-orm";
import {
    gameProfile,
    singlePlayerRunHistory,
    multiplayerMatchCache,
    resultSyncQueue,
    hero,
    round,
    resource,
    playlistTrackPlay,
    playlist
} from "../../services/db/schema";

const ZNullableText = z.string().optional().nullable();
const ZRoundType = z.enum(["Normal", "Interjection", "Cum"]);

function getInstallExportBaseDir(): string {
    const exportBaseDir = app.isPackaged ? app.getPath("userData") : app.getAppPath();
    return path.join(exportBaseDir, "export");
}

export const dbRouter = router({
    getLocalHighscore: publicProcedure.query(async () => {
        const db = getDb();
        const profile = await db.select().from(gameProfile).where(eq(gameProfile.id, "local")).get();
        return Math.max(0, profile?.highscore ?? 0);
    }),

    setLocalHighscore: publicProcedure
        .input(z.object({ highscore: z.number().int().min(0) }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const clamped = Math.max(0, Math.floor(input.highscore));
            const existing = await db.select().from(gameProfile).where(eq(gameProfile.id, "local")).get();
            const nextHighscore = Math.max(existing?.highscore ?? 0, clamped);
            await db.insert(gameProfile).values({ id: "local", highscore: nextHighscore }).onConflictDoUpdate({
                target: gameProfile.id,
                set: { highscore: nextHighscore },
            });
            return nextHighscore;
        }),

    recordSinglePlayerRun: publicProcedure
        .input(z.object({
            finishedAtIso: z.string().min(1).optional(),
            score: z.number().int().min(0),
            highscoreBefore: z.number().int().min(0),
            highscoreAfter: z.number().int().min(0),
            wasNewHighscore: z.boolean(),
            completionReason: z.string().min(1),
            playlistId: z.string().min(1).nullable().optional(),
            playlistName: z.string().min(1),
            playlistFormatVersion: z.number().int().min(1).nullable().optional(),
            endingPosition: z.number().int().min(0),
            turn: z.number().int().min(0),
        }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const [created] = await db.insert(singlePlayerRunHistory).values({
                finishedAt: input.finishedAtIso ? new Date(input.finishedAtIso) : new Date(),
                score: input.score,
                highscoreBefore: input.highscoreBefore,
                highscoreAfter: input.highscoreAfter,
                wasNewHighscore: input.wasNewHighscore,
                completionReason: input.completionReason,
                playlistId: input.playlistId ?? null,
                playlistName: input.playlistName.trim(),
                playlistFormatVersion: input.playlistFormatVersion ?? null,
                endingPosition: input.endingPosition,
                turn: input.turn,
            }).returning();
            return created;
        }),

    listSinglePlayerRuns: publicProcedure
        .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
        .query(({ input }) => {
            const db = getDb();
            const limit = input?.limit ?? 50;
            return db.query.singlePlayerRunHistory.findMany({
                orderBy: [desc(singlePlayerRunHistory.finishedAt)],
                limit,
            });
        }),

    upsertMultiplayerMatchCache: publicProcedure
        .input(z.object({
            lobbyId: z.string().min(1),
            finishedAtIso: z.string().min(1),
            isFinal: z.boolean().default(false),
            resultsJson: z.unknown(),
        }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const [created] = await db.insert(multiplayerMatchCache).values({
                lobbyId: input.lobbyId,
                finishedAt: new Date(input.finishedAtIso),
                isFinal: input.isFinal,
                resultsJson: input.resultsJson,
            }).onConflictDoUpdate({
                target: multiplayerMatchCache.lobbyId,
                set: {
                    finishedAt: new Date(input.finishedAtIso),
                    isFinal: input.isFinal,
                    resultsJson: input.resultsJson,
                    updatedAt: new Date(),
                },
            }).returning();
            return created;
        }),

    getMultiplayerMatchCache: publicProcedure
        .input(z.object({ lobbyId: z.string().min(1) }))
        .query(({ input }) => {
            const db = getDb();
            return db.query.multiplayerMatchCache.findFirst({
                where: eq(multiplayerMatchCache.lobbyId, input.lobbyId),
            });
        }),

    listMultiplayerMatchCache: publicProcedure
        .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
        .query(({ input }) => {
            const db = getDb();
            const limit = input?.limit ?? 50;
            return db.query.multiplayerMatchCache.findMany({
                orderBy: [desc(multiplayerMatchCache.finishedAt)],
                limit,
            });
        }),

    enqueueResultSyncLobby: publicProcedure
        .input(z.object({ lobbyId: z.string().min(1) }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const [created] = await db.insert(resultSyncQueue).values({
                lobbyId: input.lobbyId,
            }).onConflictDoNothing({ target: resultSyncQueue.lobbyId }).returning();
            return created;
        }),

    touchResultSyncLobby: publicProcedure
        .input(z.object({ lobbyId: z.string().min(1) }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const now = new Date();
            const [created] = await db.insert(resultSyncQueue).values({
                lobbyId: input.lobbyId,
                lastAttemptAt: now,
            }).onConflictDoUpdate({
                target: resultSyncQueue.lobbyId,
                set: { lastAttemptAt: now },
            }).returning();
            return created;
        }),

    listResultSyncLobbies: publicProcedure.query(() => {
        const db = getDb();
        return db.query.resultSyncQueue.findMany({
            orderBy: [asc(resultSyncQueue.createdAt)],
        });
    }),

    removeResultSyncLobby: publicProcedure
        .input(z.object({ lobbyId: z.string().min(1) }))
        .mutation(async ({ input }) => {
            const db = getDb();
            return db.delete(resultSyncQueue).where(eq(resultSyncQueue.lobbyId, input.lobbyId)).returning();
        }),

    getHeroes: publicProcedure.query(() => {
        const db = getDb();
        return db.query.hero.findMany();
    }),

    abortInstallScan: publicProcedure.mutation(() => {
        return requestInstallScanAbort();
    }),

    updateHero: publicProcedure
        .input(z.object({
            id: z.string().min(1),
            name: z.string().trim().min(1),
            author: ZNullableText,
            description: ZNullableText,
        }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const existing = await db.query.hero.findFirst({
                where: eq(hero.id, input.id),
            });
            if (!existing) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Hero not found.",
                });
            }

            const trimmedName = input.name.trim();
            const conflict = await db.query.hero.findFirst({
                where: eq(hero.name, trimmedName),
            });
            if (conflict && conflict.id !== input.id) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Another hero already uses that name.",
                });
            }

            const [updated] = await db.update(hero).set({
                name: trimmedName,
                author: input.author?.trim() || null,
                description: input.description?.trim() || null,
                updatedAt: new Date(),
            }).where(eq(hero.id, input.id)).returning();
            return updated;
        }),

    deleteHero: publicProcedure
        .input(z.object({ id: z.string().min(1) }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const existing = await db.query.hero.findFirst({
                where: eq(hero.id, input.id),
                columns: { id: true },
            });
            if (!existing) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Hero not found.",
                });
            }

            await db.delete(hero).where(eq(hero.id, input.id));
            return { deleted: true };
        }),

    getHeroRounds: publicProcedure
        .input(z.object({ heroId: z.string() }))
        .query(({ input }) => {
            const db = getDb();
            return db.query.round.findMany({
                where: eq(round.heroId, input.heroId),
            });
        }),

    updateRound: publicProcedure
        .input(z.object({
            id: z.string().min(1),
            name: z.string().trim().min(1),
            author: ZNullableText,
            description: ZNullableText,
            bpm: z.number().finite().min(1).max(400).optional().nullable(),
            difficulty: z.number().int().min(1).max(5).optional().nullable(),
            startTime: z.number().int().min(0).optional().nullable(),
            endTime: z.number().int().min(0).optional().nullable(),
            type: ZRoundType,
        }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const existing = await db.query.round.findFirst({
                where: eq(round.id, input.id),
                columns: { id: true },
            });
            if (!existing) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Round not found.",
                });
            }

            const startTime = input.startTime ?? null;
            const endTime = input.endTime ?? null;
            if (startTime !== null && endTime !== null && endTime <= startTime) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Round end time must be greater than start time.",
                });
            }

            const [updated] = await db.update(round).set({
                name: input.name.trim(),
                author: input.author?.trim() || null,
                description: input.description?.trim() || null,
                bpm: input.bpm ?? null,
                difficulty: input.difficulty ?? null,
                startTime,
                endTime,
                type: input.type,
                updatedAt: new Date(),
            }).where(eq(round.id, input.id)).returning();
            return updated;
        }),

    deleteRound: publicProcedure
        .input(z.object({ id: z.string().min(1) }))
        .mutation(async ({ input }) => {
            const db = getDb();
            const existing = await db.query.round.findFirst({
                where: eq(round.id, input.id),
                columns: { id: true },
            });
            if (!existing) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Round not found.",
                });
            }

            await db.delete(round).where(eq(round.id, input.id));
            return { deleted: true };
        }),

    getResource: publicProcedure
        .input(z.object({ roundId: z.string() }))
        .query(async ({ input }) => {
            const disabledRoundIds = getDisabledRoundIdSet();
            if (disabledRoundIds.has(input.roundId)) {
                return null;
            }

            const db = getDb();
            const firstResource = await db.query.resource.findFirst({
                where: (r, { and, eq }) => and(eq(r.roundId, input.roundId), eq(r.disabled, false)),
            });

            if (!firstResource) return null;
            return {
                ...firstResource,
                ...resolveResourceUris({
                    videoUri: firstResource.videoUri,
                    funscriptUri: firstResource.funscriptUri,
                }),
            };
        }),

    getResources: publicProcedure.query(async () => {
        const disabledRoundIds = [...getDisabledRoundIdSet()];
        const db = getDb();

        const resources = await db.query.resource.findMany({
            where: (r, { and, eq, notInArray }) => {
                if (disabledRoundIds.length > 0) {
                    return and(eq(r.disabled, false), notInArray(r.roundId, disabledRoundIds));
                }
                return eq(r.disabled, false);
            },
            limit: 5,
        });

        return resources.map((r) => ({
            ...r,
            ...resolveResourceUris({
                videoUri: r.videoUri,
                funscriptUri: r.funscriptUri,
            }),
        }));
    }),

    getInstalledRounds: publicProcedure
        .input(z.object({ includeDisabled: z.boolean().optional() }).optional())
        .query(async ({ input }) => {
            const db = getDb();
            const includeDisabled = input?.includeDisabled ?? false;
            const disabledRoundIds = getDisabledRoundIdSet();

            const rounds = await db.query.round.findMany({
                with: {
                    hero: true,
                    resources: includeDisabled ? true : {
                        where: (r, { eq }) => eq(r.disabled, false)
                    },
                },
                orderBy: [desc(round.createdAt)]
            });

            const filteredRounds = rounds.filter((r) => {
                if (!includeDisabled) {
                    if (disabledRoundIds.has(r.id)) return false;
                    if (r.resources.length === 0) return false;
                }
                return true;
            });

            return filteredRounds.map((r) => ({
                ...r,
                resources: r.resources.map((res) => ({
                    ...res,
                    ...resolveResourceUris({
                        videoUri: res.videoUri,
                        funscriptUri: res.funscriptUri,
                    }),
                })),
            }));
        }),

    getDisabledRoundIds: publicProcedure.query(async () => {
        const db = getDb();
        const fromStore = getDisabledRoundIdSet();

        // Find rounds where all resources are disabled and it has at least one resource
        const roundsWithResources = await db.query.round.findMany({
            with: { resources: true }
        });

        for (const r of roundsWithResources) {
            if (r.resources.length > 0 && r.resources.every(res => res.disabled)) {
                fromStore.add(r.id);
            }
        }

        return [...fromStore];
    }),

    getInstallScanStatus: publicProcedure.query(() => {
        return getInstallScanStatus();
    }),

    inspectInstallFolder: publicProcedure
        .input(z.object({
            folderPath: z.string().min(1),
        }))
        .query(async ({ input }) => {
            try {
                return await inspectInstallFolder(input.folderPath);
            } catch (error) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: error instanceof Error ? error.message : "Failed to inspect selected folder.",
                });
            }
        }),

    scanInstallSources: publicProcedure.mutation(async () => {
        return scanInstallSources("manual");
    }),

    scanInstallFolderOnce: publicProcedure
        .input(z.object({
            folderPath: z.string().min(1),
            omitCheckpointRounds: z.boolean().optional(),
        }))
        .mutation(async ({ input }) => {
            try {
                return await scanInstallFolderOnceWithLegacySupport(input.folderPath, {
                    omitCheckpointRounds: input.omitCheckpointRounds ?? true,
                });
            } catch (error) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: error instanceof Error ? error.message : "Failed to install from selected folder.",
                });
            }
        }),

    importInstallSidecarFile: publicProcedure
        .input(z.object({
            filePath: z.string().min(1),
        }))
        .mutation(async ({ input }) => {
            try {
                return await importInstallSidecarFile(input.filePath);
            } catch (error) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: error instanceof Error ? error.message : "Failed to import selected sidecar file.",
                });
            }
        }),

    importLegacyFolderWithPlan: publicProcedure
        .input(z.object({
            folderPath: z.string().min(1),
            reviewedSlots: z.array(z.object({
                id: z.string().min(1),
                sourcePath: z.string().min(1),
                originalOrder: z.number().int().min(0),
                selectedAsCheckpoint: z.boolean(),
                excludedFromImport: z.boolean(),
            })),
        }))
        .mutation(async ({ input }) => {
            try {
                return await importLegacyFolderWithPlan(input.folderPath, input.reviewedSlots);
            } catch (error) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: error instanceof Error ? error.message : "Failed to import reviewed legacy folder.",
                });
            }
        }),

    getAutoScanFolders: publicProcedure.query(() => {
        return getAutoScanFolders();
    }),

    addAutoScanFolder: publicProcedure
        .input(z.object({ folderPath: z.string().min(1) }))
        .mutation(async ({ input }) => {
            try {
                return await addAutoScanFolder(input.folderPath);
            } catch (error) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: error instanceof Error ? error.message : "Failed to add auto-scan folder.",
                });
            }
        }),

    removeAutoScanFolder: publicProcedure
        .input(z.object({ folderPath: z.string().min(1) }))
        .mutation(({ input }) => {
            return removeAutoScanFolder(input.folderPath);
        }),

    exportInstalledDatabase: publicProcedure
        .input(z.object({ includeResourceUris: z.boolean().optional() }).optional())
        .mutation(async ({ input }) => {
            try {
                return await exportInstalledDatabase({
                    includeResourceUris: input?.includeResourceUris ?? false,
                });
            } catch (error) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: error instanceof Error ? error.message : "Failed to export installed database.",
                });
            }
        }),

    openInstallExportFolder: publicProcedure.mutation(async () => {
        const exportBaseDir = getInstallExportBaseDir();
        await fs.mkdir(exportBaseDir, { recursive: true });
        const openError = await shell.openPath(exportBaseDir);
        if (openError) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: openError,
            });
        }
        return { path: exportBaseDir };
    }),

    clearAllData: publicProcedure.mutation(async () => {
        const db = getDb();

        await db.transaction(async (tx) => {
            await tx.delete(playlistTrackPlay);
            await tx.delete(resource);
            await tx.delete(round);
            await tx.delete(hero);
            await tx.delete(playlist);
            await tx.delete(singlePlayerRunHistory);
            await tx.delete(multiplayerMatchCache);
            await tx.delete(resultSyncQueue);
            await tx.delete(gameProfile);
        });

        getStore().clear();
        return { cleared: true };
    }),

    convertHeroGroupToRound: publicProcedure
        .input(
            z.object({
                keepRoundId: z.string().min(1),
                roundIds: z.array(z.string().min(1)).min(1),
                heroId: z.string().min(1).optional().nullable(),
                roundName: z.string().trim().min(1),
            }),
        )
        .mutation(async ({ input }) => {
            if (!input.roundIds.includes(input.keepRoundId)) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "The selected round to keep must be part of the hero group.",
                });
            }

            const db = getDb();

            return db.transaction(async (tx) => {
                const rounds = await tx.query.round.findMany({
                    where: inArray(round.id, input.roundIds),
                    columns: { id: true, heroId: true },
                });
                if (rounds.length !== input.roundIds.length) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "Some rounds in this hero group could not be found.",
                    });
                }

                const roundById = new Map(rounds.map((r) => [r.id, r]));
                const keepRound = roundById.get(input.keepRoundId);
                if (!keepRound) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "The selected round to keep no longer exists.",
                    });
                }

                const keepRoundHeroId = keepRound.heroId ?? null;
                const targetHeroId = input.heroId ?? keepRoundHeroId;
                if (input.heroId && keepRoundHeroId !== input.heroId) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "The selected round does not belong to the provided hero.",
                    });
                }

                const deleteRoundIds = input.roundIds.filter((id) => id !== input.keepRoundId);
                if (deleteRoundIds.length > 0) {
                    await tx.delete(resource).where(inArray(resource.roundId, deleteRoundIds));
                    await tx.delete(round).where(inArray(round.id, deleteRoundIds));
                }

                await tx.update(round).set({
                    heroId: null,
                    name: input.roundName,
                    startTime: null,
                    endTime: null,
                }).where(eq(round.id, input.keepRoundId));

                let deletedHero = false;
                if (targetHeroId) {
                    // count properly
                    const groupRemaining = await tx.select({ id: round.id }).from(round).where(eq(round.heroId, targetHeroId));
                    if (groupRemaining.length === 0) {
                        await tx.delete(hero).where(eq(hero.id, targetHeroId));
                        deletedHero = true;
                    }
                }

                return {
                    keptRoundId: input.keepRoundId,
                    removedRoundCount: deleteRoundIds.length,
                    deletedHero,
                };
            });
        }),
});
