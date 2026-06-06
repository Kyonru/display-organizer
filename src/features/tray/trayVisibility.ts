import { emit } from "@tauri-apps/api/event";
import { Image } from "@tauri-apps/api/image";
import { Menu } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LayoutProfile } from "../../shared/types";

const TRAY_ID = "display-layout-manager";
const STATUS_TITLE = "";
const ICON_SIZE = 32;
const ICON_TEMPLATE = [0, 0, 0, 255] as const;

let retainedTray: TrayIcon | null = null;
let retainedMenu: Menu | null = null;
let setupPromise: Promise<TrayIcon> | null = null;

type StatusMenuOptions = {
  profiles?: LayoutProfile[];
  activeProfileId?: string | null;
};

export async function ensureMenuBarIconVisible(
  options: StatusMenuOptions = {},
) {
  const tray = await ensureTrayIcon();
  const menu = await createStatusMenu(
    options.profiles ?? [],
    options.activeProfileId ?? null,
  );

  retainedMenu = menu;
  await tray.setMenu(menu);
}

async function ensureTrayIcon() {
  setupPromise ??= setupTrayIcon().catch((error: unknown) => {
    setupPromise = null;
    throw error;
  });

  return setupPromise;
}

async function setupTrayIcon() {
  const icon = await Image.new(createMonitorIconRgba(), ICON_SIZE, ICON_SIZE);
  const tray =
    (await TrayIcon.getById(TRAY_ID)) ??
    (await TrayIcon.new({
      id: TRAY_ID,
      tooltip: "Display Layout Manager",
      title: STATUS_TITLE,
      icon,
      iconAsTemplate: true,
      showMenuOnLeftClick: true,
    }));

  retainedTray = tray;
  await tray.setTooltip("Display Layout Manager");
  await tray.setTitle(STATUS_TITLE);
  await tray.setIconWithAsTemplate(icon, true);
  await tray.setShowMenuOnLeftClick(true);
  await tray.setVisible(true);

  return tray;
}

async function createStatusMenu(
  profiles: LayoutProfile[],
  activeProfileId: string | null,
) {
  const profileItems =
    profiles.length > 0
      ? profiles.map((profile) => ({
          id: `apply-profile-${profile.id}`,
          text:
            profile.id === activeProfileId
              ? `Current: ${profile.name}`
              : `Switch to ${profile.name}`,
          action: () => {
            void emit("tray:apply-profile", { profileId: profile.id });
          },
        }))
      : [
          {
            id: "no-profiles",
            text: "No saved layouts",
            enabled: false,
          },
        ];

  return Menu.new({
    items: [
      ...profileItems,
      { item: "Separator" },
      {
        id: "refresh-displays",
        text: "Refresh Displays",
        action: () => {
          void emit("tray:refresh-displays");
        },
      },
      {
        id: "apply-current-layout",
        text: "Apply Manual Layout",
        action: () => {
          void emit("tray:apply-current-layout");
        },
      },
      { item: "Separator" },
      {
        id: "show",
        text: "Show Display Layout Manager",
        action: () => {
          void showMainWindow();
        },
      },
      {
        item: "Quit",
        text: "Quit",
      },
    ],
  });
}

async function showMainWindow() {
  const window = getCurrentWindow();
  await window.show();
  await window.unminimize();
  await window.setFocus();
}

function createMonitorIconRgba() {
  const rgba = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);

  fillRect(rgba, 5, 6, 26, 8, ICON_TEMPLATE);
  fillRect(rgba, 5, 8, 7, 21, ICON_TEMPLATE);
  fillRect(rgba, 24, 8, 26, 21, ICON_TEMPLATE);
  fillRect(rgba, 5, 19, 26, 21, ICON_TEMPLATE);
  fillRect(rgba, 14, 22, 17, 26, ICON_TEMPLATE);
  fillRect(rgba, 10, 27, 21, 29, ICON_TEMPLATE);

  return rgba;
}

function fillRect(
  rgba: Uint8Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: readonly [number, number, number, number],
) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (x >= ICON_SIZE || y >= ICON_SIZE) {
        continue;
      }

      const index = (y * ICON_SIZE + x) * 4;
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = color[3];
    }
  }
}
