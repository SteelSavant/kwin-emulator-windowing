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
    multiScreenMultiSecondaryLayout?: Layout | undefined,
    blacklist?: RegExp[]
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