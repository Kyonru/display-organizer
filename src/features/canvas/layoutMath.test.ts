import { describe, expect, it } from "vitest";
import type { Display } from "../../shared/types";
import {
  canvasPositionsToLayout,
  displayNodeDimensions,
  displaysToCanvasNodes,
  displayToLayoutDisplay,
  resolveScaleOptionForLayoutDisplay,
  snapPoint,
} from "./layoutMath";

function display(overrides: Partial<Display>): Display {
  return {
    id: "1",
    stableId: "macos-cg-1",
    modeId: "mode-default",
    name: "Display",
    manufacturer: null,
    model: null,
    serialNumber: null,
    resolution: { width: 100, height: 100 },
    refreshRate: null,
    scaleFactor: 1,
    position: { x: 0, y: 0 },
    rotation: 0,
    isPrimary: false,
    isInternal: false,
    connectionType: "unknown",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    capabilities: {
      position: { supported: true, reason: null },
      primary: { supported: true, reason: null },
      rotation: { supported: true, reason: null },
      scale: { supported: true, reason: null },
    },
    scaleOptions: [
      {
        id: "mode-default",
        label: "Default",
        scaleFactor: 1,
        resolution: { width: 100, height: 100 },
        refreshRate: null,
        isCurrent: true,
      },
    ],
    ...overrides,
  };
}

const displays: Display[] = [
  display({
    id: "1",
    stableId: "macos-cg-1",
    modeId: "mode-built-in",
    name: "Built-in",
    resolution: { width: 1728, height: 1117 },
    scaleFactor: 2,
    position: { x: 0, y: 0 },
    isPrimary: true,
    isInternal: true,
    connectionType: "internal",
    bounds: { x: 0, y: 0, width: 1728, height: 1117 },
    scaleOptions: [
      {
        id: "mode-built-in",
        label: "Built-in",
        scaleFactor: 2,
        resolution: { width: 1728, height: 1117 },
        refreshRate: null,
        isCurrent: true,
      },
    ],
  }),
  display({
    id: "2",
    stableId: "macos-cg-2",
    modeId: "mode-external",
    name: "External",
    resolution: { width: 2560, height: 1440 },
    position: { x: -2560, y: 0 },
    bounds: { x: -2560, y: 0, width: 2560, height: 1440 },
    scaleOptions: [
      {
        id: "mode-external",
        label: "External",
        scaleFactor: 1,
        resolution: { width: 2560, height: 1440 },
        refreshRate: null,
        isCurrent: true,
      },
    ],
  }),
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

  it("uses a rotated node footprint for portrait display previews", () => {
    const node = displaysToCanvasNodes([
      display({
        id: "portrait",
        stableId: "macos-cg-portrait",
        bounds: { x: 0, y: 0, width: 2560, height: 1440 },
        rotation: 90,
      }),
    ])[0];

    expect(node.height).toBeGreaterThan(node.width);
  });

  it("does not double-rotate bounds already reported as portrait", () => {
    const dimensions = displayNodeDimensions(
      display({
        bounds: { x: 0, y: 0, width: 1440, height: 2560 },
        rotation: 90,
      }),
    );

    expect(dimensions.height).toBeGreaterThan(dimensions.width);
  });

  it("resolves legacy macOS mode ids to current full scale option ids", () => {
    const externalDisplay = display({
      id: "2",
      stableId: "macos-cg-2",
      modeId: "macos-mode-98-2560x1440-2560x1440-180000",
      resolution: { width: 2560, height: 1440 },
      refreshRate: 180,
      scaleFactor: 1,
      scaleOptions: [
        {
          id: "macos-mode-98-1920x1080-3840x2160-60000",
          label: "1920 x 1080",
          scaleFactor: 2,
          resolution: { width: 1920, height: 1080 },
          refreshRate: 60,
          isCurrent: false,
        },
        {
          id: "macos-mode-98-2560x1440-2560x1440-180000",
          label: "2560 x 1440",
          scaleFactor: 1,
          resolution: { width: 2560, height: 1440 },
          refreshRate: 180,
          isCurrent: true,
        },
      ],
    });
    const layoutDisplay = {
      ...displayToLayoutDisplay(externalDisplay),
      modeId: "macos-mode-98",
    };

    expect(resolveScaleOptionForLayoutDisplay(externalDisplay, layoutDisplay)?.id).toBe(
      "macos-mode-98-2560x1440-2560x1440-180000",
    );
  });
});
