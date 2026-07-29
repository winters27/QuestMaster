/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./QuestButton.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import {
    findByCodeLazy,
    findComponentByCodeLazy,
} from "@webpack";
import { NavigationRouter, Tooltip, useEffect, useState } from "@webpack/common";

import { toggleQuestPanel } from "../questState";
import settings from "../settings";
import { QuestsStore } from "../stores";

const QuestIcon = findByCodeLazy('"M7.5 21.7a8.95');
const TopBarButton = findComponentByCodeLazy("badgePosition");
const SettingsBarButton = findComponentByCodeLazy("iconForeground:");
const CountBadge = findComponentByCodeLazy('"renderBadgeCount"');

function questsStatus() {
    const availableQuests = [...QuestsStore.quests.values()];
    return availableQuests.reduce(
        (acc, x) => {
            if (x.id === "1248385850622869556") return acc;
            else if (new Date(x.config.expiresAt).getTime() < Date.now()) {
                acc.expired++;
            } else if (x.userStatus?.claimedAt) {
                acc.claimed++;
            } else if (x.userStatus?.completedAt) {
                acc.claimable++;
            } else if (x.userStatus?.enrolledAt) {
                acc.enrolled++;
            } else {
                acc.enrollable++;
            }
            return acc;
        },
        { enrollable: 0, enrolled: 0, claimable: 0, claimed: 0, expired: 0 }
    );
}

// CountBadge is one of Discord's own components, found by code. That finder went stale once
// already, and it renders inside Discord's element tree, so an unguarded throw here takes the
// surrounding UI with it. Losing the badge is an acceptable degradation; losing the tree is not.
export const QuestsCount = ErrorBoundary.wrap(function QuestsCountInner() {
    const [status, setStatus] = useState(questsStatus());

    const checkForNewQuests = () => {
        setStatus(questsStatus());
    };

    useEffect(() => {
        QuestsStore.addChangeListener(checkForNewQuests);
        return () => {
            QuestsStore.removeChangeListener(checkForNewQuests);
        };
    }, []);

    return (
        <Flex
            flexDirection={"row"}
            justifyContent={"flex-end"}
            className={"quest-button-badges"}
        >
            {status.enrollable > 0 && (
                <Tooltip text={"Enrollable"}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <CountBadge
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            count={status.enrollable}
                            color={"var(--status-danger)"}
                        />
                    )}
                </Tooltip>
            )}
            {status.enrolled > 0 && (
                <Tooltip text={"Enrolled"}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <CountBadge
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            count={status.enrolled}
                            color={"var(--status-warning)"}
                        />
                    )}
                </Tooltip>
            )}
            {status.claimable > 0 && (
                <Tooltip text={"Claimable"}>
                    {({ onMouseEnter, onMouseLeave }) => (
                        <CountBadge
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            count={status.claimable}
                            color={"var(--status-positive)"}
                        />
                    )}
                </Tooltip>
            )}
        </Flex>
    );
}, { noop: true });

export function QuestButton({ type }: { type: "top-bar" | "settings-bar"; }) {
    const [state, setState] = useState(questsStatus());

    const checkForNewQuests = () => {
        setState(questsStatus());
    };

    useEffect(() => {
        QuestsStore.addChangeListener(checkForNewQuests);
        return () => {
            QuestsStore.removeChangeListener(checkForNewQuests);
        };
    }, []);

    const className = state.enrollable
        ? "quest-button-enrollable"
        : state.enrolled
            ? "quest-button-enrolled"
            : state.claimable
                ? "quest-button-claimable"
                : "";
    const tooltip = state.enrollable
        ? `${state.enrollable} Enrollable Quests`
        : state.enrolled
            ? `${state.enrolled} Enrolled Quests`
            : state.claimable
                ? `${state.claimable} Claimable Quests`
                : "Quests";

    // The panel is the more useful landing spot, but Discord's own page is one setting away.
    const opensPanel = (settings.store.questButtonAction ?? "panel") === "panel";
    const onClick = opensPanel ? toggleQuestPanel : () => NavigationRouter.transitionTo("/quest-home");
    const disabled = false;
    if (type === "top-bar") {
        return (
            <TopBarButton
                className={className}
                iconClassName={undefined}
                disabled={disabled}
                showBadge={
                    state.enrollable > 0 || state.enrolled > 0 || state.claimable > 0
                }
                badgePosition={"bottom"}
                icon={QuestIcon}
                iconSize={20}
                onClick={onClick}
                onContextMenu={undefined}
                tooltip={tooltip}
                tooltipPosition={"bottom"}
                hideOnClick={false}
            />
        );
    } else if (type === "settings-bar") {
        return (
            <SettingsBarButton
                tooltipText={tooltip}
                onContextMenu={undefined}
                onClick={onClick}
                disabled={disabled}
                icon={undefined}
                className={"quest-button"}
            >
                <TopBarButton
                    className={className}
                    iconClassName={undefined}
                    disabled={disabled}
                    showBadge={
                        state.enrollable > 0 || state.enrolled > 0 || state.claimable > 0
                    }
                    badgePosition={"bottom"}
                    icon={QuestIcon}
                    iconSize={20}
                    onClick={onClick}
                    onContextMenu={undefined}
                    tooltip={tooltip}
                    tooltipPosition={"bottom"}
                    hideOnClick={false}
                />
            </SettingsBarButton>
        );
    }
}
