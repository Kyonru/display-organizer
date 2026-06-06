import { create } from "zustand";
import type {
  AutomationEvaluation,
  AutomationEventType,
  AutomationMatchResult,
  AutomationRule,
  AutomationRuleDraft,
  DiagnosticsBundle,
  RecoveryState,
} from "../shared/types";
import * as api from "./betaApi";

type BetaState = {
  automationRules: AutomationRule[];
  automationEvaluation: AutomationEvaluation | null;
  pendingAutomationMatches: AutomationMatchResult[];
  recoveryState: RecoveryState | null;
  diagnostics: DiagnosticsBundle | null;
  error: string | null;
  loadAutomationRules: () => Promise<void>;
  saveAutomationRule: (draft: AutomationRuleDraft) => Promise<AutomationRule | null>;
  deleteAutomationRule: (id: string) => Promise<void>;
  evaluateAutomation: () => Promise<AutomationEvaluation | null>;
  clearPendingAutomation: (eventType?: AutomationEventType, message?: string) => Promise<void>;
  loadRecoveryState: () => Promise<void>;
  keepRecovery: () => Promise<void>;
  revertRecovery: () => Promise<boolean>;
  exportDiagnostics: () => Promise<DiagnosticsBundle | null>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useBetaStore = create<BetaState>((set, get) => ({
  automationRules: [],
  automationEvaluation: null,
  pendingAutomationMatches: [],
  recoveryState: null,
  diagnostics: null,
  error: null,
  loadAutomationRules: async () => {
    set({ error: null });
    try {
      set({ automationRules: await api.getAutomationRules() });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  saveAutomationRule: async (draft) => {
    set({ error: null });
    try {
      const rule = await api.saveAutomationRule(draft);
      set({
        automationRules: [
          rule,
          ...get().automationRules.filter((item) => item.id !== rule.id),
        ],
      });
      return rule;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },
  deleteAutomationRule: async (id) => {
    set({ error: null });
    try {
      await api.deleteAutomationRule(id);
      set({ automationRules: get().automationRules.filter((rule) => rule.id !== id) });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  evaluateAutomation: async () => {
    set({ error: null });
    try {
      const evaluation = await api.evaluateAutomationRules();
      set({
        automationEvaluation: evaluation,
        pendingAutomationMatches: evaluation.matches,
      });
      return evaluation;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },
  clearPendingAutomation: async (eventType = "skipped", message = "Automation prompt dismissed") => {
    const matches = get().pendingAutomationMatches;
    set({ pendingAutomationMatches: [] });
    await Promise.all(
      matches.map((match) =>
        api.recordAutomationEvent(match.rule.id, match.rule.profileId, eventType, message),
      ),
    ).catch((error) => set({ error: errorMessage(error) }));
  },
  loadRecoveryState: async () => {
    set({ error: null });
    try {
      set({ recoveryState: await api.getRecoveryState() });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  keepRecovery: async () => {
    set({ error: null });
    try {
      await api.keepRecovery();
      set({ recoveryState: null });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  },
  revertRecovery: async () => {
    set({ error: null });
    try {
      await api.revertRecovery();
      set({ recoveryState: null });
      return true;
    } catch (error) {
      set({ error: errorMessage(error) });
      return false;
    }
  },
  exportDiagnostics: async () => {
    set({ error: null });
    try {
      const diagnostics = await api.exportDiagnostics();
      set({ diagnostics });
      return diagnostics;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },
}));
