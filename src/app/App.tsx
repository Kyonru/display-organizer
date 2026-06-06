import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { Copy, Monitor, Moon, Plus, RefreshCcw, Save, Sun, Trash2, Zap } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { clsx } from "clsx";
import { useCanvasStore } from "../features/canvas/canvasStore";
import {
  CANVAS_SCALE,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
  canvasPositionsToLayout,
  displaysToCanvasNodes,
  displaysToLayout,
  resolveScaleOptionForLayoutDisplay,
  snapPoint,
} from "../features/canvas/layoutMath";
import { useDisplayStore } from "../features/displays/displayStore";
import { useProfileStore } from "../features/profiles/profileStore";
import { ensureMenuBarIconVisible } from "../features/tray/trayVisibility";
import { isTauriRuntime } from "../shared/runtime";
import type { Display, DisplayRotation } from "../shared/types";

type MonitorNodeData = {
  display: Display;
  width: number;
  height: number;
};

type Theme = "light" | "dark";

const buttonBase =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

const iconButton =
  "inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

const primaryButton =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded border border-emerald-600 bg-emerald-600 px-2.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45";

const fieldInput =
  "h-8 w-full rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-900 outline-none transition focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-55 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100";

function monitorNodeDimensions(display: Display) {
  return {
    width: Math.max(NODE_MIN_WIDTH, display.bounds.width * CANVAS_SCALE),
    height: Math.max(NODE_MIN_HEIGHT, display.bounds.height * CANVAS_SCALE),
  };
}

function MonitorNode({ data, selected }: NodeProps<Node<MonitorNodeData>>) {
  const display = data.display;

  return (
    <div
      className={clsx("monitor-node", selected && "monitor-node-selected")}
      style={{ width: data.width, height: data.height }}
    >
      <div className="monitor-node-header">
        <span>{display.name}</span>
        {display.isPrimary ? <strong>Primary</strong> : null}
      </div>
      <div className="monitor-node-body">
        <Monitor size={22} />
        <span>
          {display.resolution.width} x {display.resolution.height}
        </span>
        <small>
          {display.scaleFactor.toFixed(2)}x scale · {display.rotation}°
        </small>
      </div>
    </div>
  );
}

const nodeTypes = {
  monitor: MonitorNode,
};

export function App() {
  const isNativeApp = isTauriRuntime();
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    const storedTheme = window.localStorage.getItem("display-layout-manager.theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const { displays, isRefreshing, error: displayError, refreshDisplays } = useDisplayStore();
  const {
    profiles,
    activeProfileId,
    isApplying,
    error: profileError,
    lastApplyResult,
    loadProfiles,
    selectProfile,
    saveProfile,
    updateProfile,
    renameProfile,
    duplicateProfile,
    deleteProfile,
    applyLayout,
    applyProfile,
  } = useProfileStore();
  const { gridSize, snapToGrid, setDirty, isDirty, setSelectedDisplayIds } = useCanvasStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MonitorNodeData>>([]);
  const [edges, , onEdgesChange] = useEdgesState([]);
  const [selectedDisplayId, setSelectedDisplayId] = useState<string | null>(null);
  const selectedDisplayIdRef = useRef<string | null>(null);
  const [profileName, setProfileName] = useState("Work Desk");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("display-layout-manager.theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!isNativeApp) {
      return;
    }

    void ensureMenuBarIconVisible({ profiles, activeProfileId }).catch((error) => {
      console.error("Failed to show menu bar icon", error);
    });
  }, [activeProfileId, isNativeApp, profiles]);

  const buildNodesForDisplays = useCallback(
    (displayList: Display[]) =>
      displaysToCanvasNodes(displayList).map<Node<MonitorNodeData>>((node) => ({
        id: node.id,
        type: "monitor",
        position: node.position,
        data: {
          display: node.display,
          width: node.width,
          height: node.height,
        },
      })),
    [],
  );

  const buildNodesForProfile = useCallback(
    (profileDisplays: Display[], profileId: string) => {
      const profile = profiles.find((item) => item.id === profileId);
      if (!profile) {
        return buildNodesForDisplays(profileDisplays);
      }

      const layoutById = new Map(profile.layout.displays.map((display) => [display.stableId, display]));
      const patchedDisplays = profileDisplays.map((display) => {
        const stableId = display.stableId ?? display.id;
        const layoutDisplay = layoutById.get(stableId);
        const isPrimary = profile.layout.primaryDisplayStableId
          ? profile.layout.primaryDisplayStableId === stableId
          : display.isPrimary;
        const resolvedScaleOption = layoutDisplay
          ? resolveScaleOptionForLayoutDisplay(display, layoutDisplay)
          : null;

        return layoutDisplay
          ? {
              ...display,
              position: layoutDisplay.position,
              resolution: resolvedScaleOption?.resolution ?? layoutDisplay.resolution,
              refreshRate: resolvedScaleOption?.refreshRate ?? layoutDisplay.refreshRate,
              scaleFactor: resolvedScaleOption?.scaleFactor ?? layoutDisplay.scaleFactor,
              rotation: layoutDisplay.rotation,
              modeId: resolvedScaleOption?.id ?? layoutDisplay.modeId ?? display.modeId,
              isPrimary,
              bounds: {
                ...display.bounds,
                width: resolvedScaleOption?.resolution.width ?? layoutDisplay.resolution.width,
                height: resolvedScaleOption?.resolution.height ?? layoutDisplay.resolution.height,
              },
              scaleOptions: display.scaleOptions.map((option) => ({
                ...option,
                isCurrent: resolvedScaleOption
                  ? option.id === resolvedScaleOption.id
                  : layoutDisplay.modeId
                    ? option.id === layoutDisplay.modeId
                    : option.resolution.width === layoutDisplay.resolution.width &&
                      option.resolution.height === layoutDisplay.resolution.height &&
                      Math.abs(option.scaleFactor - layoutDisplay.scaleFactor) < 0.01,
              })),
            }
          : { ...display, isPrimary };
      });

      return buildNodesForDisplays(patchedDisplays);
    },
    [buildNodesForDisplays, profiles],
  );

  useEffect(() => {
    void refreshDisplays();
    void loadProfiles();
  }, [loadProfiles, refreshDisplays]);

  useEffect(() => {
    const canvasNodes = activeProfileId
      ? buildNodesForProfile(displays, activeProfileId)
      : buildNodesForDisplays(displays);
    const selectedId = selectedDisplayIdRef.current;
    setNodes(canvasNodes.map((node) => ({ ...node, selected: selectedId === node.id })));
    setDirty(false);
  }, [activeProfileId, buildNodesForDisplays, buildNodesForProfile, displays, setDirty, setNodes]);

  useEffect(() => {
    const profile = profiles.find((item) => item.id === activeProfileId);
    if (profile) {
      setProfileName(profile.name);
    }
  }, [activeProfileId, profiles]);

  const selectedDisplay = useMemo(
    () =>
      nodes.find((node) => node.id === selectedDisplayId)?.data.display ??
      nodes[0]?.data.display ??
      displays[0],
    [displays, nodes, selectedDisplayId],
  );

  const snapGrid = useMemo<[number, number]>(() => [gridSize, gridSize], [gridSize]);

  const currentLayout = useCallback(() => {
    const draftDisplays = nodes.length > 0 ? nodes.map((node) => node.data.display) : displays;
    const positions = Object.fromEntries(
      nodes.map((node) => [
        node.id,
        snapToGrid ? snapPoint(node.position, gridSize) : node.position,
      ]),
    );
    return nodes.length > 0 ? canvasPositionsToLayout(draftDisplays, positions) : displaysToLayout(displays);
  }, [displays, gridSize, nodes, snapToGrid]);

  const updateDisplayDraft = useCallback(
    (displayId: string, updater: (display: Display) => Display) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== displayId) {
            return node;
          }

          const display = updater(node.data.display);
          return {
            ...node,
            data: {
              ...node.data,
              ...monitorNodeDimensions(display),
              display,
            },
          };
        }),
      );
      setDirty(true);
    },
    [setDirty, setNodes],
  );

  const handleSetPrimaryDisplay = useCallback(
    (displayId: string) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            display: {
              ...node.data.display,
              isPrimary: node.id === displayId,
            },
          },
        })),
      );
      setDirty(true);
    },
    [setDirty, setNodes],
  );

  const handleScaleChange = useCallback(
    (displayId: string, modeId: string) => {
      updateDisplayDraft(displayId, (display) => {
        const option = display.scaleOptions.find((item) => item.id === modeId);
        if (!option) {
          return display;
        }

        return {
          ...display,
          modeId: option.id,
          scaleFactor: option.scaleFactor,
          resolution: option.resolution,
          refreshRate: option.refreshRate,
          bounds: {
            ...display.bounds,
            width: option.resolution.width,
            height: option.resolution.height,
          },
          scaleOptions: display.scaleOptions.map((item) => ({
            ...item,
            isCurrent: item.id === option.id,
          })),
        };
      });
    },
    [updateDisplayDraft],
  );

  const handleRotationChange = useCallback(
    (displayId: string, rotation: DisplayRotation) => {
      updateDisplayDraft(displayId, (display) => ({ ...display, rotation }));
    },
    [updateDisplayDraft],
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      if (changes.some((change) => change.type === "position")) {
        setDirty(true);
      }
    },
    [onNodesChange, setDirty],
  );

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node<MonitorNodeData>[] }) => {
      const ids = selectedNodes.map((node) => node.id);
      const nextId = ids[0] ?? null;
      selectedDisplayIdRef.current = nextId;
      setSelectedDisplayIds(ids);
      setSelectedDisplayId((currentId) => {
        return currentId === nextId ? currentId : nextId;
      });
    },
    [setSelectedDisplayIds],
  );

  const handleSaveProfile = async () => {
    const name = profileName.trim();
    if (!name || !activeProfileId) {
      return;
    }

    const profile = await updateProfile(activeProfileId, {
      name,
      description: null,
      layout: currentLayout(),
    });

    if (profile) {
      setDirty(false);
    }
  };

  const handleAddProfile = async () => {
    const name = profileName.trim() || `Profile ${profiles.length + 1}`;
    const profile = await saveProfile({
      name,
      description: null,
      layout: currentLayout(),
    });

    if (profile) {
      selectProfile(profile.id);
      setProfileName(profile.name);
      setDirty(false);
    }
  };

  const handleOpenProfile = (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    selectProfile(profile.id);
    setProfileName(profile.name);
    const selectedId = selectedDisplayIdRef.current;
    setNodes(
      buildNodesForProfile(displays, profile.id).map((node) => ({
        ...node,
        selected: selectedId === node.id,
      })),
    );
    setDirty(false);
  };

  const handleApplyLayout = useCallback(async () => {
    if (displays.length === 0) {
      return;
    }

    const result = await applyLayout(currentLayout());
    if (result?.applied) {
      setDirty(false);
      await refreshDisplays();
    }
  }, [applyLayout, currentLayout, displays.length, refreshDisplays, setDirty]);

  useEffect(() => {
    if (!isNativeApp) {
      return;
    }

    const unlistenRefresh = listen("tray:refresh-displays", () => {
      void refreshDisplays();
    });
    const unlistenApply = listen("tray:apply-current-layout", () => {
      void handleApplyLayout();
    });
    const unlistenApplyProfile = listen<{ profileId: string }>("tray:apply-profile", (event) => {
      const profileId = event.payload.profileId;
      if (!profileId) {
        return;
      }

      void applyProfile(profileId).then(async (result) => {
        if (result?.applied) {
          setDirty(false);
          await refreshDisplays();
        }
      });
    });

    return () => {
      void unlistenRefresh.then((unlisten) => unlisten());
      void unlistenApply.then((unlisten) => unlisten());
      void unlistenApplyProfile.then((unlisten) => unlisten());
    };
  }, [applyProfile, handleApplyLayout, isNativeApp, refreshDisplays, setDirty]);

  const selectedStableId = selectedDisplay ? selectedDisplay.stableId ?? selectedDisplay.id : null;
  const selectedScaleValue =
    selectedDisplay?.modeId ??
    selectedDisplay?.scaleOptions.find((option) => option.isCurrent)?.id ??
    "";

  return (
    <main className="grid h-screen grid-rows-[48px_minmax(0,1fr)] overflow-hidden bg-zinc-100 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-5">Display Layout Manager</h1>
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {displays.length} display{displays.length === 1 ? "" : "s"}
            {!isNativeApp ? " · browser preview" : ""}
            {isDirty ? " · unsaved" : ""}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <label className="flex h-8 items-center gap-2 rounded border border-zinc-200 bg-zinc-50 pl-2 pr-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <span className="shrink-0 uppercase tracking-wide">Profile</span>
            <input
              className="h-6 w-36 rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="Profile name"
            />
          </label>
          <button className={buttonBase} type="button" onClick={() => void refreshDisplays()} disabled={isRefreshing}>
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button className={buttonBase} type="button" onClick={() => void handleAddProfile()} disabled={displays.length === 0}>
            <Plus size={16} />
            Add
          </button>
          <button
            className={buttonBase}
            type="button"
            onClick={() => void handleSaveProfile()}
            disabled={displays.length === 0 || !activeProfileId}
          >
            <Save size={16} />
            Save
          </button>
          <button
            type="button"
            className={primaryButton}
            onClick={() => void handleApplyLayout()}
            disabled={displays.length === 0 || isApplying}
          >
            <Zap size={16} />
            Apply
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <section className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)_260px]">
        <aside className="min-h-0 overflow-auto border-r border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Profiles</h2>
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {profiles.length}
            </span>
          </div>
          <div className="space-y-1.5">
            {profiles.length === 0 ? (
              <p className="rounded border border-dashed border-zinc-300 p-2 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                Use Add to save the current arrangement.
              </p>
            ) : null}
            {profiles.map((profile) => (
              <article
                key={profile.id}
                className={clsx(
                  "group flex items-start gap-2 rounded border p-2 transition",
                  activeProfileId === profile.id
                    ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500/20 dark:bg-emerald-950/30"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:border-zinc-700",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => handleOpenProfile(profile.id)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <strong className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {profile.name}
                    </strong>
                    {activeProfileId === profile.id ? (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
                        Open
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                    {profile.layout.displays.length} displays
                  </span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={`Apply ${profile.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleOpenProfile(profile.id);
                      void applyProfile(profile.id).then((result) => {
                        if (result?.applied) {
                          void refreshDisplays();
                        }
                      });
                    }}
                  >
                    <Zap size={14} />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={`Duplicate ${profile.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void duplicateProfile(profile.id);
                    }}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={`Delete ${profile.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteProfile(profile.id).then(() => {
                        if (activeProfileId === profile.id) {
                          setProfileName("Work Desk");
                          setNodes(buildNodesForDisplays(displays));
                          setDirty(false);
                        }
                      });
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </aside>

        <section className="min-h-0 min-w-0 bg-zinc-100 dark:bg-zinc-950">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={handleSelectionChange}
            snapToGrid={snapToGrid}
            snapGrid={snapGrid}
            minZoom={0.15}
            maxZoom={2.5}
            colorMode={theme}
            fitView
          >
            <Background gap={gridSize} color={theme === "dark" ? "#3f3f46" : "#d4d4d8"} />
            <MiniMap
              pannable
              zoomable
              maskColor={theme === "dark" ? "rgb(9 9 11 / 0.68)" : "rgb(244 244 245 / 0.68)"}
              nodeColor={theme === "dark" ? "#10b981" : "#047857"}
              nodeStrokeWidth={2}
            />
            <Controls />
          </ReactFlow>
        </section>

        <aside className="min-h-0 overflow-auto border-l border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Display</h2>
            {isDirty ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-200">
                Unsaved
              </span>
            ) : null}
          </div>
          {selectedDisplay ? (
            <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
              <dt className="text-zinc-500 dark:text-zinc-400">Name</dt>
              <dd className="min-w-0 truncate">{selectedDisplay.name}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Resolution</dt>
              <dd className="min-w-0 truncate">
                {selectedDisplay.resolution.width} x {selectedDisplay.resolution.height}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Position</dt>
              <dd className="min-w-0 truncate">
                {selectedDisplay.position.x}, {selectedDisplay.position.y}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Scale</dt>
              <dd>{selectedDisplay.scaleFactor.toFixed(2)}x</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Rotation</dt>
              <dd>{selectedDisplay.rotation}°</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">Identifier</dt>
              <dd className="min-w-0 break-all">{selectedDisplay.stableId ?? selectedDisplay.id}</dd>
            </dl>
          ) : (
            <p className="rounded border border-dashed border-zinc-300 p-2 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              No display selected.
            </p>
          )}
          {selectedDisplay && selectedStableId ? (
            <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <label className="flex items-center justify-between gap-3 rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/80">
                <span className="font-medium text-zinc-700 dark:text-zinc-200">Primary display</span>
                <input
                  type="radio"
                  checked={selectedDisplay.isPrimary}
                  disabled={!selectedDisplay.capabilities.primary.supported}
                  onChange={() => handleSetPrimaryDisplay(selectedStableId)}
                />
              </label>
              {!selectedDisplay.capabilities.primary.supported ? (
                <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  {selectedDisplay.capabilities.primary.reason}
                </p>
              ) : null}

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-200">Scale</span>
                <select
                  className={fieldInput}
                  value={selectedScaleValue}
                  disabled={
                    !selectedDisplay.capabilities.scale.supported ||
                    selectedDisplay.scaleOptions.length === 0
                  }
                  onChange={(event) => handleScaleChange(selectedStableId, event.target.value)}
                >
                  {selectedDisplay.scaleOptions.length > 0 ? (
                    selectedDisplay.scaleOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))
                  ) : (
                    <option value="">No scale options</option>
                  )}
                </select>
              </label>
              {!selectedDisplay.capabilities.scale.supported ? (
                <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  {selectedDisplay.capabilities.scale.reason}
                </p>
              ) : null}

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-200">Rotation</span>
                <select
                  className={fieldInput}
                  value={selectedDisplay.rotation}
                  disabled={!selectedDisplay.capabilities.rotation.supported}
                  onChange={(event) =>
                    handleRotationChange(selectedStableId, Number(event.target.value) as DisplayRotation)
                  }
                >
                  {[0, 90, 180, 270].map((rotation) => (
                    <option key={rotation} value={rotation}>
                      {rotation}°
                    </option>
                  ))}
                </select>
              </label>
              {!selectedDisplay.capabilities.rotation.supported ? (
                <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  {selectedDisplay.capabilities.rotation.reason}
                </p>
              ) : null}
            </div>
          ) : null}
          {displayError || profileError ? (
            <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200">
              {displayError ?? profileError}
            </p>
          ) : null}
          {lastApplyResult ? (
            <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs leading-5 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200">
              {lastApplyResult.message}
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
