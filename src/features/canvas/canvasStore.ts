import { create } from "zustand";

type CanvasState = {
  selectedDisplayIds: string[];
  snapToGrid: boolean;
  gridSize: number;
  isDirty: boolean;
  setSelectedDisplayIds: (ids: string[]) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setDirty: (isDirty: boolean) => void;
};

export const useCanvasStore = create<CanvasState>((set) => ({
  selectedDisplayIds: [],
  snapToGrid: true,
  gridSize: 20,
  isDirty: false,
  setSelectedDisplayIds: (selectedDisplayIds) =>
    set((state) => {
      const isSameSelection =
        state.selectedDisplayIds.length === selectedDisplayIds.length &&
        state.selectedDisplayIds.every((id, index) => id === selectedDisplayIds[index]);

      return isSameSelection ? state : { selectedDisplayIds };
    }),
  setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
  setDirty: (isDirty) => set({ isDirty }),
}));
