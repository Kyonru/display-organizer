import { invoke } from "@tauri-apps/api/core";
import type { Display } from "../../shared/types";
import { mockDisplays } from "../../shared/mockBackend";
import { isTauriRuntime } from "../../shared/runtime";

export function getDisplays(): Promise<Display[]> {
  if (!isTauriRuntime()) {
    return Promise.resolve(mockDisplays);
  }

  return invoke<Display[]>("get_displays");
}
