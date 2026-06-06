import type { Display, Layout, LayoutDisplay, Point } from "../../shared/types";

export const CANVAS_SCALE = 0.18;
export const NODE_MIN_WIDTH = 120;
export const NODE_MIN_HEIGHT = 78;

export type CanvasNodeModel = {
  id: string;
  display: Display;
  position: Point;
  width: number;
  height: number;
};

type ScaleOption = Display["scaleOptions"][number];

function isSidewaysRotation(rotation: Display["rotation"]): boolean {
  return rotation === 90 || rotation === 270;
}

export function displayNodeDimensions(display: Display) {
  const longSide = Math.max(display.bounds.width, display.bounds.height) * CANVAS_SCALE;
  const shortSide = Math.min(display.bounds.width, display.bounds.height) * CANVAS_SCALE;

  return isSidewaysRotation(display.rotation)
    ? {
        width: Math.max(NODE_MIN_WIDTH, shortSide),
        height: Math.max(NODE_MIN_HEIGHT, longSide),
      }
    : {
        width: Math.max(NODE_MIN_WIDTH, longSide),
        height: Math.max(NODE_MIN_HEIGHT, shortSide),
      };
}

export function displayToLayoutDisplay(display: Display): LayoutDisplay {
  return {
    stableId: display.stableId ?? display.id,
    modeId:
      display.modeId ??
      display.scaleOptions.find((option) => option.isCurrent)?.id ??
      null,
    position: { ...display.position },
    resolution: { ...display.resolution },
    refreshRate: display.refreshRate,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    enabled: true,
  };
}

function isLegacyMacosModeId(modeId: string): boolean {
  return /^macos-mode-\d+$/.test(modeId);
}

function modeIdMatchesOption(requestedModeId: string, optionId: string): boolean {
  if (requestedModeId === optionId) {
    return true;
  }

  return isLegacyMacosModeId(requestedModeId) && optionId.startsWith(`${requestedModeId}-`);
}

function scaleOptionScore(option: ScaleOption, layoutDisplay: LayoutDisplay): number {
  const widthBase = Math.max(option.resolution.width, layoutDisplay.resolution.width, 1);
  const heightBase = Math.max(option.resolution.height, layoutDisplay.resolution.height, 1);
  const widthDelta = Math.abs(option.resolution.width - layoutDisplay.resolution.width) / widthBase;
  const heightDelta =
    Math.abs(option.resolution.height - layoutDisplay.resolution.height) / heightBase;
  const scaleDelta = Math.abs(option.scaleFactor - layoutDisplay.scaleFactor);
  const refreshDelta =
    option.refreshRate !== null && layoutDisplay.refreshRate !== null
      ? Math.abs(option.refreshRate - layoutDisplay.refreshRate) /
        Math.max(option.refreshRate, layoutDisplay.refreshRate, 1)
      : 0;

  return widthDelta * 10 + heightDelta * 10 + scaleDelta + refreshDelta;
}

export function resolveScaleOptionForLayoutDisplay(
  display: Display,
  layoutDisplay: LayoutDisplay,
): ScaleOption | null {
  const requestedModeId = layoutDisplay.modeId ?? null;

  if (requestedModeId) {
    const candidates = display.scaleOptions.filter((option) =>
      modeIdMatchesOption(requestedModeId, option.id),
    );

    if (candidates.length > 0) {
      return [...candidates].sort(
        (a, b) => scaleOptionScore(a, layoutDisplay) - scaleOptionScore(b, layoutDisplay),
      )[0];
    }

    return null;
  }

  return (
    display.scaleOptions
      .filter(
        (option) =>
          option.resolution.width === layoutDisplay.resolution.width &&
          option.resolution.height === layoutDisplay.resolution.height,
      )
      .sort((a, b) => scaleOptionScore(a, layoutDisplay) - scaleOptionScore(b, layoutDisplay))[0] ??
    null
  );
}

export function displaysToLayout(displays: Display[]): Layout {
  return {
    displays: displays.map(displayToLayoutDisplay),
    primaryDisplayStableId:
      displays.find((display) => display.isPrimary)?.stableId ??
      displays.find((display) => display.isPrimary)?.id ??
      displays[0]?.stableId ??
      displays[0]?.id ??
      null,
  };
}

function valuesWithin(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

function optionalRefreshRatesMatch(left: number | null, right: number | null): boolean {
  if (left === null || right === null) {
    return true;
  }

  return valuesWithin(left, right, 0.5);
}

function layoutDisplayMatches(left: LayoutDisplay, right: LayoutDisplay): boolean {
  return (
    valuesWithin(left.position.x, right.position.x, 1) &&
    valuesWithin(left.position.y, right.position.y, 1) &&
    left.resolution.width === right.resolution.width &&
    left.resolution.height === right.resolution.height &&
    valuesWithin(left.scaleFactor, right.scaleFactor, 0.02) &&
    optionalRefreshRatesMatch(left.refreshRate, right.refreshRate) &&
    left.rotation === right.rotation
  );
}

export function layoutsMatch(left: Layout, right: Layout): boolean {
  const leftDisplays = left.displays.filter((display) => display.enabled);
  const rightDisplays = right.displays.filter((display) => display.enabled);

  if (leftDisplays.length !== rightDisplays.length) {
    return false;
  }

  if (
    left.primaryDisplayStableId &&
    right.primaryDisplayStableId &&
    left.primaryDisplayStableId !== right.primaryDisplayStableId
  ) {
    return false;
  }

  const rightById = new Map(rightDisplays.map((display) => [display.stableId, display]));

  return leftDisplays.every((leftDisplay) => {
    const rightDisplay = rightById.get(leftDisplay.stableId);
    return rightDisplay ? layoutDisplayMatches(leftDisplay, rightDisplay) : false;
  });
}

export function displaysToCanvasNodes(displays: Display[]): CanvasNodeModel[] {
  const minX = Math.min(0, ...displays.map((display) => display.position.x));
  const minY = Math.min(0, ...displays.map((display) => display.position.y));

  return displays.map((display) => {
    const { width, height } = displayNodeDimensions(display);

    return {
      id: display.stableId ?? display.id,
      display,
      width,
      height,
      position: {
        x: (display.position.x - minX) * CANVAS_SCALE,
        y: (display.position.y - minY) * CANVAS_SCALE,
      },
    };
  });
}

export function canvasPositionsToLayout(
  displays: Display[],
  positions: Record<string, Point>,
): Layout {
  const nodes = displaysToCanvasNodes(displays);
  const displayById = new Map(displays.map((display) => [display.stableId ?? display.id, display]));
  const firstNode = nodes[0];
  const firstPosition = firstNode ? positions[firstNode.id] ?? firstNode.position : { x: 0, y: 0 };
  const firstDisplay = firstNode ? displayById.get(firstNode.id) : null;
  const offsetX = firstDisplay ? firstDisplay.position.x - firstPosition.x / CANVAS_SCALE : 0;
  const offsetY = firstDisplay ? firstDisplay.position.y - firstPosition.y / CANVAS_SCALE : 0;

  return {
    primaryDisplayStableId:
      displays.find((display) => display.isPrimary)?.stableId ??
      displays.find((display) => display.isPrimary)?.id ??
      null,
    displays: nodes.map((node) => {
      const display = displayById.get(node.id);
      if (!display) {
        throw new Error(`Unknown display node ${node.id}`);
      }

      const position = positions[node.id] ?? node.position;
      return {
        ...displayToLayoutDisplay(display),
        position: {
          x: Math.round(position.x / CANVAS_SCALE + offsetX),
          y: Math.round(position.y / CANVAS_SCALE + offsetY),
        },
      };
    }),
  };
}

export function snapPoint(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
