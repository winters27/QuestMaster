/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setQuestRuntime } from "../questState";
import { Cancelled } from "../utils/questControl";
import { callWithRetry } from "../utils/retry";
import { QuestHandler } from "./types";

const videoTasks = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE"] as const;

export const videoHandler: QuestHandler = {
    supports(taskName: string) {
        return videoTasks.includes(taskName as (typeof videoTasks)[number]);
    },

    async handle({ quest, questName, secondsNeeded, secondsDone, completingQuest, controller, RestAPI, getSpoofingProfile, onQuestComplete }) {
        const { maxFuture, speed, interval } = getSpoofingProfile().video;
        const enrolledAt = new Date(quest.userStatus.enrolledAt).getTime();
        let completed = false;
        let reachedTarget = false;

        const watchVideo = async () => {
            while (true) {
                await controller.gate();

                const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
                const diff = maxAllowed - secondsDone;
                const timestamp = secondsDone + speed;

                if (!completingQuest.get(quest.id)) {
                    console.log("Stopping completing quest:", questName);
                    completingQuest.set(quest.id, false);
                    break;
                }

                if (diff >= speed) {
                    try {
                        const res = await callWithRetry(() => RestAPI.post({
                            url: `/quests/${quest.id}/video-progress`,
                            body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) }
                        }), { label: "video-progress" });
                        completed = (res as any).body.completed_at != null;
                        if (completed) {
                            reachedTarget = true;
                            break;
                        }
                        secondsDone = Math.min(secondsNeeded, timestamp);
                        setQuestRuntime(quest.id, { value: Math.floor(secondsDone), target: secondsNeeded });
                    } catch (err) {
                        console.error("Video progress failed after retries, stopping quest:", questName, err);
                        setQuestRuntime(quest.id, { status: "skipped", why: "video progress failed" });
                        completingQuest.set(quest.id, false);
                        break;
                    }
                }

                if (timestamp >= secondsNeeded) {
                    reachedTarget = true;
                    break;
                }
                await controller.sleep(interval * 1000);
            }
            if (reachedTarget && !completed) {
                try {
                    await callWithRetry(() => RestAPI.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } }), { label: "video-progress-final" });
                } catch (err) {
                    console.error("Final video progress failed after retries for quest:", questName, err);
                }
            }
            if (reachedTarget || completed) {
                console.log("Quest completed!");
                onQuestComplete();
            }
        };

        watchVideo().catch(err => {
            // A stop is the expected way out of the loop, not something to report as a failure.
            if (err instanceof Cancelled) {
                completingQuest.set(quest.id, false);
                return;
            }
            console.error("[QuestMaster] Video quest failed:", questName, err);
            setQuestRuntime(quest.id, { status: "skipped", why: "video quest failed" });
            completingQuest.set(quest.id, false);
        });
        console.log(`Spoofing video for ${questName}.`);
    }
};
