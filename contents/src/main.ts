import {
    AppSettings,
    Layout,
    loadAppConfigs,
    loadGeneralConfig,
    loadKeyboardConfigs,
    loadSecondaryAppConfigs,
} from './config';
import {
    AppWindows,
    ClientWithMaybeSecondaryConfig,
    WindowConfig,
    WindowType,
} from './types';
// Interactive console (for development): plasma-interactiveconsole --kwin
// View interactive console logs (since the ones in the application are broken on plasma): journalctl -g "js:" -f
print('!!!EMULATOR_WINDOWING_KWINSCRIPT!!!');

// TODO::this script is fairly naive about which screen should be selected; it just picks the smallest and largest.
// Consider reading the screens names (as reported by qdbus org.kde.KWin /KWin supportInformation, and possibly workspace.supportInformation()), and using dbus queries to get the ids.

// Types

// Globals

let globalMarker = 0;

function nextMarker() {
    globalMarker = (globalMarker + 1) % 1024;
    return globalMarker;
}
let screenCount = workspace.numScreens;

let primaryDisplay = 0;
let secondaryDisplay = 0;

let normalClients: { [k: string]: AppWindows } = {};
let secondaryAppClients: {
    [k: number]: ClientWithMaybeSecondaryConfig;
} = {};
let unmanagedClients: Set<KWin.AbstractClient> = new Set();

interface SettingsCache {
    [k: number]: {
        frameGeometry: QRect;
        fullScreen: boolean;
        keepAbove: boolean;
        keepBelow: boolean;
    };
}

/// settings before interacting with the script
const originalSettings: SettingsCache = {};

/// settings before being sent to background to accomodate keyboard
const tmpSettings: SettingsCache = {};

let primaryFullScreen = false;
let oldPrimaryFullScreen = false;

// Configuration

const generalConfig = loadGeneralConfig();
const appConfigs = loadAppConfigs();
const secondaryAppConfigs = loadSecondaryAppConfigs();

function setScreens(marker: number) {
    if (marker != globalMarker) {
        return;
    }

    print('Configuring screens');

    for (let i = 0; i < screenCount; i++) {
        const currentScreen = i;

        const currentDimensions = workspace.clientArea(
            KWin.FullScreenArea,
            currentScreen,
            1,
        );
        const primaryDimensions = workspace.clientArea(
            KWin.FullScreenArea,
            primaryDisplay,
            1,
        );
        const secondaryDimensions = workspace.clientArea(
            KWin.FullScreenArea,
            secondaryDisplay,
            1,
        );

        // Compare screen dimensions
        if (
            currentDimensions.height * currentDimensions.width >
            primaryDimensions.height * primaryDimensions.width
        ) {
            primaryDisplay = currentScreen;
        }

        if (
            currentDimensions.height * currentDimensions.width <
            secondaryDimensions.height * secondaryDimensions.width
        ) {
            secondaryDisplay = currentScreen;
        }
    }

    if (generalConfig.swapScreens) {
        const tmp = primaryDisplay;
        primaryDisplay = secondaryDisplay;
        secondaryDisplay = tmp;
    }

    print(
        'primary display: ',
        primaryDisplay,
        ', geometry: ',
        workspace.clientArea(KWin.FullScreenArea, primaryDisplay, 1),
    );
    print(
        'secondary display: ',
        secondaryDisplay,
        ', geometry: ',
        workspace.clientArea(KWin.FullScreenArea, secondaryDisplay, 1),
    );

    normalClients = {};
    secondaryAppClients = {};
    unmanagedClients = new Set();

    const clients = workspace.clientList();
    for (const client of clients) {
        handleClient(client, marker);
    }

    for (const app in normalClients) {
        const windows = normalClients[app];
        assertWindowsValid(windows);
        setClientWindows(
            {
                app: app,
                type: 'primary',
                settings: appConfigs[app].settings,
            },
            windows,
            marker,
        );
    }
}

// Script logic

function resetClient(client: KWin.AbstractClient, cache: SettingsCache) {
    const oldClient = cache[client.windowId];
    if (oldClient) {
        client.frameGeometry = oldClient.frameGeometry;
        client.fullScreen = oldClient.fullScreen;
        client.keepAbove = oldClient.keepAbove;
        client.keepBelow = oldClient.keepBelow;
    }
}

function assertWindowsValid(windows: AppWindows) {
    for (const scope in windows) {
        for (const window of windows[scope as WindowType]) {
            if (!window) {
                const msg = 'Scope ' + scope + ' contains invalid window';
                print(msg);
                assert(window, msg);
            }
        }
    }
}

function clientSetFullscreenOn(
    client: KWin.AbstractClient,
    settings: AppSettings,
    index: number,
    secondaryCount: number,
    marker: number,
) {
    if (marker != globalMarker) {
        return;
    }

    let layout: Layout =
        screenCount === 1
            ? settings.singleScreenLayout
            : secondaryCount === 1
            ? settings.multiScreenSingleSecondaryLayout
            : settings.multiScreenMultiSecondaryLayout ??
              settings.multiScreenSingleSecondaryLayout;

    // save old settings; failing to re-apply them breaks things (specifically Cemu)
    const screen =
        index === 0 || layout != 'separate' ? primaryDisplay : secondaryDisplay;
    print(
        'setting client',
        client.caption,
        'on screen',
        screen,
        'with layout',
        layout,
        'index',
        index,
        'with',
        secondaryCount,
        'secondaries',
    );

    const geometry = workspace.clientArea(
        KWin.FullScreenArea,
        screen,
        workspace.currentDesktop,
    );

    // swap layout engine where possible to simplify logic

    const originalLayout = layout;

    if (secondaryCount < 3) {
        layout = layout.replace('square', 'column') as Layout;
    }

    if (secondaryCount === 0) {
        layout = 'separate';
    }

    print('layout set to', layout, 'from', originalLayout, 'after analysis');

    switch (layout) {
        case 'separate':
            print('handling separate layout');

            if (index > 0) {
                const height =
                    secondaryCount > 2 ? geometry.height / 2 : geometry.height;
                const width =
                    secondaryCount > 1 ? geometry.width / 2 : geometry.width;

                if (index % 2 === 0) {
                    geometry.x += width;
                }

                if (!(index === 3 && secondaryCount === 3)) {
                    geometry.width = width;
                }

                geometry.height = height;

                if (index > 2) {
                    geometry.y += height;
                }
            }
            break;
        case 'column-left':
        case 'column-right':
            {
                const maxSecondaryWidth = geometry.width / 2;

                let secondaryHeight = geometry.height / secondaryCount;
                let secondaryWidth =
                    settings.secondaryWindowAspectRatio * secondaryHeight;

                secondaryWidth =
                    maxSecondaryWidth > secondaryWidth
                        ? secondaryWidth
                        : maxSecondaryWidth;
                if (secondaryCount > 1) {
                    secondaryHeight =
                        (1 / settings.secondaryWindowAspectRatio) *
                        secondaryWidth;
                }

                if (index === 0) {
                    if (layout === 'column-left') {
                        geometry.x += secondaryWidth;
                    }
                    geometry.width -= secondaryWidth;
                } else if (index > 0) {
                    if (layout === 'column-right') {
                        geometry.x += geometry.width - secondaryWidth;
                    }
                    const slot = index - 1;
                    geometry.y += slot * secondaryHeight;

                    geometry.width = secondaryWidth;
                    geometry.height = secondaryHeight;
                }
            }
            break;
        case 'square-left':
        case 'square-right': {
            // guaranteed to have at least 3, since we demote layout to column otherwise

            const maxSecondaryWidth = geometry.width / 4;

            let secondaryHeight = geometry.height / 2;
            let secondaryWidth =
                settings.secondaryWindowAspectRatio * secondaryHeight;
            secondaryWidth =
                maxSecondaryWidth > secondaryWidth
                    ? secondaryWidth
                    : maxSecondaryWidth;
            secondaryHeight =
                (1 / settings.secondaryWindowAspectRatio) * secondaryWidth;

            let fullHeight = geometry.height;

            if (index === 0) {
                if (layout === 'square-left') {
                    geometry.x += secondaryWidth * 2;
                }
                geometry.width -= secondaryWidth * 2;
            } else {
                if (index % 2 === 0) {
                    geometry.x += secondaryWidth;
                }

                if (index > 2) {
                    geometry.y += secondaryHeight;
                }

                if (layout === 'square-right') {
                    const primaryWidth = geometry.width - secondaryWidth * 2;
                    geometry.x += primaryWidth;
                }

                geometry.width = secondaryWidth;
                geometry.height = secondaryHeight;

                if (secondaryCount === 3) {
                    if (index === 3) {
                        geometry.width = secondaryWidth * 2;
                        geometry.height = secondaryHeight * 2;
                    }
                    geometry.y += (fullHeight - secondaryHeight * 3) / 2;
                } else {
                    geometry.y += (fullHeight - secondaryHeight * 2) / 2;
                }
            }
            break;
        }
        default:
            throw 'unhandled layout: ' + layout;
    }

    /// fullscreen settings
    if (index !== 0) {
        client.minimized = false;
        client.fullScreen = true;
    }

    if (generalConfig.keepAbove) {
        client.keepAbove = true;
    }

    client.frameGeometry = geometry;

    print(
        'client final geometry: x:',
        geometry.x,
        'y:',
        geometry.y,
        'width:',
        geometry.width,
        'height:',
        geometry.height,
    );

    if (settings.delayReconfigure) {
        delay(100, () => {
            if (marker != globalMarker) {
                return;
            }

            workspace.sendClientToScreen(client, screen);
        });
    } else {
        workspace.sendClientToScreen(client, screen);
    }
}

function calcNumWindows(windows: AppWindows): number {
    return (
        windows['primary'].length +
        windows['secondary'].length +
        windows['other'].length +
        Object.getOwnPropertyNames(secondaryAppClients).length
    );
}

function printWindows(app: string, windows: AppWindows): void {
    const len = calcNumWindows(windows);

    print('Setting', len, 'windows for app: ', app, ':');

    print(
        'primary:',
        windows['primary'].map((p) => p.caption),
    );
    print(
        'secondary:',
        windows['secondary'].map((p) => p.caption),
    );
    print(
        'other:',
        windows['other'].map((p) => p.caption),
    );
    print(
        'secondary app:',
        Object.getOwnPropertyNames(secondaryAppClients).map(
            (p) => secondaryAppClients[parseInt(p)].client.caption,
        ),
    );
}

function setClientWindows(
    config: WindowConfig,
    windows: AppWindows,
    marker: number,
) {
    if (marker != globalMarker) {
        return;
    }

    print('setting client windows for app', config.app);

    const app = config.app;

    const primaries = [...windows['primary']];
    const secondaries = windows['secondary'].map((v) => {
        return { client: v };
    });
    const other = [...windows['other']];
    const secondaryApps = Object.getOwnPropertyNames(secondaryAppClients).map(
        (p) => secondaryAppClients[parseInt(p)],
    );

    secondaries.sort((a, b) => (a.client.caption < b.client.caption ? -1 : 1));
    secondaryApps.sort((a, b) =>
        a.client.caption < b.client.caption ? -1 : 1,
    );

    const fullscreenSecondaryApps = secondaryApps.filter(
        (v) => v.secondaryConfig?.windowingBehavior === 'Fullscreen',
    );

    printWindows(app, windows);

    primaries.sort(
        (a, b) => (a.caption.length > b.caption.length ? -1 : 1), // sort primaries so that the longest window title gets selected
    );
    const primary = primaries[0];

    const sharedPrimaries: ClientWithMaybeSecondaryConfig[] = []; // secondary windows on primary screen
    const sharedSecondaries: ClientWithMaybeSecondaryConfig[] = []; // secondary windows on secondary screen

    const primarySettings = { ...config.settings };
    const secondarySettings = { ...config.settings };

    if (screenCount < 2) {
        sharedPrimaries.push(...secondaries);
        sharedPrimaries.push(...fullscreenSecondaryApps);
    } else {
        if (config.settings.multiScreenMultiSecondaryLayout === 'separate') {
            sharedSecondaries.push(...secondaries);
        } else {
            sharedPrimaries.push(...secondaries);
        }

        for (const app of fullscreenSecondaryApps) {
            print(
                'current screen preference for secondary app:',
                app.secondaryConfig?.screenPreference,
            );
            if (app.secondaryConfig?.screenPreference === 'PreferPrimary') {
                sharedPrimaries.push(app);
                const separateLayout: Layout = 'separate';
                if (
                    primarySettings.multiScreenSingleSecondaryLayout ===
                    separateLayout
                ) {
                    primarySettings.multiScreenSingleSecondaryLayout =
                        'column-right';
                }
                if (
                    primarySettings.multiScreenMultiSecondaryLayout ===
                    separateLayout
                ) {
                    primarySettings.multiScreenMultiSecondaryLayout =
                        'column-right';
                }

                print(
                    'set secondary app to primary screen; primary settings single:',
                    primarySettings.multiScreenSingleSecondaryLayout,
                    'multi:',
                    primarySettings.multiScreenMultiSecondaryLayout,
                );
            } else {
                sharedSecondaries.push(app);
                secondarySettings.multiScreenSingleSecondaryLayout = 'separate';
                secondarySettings.multiScreenMultiSecondaryLayout = 'separate';
                print('sending secondary app to secondary screen');
            }
            print('handled secondary app', app.client.caption);
        }
    }

    if (primary) {
        if (primaries.length > 1) {
            const toOther = primaries.splice(1, primaries.length - 1);
            print(
                'too many primary windows; using',
                primary.caption,
                ', ignoring',
                toOther.map((c) => c.caption),
            );
            other.push(...toOther);
        }

        if (primary.fullScreen) {
            clientSetFullscreenOn(
                primary,
                primarySettings,
                0,
                sharedPrimaries.length,
                marker,
            );

            for (const { settings, secondaries } of [
                { settings: primarySettings, secondaries: sharedPrimaries },
                { settings: secondarySettings, secondaries: sharedSecondaries },
            ]) {
                for (const client of secondaries) {
                    const index = secondaries.indexOf(client) + 1;

                    if (index <= 4) {
                        // max 4 secondary windows
                        if (primaryFullScreen) {
                            clientSetFullscreenOn(
                                client.client,
                                settings,
                                index,
                                secondaries.length,
                                marker,
                            );
                            client.client.fullScreen = true; // if the region is Full, fullscreen won't get set, so we do it manually
                        } else {
                            resetClient(client.client, originalSettings); // reset the geometry
                            client.client.fullScreen = false;
                            client.client.keepAbove = false;
                        }
                    } else {
                        print(
                            'too many secondary views; ignoring',
                            client.client.caption,
                        );
                    }
                }
            }

            for (const client of other) {
                print('handling other window:', client.caption);
                workspace.sendClientToScreen(client, secondaryDisplay);
                client.fullScreen = false;
                client.setMaximize(true, true);
                // client.keepAbove = keepAbove && (!primaryFullScreen || (!secondaries && screenCount === 1));
            }

            for (const client of unmanagedClients) {
                workspace.sendClientToScreen(client, secondaryDisplay);
            }
        }
    }
}

function getWindowConfig(
    client: KWin.AbstractClient,
): WindowConfig | ClientWithMaybeSecondaryConfig | null {
    const caption = client.caption;
    const windowClass = client.resourceClass.toString().toLowerCase();

    for (const secondaryAppConfig of secondaryAppConfigs) {
        // test secondary apps first, since they don't
        // have other windows thay may accidentally match

        const matchesPrimary = secondaryAppConfig.primary.test(caption);
        const matches = secondaryAppConfig.classes.some((wc) => {
            return windowClass.includes(wc.toLowerCase());
        });

        if (matches && matchesPrimary) {
            switch (secondaryAppConfig.windowingBehavior) {
                case 'Minimized':
                    client.fullScreen = false;
                    client.minimized = true;

                    unmanagedClients.add(client);
                    return null;
                case 'Unmanaged':
                    unmanagedClients.add(client);
                    return null;
                case 'Maximized':
                    client.fullScreen = false;
                    client.minimized = false;
                    client.setMaximize(true, true);
                    unmanagedClients.add(client);
                case 'Fullscreen':
                    const res = { client, secondaryConfig: secondaryAppConfig };
                    secondaryAppClients[client.windowId] = res;
                    return res;
                default:
                    const typecheck: never =
                        secondaryAppConfig.windowingBehavior;
                    throw typecheck ?? 'windowing behavior failed to typecheck';
            }
        }
    }

    for (const app in appConfigs) {
        // match primaries first, to avoid false positives with "other"
        // windows in the same window class. Mostly an issue with Cemu (Proton)
        // and other Proton games.
        const config = appConfigs[app];

        const matchesPrimary = config.primary.test(caption);
        const matches = config.classes.some((wc) => {
            return windowClass.toLowerCase().includes(wc.toLowerCase());
        });

        if (matches && matchesPrimary) {
            const blacklisted = config.settings.blacklist?.some((rxp) =>
                rxp.test(caption),
            );
            if (blacklisted) {
                client.fullScreen = false;
                client.minimized = true;

                print(caption, 'blacklisted by:', config.settings.blacklist);

                return null;
            }

            const res: WindowConfig = {
                app: app,
                type: 'primary',
                settings: config.settings,
            };

            print('matched', caption, 'with', res.app, 'priority', res.type);
            return res;
        }
    }

    for (const app in appConfigs) {
        // Match secondary + other windows
        const config = appConfigs[app];

        const matchesSecondary = config.secondary.test(caption);
        const matches = config.classes.some((wc) => {
            return windowClass.toLowerCase().includes(wc.toLowerCase());
        });

        if (matches) {
            const blacklisted = config.settings.blacklist?.some((rxp) =>
                rxp.test(caption),
            );
            if (blacklisted) {
                client.fullScreen = false;
                client.minimized = true;

                print(caption, 'blacklisted by:', config.settings.blacklist);

                return null;
            }

            const res: WindowConfig = {
                app: app,
                type: matchesSecondary ? 'secondary' : 'other',
                settings: config.settings,
            };

            print('matched', caption, 'with', res.app, 'priority', res.type);
            return res;
        }
    }

    print(client.caption, 'with class', windowClass, 'not matched; ignoring');

    unmanagedClients.add(client);

    return null;
}

function isWindowConfig(config: any): config is WindowConfig {
    return !!config?.settings;
}

function handleClient(client: KWin.AbstractClient, marker: number): void {
    const windowConfig = getWindowConfig(client);

    if (windowConfig) {
        saveSettings(client, originalSettings);
    }

    if (isWindowConfig(windowConfig)) {
        if (windowConfig?.settings.watchCaption) {
            client.captionChanged.disconnect(() => setScreens(globalMarker));
            client.captionChanged.connect(() => setScreens(globalMarker));
        }

        if (client.normalWindow) {
            const app = windowConfig.app;

            if (windowConfig.type === 'primary') {
                print('attaching fullscreen listener to primary window');
                primaryFullScreen = client.fullScreen;
                oldPrimaryFullScreen = primaryFullScreen;

                client.fullScreenChanged.connect(() => {
                    if (normalClients[app]?.primary.includes(client)) {
                        if (
                            !client.fullScreen &&
                            inRemoveWindow(false) &&
                            primaryFullScreen
                        ) {
                            print(
                                'setting fullscreen to former value from fullscreen change',
                            );
                            client.fullScreen = primaryFullScreen;
                        } else {
                            oldPrimaryFullScreen = primaryFullScreen;
                            primaryFullScreen = client.fullScreen;
                            print(
                                client.caption,
                                'now fullscreen:',
                                client.fullScreen,
                            );
                            setClientWindows(
                                windowConfig,
                                normalClients[app],
                                nextMarker(),
                            );
                        }
                    }
                });
            }

            if (!normalClients[app]) {
                const windows: AppWindows = {
                    primary: [],
                    secondary: [],
                    other: [],
                };
                windows[windowConfig.type] = [client];
                normalClients[app] = windows;
            } else {
                let windows = normalClients[app];
                let scope = windows[windowConfig.type];

                // print("current windows:", windows);

                windows[windowConfig.type] = scope
                    ? [...scope, client]
                    : [client];
                normalClients[app] = windows;
                // print(client.caption, "added:", windows);
            }
        }
    }
}

let fullScreenTime = new Date('1969-12-29');
let removeTime = new Date('1969-12-29');

function inRemoveWindow(forRemove: boolean) {
    const now = new Date();
    if (forRemove) {
        removeTime = now;
    } else {
        fullScreenTime = now;
    }

    const diff = Math.abs(fullScreenTime.getTime() - removeTime.getTime());
    const tooClose = diff < 100;

    return tooClose;
}

function saveSettings(client: KWin.AbstractClient, cache: SettingsCache) {
    if (!cache[client.windowId]) {
        cache[client.windowId] = {
            frameGeometry: client.frameGeometry,
            fullScreen: client.fullScreen,
            keepAbove: client.keepAbove,
            keepBelow: client.keepBelow,
        };
    }
}

// taken from https://github.com/wsdfhjxc/kwin-scripts/blob/master/experimental/experimental.js
function delay(milliseconds: number, callbackFunc: () => void) {
    var timer = new QTimer();
    timer.timeout.connect(function () {
        timer.stop();
        callbackFunc();
    });
    timer.start(milliseconds);
    return timer;
}

function setScreensOnDelay(delays: number[], marker: number) {
    for (const delayTime of delays) {
        delay(delayTime, () => setScreens(marker));
    }
}

function matchesKeyboard(client: KWin.AbstractClient): boolean {
    const keyboards = loadKeyboardConfigs();

    return !!keyboards.find(
        (k) =>
            k.primary.test(client.caption) &&
            k.classes.find((c) =>
                c
                    .toString()
                    .toLowerCase()
                    .includes(client.resourceClass.toString().toLowerCase()),
            ),
    );
}

function backgroundAllForKeyboard() {
    const clients = flattenedClients();
    console.log(
        'sending',
        clients.length,
        'clients to background for keyboard',
    );

    for (const client of clients) {
        saveSettings(client, tmpSettings);
        client.keepAbove = false;
        client.keepBelow = true;
    }
}

function restoreAllFromKeyboard() {
    const clients = flattenedClients();

    console.log(
        'restoring',
        clients.length,
        'clients from background from keyboard',
    );
    for (const client of clients) {
        resetClient(client, tmpSettings);
        delete tmpSettings[client.windowId];
    }
}

function flattenedClients(): KWin.AbstractClient[] {
    const clients = Array.from(unmanagedClients);

    for (const key in secondaryAppClients) {
        const w = secondaryAppClients[key];
        clients.push(w.client);
    }

    for (const key in normalClients) {
        const w = normalClients[key];
        clients.push(...w.other);
        clients.push(...w.secondary);
        clients.push(...w.primary);
    }

    return clients;
}

let removeId = 0;

workspace.clientAdded.connect((client) => {
    if (matchesKeyboard(client)) {
        backgroundAllForKeyboard();
        return;
    }

    if (!(client.windowId in originalSettings)) {
        const config = getWindowConfig(client);

        if (isWindowConfig(config)) {
            if (config.type === 'primary') {
                // ideally, we would also fullscreen here,
                // but Citra breaks badly, and it may not actually
                // be the desired user behavior.
                workspace.sendClientToScreen(client, primaryDisplay);
            }
        } else {
            workspace.sendClientToScreen(client, secondaryDisplay);
        }
    }
    setScreens(globalMarker);
});

workspace.clientRemoved.connect((client) => {
    const marker = nextMarker();

    if (matchesKeyboard(client)) {
        restoreAllFromKeyboard();
        return;
    }

    // Remove from unmanaged clients list
    unmanagedClients.delete(client);

    if (client.windowId in originalSettings) {
        // // reset client; things will break otherwise
        // resetClient(client, originalSettings);
        delete originalSettings[client.windowId];

        // reconfigure remaining windows
        const config = getWindowConfig(client);
        if (isWindowConfig(config)) {
            const name = config.app;
            const windows = normalClients[name];

            const primaries = windows['primary'];
            const thisRemove = ++removeId;
            if (primaries && primaries[0] && inRemoveWindow(true)) {
                const primary = primaries[0];
                delay(1000, () => {
                    const currentWindows = normalClients[name];
                    if (
                        thisRemove == removeId &&
                        currentWindows &&
                        currentWindows['primary'] &&
                        currentWindows['primary'][0] == primary
                    ) {
                        print(
                            'setting fullscreen to former value from remove window change',
                        );
                        primary.fullScreen = oldPrimaryFullScreen;
                    }
                });
            }

            // const primaries = windows[0];
            // if(primaries && primaries[0] && inRemoveWindow(true)) {
            //     print("setting fullscreen to former value from remove window change");
            //     primaries[0].fullScreen = oldPrimaryFullScreen;
            // }

            for (const scope of [
                windows['primary'],
                windows['secondary'],
                windows['other'],
            ].filter((f) => f)) {
                const index = scope.indexOf(client);
                if (index > -1) {
                    scope.splice(index, 1);
                }
            }
            normalClients[name] = windows;
            // print(client.caption, "removed, remaining:", windows.map((s) => s.map((w) => w.caption)));
            assertWindowsValid(windows);

            setClientWindows(config, windows, marker);
        } else if (config) {
            // config must be secondary app
            print('deleting secondary app client', client.windowId);
            const config = getWindowConfig(client);
            if (config && !isWindowConfig(config)) {
                delete secondaryAppClients[client.windowId];
                if (
                    config.secondaryConfig?.windowingBehavior === 'Fullscreen'
                ) {
                    print('resetting screens after removing client');
                    setScreensOnDelay([200], marker);
                }
            }
        }
    }
});

workspace.numberScreensChanged.connect((count) => {
    screenCount = count;
    setScreensOnDelay([2000, 5000], nextMarker());
});

workspace.virtualScreenGeometryChanged.connect(() => {
    setScreensOnDelay([500, 1000], nextMarker());
});

setScreens(nextMarker());
