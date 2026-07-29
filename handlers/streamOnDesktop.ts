/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setQuestRuntime } from "../questState";
import { ApplicationStreamingStore } from "../stores";
import { HEARTBEAT_GRACE_MS, readTaskProgress } from "../utils/quest";
import { QuestHandler } from "./types";

export const streamOnDesktopHandler: QuestHandler = {
    supports(taskName: string) {
        return taskName === "STREAM_ON_DESKTOP";
    },

    handle({ quest, questName, taskName, secondsNeeded, secondsDone, applicationId, applicationName, pid, configVersion, FluxDispatcher, completingQuest, onQuestComplete }) {
        const realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

        ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
            id: applicationId,
            pid,
            sourceName: null
        });

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
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
            unsubscribe();

            if (completed) {
                console.log("Quest completed!");
                onQuestComplete();
            } else {
                completingQuest.set(quest.id, false);
            }
        };

        // Unlike the game quest, this one waits on the user to start streaming in a call, which
        // has no time limit. So the watchdog only arms once heartbeats have started: it catches
        // a stream that stalls, and never punishes someone slow to set up.
        const armWatchdog = () => {
            clearTimeout(watchdog);
            watchdog = setTimeout(() => {
                console.error(`[QuestMaster] Discord stopped sending heartbeats for "${questName}" after ${beats}. Check you are still streaming with someone else in the call.`);
                setQuestRuntime(quest.id, { status: "skipped", why: "stream heartbeats stopped" });
                cleanup(false);
            }, HEARTBEAT_GRACE_MS);
        };

        const onHeartbeat = (event: any) => {
            if (event.questId !== quest.id) return;

            if (!completingQuest.get(quest.id)) {
                console.log("Stopping completing quest:", questName);
                cleanup(false);
                return;
            }

            beats++;
            armWatchdog();

            const progress = readTaskProgress(event.userStatus, taskName, configVersion);
            setQuestRuntime(quest.id, { value: progress, target: secondsNeeded });

            console.log(`Quest progress: ${progress}/${secondsNeeded}`);

            if (progress >= secondsNeeded) {
                cleanup(true);
            }
        };

        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", onHeartbeat);

        console.log(`Spoofed your stream to ${applicationName ?? "the quest game"}. Stream any window in vc for ${Math.ceil((secondsNeeded - secondsDone) / 60)} more minutes.`);
        console.log("Remember that you need at least 1 other person to be in the vc!");
    }
};
