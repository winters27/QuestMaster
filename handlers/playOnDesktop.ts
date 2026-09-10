/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setQuestRuntime } from "../questState";
import { addSpoofedGame, getAllGames, removeSpoofedGame } from "../utils/gameSpoof";
import { describeHeartbeatError, HeartbeatWatchdog } from "../utils/heartbeat";
import { readTaskProgress } from "../utils/quest";
import { callWithRetry } from "../utils/retry";
import { QuestHandler } from "./types";

export const playOnDesktopHandler: QuestHandler = {
    supports(taskName: string) {
        return taskName === "PLAY_ON_DESKTOP";
    },

    handle({ quest, questName, taskName, secondsNeeded, secondsDone, applicationId, applicationName, pid, isApp, RestAPI, FluxDispatcher, RunningGameStore, completingQuest, controller, configVersion, onQuestComplete }) {
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

            let spoofing = false;
            const startSpoof = () => {
                if (spoofing) return;
                spoofing = true;
                addSpoofedGame(RunningGameStore, quest.id, fakeGame);
                // Nothing is removed: the spoof adds to what is really running rather than
                // standing in for it, so the payload has to describe the whole set.
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [], added: [fakeGame], games: getAllGames() });
            };
            const stopSpoof = () => {
                if (!spoofing) return;
                spoofing = false;
                removeSpoofedGame(quest.id);
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: getAllGames() });
            };

            let cleaned = false;

            const watchdog = new HeartbeatWatchdog({
                questName,
                onGiveUp: verdict => {
                    console.error(verdict.message);
                    setQuestRuntime(quest.id, { status: "skipped", why: verdict.reason });
                    cleanup(false);
                },
            });

            const unsubscribe = () => {
                try {
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_FAILURE", onHeartbeatFailure);
                } catch {

                }
            };

            const cleanup = (completed: boolean) => {
                if (cleaned) return;
                cleaned = true;

                watchdog.stop();
                stopSpoof();
                unsubscribe();

                if (completed) {
                    console.log("Quest completed!");
                    onQuestComplete();
                } else {
                    completingQuest.set(quest.id, false);
                }
            };

            const onHeartbeat = (data: any) => {
                if (data.questId !== quest.id) return;

                if (!completingQuest.get(quest.id)) {
                    console.log("Stopping completing quest:", questName);
                    cleanup(false);
                    return;
                }

                watchdog.beat();

                const progress = readTaskProgress(data.userStatus, taskName, configVersion);
                setQuestRuntime(quest.id, { value: progress, target: secondsNeeded });

                console.log(`Quest progress: ${progress}/${secondsNeeded}`);

                if (progress >= secondsNeeded) {
                    cleanup(true);
                }
            };

            // A beat Discord tried and failed is not the same as Discord going quiet, and it does
            // not resend one: the next attempt is the tick already scheduled.
            const onHeartbeatFailure = (data: any) => {
                if (data?.questId !== quest.id) return;
                watchdog.fail(describeHeartbeatError(data));
            };

            // Pausing has to drop the spoof, not just stop reading. While the fake game is still
            // in the store Discord keeps crediting time, so a pause that only looked away would
            // pause nothing. Dropping it also means the watchdog has to stand down, since the
            // heartbeats stopping is the intended result rather than a fault.
            controller.onPause = () => {
                watchdog.stop();
                stopSpoof();
            };
            controller.onResume = () => {
                startSpoof();
                watchdog.start();
            };
            controller.onCancel = () => cleanup(false);

            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);
            FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_FAILURE", onHeartbeatFailure);

            // Starting a quest that is already paused must not spoof at all, rather than spoof
            // and immediately take it back.
            if (!controller.paused) {
                startSpoof();
                watchdog.start();
            }

            console.log(`Spoofed your game to ${applicationName ?? appData.name}. Wait for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
        }).catch(err => {
            console.error("Failed to fetch application data for quest", questName, err);
            completingQuest.set(quest.id, false);
        });
    }
};
