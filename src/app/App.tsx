import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  BatteryCharging,
  Clock,
  Copy,
  FileDown,
  Monitor,
  Moon,
  Plus,
  Power,
  RefreshCcw,
  Save,
  Sun,
  Terminal,
  Trash2,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { clsx } from "clsx";
import {
  maybeSendAutomationNotification,
  registerAutomationNotificationActionHandler,
} from "../features/automation/automationNotifications";
import {
  automationRuleToDraft,
  conditionLabel,
  cooldownLabel,
  createConditionPreset,
  createDisplaySetupRuleDraft,
  createTriggerPreset,
  platformOptions,
  triggerLabel,
} from "../features/automation/automationRules";
import { useBetaStore } from "../features/betaStore";
import { useCanvasStore } from "../features/canvas/canvasStore";
import {
  CANVAS_SCALE,
  NODE_MIN_HEIGHT,
  NODE_MIN_WIDTH,
  canvasPositionsToLayout,
  displayNodeDimensions,
  displaysToCanvasNodes,
  displaysToLayout,
  layoutsMatch,
  resolveScaleOptionForLayoutDisplay,
  snapPoint,
} from "../features/canvas/layoutMath";
import { useDisplayStore } from "../features/displays/displayStore";
import {
  actionEnabled,
  actionLabel,
  argsToText,
  createActionId,
  createOpenAppAction,
  maybeNumber,
  moveAction,
  normalizeAction,
  textToArgs,
  updatePositionValue,
} from "../features/profiles/profileActions";
import { useProfileStore } from "../features/profiles/profileStore";
import { useSettingsStore } from "../features/settings/settingsStore";
import { ensureMenuBarIconVisible } from "../features/tray/trayVisibility";
import { isTauriRuntime } from "../shared/runtime";
import type {
  AutomationCondition,
  AutomationEvaluation,
  AutomationRuleDraft,
  AutomationTrigger,
  Display,
  DisplayRotation,
  PlatformName,
  ProfileAction,
} from "../shared/types";

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

type TimeScheduleTrigger = Extract<AutomationTrigger, { type: "time_schedule" }>;

const timeTextInputProps = {
  inputMode: "numeric" as const,
  maxLength: 5,
  pattern: "([01][0-9]|2[0-3]):[0-5][0-9]",
};

function sanitizeTimeText(value: string) {
  const normalized = value.replace(/[^\d:]/g, "").replace(/:{2,}/g, ":");
  const [hours = "", minutes = ""] = normalized.split(":");

  if (normalized.includes(":")) {
    return `${hours.slice(0, 2)}:${minutes.slice(0, 2)}`.slice(0, 5);
  }

  const digits = normalized.slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

function normalizeTimeText(value: string) {
  const sanitized = sanitizeTimeText(value);
  const [rawHours = "", rawMinutes = ""] = sanitized.split(":");

  if (!rawHours) {
    return "";
  }

  const hours = Math.min(23, Math.max(0, Number(rawHours) || 0));
  const minutes = Math.min(59, Math.max(0, Number(rawMinutes) || 0));

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function timeScheduleMode(trigger: TimeScheduleTrigger) {
  return trigger.exactTime || (!trigger.startTime && !trigger.endTime) ? "exact" : "window";
}

function MonitorNode({ data, selected }: NodeProps<Node<MonitorNodeData>>) {
  const display = data.display;
  const nodeStyle = {
    width: data.width,
    height: data.height,
    "--monitor-rotation": `${display.rotation}deg`,
  } as CSSProperties;

  return (
    <div
      className={clsx("monitor-node", selected && "monitor-node-selected")}
      style={nodeStyle}
    >
      <div className="monitor-node-header">
        <span>{display.name}</span>
        {display.isPrimary ? <strong>Primary</strong> : null}
      </div>
      <div className="monitor-node-body">
        <span className="monitor-node-icon">
          <Monitor size={22} />
        </span>
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
    lastProfileApplyResult,
    loadProfiles,
    selectProfile,
    saveProfile,
    updateProfile,
    renameProfile,
    duplicateProfile,
    deleteProfile,
    applyLayout,
    applyProfile,
    applyProfileDraft,
  } = useProfileStore();
  const {
    settings,
    error: settingsError,
    loadSettings,
    setScriptsEnabled,
    setAutomationNotificationsEnabled,
  } = useSettingsStore();
  const { gridSize, snapToGrid, setDirty, isDirty, setSelectedDisplayIds } = useCanvasStore();
  const {
    automationRules,
    automationEvaluation,
    pendingAutomationMatches,
    recoveryState,
    error: betaError,
    setAutomationEvaluation,
    loadAutomationRules,
    saveAutomationRule,
    deleteAutomationRule,
    evaluateAutomation,
    recordAutomationEvent,
    clearPendingAutomation,
    loadRecoveryState,
    keepRecovery,
    revertRecovery,
    exportDiagnostics,
  } = useBetaStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MonitorNodeData>>([]);
  const [edges, , onEdgesChange] = useEdgesState([]);
  const [selectedDisplayId, setSelectedDisplayId] = useState<string | null>(null);
  const selectedDisplayIdRef = useRef<string | null>(null);
  const automationPromptSignatureRef = useRef<string | null>(null);
  const automationAutoSignatureRef = useRef<string | null>(null);
  const notifiedAutomationSignaturesRef = useRef<Set<string>>(new Set());
  const [profileName, setProfileName] = useState("Work Desk");
  const [profileActions, setProfileActions] = useState<ProfileAction[]>([]);
  const [automationDraft, setAutomationDraft] = useState<AutomationRuleDraft | null>(null);
  const [recoverySecondsRemaining, setRecoverySecondsRemaining] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [notificationPermissionDenied, setNotificationPermissionDenied] = useState(false);

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

  useEffect(() => {
    if (!isNativeApp) {
      return;
    }

    let listener: { unregister: () => Promise<void> } | null = null;
    void registerAutomationNotificationActionHandler()
      .then((registeredListener) => {
        listener = registeredListener;
      })
      .catch((error) => {
        console.error("Failed to register automation notification action", error);
      });

    return () => {
      void listener?.unregister();
    };
  }, [isNativeApp]);

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
              rotation: display.capabilities.rotation.supported
                ? layoutDisplay.rotation
                : display.rotation,
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
    void loadAutomationRules();
    void loadRecoveryState();
    void loadSettings();
  }, [loadAutomationRules, loadProfiles, loadRecoveryState, loadSettings, refreshDisplays]);

  useEffect(() => {
    if (!recoveryState) {
      setRecoverySecondsRemaining(0);
      return;
    }

    const expiresAtMs = new Date(recoveryState.expiresAt).getTime();
    const updateRemaining = () => {
      setRecoverySecondsRemaining(Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)));
    };

    updateRemaining();
    const interval = window.setInterval(updateRemaining, 1000);
    const timeout = window.setTimeout(() => {
      void keepRecovery();
    }, Math.max(0, expiresAtMs - Date.now()));

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [keepRecovery, recoveryState]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeout = window.setTimeout(() => setToastMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    if (
      automationRules.length === 0 ||
      profiles.length === 0 ||
      displays.length === 0 ||
      isApplying ||
      pendingAutomationMatches.length > 0
    ) {
      return;
    }

    const setupSignature = [
      automationRules
        .map(
          (rule) =>
            `${rule.id}:${rule.enabled}:${rule.profileId}:${JSON.stringify(rule.match)}:${JSON.stringify(rule.triggers)}:${JSON.stringify(rule.conditions)}:${rule.confirmationMode}:${rule.cooldownMs}`,
        )
        .sort()
        .join("|"),
      profiles
        .map((profile) => profile.id)
        .sort()
        .join("|"),
      displays
        .map((display) => display.stableId ?? display.id)
        .sort()
        .join("|"),
    ].join("::");

    if (automationPromptSignatureRef.current === setupSignature) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void evaluateAutomation().then((evaluation) => {
        if (!evaluation || evaluation.matches.length === 0) {
          return;
        }

        automationPromptSignatureRef.current = setupSignature;
      });
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [
    automationRules.length,
    automationRules,
    displays,
    evaluateAutomation,
    isApplying,
    pendingAutomationMatches.length,
    profiles,
    profiles.length,
  ]);

  useEffect(() => {
    if (pendingAutomationMatches.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void clearPendingAutomation("skipped", "Automation confirmation expired");
    }, 30_000);

    return () => window.clearTimeout(timeout);
  }, [clearPendingAutomation, pendingAutomationMatches.length]);

  useEffect(() => {
    if (!automationEvaluation || isApplying || pendingAutomationMatches.length > 0) {
      return;
    }

    const autoMatches = automationEvaluation.matches.filter((match) => !match.requiresConfirmation);
    if (autoMatches.length !== 1) {
      return;
    }

    const match = autoMatches[0];
    const signature = match.matchSignature || `${match.rule.id}:${automationEvaluation.evaluatedAt}`;
    if (automationAutoSignatureRef.current === signature) {
      return;
    }

    automationAutoSignatureRef.current = signature;
    void applyProfile(match.rule.profileId).then(async (result) => {
      if (result?.applied) {
        await recordAutomationEvent(match.rule.id, match.rule.profileId, "applied", `Auto-applied ${match.profileName}`);
        setDirty(false);
        await refreshDisplays();
        await loadRecoveryState();
      } else {
        await recordAutomationEvent(match.rule.id, match.rule.profileId, "failed", `Failed to auto-apply ${match.profileName}`);
      }
    });
  }, [
    applyProfile,
    automationEvaluation,
    isApplying,
    loadRecoveryState,
    pendingAutomationMatches.length,
    recordAutomationEvent,
    refreshDisplays,
    setDirty,
  ]);

  useEffect(() => {
    if (!automationEvaluation) {
      return;
    }

    void maybeSendAutomationNotification({
      evaluation: automationEvaluation,
      settings,
      isNative: isNativeApp,
      notifiedSignatures: notifiedAutomationSignaturesRef.current,
    })
      .then((result) => {
        setNotificationPermissionDenied(result === "permission denied");
        if (result.startsWith("notification error:")) {
          setToastMessage(result);
        }
      })
      .catch((error) => {
        console.error("Failed to send automation notification", error);
      });
  }, [automationEvaluation, isNativeApp, settings]);

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
      setProfileActions((profile.actions ?? []).map(normalizeAction));
    } else if (!activeProfileId) {
      setProfileActions([]);
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
              ...displayNodeDimensions(display),
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
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== displayId) {
            return node;
          }

          const previousDimensions = {
            width: node.data.width,
            height: node.data.height,
          };
          const display = { ...node.data.display, rotation };
          const nextDimensions = displayNodeDimensions(display);

          return {
            ...node,
            position: {
              x: node.position.x + (previousDimensions.width - nextDimensions.width) / 2,
              y: node.position.y + (previousDimensions.height - nextDimensions.height) / 2,
            },
            data: {
              ...node.data,
              ...nextDimensions,
              display,
            },
          };
        }),
      );
      setDirty(true);
    },
    [setDirty, setNodes],
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

  const currentProfileDraft = useCallback(
    (name: string) => ({
      name,
      description: null,
      layout: currentLayout(),
      actions: profileActions.map(normalizeAction),
    }),
    [currentLayout, profileActions],
  );

  const handleSaveProfile = async () => {
    const name = profileName.trim();
    if (!name || !activeProfileId) {
      return;
    }

    const profile = await updateProfile(activeProfileId, currentProfileDraft(name));

    if (profile) {
      setDirty(false);
    }
  };

  const handleAddProfile = async () => {
    const name = profileName.trim() || `Profile ${profiles.length + 1}`;
    const profile = await saveProfile(currentProfileDraft(name));

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
    setProfileActions((profile.actions ?? []).map(normalizeAction));
    const selectedId = selectedDisplayIdRef.current;
    setNodes(
      buildNodesForProfile(displays, profile.id).map((node) => ({
        ...node,
        selected: selectedId === node.id,
      })),
    );
    setDirty(false);
  };

  const handleApplyManualLayout = useCallback(async () => {
    if (displays.length === 0) {
      return;
    }

    const result = await applyLayout(currentLayout());
    if (result?.applied) {
      setDirty(false);
      await refreshDisplays();
      await loadRecoveryState();
    }
  }, [applyLayout, currentLayout, displays.length, loadRecoveryState, refreshDisplays, setDirty]);

  const handleApplyCurrentDraft = useCallback(async () => {
    if (displays.length === 0) {
      return;
    }

    const name = profileName.trim() || "Profile";
    const result = activeProfileId
      ? await applyProfileDraft(currentProfileDraft(name))
      : await applyLayout(currentLayout());

    if (result?.applied) {
      setDirty(false);
      await refreshDisplays();
      await loadRecoveryState();
    }
  }, [
    activeProfileId,
    applyLayout,
    applyProfileDraft,
    currentLayout,
    currentProfileDraft,
    displays.length,
    loadRecoveryState,
    profileName,
    refreshDisplays,
    setDirty,
  ]);

  const updateProfileAction = useCallback(
    (actionId: string, updater: (action: ProfileAction) => ProfileAction) => {
      setProfileActions((currentActions) =>
        currentActions.map((action) => {
          if ((action.id ?? "") !== actionId) {
            return action;
          }

          return normalizeAction(updater(action));
        }),
      );
      setDirty(true);
    },
    [setDirty],
  );

  const deleteProfileAction = useCallback(
    (actionId: string) => {
      setProfileActions((currentActions) => currentActions.filter((action) => action.id !== actionId));
      setDirty(true);
    },
    [setDirty],
  );

  const moveProfileAction = useCallback(
    (actionId: string, direction: -1 | 1) => {
      setProfileActions((currentActions) => {
        return moveAction(currentActions, actionId, direction);
      });
      setDirty(true);
    },
    [setDirty],
  );

  const pickApplicationPath = useCallback(async () => {
    if (!isNativeApp) {
      return window.prompt("Application path", "/Applications/Slack.app");
    }

    const result = await open({
      multiple: false,
      directory: false,
      defaultPath: "/Applications",
      filters: [{ name: "Applications", extensions: ["app"] }],
      fileAccessMode: "scoped",
    });

    return Array.isArray(result) ? result[0] : result;
  }, [isNativeApp]);

  const handleAddOpenAppAction = useCallback(async () => {
    const appPath = await pickApplicationPath();
    if (!appPath) {
      return;
    }

    setProfileActions((currentActions) => [
      ...currentActions,
      createOpenAppAction(appPath),
    ]);
    setDirty(true);
  }, [pickApplicationPath, setDirty]);

  const handleAddCloseAppAction = useCallback(() => {
    setProfileActions((currentActions) => [
      ...currentActions,
      normalizeAction({
        id: createActionId(),
        type: "close_app",
        enabled: true,
        conditions: null,
        appName: "",
      }),
    ]);
    setDirty(true);
  }, [setDirty]);

  const handleAddScriptAction = useCallback(() => {
    setProfileActions((currentActions) => [
      ...currentActions,
      normalizeAction({
        id: createActionId(),
        type: "run_script",
        enabled: true,
        conditions: null,
        command: "",
        delayMs: 0,
      }),
    ]);
    setDirty(true);
  }, [setDirty]);

  const handleCreateAutomationRule = async () => {
    const profile = profiles.find((item) => item.id === activeProfileId);
    if (!profile || displays.length === 0) {
      return;
    }

    setAutomationDraft(createDisplaySetupRuleDraft(profile, displays));
  };

  const updateAutomationDraft = useCallback((updater: (draft: AutomationRuleDraft) => AutomationRuleDraft) => {
    setAutomationDraft((currentDraft) => (currentDraft ? updater(currentDraft) : currentDraft));
  }, []);

  const handleEditAutomationRule = (ruleId: string) => {
    const rule = automationRules.find((item) => item.id === ruleId);
    if (!rule) {
      return;
    }

    setAutomationDraft(automationRuleToDraft(rule));
  };

  const handleSaveAutomationDraft = async () => {
    if (!automationDraft) {
      return;
    }

    const saved = await saveAutomationRule({
      ...automationDraft,
      name: automationDraft.name.trim() || "Automation rule",
      triggers: automationDraft.triggers ?? [],
      conditions: automationDraft.conditions ?? [],
      confirmationMode: automationDraft.confirmationMode ?? "confirm",
      cooldownMs: automationDraft.cooldownMs ?? 600_000,
    });

    if (saved) {
      setAutomationDraft(null);
    }
  };

  const handleAddAutomationTrigger = (kind: AutomationTrigger["type"]) => {
    updateAutomationDraft((draft) => ({
      ...draft,
      triggers: [...(draft.triggers ?? []), createTriggerPreset(kind, displays)],
    }));
  };

  const handleUpdateAutomationTrigger = (
    index: number,
    updater: (trigger: AutomationTrigger) => AutomationTrigger,
  ) => {
    updateAutomationDraft((draft) => ({
      ...draft,
      triggers: (draft.triggers ?? []).map((trigger, triggerIndex) =>
        triggerIndex === index ? updater(trigger) : trigger,
      ),
    }));
  };

  const handleDeleteAutomationTrigger = (index: number) => {
    updateAutomationDraft((draft) => ({
      ...draft,
      triggers: (draft.triggers ?? []).filter((_, triggerIndex) => triggerIndex !== index),
    }));
  };

  const handleAddAutomationCondition = (kind: AutomationCondition["type"]) => {
    updateAutomationDraft((draft) => ({
      ...draft,
      conditions: [...(draft.conditions ?? []), createConditionPreset(kind, displays)],
    }));
  };

  const handleUpdateAutomationCondition = (
    index: number,
    updater: (condition: AutomationCondition) => AutomationCondition,
  ) => {
    updateAutomationDraft((draft) => ({
      ...draft,
      conditions: (draft.conditions ?? []).map((condition, conditionIndex) =>
        conditionIndex === index ? updater(condition) : condition,
      ),
    }));
  };

  const handleDeleteAutomationCondition = (index: number) => {
    updateAutomationDraft((draft) => ({
      ...draft,
      conditions: (draft.conditions ?? []).filter((_, conditionIndex) => conditionIndex !== index),
    }));
  };

  const handleToggleAutomationRule = async (ruleId: string) => {
    const rule = automationRules.find((item) => item.id === ruleId);
    if (!rule) {
      return;
    }

    await saveAutomationRule({
      ...automationRuleToDraft(rule),
      enabled: !rule.enabled,
    });
  };

  const handleApplyAutomationMatch = async (matchIndex: number) => {
    const match = pendingAutomationMatches[matchIndex];
    if (!match) {
      return;
    }

    const result = await applyProfile(match.rule.profileId);
    if (result?.applied) {
      await clearPendingAutomation("applied", `Applied ${match.profileName}`);
      await refreshDisplays();
      await loadRecoveryState();
    } else {
      await clearPendingAutomation("failed", `Failed to apply ${match.profileName}`);
    }
  };

  const handleKeepRecovery = async () => {
    await keepRecovery();
  };

  const handleRevertRecovery = async () => {
    const reverted = await revertRecovery();
    if (reverted) {
      setDirty(false);
      await refreshDisplays();
    }
  };

  const handleExportDiagnostics = async () => {
    const diagnostics = await exportDiagnostics();
    if (!diagnostics) {
      return;
    }

    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const filename = `display-layout-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setToastMessage(`Diagnostics downloaded: ${filename}`);
  };

  useEffect(() => {
    if (!isNativeApp) {
      return;
    }

    const unlistenRefresh = listen("tray:refresh-displays", () => {
      void refreshDisplays();
    });
    const unlistenApply = listen("tray:apply-current-layout", () => {
      void handleApplyManualLayout();
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
          await loadRecoveryState();
        }
      });
    });
    const unlistenAutomation = listen<AutomationEvaluation>("automation:matches", (event) => {
      setAutomationEvaluation(event.payload);
    });

    return () => {
      void unlistenRefresh.then((unlisten) => unlisten());
      void unlistenApply.then((unlisten) => unlisten());
      void unlistenApplyProfile.then((unlisten) => unlisten());
      void unlistenAutomation.then((unlisten) => unlisten());
    };
  }, [
    applyProfile,
    handleApplyManualLayout,
    isNativeApp,
    loadRecoveryState,
    refreshDisplays,
    setAutomationEvaluation,
    setDirty,
  ]);

  const selectedStableId = selectedDisplay ? selectedDisplay.stableId ?? selectedDisplay.id : null;
  const selectedScaleValue =
    selectedDisplay?.modeId ??
    selectedDisplay?.scaleOptions.find((option) => option.isCurrent)?.id ??
    "";
  const selectedRotationReason = selectedDisplay?.capabilities.rotation.reason ?? "";
  const rotationLabel = selectedDisplay?.capabilities.rotation.supported
    ? "Rotation"
    : selectedRotationReason.toLowerCase().includes("displayplacer")
      ? "Rotation (requires displayplacer)"
      : "Rotation (read-only)";
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles],
  );
  const activeProfileMatchesOs = useMemo(() => {
    if (!activeProfile || displays.length === 0 || isDirty) {
      return false;
    }

    return layoutsMatch(activeProfile.layout, displaysToLayout(displays));
  }, [activeProfile, displays, isDirty]);
  const canvasProfileTitle = activeProfile?.name ?? "Current OS layout";
  const canvasProfileStatus = activeProfile
    ? activeProfileMatchesOs
      ? "Actual profile"
      : isDirty
        ? "Editing"
        : "Saved profile"
    : "Live";

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
            onClick={() => void handleApplyCurrentDraft()}
            disabled={displays.length === 0 || isApplying}
          >
            <Zap size={16} />
            Apply
          </button>
          <button
            className={buttonBase}
            type="button"
            onClick={() => void handleExportDiagnostics()}
          >
            <FileDown size={16} />
            Diagnostics
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

      <section className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)_340px]">
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
                    {profile.layout.displays.length} displays · {(profile.actions ?? []).length} actions
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
                          void loadRecoveryState();
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
          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Automation
              </h2>
              <div className="flex gap-1">
                <label className="flex h-7 items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={settings.automationNotifications.enabled}
                    onChange={(event) => void setAutomationNotificationsEnabled(event.target.checked)}
                  />
                  Notify
                </label>
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Test automation rules"
                  onClick={() => void evaluateAutomation()}
                >
                  <RefreshCcw size={14} />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label="Add automation rule"
                  disabled={!activeProfileId || displays.length === 0}
                  onClick={() => void handleCreateAutomationRule()}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            {notificationPermissionDenied && settings.automationNotifications.enabled ? (
              <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100">
                Notifications are blocked in macOS. Enable them in System Settings to receive automation alerts.
              </p>
            ) : null}

            {automationDraft ? (
              <div className="space-y-2.5 rounded border border-zinc-200 bg-white p-2.5 text-xs dark:border-zinc-800 dark:bg-zinc-900/70">
                <input
                  className={fieldInput}
                  value={automationDraft.name}
                  onChange={(event) => updateAutomationDraft((draft) => ({ ...draft, name: event.target.value }))}
                  placeholder="Rule name"
                />
                <div className="space-y-1.5">
                  <select
                    className={fieldInput}
                    value={automationDraft.profileId}
                    onChange={(event) => updateAutomationDraft((draft) => ({ ...draft, profileId: event.target.value }))}
                  >
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-1.5">
                    <select
                      className={fieldInput}
                      value={automationDraft.confirmationMode ?? "confirm"}
                      onChange={(event) =>
                        updateAutomationDraft((draft) => ({
                          ...draft,
                          confirmationMode: event.target.value === "auto" ? "auto" : "confirm",
                        }))
                      }
                    >
                      <option value="confirm">Confirm</option>
                      <option value="auto">Auto</option>
                    </select>
                    <select
                      className={fieldInput}
                      value={automationDraft.cooldownMs ?? 600_000}
                      onChange={(event) =>
                        updateAutomationDraft((draft) => ({ ...draft, cooldownMs: Number(event.target.value) }))
                      }
                    >
                      <option value={0}>No cooldown</option>
                      <option value={60_000}>1 min</option>
                      <option value={300_000}>5 min</option>
                      <option value={600_000}>10 min</option>
                      <option value={1_800_000}>30 min</option>
                    </select>
                  </div>
                  <label className="flex h-8 items-center gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 dark:border-zinc-800 dark:bg-zinc-950">
                    <input
                      type="checkbox"
                      checked={automationDraft.enabled}
                      onChange={(event) => updateAutomationDraft((draft) => ({ ...draft, enabled: event.target.checked }))}
                    />
                    Enabled
                  </label>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <strong className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Triggers
                    </strong>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-1.5">
                    {([
                      ["display_setup_changed", Monitor, "Display"],
                      ["time_schedule", Clock, "Time"],
                      ["app_event", AppWindow, "App"],
                      ["app_lifecycle", Power, "Launch"],
                      ["power_source", BatteryCharging, "Power"],
                      ["network_context", Wifi, "Wi-Fi"],
                    ] as const).map(([kind, Icon, label]) => (
                      <button
                        key={kind}
                        type="button"
                        className={buttonBase}
                        onClick={() => handleAddAutomationTrigger(kind)}
                      >
                        <Icon size={13} />
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {(automationDraft.triggers ?? []).map((trigger, index) => (
                      <article key={`${trigger.type}-${index}`} className="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <strong className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                            {triggerLabel(trigger)}
                          </strong>
                          <button
                            type="button"
                            className={iconButton}
                            aria-label="Delete trigger"
                            onClick={() => handleDeleteAutomationTrigger(index)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {trigger.type === "display_setup_changed" ? (
                          <div className="space-y-1.5">
                            <input
                              className={fieldInput}
                              type="number"
                              min={0}
                              value={trigger.displayCount ?? ""}
                              onChange={(event) =>
                                handleUpdateAutomationTrigger(index, (current) =>
                                  current.type === "display_setup_changed"
                                    ? { ...current, displayCount: maybeNumber(event.target.value) }
                                    : current,
                                )
                              }
                              placeholder="Display count"
                            />
                            <select
                              className={fieldInput}
                              value={trigger.platform ?? ""}
                              onChange={(event) =>
                                handleUpdateAutomationTrigger(index, (current) =>
                                  current.type === "display_setup_changed"
                                    ? { ...current, platform: (event.target.value || null) as PlatformName | null }
                                    : current,
                                )
                              }
                            >
                              <option value="">Any OS</option>
                              {platformOptions().map((platform) => (
                                <option key={platform} value={platform}>
                                  {platform}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        {trigger.type === "time_schedule" ? (
                          (() => {
                            const mode = timeScheduleMode(trigger);

                            return (
                              <div className="space-y-1.5">
                                <select
                                  className={fieldInput}
                                  value={mode}
                                  onChange={(event) =>
                                    handleUpdateAutomationTrigger(index, (current) => {
                                      if (current.type !== "time_schedule") {
                                        return current;
                                      }

                                      if (event.target.value === "exact") {
                                        return {
                                          ...current,
                                          exactTime: current.exactTime ?? current.startTime ?? "09:00",
                                          startTime: null,
                                          endTime: null,
                                        };
                                      }

                                      return {
                                        ...current,
                                        exactTime: null,
                                        startTime: current.startTime ?? current.exactTime ?? "09:00",
                                        endTime: current.endTime ?? "17:00",
                                      };
                                    })
                                  }
                                >
                                  <option value="exact">At time</option>
                                  <option value="window">Time window</option>
                                </select>
                                {mode === "exact" ? (
                                  <input
                                    className={fieldInput}
                                    type="text"
                                    {...timeTextInputProps}
                                    value={trigger.exactTime ?? ""}
                                    onChange={(event) =>
                                      handleUpdateAutomationTrigger(index, (current) =>
                                        current.type === "time_schedule"
                                          ? {
                                              ...current,
                                              exactTime: sanitizeTimeText(event.target.value) || null,
                                              startTime: null,
                                              endTime: null,
                                            }
                                          : current,
                                      )
                                    }
                                    onBlur={(event) =>
                                      handleUpdateAutomationTrigger(index, (current) =>
                                        current.type === "time_schedule"
                                          ? { ...current, exactTime: normalizeTimeText(event.target.value) || null }
                                          : current,
                                      )
                                    }
                                    placeholder="HH:mm"
                                    aria-label="Exact time in 24-hour HH:mm format"
                                  />
                                ) : (
                                  <div className="space-y-1.5">
                                    <input
                                      className={fieldInput}
                                      type="text"
                                      {...timeTextInputProps}
                                      value={trigger.startTime ?? ""}
                                      onChange={(event) =>
                                        handleUpdateAutomationTrigger(index, (current) =>
                                          current.type === "time_schedule"
                                            ? {
                                                ...current,
                                                startTime: sanitizeTimeText(event.target.value) || null,
                                                exactTime: null,
                                              }
                                            : current,
                                      )
                                    }
                                      onBlur={(event) =>
                                        handleUpdateAutomationTrigger(index, (current) =>
                                          current.type === "time_schedule"
                                            ? { ...current, startTime: normalizeTimeText(event.target.value) || null }
                                            : current,
                                        )
                                      }
                                      placeholder="Start HH:mm"
                                      aria-label="Start time in 24-hour HH:mm format"
                                    />
                                    <input
                                      className={fieldInput}
                                      type="text"
                                      {...timeTextInputProps}
                                      value={trigger.endTime ?? ""}
                                      onChange={(event) =>
                                        handleUpdateAutomationTrigger(index, (current) =>
                                          current.type === "time_schedule"
                                            ? {
                                                ...current,
                                                endTime: sanitizeTimeText(event.target.value) || null,
                                                exactTime: null,
                                              }
                                            : current,
                                      )
                                    }
                                      onBlur={(event) =>
                                        handleUpdateAutomationTrigger(index, (current) =>
                                          current.type === "time_schedule"
                                            ? { ...current, endTime: normalizeTimeText(event.target.value) || null }
                                            : current,
                                        )
                                      }
                                      placeholder="End HH:mm"
                                      aria-label="End time in 24-hour HH:mm format"
                                    />
                                  </div>
                                )}
                                <p className="text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
                                  24-hour format, for example 09:00 or 17:30.
                                </p>
                              </div>
                            );
                          })()
                        ) : null}
                        {trigger.type === "app_event" ? (
                          <div className="space-y-1.5">
                            <input
                              className={fieldInput}
                              value={trigger.appName}
                              onChange={(event) =>
                                handleUpdateAutomationTrigger(index, (current) =>
                                  current.type === "app_event" ? { ...current, appName: event.target.value } : current,
                                )
                              }
                              placeholder="App/process"
                            />
                            <select
                              className={fieldInput}
                              value={trigger.event}
                              onChange={(event) =>
                                handleUpdateAutomationTrigger(index, (current) =>
                                  current.type === "app_event"
                                    ? { ...current, event: event.target.value as "opened" | "closed" | "running" }
                                    : current,
                                )
                              }
                            >
                              <option value="running">Running</option>
                              <option value="opened">Opened</option>
                              <option value="closed">Closed</option>
                            </select>
                          </div>
                        ) : null}
                        {trigger.type === "app_lifecycle" ? (
                          <select
                            className={fieldInput}
                            value={trigger.event}
                            onChange={(event) =>
                              handleUpdateAutomationTrigger(index, (current) =>
                                current.type === "app_lifecycle"
                                  ? { ...current, event: event.target.value === "system_wake" ? "system_wake" : "app_launch" }
                                  : current,
                              )
                            }
                          >
                            <option value="app_launch">App launch</option>
                            <option value="system_wake">System wake</option>
                          </select>
                        ) : null}
                        {trigger.type === "power_source" ? (
                          <select
                            className={fieldInput}
                            value={trigger.source}
                            onChange={(event) =>
                              handleUpdateAutomationTrigger(index, (current) =>
                                current.type === "power_source"
                                  ? { ...current, source: event.target.value as "ac" | "battery" | "charging" }
                                  : current,
                              )
                            }
                          >
                            <option value="ac">AC power</option>
                            <option value="battery">Battery</option>
                            <option value="charging">Charging</option>
                          </select>
                        ) : null}
                        {trigger.type === "network_context" ? (
                          <div className="space-y-1.5">
                            <input
                              className={fieldInput}
                              value={trigger.ssid}
                              onChange={(event) =>
                                handleUpdateAutomationTrigger(index, (current) =>
                                  current.type === "network_context" ? { ...current, ssid: event.target.value } : current,
                                )
                              }
                              placeholder="Wi-Fi SSID"
                            />
                            <label className="flex h-8 items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-900">
                              <input
                                type="checkbox"
                                checked={trigger.contains ?? false}
                                onChange={(event) =>
                                  handleUpdateAutomationTrigger(index, (current) =>
                                    current.type === "network_context"
                                      ? { ...current, contains: event.target.checked }
                                      : current,
                                  )
                                }
                              />
                              Contains
                            </label>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>

                <div>
                  <strong className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Conditions
                  </strong>
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {([
                      ["display_count", "Count"],
                      ["display_ids", "Displays"],
                      ["platform", "OS"],
                      ["app_running", "App"],
                      ["power_source", "Power"],
                      ["wifi_ssid", "Wi-Fi"],
                    ] as const).map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        className={buttonBase}
                        onClick={() => handleAddAutomationCondition(kind)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {(automationDraft.conditions ?? []).map((condition, index) => (
                      <article key={`${condition.type}-${index}`} className="rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <strong className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                            {conditionLabel(condition)}
                          </strong>
                          <button
                            type="button"
                            className={iconButton}
                            aria-label="Delete condition"
                            onClick={() => handleDeleteAutomationCondition(index)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {condition.type === "display_count" ? (
                          <input
                            className={fieldInput}
                            type="number"
                            min={0}
                            value={condition.count}
                            onChange={(event) =>
                              handleUpdateAutomationCondition(index, (current) =>
                                current.type === "display_count"
                                  ? { ...current, count: Math.max(0, Number(event.target.value) || 0) }
                                  : current,
                              )
                            }
                          />
                        ) : null}
                        {condition.type === "platform" ? (
                          <select
                            className={fieldInput}
                            value={condition.platform}
                            onChange={(event) =>
                              handleUpdateAutomationCondition(index, (current) =>
                                current.type === "platform"
                                  ? { ...current, platform: event.target.value as PlatformName }
                                  : current,
                              )
                            }
                          >
                            {platformOptions().map((platform) => (
                              <option key={platform} value={platform}>
                                {platform}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {condition.type === "app_running" ? (
                          <div className="space-y-1.5">
                            <input
                              className={fieldInput}
                              value={condition.appName}
                              onChange={(event) =>
                                handleUpdateAutomationCondition(index, (current) =>
                                  current.type === "app_running"
                                    ? { ...current, appName: event.target.value }
                                    : current,
                                )
                              }
                              placeholder="App/process"
                            />
                            <label className="flex h-8 items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-900">
                              <input
                                type="checkbox"
                                checked={condition.running}
                                onChange={(event) =>
                                  handleUpdateAutomationCondition(index, (current) =>
                                    current.type === "app_running"
                                      ? { ...current, running: event.target.checked }
                                      : current,
                                  )
                                }
                              />
                              Running
                            </label>
                          </div>
                        ) : null}
                        {condition.type === "power_source" ? (
                          <select
                            className={fieldInput}
                            value={condition.source}
                            onChange={(event) =>
                              handleUpdateAutomationCondition(index, (current) =>
                                current.type === "power_source"
                                  ? { ...current, source: event.target.value as "ac" | "battery" | "charging" }
                                  : current,
                              )
                            }
                          >
                            <option value="ac">AC power</option>
                            <option value="battery">Battery</option>
                            <option value="charging">Charging</option>
                          </select>
                        ) : null}
                        {condition.type === "wifi_ssid" ? (
                          <div className="space-y-1.5">
                            <input
                              className={fieldInput}
                              value={condition.ssid}
                              onChange={(event) =>
                                handleUpdateAutomationCondition(index, (current) =>
                                  current.type === "wifi_ssid" ? { ...current, ssid: event.target.value } : current,
                                )
                              }
                              placeholder="Wi-Fi SSID"
                            />
                            <label className="flex h-8 items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 dark:border-zinc-800 dark:bg-zinc-900">
                              <input
                                type="checkbox"
                                checked={condition.contains ?? false}
                                onChange={(event) =>
                                  handleUpdateAutomationCondition(index, (current) =>
                                    current.type === "wifi_ssid"
                                      ? { ...current, contains: event.target.checked }
                                      : current,
                                  )
                                }
                              />
                              Contains
                            </label>
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>

                <div className="flex gap-1.5">
                  <button type="button" className={primaryButton} onClick={() => void handleSaveAutomationDraft()}>
                    <Save size={14} />
                    Save rule
                  </button>
                  <button type="button" className={buttonBase} onClick={() => void evaluateAutomation()}>
                    <RefreshCcw size={14} />
                    Test
                  </button>
                  <button type="button" className={buttonBase} onClick={() => setAutomationDraft(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {automationRules.length === 0 ? (
                  <p className="rounded border border-dashed border-zinc-300 p-2 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    Open a profile and add a rule from the current setup.
                  </p>
                ) : null}
                {automationRules.map((rule) => (
                  <article
                    key={rule.id}
                    className="flex items-start gap-2 rounded border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900/70"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => handleEditAutomationRule(rule.id)}
                    >
                      <strong className="block truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {rule.name}
                      </strong>
                      <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">
                        {rule.enabled ? "Enabled" : "Paused"} · {rule.triggers?.length || 1} trigger
                        {(rule.triggers?.length || 1) === 1 ? "" : "s"} · {rule.confirmationMode ?? "confirm"} ·{" "}
                        {cooldownLabel(rule.cooldownMs ?? 600_000)}
                      </span>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className={iconButton}
                        aria-label={`${rule.enabled ? "Pause" : "Enable"} ${rule.name}`}
                        onClick={() => void handleToggleAutomationRule(rule.id)}
                      >
                        <Power size={13} />
                      </button>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label={`Delete ${rule.name}`}
                        onClick={() => void deleteAutomationRule(rule.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))}
                {automationEvaluation?.matches.length ? (
                  <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-[11px] leading-4 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-100">
                    {automationEvaluation.matches.length} match
                    {automationEvaluation.matches.length === 1 ? "" : "es"} ·{" "}
                    {automationEvaluation.matches.map((match) => match.reason).join("; ")}
                  </div>
                ) : null}
              </div>
            )}
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
            <Panel position="top-left" className="!m-3">
              <div className="flex max-w-[360px] items-center gap-2 rounded border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
                <span className="min-w-0 truncate font-semibold text-zinc-900 dark:text-zinc-100">
                  {canvasProfileTitle}
                </span>
                <span
                  className={clsx(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    activeProfileMatchesOs
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200"
                      : isDirty
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                  )}
                >
                  {canvasProfileStatus}
                </span>
              </div>
            </Panel>
            {recoveryState ? (
              <Panel position="top-center" className="!m-3">
                <div className="flex max-w-[520px] items-center gap-2 rounded border border-amber-200 bg-amber-50/95 px-2.5 py-1.5 text-xs text-amber-900 shadow-sm backdrop-blur dark:border-amber-900/60 dark:bg-amber-950/90 dark:text-amber-100">
                  <span className="min-w-0 flex-1 truncate">
                    Recovery available · {recoverySecondsRemaining}s
                  </span>
                  <button type="button" className={buttonBase} onClick={() => void handleKeepRecovery()}>
                    Keep
                  </button>
                  <button type="button" className={primaryButton} onClick={() => void handleRevertRecovery()}>
                    Revert
                  </button>
                </div>
              </Panel>
            ) : null}
            {pendingAutomationMatches.length > 0 ? (
              <Panel position="bottom-center" className="!m-3">
                <div className="max-w-[520px] rounded border border-emerald-200 bg-white/95 p-2 text-xs shadow-sm backdrop-blur dark:border-emerald-900/60 dark:bg-zinc-900/95">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <strong className="truncate text-zinc-900 dark:text-zinc-100">
                      {pendingAutomationMatches.length === 1
                        ? `Apply ${pendingAutomationMatches[0].profileName}?`
                        : "Automation matches"}
                    </strong>
                    <button
                      type="button"
                      className={iconButton}
                      aria-label="Dismiss automation prompt"
                      onClick={() => void clearPendingAutomation("skipped", "Automation prompt dismissed")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {pendingAutomationMatches.map((match, index) => (
                      <button
                        key={match.rule.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-800"
                        onClick={() => void handleApplyAutomationMatch(index)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">
                            {match.profileName}
                          </span>
                          <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                            {match.reason}
                          </span>
                        </span>
                        <Zap size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              </Panel>
            ) : null}
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
                <span className="font-medium text-zinc-700 dark:text-zinc-200">{rotationLabel}</span>
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
          <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Profile Actions
                </h2>
                <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {profileActions.length} action{profileActions.length === 1 ? "" : "s"}
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={settings.profileActions.scriptsEnabled}
                  onChange={(event) => void setScriptsEnabled(event.target.checked)}
                />
                Scripts
              </label>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button type="button" className={buttonBase} onClick={() => void handleAddOpenAppAction()}>
                <AppWindow size={14} />
                App
              </button>
              <button type="button" className={buttonBase} onClick={handleAddCloseAppAction}>
                <X size={14} />
                Close
              </button>
              <button type="button" className={buttonBase} onClick={handleAddScriptAction}>
                <Terminal size={14} />
                Script
              </button>
            </div>
            {!settings.profileActions.scriptsEnabled ? (
              <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-100">
                Advanced scripts are saved but skipped until enabled.
              </p>
            ) : null}
            <div className="space-y-2">
              {profileActions.length === 0 ? (
                <p className="rounded border border-dashed border-zinc-300 p-2 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  Add apps, window placement, close-app steps, or scripts to this profile.
                </p>
              ) : null}
              {profileActions.map((action, index) => {
                const actionId = action.id ?? "";
                const conditions = action.conditions ?? {};
                return (
                  <article
                    key={actionId}
                    className="rounded border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/70"
                  >
                    <div className="mb-2 flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={actionEnabled(action)}
                        onChange={(event) =>
                          updateProfileAction(actionId, (currentAction) => ({
                            ...currentAction,
                            enabled: event.target.checked,
                          } as ProfileAction))
                        }
                      />
                      <strong className="min-w-0 flex-1 truncate text-zinc-900 dark:text-zinc-100">
                        {actionLabel(action)}
                      </strong>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label="Move action up"
                        disabled={index === 0}
                        onClick={() => moveProfileAction(actionId, -1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label="Move action down"
                        disabled={index === profileActions.length - 1}
                        onClick={() => moveProfileAction(actionId, 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label="Delete action"
                        onClick={() => deleteProfileAction(actionId)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {action.type === "open_app" ? (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                          <input
                            className={fieldInput}
                            value={action.appPath}
                            onChange={(event) =>
                              updateProfileAction(actionId, (currentAction) =>
                                currentAction.type === "open_app"
                                  ? { ...currentAction, appPath: event.target.value }
                                  : currentAction,
                              )
                            }
                            placeholder="/Applications/App.app or https://..."
                          />
                          <button
                            type="button"
                            className={buttonBase}
                            onClick={() =>
                              void pickApplicationPath().then((appPath) => {
                                if (appPath) {
                                  updateProfileAction(actionId, (currentAction) =>
                                    currentAction.type === "open_app"
                                      ? { ...currentAction, appPath }
                                      : currentAction,
                                  );
                                }
                              })
                            }
                          >
                            Pick
                          </button>
                        </div>
                        <textarea
                          className="min-h-14 w-full resize-y rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 outline-none transition focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                          value={argsToText(action.args)}
                          onChange={(event) =>
                            updateProfileAction(actionId, (currentAction) =>
                              currentAction.type === "open_app"
                                ? { ...currentAction, args: textToArgs(event.target.value) }
                                : currentAction,
                            )
                          }
                          placeholder="Arguments, one per line"
                        />
                        <div className="grid grid-cols-2 gap-1.5">
                          <label className="space-y-1">
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Delay ms</span>
                            <input
                              className={fieldInput}
                              type="number"
                              min={0}
                              value={action.delayMs ?? 0}
                              onChange={(event) =>
                                updateProfileAction(actionId, (currentAction) =>
                                  currentAction.type === "open_app"
                                    ? { ...currentAction, delayMs: Math.max(0, Number(event.target.value) || 0) }
                                    : currentAction,
                                )
                              }
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Monitor</span>
                            <select
                              className={fieldInput}
                              value={action.monitorId ?? ""}
                              onChange={(event) =>
                                updateProfileAction(actionId, (currentAction) =>
                                  currentAction.type === "open_app"
                                    ? { ...currentAction, monitorId: event.target.value || null }
                                    : currentAction,
                                )
                              }
                            >
                              <option value="">Global</option>
                              {displays.map((display) => (
                                <option key={display.stableId ?? display.id} value={display.stableId ?? display.id}>
                                  {display.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {action.position ? (
                          <div className="grid grid-cols-4 gap-1">
                            {(["x", "y", "width", "height"] as const).map((key) => (
                              <label key={key} className="space-y-1">
                                <span className="text-[10px] uppercase text-zinc-500 dark:text-zinc-400">{key}</span>
                                <input
                                  className={fieldInput}
                                  type="number"
                                  min={key === "width" || key === "height" ? 1 : undefined}
                                  value={action.position?.[key] ?? ""}
                                  onChange={(event) =>
                                    updateProfileAction(actionId, (currentAction) =>
                                      currentAction.type === "open_app"
                                        ? {
                                            ...currentAction,
                                            position: updatePositionValue(
                                              currentAction.position,
                                              key,
                                              event.target.value,
                                            ),
                                          }
                                        : currentAction,
                                    )
                                  }
                                />
                              </label>
                            ))}
                            <button
                              type="button"
                              className="col-span-4 text-left text-[11px] font-semibold text-zinc-500 underline dark:text-zinc-400"
                              onClick={() =>
                                updateProfileAction(actionId, (currentAction) =>
                                  currentAction.type === "open_app"
                                    ? { ...currentAction, position: null }
                                    : currentAction,
                                )
                              }
                            >
                              Clear placement
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-zinc-500 underline dark:text-zinc-400"
                            onClick={() =>
                              updateProfileAction(actionId, (currentAction) =>
                                currentAction.type === "open_app"
                                  ? {
                                      ...currentAction,
                                      position: { x: 0, y: 0, width: 1200, height: 800 },
                                    }
                                  : currentAction,
                              )
                            }
                          >
                            Add window placement
                          </button>
                        )}
                      </div>
                    ) : null}

                    {action.type === "close_app" ? (
                      <input
                        className={fieldInput}
                        value={action.appName}
                        onChange={(event) =>
                          updateProfileAction(actionId, (currentAction) =>
                            currentAction.type === "close_app"
                              ? { ...currentAction, appName: event.target.value }
                              : currentAction,
                          )
                        }
                        placeholder="App name"
                      />
                    ) : null}

                    {action.type === "run_script" ? (
                      <div className="space-y-1.5">
                        <input
                          className={fieldInput}
                          value={action.command}
                          disabled={!settings.profileActions.scriptsEnabled}
                          onChange={(event) =>
                            updateProfileAction(actionId, (currentAction) =>
                              currentAction.type === "run_script"
                                ? { ...currentAction, command: event.target.value }
                                : currentAction,
                            )
                          }
                          placeholder="zsh command"
                        />
                        <label className="block space-y-1">
                          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Delay ms</span>
                          <input
                            className={fieldInput}
                            type="number"
                            min={0}
                            value={action.delayMs ?? 0}
                            onChange={(event) =>
                              updateProfileAction(actionId, (currentAction) =>
                                currentAction.type === "run_script"
                                  ? { ...currentAction, delayMs: Math.max(0, Number(event.target.value) || 0) }
                                  : currentAction,
                              )
                            }
                          />
                        </label>
                      </div>
                    ) : null}

                    <div className="mt-2 grid grid-cols-3 gap-1.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                      <select
                        className={fieldInput}
                        value={conditions.platform ?? ""}
                        onChange={(event) =>
                          updateProfileAction(actionId, (currentAction) => ({
                            ...currentAction,
                            conditions: {
                              ...(currentAction.conditions ?? {}),
                              platform: (event.target.value || null) as PlatformName | null,
                            },
                          } as ProfileAction))
                        }
                      >
                        <option value="">Any OS</option>
                        <option value="macos">macOS</option>
                        <option value="windows">Windows</option>
                        <option value="linux">Linux</option>
                      </select>
                      <select
                        className={fieldInput}
                        value={conditions.displayStableId ?? ""}
                        onChange={(event) =>
                          updateProfileAction(actionId, (currentAction) => ({
                            ...currentAction,
                            conditions: {
                              ...(currentAction.conditions ?? {}),
                              displayStableId: event.target.value || null,
                            },
                          } as ProfileAction))
                        }
                      >
                        <option value="">Any display</option>
                        {displays.map((display) => (
                          <option key={display.stableId ?? display.id} value={display.stableId ?? display.id}>
                            {display.name}
                          </option>
                        ))}
                      </select>
                      <input
                        className={fieldInput}
                        type="number"
                        min={0}
                        value={conditions.displayCount ?? ""}
                        onChange={(event) =>
                          updateProfileAction(actionId, (currentAction) => ({
                            ...currentAction,
                            conditions: {
                              ...(currentAction.conditions ?? {}),
                              displayCount: maybeNumber(event.target.value),
                            },
                          } as ProfileAction))
                        }
                        placeholder="Count"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          {displayError || profileError || betaError || settingsError ? (
            <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200">
              {displayError ?? profileError ?? betaError ?? settingsError}
              <button
                type="button"
                className="mt-2 flex items-center gap-1 font-semibold underline"
                onClick={() => void handleExportDiagnostics()}
              >
                <FileDown size={13} />
                Export diagnostics
              </button>
            </div>
          ) : null}
          {lastApplyResult ? (
            <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs leading-5 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200">
              {lastProfileApplyResult?.message ?? lastApplyResult.message}
            </p>
          ) : null}
          {lastProfileApplyResult?.actionResults.length ? (
            <div className="mt-3 rounded border border-zinc-200 bg-white p-2 text-xs leading-5 dark:border-zinc-800 dark:bg-zinc-900/70">
              <strong className="block text-zinc-900 dark:text-zinc-100">Action results</strong>
              <div className="mt-1 space-y-1">
                {lastProfileApplyResult.actionResults.map((result) => (
                  <p
                    key={result.actionId}
                    className={clsx(
                      "rounded px-1.5 py-1",
                      result.status === "error"
                        ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200"
                        : result.status === "skipped"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
                    )}
                  >
                    {result.actionType.replace("_", " ")} · {result.message}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </section>
      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-3 right-3 z-50 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded border border-emerald-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 shadow-sm dark:border-emerald-900/60 dark:bg-zinc-900 dark:text-zinc-100 sm:max-w-sm"
        >
          <FileDown size={14} className="shrink-0 text-emerald-600 dark:text-emerald-300" />
          <span className="min-w-0 truncate">{toastMessage}</span>
        </div>
      ) : null}
    </main>
  );
}
