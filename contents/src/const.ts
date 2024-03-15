export type Layout =
    'separate' | // primary fullscreen | secondaries on secondary screen 
    'square-left' | // secondaries in a square left of primary (only useful on widescreen displays)
    'square-right' | // secondaries in a square right of primary (only useful on widescreen displays)
    'column-left' | // secondaries in a column left of primary
    'column-right'; // secondaries in a column right of primary


export interface AppConfig {
    classes: string[],
    primary: RegExp,
    secondary: RegExp,
    settings: AppSettings
}

export interface AppSettings {
    secondaryWindowAspectRatio: number,
    singleScreenLayout: Layout,
    multiScreenSingleSecondaryLayout: Layout,
    multiScreenMultiSecondaryLayout?: Layout
    blacklist?: RegExp[],
    /// Some emulators (Cemu Proton) require delay to handle windows properly;
    /// delay breaks dolphin on display reconnect, so its configurable
    delayReconfigure?: boolean
    /// Citra needs to be watched for caption changes, as, 
    /// depending on settings, the menu can become the primary window
    watchCaption?: boolean
}

export const appConfigs: { [k: string]: AppConfig } = {
    "Cemu": {
        classes: ["cemu", "cemu_relwithdebinfo"],
        primary: /^Cemu/,
        secondary: /^GamePad View/,
        settings: {
            secondaryWindowAspectRatio: 16 / 9,
            singleScreenLayout: 'column-right',
            multiScreenSingleSecondaryLayout: 'separate',
        }
    },
    "Cemu (Proton)": {
        classes: ["steam_app_"],
        primary: /^Cemu/,
        secondary: /^GamePad View/,
        settings: {
            secondaryWindowAspectRatio: 16 / 9,
            singleScreenLayout: 'column-right',
            multiScreenSingleSecondaryLayout: 'separate',
            delayReconfigure: true,
        }
    },
    "Citra": {
        classes: ["citra", "citra-qt"],
        primary: /^Citra[^\|]+\|[^\|]+$|^Citra[^\|]+\|[^\|]+\|[^\|]+Primary[^\|]*$/,
        secondary: /^Citra.*Secondary/,
        settings: {
            secondaryWindowAspectRatio: 4 / 3,
            singleScreenLayout: 'column-right',
            multiScreenSingleSecondaryLayout: 'separate',
            watchCaption: true,
        }
    },
    "Dolphin": {
        classes: ["dolphin-emu"],
        primary: /^Dolphin$|^(Dolphin.*\|)/,
        secondary: /^GBA\d+/,
        settings: {
            secondaryWindowAspectRatio: 3 / 2,
            singleScreenLayout: 'column-right',
            multiScreenSingleSecondaryLayout: 'separate',
            multiScreenMultiSecondaryLayout: 'column-right'
        }
    },
};

export type SecondaryAppWindowingBehavior = "PreferSecondary" | "PreferPrimary" | "Hidden" | "Unmanged";

export interface SecondaryAppConfig {
    primary: RegExp
    classes: string[]
    windowing: SecondaryAppWindowingBehavior
}

