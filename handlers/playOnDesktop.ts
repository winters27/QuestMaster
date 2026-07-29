/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HEARTBEAT_GRACE_MS, readTaskProgress } from "../utils/quest";
import { callWithRetry } from "../utils/retry";
import { QuestHandler } from "./types";

// Overriding getRunningGames alone is no longer enough. Newer builds decide quest eligibility
// from the "visible" and "candidate" views too, and a game missing from those never gets a
// heartbeat scheduled. Older builds do not expose all of them, so each is patched only where
// it already exists.
const PATCHED_METHODS = [
    "getRunningGames",
    "getGameForPID",
    "getVisibleGame",
    "getVisibleRunningGames",
    "getRunningDiscordApplicationIds",
    "getCandidateGames",
];

export const playOnDesktopHandler: QuestHandler = {
    supports(taskName: string) {
        return taskName === "PLAY_ON_DESKTOP";
    },

    handle({ quest, questName, taskName, secondsNeeded, secondsDone, applicationId, applicationName, pid, isApp, RestAPI, FluxDispatcher, RunningGameStore, completingQuest, configVersion, onQuestComplete }) {
        if (!isApp) {
            console.log("This no longer works in browser for non-video quests. Use the discord desktop app to complete the", questName, "quest!");
            return;
        }

        callWithRetry(() => RestAPI.get({ url: `/applications/public?application_ids=${applicationId}` }), { label: "applications/public" }).then(res => {
            const appData = (res as any).body[0];
            const exeName = (appData.executables?.find(x => x.os === "win32")?.name?.replace(">", "")) ?? appData.name.replace(/[/\\:*?"<>|]/g, "");

            const fakeGame = {
                cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
                exeName,
                exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
                hidden: false,
                isLauncher: false,
                id: applicationId,
                name: appData.name,
                pid: pid,
                pidPath: [pid],
                processName: appData.name,
                start: Date.now(),
            };

            const realGames = RunningGameStore.getRunningGames();
            const fakeGames = [fakeGame];

            const realMethods: Record<string, any> = {};
            for (const name of PATCHED_METHODS) {
                if (typeof RunningGameStore[name] === "function") realMethods[name] = RunningGameStore[name];
            }

            RunningGameStore.getRunningGames = () => fakeGames;
            RunningGameStore.getGameForPID = (pidValue: number) => fakeGames.find(x => x.pid === pidValue);
            if (realMethods.getVisibleGame) RunningGameStore.getVisibleGame = () => fakeGame;
            if (realMethods.getVisibleRunningGames) RunningGameStore.getVisibleRunningGames = () => fakeGames;
            if (realMethods.getCandidateGames) RunningGameStore.getCandidateGames = () => fakeGames;
            if (realMethods.getRunningDiscordApplicationIds) {
                RunningGameStore.getRunningDiscordApplicationIds = () => {
                    // The collection type varies by build, so match whatever the real one returns.
                    const real = realMethods.getRunningDiscordApplicationIds.call(RunningGameStore);
                    return real instanceof Set ? new Set([String(applicationId)]) : [String(applicationId)];
                };
            }

            FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: realGames, added: [fakeGame], games: fakeGames });

            let cleaned = false;
            let beats = 0;
            let watchdog: ReturnType<typeof setTimeout> | undefined;

            const unsubscribe = () => {
                try {
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
                } catch {

                }
            };

            const cleanup = (completed: boolean) => {
                if (cleaned) return;
                cleaned = true;

                clearTimeout(watchdog);
                for (const [name, fn] of Object.entries(realMethods)) RunningGameStore[name] = fn;
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: [] });

                unsubscribe();

                if (completed) {
                    console.log("Quest completed!");
                    onQuestComplete();
                } else {
                    completingQuest.set(quest.id, false);
                }
            };

            // Discord sends the heartbeat itself while it believes the game is running, so if
            // it never accepts the spoofed process nothing arrives and the quest would sit at
            // 0% in silence. Re-armed on every beat so a task that stops partway is caught too.
            const armWatchdog = () => {
                clearTimeout(watchdog);
                watchdog = setTimeout(() => {
                    console.error(beats === 0
                        ? `[QuestMaster] Discord never sent a heartbeat for "${questName}". It is not accepting the spoofed game on this client, so there is nothing to wait for.`
                        : `[QuestMaster] Discord stopped sending heartbeats for "${questName}" after ${beats}. Giving up.`);
                    cleanup(false);
                }, HEARTBEAT_GRACE_MS);
            };

            const onHeartbeat = (data: any) => {
                if (data.questId !== quest.id) return;

                if (!completingQuest.get(quest.id)) {
                    console.log("Stopping completing quest:", questName);
                    cleanup(false);
                    return;
                }

                beats++;
                armWatchdog();

                const progress = readTaskProgress(data.userStatus, taskName, configVersion);

                console.log(`Quest progress: ${progress}/${secondsNeeded}`);

                if (progress >= secondsNeeded) {
                    cleanup(true);
                }
            };

            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
            armWatchdog();

            console.log(`Spoofed your game to ${applicationName ?? appData.name}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
        }).catch(err => {
            console.error("Failed to fetch application data for quest", questName, err);
            completingQuest.set(quest.id, false);
        });
    }
};
