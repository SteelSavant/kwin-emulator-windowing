interface GeneralConfig {
    /// Render primary window to smaller screen instead of larger one.
    swapScreens: boolean,
    /// Keep app windows above other windows
    keepAbove: boolean,
}

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

export type Layout =
    'separate'  // primary fullscreen | secondaries on secondary screen 
    | 'square-left'  // secondaries in a square left of primary (only useful on widescreen displays)
    | 'square-right'  // secondaries in a square right of primary (only useful on widescreen displays)
    | 'column-left'  // secondaries in a column left of primary
    | 'column-right' // secondaries in a column right of primary
    ;

interface SecondaryAppConfig {
    primary: RegExp
    classes: string[]
    windowing: SecondaryAppWindowingBehavior
}

export type SecondaryAppWindowingBehavior =
    "PreferSecondary" // If main layout is Separate, prefer secondary screen
    | "PreferPrimary" // If main layout is Separate, perefer primary screen
    | "Unmanaged" // Don't manage secondary app windows
    | "Hidden" // Like unmanaged, but minimize the windows
    ;

export function loadGeneralConfig(): GeneralConfig {
    const swapScreens: boolean = readConfigCleaned('swapScreens', false);
    const keepAbove: boolean = readConfigCleaned('keepAbove', true);

    print('General Settings:: keepAbove:', keepAbove, ', swapScreens:', swapScreens);

    return {
        swapScreens,
        keepAbove
    }
}

export function loadSecondaryAppConfig(): SecondaryAppConfig | null {
    const primaryWindowMatcher: string = readConfigCleaned('secondaryAppWindowMatcher', '');
    const classes: string[] = readConfigCleaned('secondaryAppWindowClasses', '').split(',').map((v: string) => v.trim());
    const windowingBehavior: SecondaryAppWindowingBehavior = readConfigCleaned('secondaryAppWindowingBehavior', 'PreferSecondary')

    if (primaryWindowMatcher.length > 0 && classes.length > 0) {
        print("SecondaryApp settings:: primary:", primaryWindowMatcher, 'classes:', classes, 'windowing:', windowingBehavior);

        return {
            primary: new RegExp(primaryWindowMatcher),
            classes: classes,
            windowing: windowingBehavior
        }
    } else {
        print('no secondary app config available');
        return null
    }
}

export function loadAppConfigs(): { [k: string]: AppConfig } {
    const appConfigs: { [k: string]: AppConfig } = {
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

    for (const app of ['Cemu', 'Cemu (Proton)']) {
        loadCemuSettings(appConfigs[app]);
    }

    loadCitraSettings(appConfigs['Citra']);
    loadDolphinSettings(appConfigs['Dolphin']);

    const custom = loadCustomConfig();
    if (custom) {
        appConfigs["Custom"] = custom;
    }

    return appConfigs;
}

function loadCemuSettings(config: AppConfig) // Cemu
{
    const cemuSingleScreenLayout: Layout = readConfigCleaned('cemuSingleScreenLayout', 'column-right')
        .toLowerCase();
    const cemuMultiScreenSingleSecondaryLayout: Layout = readConfigCleaned('cemuMultiScreenSingleSecondaryLayout', 'separate')
        .toLowerCase();
    print('Cemu Settings:: single:', cemuSingleScreenLayout, ', multi:', cemuMultiScreenSingleSecondaryLayout);

    const settings = config.settings;
    settings.singleScreenLayout = cemuSingleScreenLayout;
    settings.multiScreenSingleSecondaryLayout = cemuMultiScreenSingleSecondaryLayout;
}

function loadCitraSettings(config: AppConfig) {
    const citraSingleScreenLayout: Layout = readConfigCleaned('citraSingleScreenLayout', 'column-right')
        .toLowerCase();
    const citraMultiScreenSingleSecondaryLayout: Layout = readConfigCleaned('citraMultiScreenSingleSecondaryLayout', 'separate')
        .toLowerCase();

    print('Citra Settings:: single:', citraSingleScreenLayout, ', multi:', citraMultiScreenSingleSecondaryLayout);

    const settings = config.settings;
    settings.singleScreenLayout = citraSingleScreenLayout;
    settings.multiScreenSingleSecondaryLayout = citraMultiScreenSingleSecondaryLayout;
}

function loadDolphinSettings(config: AppConfig) {
    const dolphinSingleScreenLayout: Layout = readConfigCleaned('dolphinSingleScreenLayout', 'column-right')
        .toLowerCase();
    const dolphinMultiScreenSingleSecondaryLayout: Layout = readConfigCleaned('dolphinMultiScreenSingleSecondaryLayout', 'separate')
        .toLowerCase();
    const dolphinMultiScreenMultiSecondaryLayout: Layout = readConfigCleaned('dolphinMultiScreenMultiSecondaryLayout', 'column-right')
        .toLowerCase();
    const dolphinBlacklist: string = readConfigCleaned('dolphinBlacklist', '')
        .trim()
        .toUpperCase();

    print('Dolphin Settings:: single:', dolphinSingleScreenLayout,
        ', multi1:', dolphinMultiScreenSingleSecondaryLayout,
        ", multi+:", dolphinMultiScreenMultiSecondaryLayout,
        ', blacklist:', dolphinBlacklist);

    const settings = config.settings;
    settings.singleScreenLayout = dolphinSingleScreenLayout;
    settings.multiScreenSingleSecondaryLayout = dolphinMultiScreenSingleSecondaryLayout;
    settings.multiScreenMultiSecondaryLayout = dolphinMultiScreenMultiSecondaryLayout;
    settings.blacklist = dolphinBlacklist
        .split(',')
        .filter((v) => v.trim().length > 0)
        .map((v) => new RegExp(`^${v.trim()}`));
}

function loadCustomConfig(): AppConfig | null {
    const primaryWindowMatcher: string = readConfigCleaned('customPrimaryWindowMatcher', '');
    const secondaryWindowMatcher: string = readConfigCleaned('customSecondaryWindowMatcher', '');
    const classes: string = readConfigCleaned('customWindowClasses', '');
    const customSingleScreenLayout: Layout = readConfigCleaned('customSingleScreenLayout', 'column-right')
        .toLowerCase();
    const customMultiScreenSingleSecondaryLayout: Layout = readConfigCleaned('customMultiScreenSingleSecondaryLayout', 'separate')
        .toLowerCase();
    const customMultiScreenMultiSecondaryLayout: Layout = readConfigCleaned('customMultiScreenMultiSecondaryLayout', 'separate')
        .toLowerCase();

    if (primaryWindowMatcher.length > 0) {
        return {
            primary: new RegExp(primaryWindowMatcher),
            secondary: new RegExp(secondaryWindowMatcher),
            classes: classes.length > 0
                ? classes.split(',').map((v) => v.trim())
                : [],
            settings: {
                singleScreenLayout: customSingleScreenLayout,
                multiScreenSingleSecondaryLayout: customMultiScreenSingleSecondaryLayout,
                multiScreenMultiSecondaryLayout: customMultiScreenMultiSecondaryLayout,
                secondaryWindowAspectRatio: 16 / 9 // TODO::this should really be recomputed based on the window location, but this is good enough for now
            }
        }
    } else {
        print("custom app windows not configured");

        return null;
    }
}

function readConfigCleaned(key: string, defaultValue?: any): any {
    const value = readConfig(key, defaultValue);
    if (typeof (value) === 'string') {
        return value.replace(/"/g, "").trim();
    }
    return value;
}