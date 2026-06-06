import { invoke } from "@tauri-apps/api/core";
import {
  deleteMockAutomationRule,
  evaluateMockAutomationRules,
  exportMockDiagnostics,
  getMockAutomationRules,
  getMockRecoveryState,
  keepMockRecovery,
  recordMockAutomationEvent,
  revertMockRecovery,
  saveMockAutomationRule,
} from "../shared/mockBackend";
import { isTauriRuntime } from "../shared/runtime";
import type {
  AutomationEvaluation,
  AutomationEvent,
  AutomationEventType,
  AutomationRule,
  AutomationRuleDraft,
  ApplyLayoutResult,
  DiagnosticsBundle,
  RecoveryState,
} from "../shared/types";

export function getAutomationRules(): Promise<AutomationRule[]> {
  if (!isTauriRuntime()) {
    return getMockAutomationRules();
  }

  return invoke<AutomationRule[]>("get_automation_rules");
}

export function saveAutomationRule(draft: AutomationRuleDraft): Promise<AutomationRule> {
  if (!isTauriRuntime()) {
    return saveMockAutomationRule(draft);
  }

  return invoke<AutomationRule>("save_automation_rule", { draft });
}

export function deleteAutomationRule(id: string): Promise<void> {
  if (!isTauriRuntime()) {
    return deleteMockAutomationRule(id);
  }

  return invoke<void>("delete_automation_rule", { id });
}

export function evaluateAutomationRules(): Promise<AutomationEvaluation> {
  if (!isTauriRuntime()) {
    return evaluateMockAutomationRules();
  }

  return invoke<AutomationEvaluation>("evaluate_automation_rules");
}

export function recordAutomationEvent(
  ruleId: string | null,
  profileId: string | null,
  eventType: AutomationEventType,
  message: string,
): Promise<AutomationEvent> {
  if (!isTauriRuntime()) {
    return recordMockAutomationEvent(ruleId, profileId, eventType, message);
  }

  return invoke<AutomationEvent>("record_automation_event", {
    ruleId,
    profileId,
    eventType,
    message,
  });
}

export function getRecoveryState(): Promise<RecoveryState | null> {
  if (!isTauriRuntime()) {
    return getMockRecoveryState();
  }

  return invoke<RecoveryState | null>("get_recovery_state");
}

export function keepRecovery(): Promise<void> {
  if (!isTauriRuntime()) {
    return keepMockRecovery();
  }

  return invoke<void>("keep_recovery");
}

export function revertRecovery(): Promise<ApplyLayoutResult> {
  if (!isTauriRuntime()) {
    return revertMockRecovery();
  }

  return invoke<ApplyLayoutResult>("revert_recovery");
}

export function exportDiagnostics(): Promise<DiagnosticsBundle> {
  if (!isTauriRuntime()) {
    return exportMockDiagnostics();
  }

  return invoke<DiagnosticsBundle>("export_diagnostics");
}
