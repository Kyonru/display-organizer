import { describe, expect, it } from "vitest";
import type { Display } from "../../shared/types";
import { canvasPositionsToLayout, displaysToCanvasNodes, snapPoint } from "./layoutMath";

const displays: Display[] = [
  {
    id: "1",
    stableId: "macos-cg-1",
    name: "Built-in",
    manufacturer: null,
    model: null,
    serialNumber: null,
    resolution: { width: 1728, height: 1117 },
    refreshRate: null,
    scaleFactor: 2,
    position: { x: 0, y: 0 },
    rotation: 0,
    isPrimary: true,
    isInternal: true,
    connectionType: "internal",
    bounds: { x: 0, y: 0, width: 1728, height: 1117 },
  },
  {
    id: "2",
    stableId: "macos-cg-2",
    name: "External",
    manufacturer: null,
    model: null,
    serialNumber: null,
    resolution: { width: 2560, height: 1440 },
    refreshRate: null,
    scaleFactor: 1,
    position: { x: -2560, y: 0 },
    rotation: 0,
    isPrimary: false,
    isInternal: false,
    connectionType: "unknown",
    bounds: { x: -2560, y: 0, width: 2560, height: 1440 },
  },
];

describe("layoutMath", () => {
  it("normalizes negative OS coordinates into positive canvas coordinates", () => {
    const nodes = displaysToCanvasNodes(displays);

    expect(nodes.find((node) => node.id === "macos-cg-2")?.position).toEqual({ x: 0, y: 0 });
    expect(nodes.find((node) => node.id === "macos-cg-1")?.position.x).toBeGreaterThan(0);
  });

  it("converts dragged canvas nodes back to logical layout coordinates", () => {
    const nodes = displaysToCanvasNodes(displays);
    const positions = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
    positions["macos-cg-2"] = { ...positions["macos-cg-2"], x: positions["macos-cg-2"].x + 180 };

    const layout = canvasPositionsToLayout(displays, positions);

    expect(layout.displays.find((display) => display.stableId === "macos-cg-2")?.position.x).toBe(-1560);
  });

  it("snaps points to a fixed grid", () => {
    expect(snapPoint({ x: 31, y: 47 }, 20)).toEqual({ x: 40, y: 40 });
  });
});
