import.meta.url = "file:///Users/kentaylor/.pi/agent/git/github.com/ktappdev/pi-fusion/src/ui.ts";
import { DynamicBorder, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, Key, matchesKey, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { MAX_PANEL_MODELS_HARD_LIMIT, THINKING_LEVELS } from "./config.ts";
import { modelDisplay } from "./models.ts";
import { clampMaxToolCalls, isMutatingSelection } from "./tools.ts";
const TOOL_MODE_CYCLE = [
    "none",
    "readonly",
    "all"
];
const FOOTER_DISPLAY_CYCLE = [
    "full",
    "compact",
    "off"
];
const SAVE_TARGET_CYCLE = [
    "session",
    "global",
    "project"
];
const MAX_CALLS_PRESETS = [
    4,
    8,
    12,
    16,
    25,
    50,
    100
];
const REASONING_CYCLE = [
    "default",
    ...THINKING_LEVELS
];
export function applySetupProfile(state, profileName) {
    const profile = state.profiles?.[profileName];
    if (!profile) return;
    state.selectedIds = new Set(profile.selectedIds);
    state.judgeId = profile.judgeId;
    state.panelReasoning = profile.panelReasoning;
    state.judgeReasoning = profile.judgeReasoning;
    state.profileName = profileName;
}
export function markSetupCustom(state) {
    state.profileName = undefined;
}
function toModelInfo(available) {
    return available.map((m)=>({
            identifier: modelDisplay(m),
            provider: m.provider,
            name: m.name
        }));
}
function filterModels(models, query) {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return models;
    return models.filter((m)=>m.name.toLowerCase().includes(trimmed) || m.provider.toLowerCase().includes(trimmed) || m.identifier.toLowerCase().includes(trimmed));
}
export function togglePanelMember(selectedIds, id, max = MAX_PANEL_MODELS_HARD_LIMIT) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
        next.delete(id);
    } else if (next.size < max) {
        next.add(id);
    }
    return next;
}
export function toggleJudgeSelection(judgeId, id) {
    return judgeId === id ? undefined : id;
}
function setSelectListItems(list, items) {
    const internal = list;
    if (!Array.isArray(internal.items) || !Array.isArray(internal.filteredItems)) {
        throw new Error("pi-tui SelectList internals changed; it now needs a public setItems() (see docs/pi-api-notes.md)");
    }
    internal.items = items;
    internal.filteredItems = [
        ...items
    ];
}
export function modelBadges(isPanel, isJudge) {
    const parts = [];
    if (isPanel) parts.push("● panel");
    if (isJudge) parts.push("◆ judge");
    return parts.join("  ");
}
export async function selectFusionSetup(ctx, available, initial) {
    if (!ctx.hasUI) return null;
    const models = toModelInfo(available);
    const nameById = new Map(models.map((m)=>[
            m.identifier,
            m.name
        ]));
    const state = {
        selectedIds: new Set(initial.selectedIds),
        judgeId: initial.judgeId,
        profileName: initial.profileName,
        profiles: initial.profiles,
        panelReasoning: initial.panelReasoning,
        judgeReasoning: initial.judgeReasoning,
        enabled: initial.enabled ?? false,
        panelTools: initial.panelTools ?? "none",
        maxToolCalls: clampMaxToolCalls(initial.maxToolCalls),
        toolsConsented: initial.toolsConsented ?? false,
        footerDisplay: initial.footerDisplay ?? "full",
        saveTarget: initial.saveTarget ?? "session"
    };
    const configRows = [];
    const profileNames = Object.keys(state.profiles ?? {}).sort();
    if (profileNames.length > 0) {
        configRows.push({
            label: "Named panel",
            values: [
                "custom",
                ...profileNames
            ],
            get: ()=>state.profileName ?? "custom",
            set: (value)=>{
                if (value === "custom") markSetupCustom(state);
                else applySetupProfile(state, value);
            },
            note: ()=>"select a configured panel or keep a custom session snapshot"
        });
    }
    configRows.push({
        label: "Panel reasoning",
        values: [
            ...REASONING_CYCLE
        ],
        get: ()=>state.panelReasoning ?? "default",
        set: (value)=>{
            state.panelReasoning = value === "default" ? undefined : value;
            markSetupCustom(state);
        },
        note: ()=>"reasoning effort copied into this session snapshot"
    }, {
        label: "Judge reasoning",
        values: [
            ...REASONING_CYCLE
        ],
        get: ()=>state.judgeReasoning ?? "default",
        set: (value)=>{
            state.judgeReasoning = value === "default" ? undefined : value;
            markSetupCustom(state);
        },
        note: ()=>"judge reasoning effort copied into this session snapshot"
    }, {
        label: "Panel tools",
        values: TOOL_MODE_CYCLE,
        get: ()=>state.panelTools ?? "none",
        set: (v)=>{
            state.panelTools = v;
            if (!isMutatingSelection(state.panelTools)) state.toolsConsented = false;
        },
        note: ()=>isMutatingSelection(state.panelTools) ? "'all' adds bash/edit/write — you'll confirm on save; panel runs serialized" : state.panelTools === "readonly" ? "read/grep/find/ls — panel models can inspect the project" : "panel models answer in one turn, no tools"
    }, {
        label: "Max tool calls",
        values: MAX_CALLS_PRESETS.map(String),
        get: ()=>String(clampMaxToolCalls(state.maxToolCalls)),
        set: (v)=>{
            state.maxToolCalls = Number(v);
        },
        note: ()=>"max tool steps per panel model when tools are on"
    }, {
        label: "Fusion status",
        values: FOOTER_DISPLAY_CYCLE,
        get: ()=>state.footerDisplay ?? "full",
        set: (v)=>{
            state.footerDisplay = v;
        },
        note: ()=>state.footerDisplay === "off" ? "hide Fusion status" : state.footerDisplay === "compact" ? "show only fusion mode and panel count" : "show fusion mode, panel, judge, and tools"
    }, {
        label: "Save to",
        values: SAVE_TARGET_CYCLE,
        get: ()=>state.saveTarget ?? "session",
        set: (v)=>{
            state.saveTarget = v;
        },
        note: ()=>state.saveTarget === "project" ? "write .pi/fusion.json in this project (trusted projects only) — survives new sessions" : state.saveTarget === "global" ? "write ~/.pi/agent/fusion.json — applies to every project" : "save to this session only (restored on /resume, lost on /new)"
    });
    return ctx.ui.custom((tui, theme, _kb, done)=>{
        let focus = "models";
        let searching = false;
        let query = "";
        let configIndex = 0;
        const searchBuffer = new Input();
        const accent = (s)=>theme.fg("accent", s);
        const dim = (s)=>theme.fg("dim", s);
        const warn = (s)=>theme.fg("warning", s);
        const container = new Container();
        container.addChild(new DynamicBorder((s)=>accent(s)));
        container.addChild(new Text(accent(theme.bold("Fusion Setup"))));
        container.addChild(new Text(dim("Choose panel models (p) and a judge (j). Tab to Config.")));
        container.addChild(new Spacer(1));
        const panelLine = new Text("");
        const judgeLine = new Text("");
        container.addChild(panelLine);
        container.addChild(judgeLine);
        container.addChild(new Spacer(1));
        const modelsHeader = new Text("");
        const searchLine = new Text("");
        container.addChild(modelsHeader);
        container.addChild(searchLine);
        const providerWidth = Math.min(16, Math.max(8, ...models.map((m)=>m.provider.length)) + 2);
        const makeItems = (filtered)=>filtered.map((m)=>({
                    value: m.identifier,
                    label: `${m.provider.padEnd(providerWidth)}${m.name}`,
                    description: modelBadges(state.selectedIds.has(m.identifier), state.judgeId === m.identifier)
                }));
        const selectList = new SelectList(makeItems(models), Math.min(Math.max(models.length, 1), 10), getSelectListTheme(), {
            minPrimaryColumnWidth: providerWidth + 18,
            maxPrimaryColumnWidth: providerWidth + 40
        });
        container.addChild(selectList);
        container.addChild(new Spacer(1));
        const configHeader = new Text("");
        container.addChild(configHeader);
        const configTexts = configRows.map(()=>new Text(""));
        for (const t of configTexts)container.addChild(t);
        const hint = new Text("");
        container.addChild(hint);
        container.addChild(new DynamicBorder((s)=>accent(s)));
        function panelSummary() {
            const names = Array.from(state.selectedIds).map((id)=>nameById.get(id) ?? id);
            if (names.length === 0) return dim("Panel: ") + warn("none selected (press p)");
            const source = profileNames.length > 0 ? `, ${state.profileName ?? "custom"}` : "";
            return dim(`Panel (${names.length}${source}): `) + names.join(", ");
        }
        function judgeSummary() {
            const judge = state.judgeId ? (nameById.get(state.judgeId) ?? state.judgeId) : undefined;
            return dim("Judge: ") + (judge ?? dim("auto (first panel model)"));
        }
        function configRowText(i) {
            const row = configRows[i];
            const focused = focus === "config" && i === configIndex;
            const cursor = focused ? accent("› ") : "  ";
            const label = focused ? accent(row.label) : dim(row.label);
            const value = focused ? theme.bold(row.get()) : row.get();
            return `${cursor}${label}: ${value}`;
        }
        function currentHint() {
            if (focus === "models" && searching) {
                return dim("type to filter • ↑/↓ move • Enter/Esc done");
            }
            if (focus === "config") {
                const note = configRows[configIndex].note();
                return dim(`↑/↓ setting • Space/←→ change • Tab models • Enter save • Esc cancel${note ? "  —  " + note : ""}`);
            }
            return dim("↑/↓ move • p panel • j judge • / search • c clear • Tab config • Enter save • Esc cancel");
        }
        function refresh() {
            const prev = selectList.getSelectedItem()?.value;
            const items = makeItems(filterModels(models, query));
            setSelectListItems(selectList, items);
            const idx = prev ? items.findIndex((i)=>i.value === prev) : 0;
            selectList.setSelectedIndex(idx >= 0 ? idx : 0);
            panelLine.setText(panelSummary());
            judgeLine.setText(judgeSummary());
            modelsHeader.setText(focus === "models" ? accent("▸ Models") : dim("  Models"));
            configHeader.setText(focus === "config" ? accent("▸ Config") : dim("  Config"));
            searchLine.setText(searching ? dim("  search: ") + query + accent("▏") : query ? dim(`  filter: ${query}  (/ to edit)`) : dim("  / to search"));
            configTexts.forEach((t, i)=>t.setText(configRowText(i)));
            hint.setText(currentHint());
            selectList.invalidate();
            tui.requestRender();
        }
        function cycleConfig(dir) {
            const row = configRows[configIndex];
            const i = row.values.indexOf(row.get());
            const base = i < 0 ? 0 : i;
            row.set(row.values[(base + dir + row.values.length) % row.values.length]);
            refresh();
        }
        function confirm() {
            if (state.selectedIds.size === 0) {
                searching = false;
                hint.setText(warn("Select at least one panel model first (press p on a model)."));
                tui.requestRender();
                return;
            }
            done({
                selectedIds: new Set(state.selectedIds),
                judgeId: state.judgeId,
                profileName: state.profileName,
                profiles: state.profiles,
                panelReasoning: state.panelReasoning,
                judgeReasoning: state.judgeReasoning,
                enabled: state.enabled,
                panelTools: state.panelTools,
                maxToolCalls: state.maxToolCalls,
                toolsConsented: state.toolsConsented,
                footerDisplay: state.footerDisplay,
                saveTarget: state.saveTarget
            });
        }
        refresh();
        return {
            render (width) {
                return container.render(width);
            },
            invalidate () {
                container.invalidate();
            },
            handleInput (data) {
                if (focus === "models" && searching) {
                    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
                        searching = false;
                        refresh();
                        return;
                    }
                    if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
                        selectList.handleInput(data);
                        return;
                    }
                    const before = searchBuffer.getValue();
                    searchBuffer.handleInput(data);
                    const after = searchBuffer.getValue();
                    if (after !== before) {
                        query = after;
                        refresh();
                    }
                    return;
                }
                if (matchesKey(data, Key.escape)) {
                    done(null);
                    return;
                }
                if (matchesKey(data, Key.tab)) {
                    focus = focus === "models" ? "config" : "models";
                    refresh();
                    return;
                }
                if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
                    confirm();
                    return;
                }
                if (focus === "config") {
                    if (matchesKey(data, Key.up)) {
                        configIndex = (configIndex - 1 + configRows.length) % configRows.length;
                        refresh();
                        return;
                    }
                    if (matchesKey(data, Key.down)) {
                        configIndex = (configIndex + 1) % configRows.length;
                        refresh();
                        return;
                    }
                    if (matchesKey(data, Key.space) || matchesKey(data, Key.right)) {
                        cycleConfig(1);
                        return;
                    }
                    if (matchesKey(data, Key.left)) {
                        cycleConfig(-1);
                        return;
                    }
                    return;
                }
                if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
                    selectList.handleInput(data);
                    return;
                }
                if (data === "/") {
                    searching = true;
                    refresh();
                    return;
                }
                if (data === "p") {
                    const item = selectList.getSelectedItem();
                    if (item) {
                        if (!state.selectedIds.has(item.value) && state.selectedIds.size >= MAX_PANEL_MODELS_HARD_LIMIT) {
                            hint.setText(warn(`Panel can have at most ${MAX_PANEL_MODELS_HARD_LIMIT} models (press c to clear).`));
                            tui.requestRender();
                        } else {
                            state.selectedIds = togglePanelMember(state.selectedIds, item.value);
                            markSetupCustom(state);
                            refresh();
                        }
                    }
                    return;
                }
                if (data === "j") {
                    const item = selectList.getSelectedItem();
                    if (item) {
                        state.judgeId = toggleJudgeSelection(state.judgeId, item.value);
                        markSetupCustom(state);
                        refresh();
                    }
                    return;
                }
                if (data === "c") {
                    state.selectedIds = new Set();
                    markSetupCustom(state);
                    refresh();
                    return;
                }
            }
        };
    });
}
