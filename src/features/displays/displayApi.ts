import { invoke } from "@tauri-apps/api/core";
import type { Display } from "../../shared/types";

export function getDisplays(): Promise<Display[]> {
  return invoke<Display[]>("get_displays");
}
