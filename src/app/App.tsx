import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Copy, Monitor, Plus, RefreshCcw, Save, Trash2, Zap } from "lucide-react";
import { clsx } from "clsx";
import { useCanvasStore } from "../features/canvas/canvasStore";
import {
  canvasPositionsToLayout,
  displaysToCanvasNodes,
  displaysToLayout,
  snapPoint,
} from "../features/canvas/layoutMath";
import { useDisplayStore } from "../features/displays/displayStore";
import { useProfileStore } from "../features/profiles/profileStore";
import { isTauriRuntime } from "../shared/runtime";
import type { Display } from "../shared/types";

type MonitorNodeData = {
  display: Display;
  width: number;
  height: number;
};

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
  const [profileName, setProfileName] = useState("Work Desk");

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
        return layoutDisplay ? { ...display, position: layoutDisplay.position } : display;
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
    setNodes(canvasNodes);
    setDirty(false);
  }, [activeProfileId, buildNodesForDisplays, buildNodesForProfile, displays, setDirty, setNodes]);

  useEffect(() => {
    const profile = profiles.find((item) => item.id === activeProfileId);
    if (profile) {
      setProfileName(profile.name);
    }
  }, [activeProfileId, profiles]);

  const selectedDisplay = useMemo(
    () => displays.find((display) => (display.stableId ?? display.id) === selectedDisplayId) ?? displays[0],
    [displays, selectedDisplayId],
  );

  const snapGrid = useMemo<[number, number]>(() => [gridSize, gridSize], [gridSize]);

  const currentLayout = useCallback(() => {
    const positions = Object.fromEntries(
      nodes.map((node) => [
        node.id,
        snapToGrid ? snapPoint(node.position, gridSize) : node.position,
      ]),
    );
    return nodes.length > 0 ? canvasPositionsToLayout(displays, positions) : displaysToLayout(displays);
  }, [displays, gridSize, nodes, snapToGrid]);

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
      setSelectedDisplayIds(ids);
      setSelectedDisplayId((currentId) => {
        const nextId = ids[0] ?? null;
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
    setNodes(buildNodesForProfile(displays, profile.id));
    setDirty(false);
  };

  const handleApplyLayout = async () => {
    if (displays.length === 0) {
      return;
    }

    const result = await applyLayout(currentLayout());
    if (result?.applied) {
      setDirty(false);
      await refreshDisplays();
    }
  };

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>Display Layout Manager</h1>
          <p>
            {displays.length} display{displays.length === 1 ? "" : "s"} connected
            {!isNativeApp ? " · browser preview" : ""}
          </p>
        </div>
        <div className="toolbar">
          <label className="profile-name-field">
            <span>Profile</span>
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="Profile name"
            />
          </label>
          <button type="button" onClick={() => void refreshDisplays()} disabled={isRefreshing}>
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button type="button" onClick={() => void handleAddProfile()} disabled={displays.length === 0}>
            <Plus size={16} />
            Add Profile
          </button>
          <button
            type="button"
            onClick={() => void handleSaveProfile()}
            disabled={displays.length === 0 || !activeProfileId}
          >
            <Save size={16} />
            Save Changes
          </button>
          <button
            type="button"
            className="primary-action"
            onClick={() => void handleApplyLayout()}
            disabled={displays.length === 0 || isApplying}
          >
            <Zap size={16} />
            Apply Layout
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="profile-sidebar">
          <div className="panel-heading">
            <h2>Profiles</h2>
            <span>{profiles.length}</span>
          </div>
          <div className="profile-list">
            {profiles.length === 0 ? (
              <p className="empty-state">Use Add Profile to save the current arrangement.</p>
            ) : null}
            {profiles.map((profile) => (
              <article
                key={profile.id}
                className={clsx("profile-row", activeProfileId === profile.id && "profile-row-active")}
              >
                <button
                  type="button"
                  className="profile-main"
                  onClick={() => handleOpenProfile(profile.id)}
                >
                  <strong>{profile.name}</strong>
                  <span>
                    {profile.layout.displays.length} displays
                    {activeProfileId === profile.id ? " · open" : ""}
                  </span>
                </button>
                <div className="profile-actions">
                  <button
                    type="button"
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
                  <button
                    type="button"
                    aria-label={`Rename ${profile.name} from name field`}
                    onClick={(event) => {
                      event.stopPropagation();
                      const name = profileName.trim();
                      if (name && activeProfileId === profile.id) {
                        void renameProfile(profile.id, name);
                      }
                    }}
                  >
                    <Save size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </aside>

        <section className="canvas-panel">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={handleSelectionChange}
            snapToGrid={snapToGrid}
            snapGrid={snapGrid}
            minZoom={0.25}
            maxZoom={2}
            fitView
          >
            <Background gap={gridSize} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </section>

        <aside className="inspector">
          <div className="panel-heading">
            <h2>Display</h2>
            {isDirty ? <span className="dirty-badge">Unsaved</span> : null}
          </div>
          {selectedDisplay ? (
            <dl>
              <dt>Name</dt>
              <dd>{selectedDisplay.name}</dd>
              <dt>Resolution</dt>
              <dd>
                {selectedDisplay.resolution.width} x {selectedDisplay.resolution.height}
              </dd>
              <dt>Position</dt>
              <dd>
                {selectedDisplay.position.x}, {selectedDisplay.position.y}
              </dd>
              <dt>Scale</dt>
              <dd>{selectedDisplay.scaleFactor.toFixed(2)}x</dd>
              <dt>Rotation</dt>
              <dd>{selectedDisplay.rotation}°</dd>
              <dt>Identifier</dt>
              <dd>{selectedDisplay.stableId ?? selectedDisplay.id}</dd>
            </dl>
          ) : (
            <p className="empty-state">No display selected.</p>
          )}
          {displayError || profileError ? <p className="error-text">{displayError ?? profileError}</p> : null}
          {lastApplyResult ? <p className="success-text">{lastApplyResult.message}</p> : null}
        </aside>
      </section>
    </main>
  );
}
