/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setQuestRuntime } from "../questState";
import { runAchievementBypass } from "../utils/achievement";
import { Cancelled } from "../utils/questControl";
import { QuestHandler } from "./types";

/**
 * Activity achievement quests, and only when the bypass setting is on.
 *
 * Nothing is spoofed here and there is no progress to watch: the whole task is one authorization
 * and one report, so it either works or it says why. `resolveRunnableTask` decides whether this
 * handler is reachable at all, so by the time it runs the setting has already been checked.
 */
export const achievementHandler: QuestHandler = {
    supports(taskName: string) {
        return taskName === "ACHIEVEMENT_IN_ACTIVITY";
    },

    handle({ quest, questName, taskName, secondsNeeded, applicationId, RestAPI, completingQuest, controller, onQuestComplete }) {
        setQuestRuntime(quest.id, { name: questName, taskName, status: "running", value: 0, target: secondsNeeded, why: "authorizing" });

        const run = async () => {
            await controller.gate();

            // The target for these is a milestone count rather than seconds, and it is what the
            // activity backend is told.
            const result = await runAchievementBypass(quest, applicationId, secondsNeeded, RestAPI);

            if (result.ok) {
                setQuestRuntime(quest.id, { value: secondsNeeded, target: secondsNeeded, why: undefined });
                onQuestComplete();
                return;
            }

            setQuestRuntime(quest.id, { status: "skipped", why: result.reason ?? "bypass failed" });
            completingQuest.set(quest.id, false);
        };

        run().catch(err => {
            if (err instanceof Cancelled) {
                completingQuest.set(quest.id, false);
                return;
            }
            console.error("[QuestMaster] Achievement quest failed:", questName, err);
            setQuestRuntime(quest.id, { status: "skipped", why: "achievement quest failed" });
            completingQuest.set(quest.id, false);
        });
    },
};
