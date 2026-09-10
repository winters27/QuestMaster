/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

/**
 * The panel's own hover labels.
 *
 * Discord's Tooltip is resolved by a webpack filter, and when that filter stops matching, Vencord
 * quietly substitutes a fallback whose mouse handlers do nothing. There is no error and no warning;
 * the buttons simply stop explaining themselves. This plugin has already lost three Discord lookups
 * that way, and a panel of unlabelled icons is worse than no panel.
 *
 * So the label is drawn here, in the same React root as the panel, out of the same stylesheet. It
 * cannot be taken away by a Discord update and it cannot lose a stacking fight with the panel it
 * belongs to.
 */

interface HintState {
    text: string;
    /** Centre of the target, in viewport coordinates. */
    x: number;
    /** Top edge of the target. */
    y: number;
    /** Bottom edge, used when there is no room above. */
    bottom: number;
}

const listeners = new Set<() => void>();
let current: HintState | null = null;

function emit() {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch (err) {
            console.error("[QuestMaster] Hint listener failed:", err);
        }
    }
}

function show(text: string, target: Element) {
    const rect = target.getBoundingClientRect();
    current = { text, x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom };
    emit();
}

export function hideHint() {
    if (current === null) return;
    current = null;
    emit();
}

export interface HintProps {
    onMouseEnter(event: React.MouseEvent): void;
    onMouseLeave(): void;
    onFocus(event: React.FocusEvent): void;
    onBlur(): void;
}

export function hintProps(text: string): HintProps {
    return {
        onMouseEnter: event => show(text, event.currentTarget),
        onMouseLeave: hideHint,
        onFocus: event => show(text, event.currentTarget),
        onBlur: hideHint,
    };
}

/** Same shape as the component it replaces, so wrapping a button reads the same way. */
export function Hint({ text, children }: { text: string; children(props: HintProps): React.ReactNode; }) {
    return <>{children(hintProps(text))}</>;
}

const GAP = 6;
const MARGIN = 8;
const ESTIMATED_WIDTH = 160;

export function PanelHintLayer() {
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const rerender = () => forceUpdate(n => n + 1);
        listeners.add(rerender);

        // A button that disappears under the cursor never fires mouseleave, and clicking one of
        // these usually replaces it: Pause becomes Resume, Run now starts the quest and the row
        // moves. Without this the label would sit there describing a button that is gone.
        const clear = () => hideHint();
        document.addEventListener("click", clear, true);
        window.addEventListener("resize", clear);

        return () => {
            listeners.delete(rerender);
            document.removeEventListener("click", clear, true);
            window.removeEventListener("resize", clear);
        };
    }, []);

    if (!current) return null;

    // Above by default, below when the target is too near the top of the window.
    const above = current.y > 40;
    const half = ESTIMATED_WIDTH / 2;
    const x = Math.min(Math.max(current.x, half + MARGIN), window.innerWidth - half - MARGIN);

    return (
        <div
            className={`qm-hint${above ? "" : " qm-hint-below"}`}
            style={above
                ? { left: `${x}px`, top: `${current.y - GAP}px` }
                : { left: `${x}px`, top: `${current.bottom + GAP}px` }}
        >
            {current.text}
        </div>
    );
}
