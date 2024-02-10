import { AppSettings, appConfigs, Layout } from "./const";
// Interactive console (for development): plasma-interactiveconsole --kwin
// View interactive console logs (since the ones in the application are broken on plasma): journalctl -g "js:" -f
print("!!!KWINSCRIPT!!!");

// TODO::this script is fairly naive about which screen should be selected; it just picks the smallest and largest.
// Consider reading the screens names (as reported by qdbus org.kde.KWin /KWin supportInformation, and possibly workspace.supportInformation()), and using dbus queries to get the ids.


// Configuration

/// Render primary window to smaller screen instead of larger one.
const swapScreens: boolean = readConfig('swapScreens', false);

/// Keep app windows above other windows
const keepAbove: boolean = readConfig('keepAbove', false);

{
    const cemuSingleScreenLayout: Layout = readConfig('cemuSingleScreenLayout', 'column-right');
    const cemuMultiScreenSingleSecondaryLayout: Layout = readConfig('cemuMultiScreenSingleSecondaryLayout', 'separate');

    for (const app of ['Cemu', 'Cemu (Proton)']) {
        const settings = appConfigs[app].settings;
        settings.singleScreenLayout = cemuSingleScreenLayout;
        settings.multiScreenSingleSecondaryLayout = cemuMultiScreenSingleSecondaryLayout;
    }
}

{
    const citraSingleScreenLayout: Layout = readConfig('citraSingleScreenLayout', 'column-right');
    const citraMultiScreenSingleSecondaryLayout: Layout = readConfig('citraMultiScreenSingleSecondaryLayout', 'separate');

    const settings = appConfigs['Citra'].settings;
    settings.singleScreenLayout = citraSingleScreenLayout;
    settings.multiScreenSingleSecondaryLayout = citraMultiScreenSingleSecondaryLayout;
}

{
    const dolphinSingleScreenLayout: Layout = readConfig('dolphinSingleScreenLayout', 'column-right');
    const dolphinMultiScreenSingleSecondaryLayout: Layout = readConfig('dolphinMultiScreenSingleSecondaryLayout', 'separate');
    const dolphinMultiScreenMultiSecondaryLayout: Layout = readConfig('dolphinMultiScreenMultiSecondaryLayout', 'column-right');
    const dolphinBlacklist: string[] = readConfig('dolphinBlacklist', []);

    const settings = appConfigs['Dolphin'].settings;
    settings.singleScreenLayout = dolphinSingleScreenLayout;
    settings.multiScreenSingleSecondaryLayout = dolphinMultiScreenSingleSecondaryLayout;
    settings.multiScreenMultiSecondaryLayout = dolphinMultiScreenMultiSecondaryLayout;
    settings.blacklist = dolphinBlacklist.map((v) => new RegExp(`^${v}`));
}

type AppWindows = {
    [key in WindowType]: KWin.AbstractClient[]
}

// Script logic

let primaryDisplay = 0;
let secondaryDisplay = 0;

let normalClients: { [k: string]: AppWindows } = {};

function setScreens(screenCount: number) {
    const actualScreens = workspace.numScreens;
    if (screenCount != actualScreens) {
        delay(500, () => {
            const screens = workspace.numScreens;
            setScreens(screens);
        })
    }

    print("Configuring screens");

    for (let i = 0; i < screenCount; i++) {
        const currentScreen = i;

        const currentDimensions = workspace.clientArea(KWin.MaximizeArea, currentScreen, 1);
        const primaryDimensions = workspace.clientArea(KWin.MaximizeArea, primaryDisplay, 1);
        const secondaryDimensions = workspace.clientArea(KWin.MaximizeArea, secondaryDisplay, 1);

        // Compare screen dimensions
        if (currentDimensions.height * currentDimensions.width > primaryDimensions.height * primaryDimensions.width) {
            primaryDisplay = currentScreen;
        }

        if (currentDimensions.height * currentDimensions.width < secondaryDimensions.height * secondaryDimensions.width) {
            secondaryDisplay = currentScreen;
        }
    }

    if (swapScreens) {
        const tmp = primaryDisplay;
        primaryDisplay = secondaryDisplay;
        secondaryDisplay = tmp;
    }

    print("primary display: ", primaryDisplay, ", geometry: ", workspace.clientArea(KWin.MaximizeArea, primaryDisplay, 1));
    print("secondary display: ", secondaryDisplay, ", geometry: ", workspace.clientArea(KWin.MaximizeArea, secondaryDisplay, 1));

    const clients = workspace.clientList();
    for (const client of clients) {
        print('handling client', client.caption, 'with class', client.resourceClass.toString())
        handleClient(client);
    }
}

const oldSettings: {
    [k: number]: {
        frameGeometry: QRect,
        fullScreen: boolean,
        keepAbove: boolean,
    }
} = {};

let primaryFullScreen = false;
let oldPrimaryFullScreen = false;

function resetClient(client: KWin.AbstractClient) {
    const oldClient = oldSettings[client.windowId];
    client.frameGeometry = oldClient.frameGeometry;
    client.fullScreen = oldClient.fullScreen;
    client.keepAbove = oldClient.keepAbove;
}

function assertWindowsValid(windows: AppWindows) {
    for (const scope in windows) {
        for (const window of windows[(scope as WindowType)]) {
            if (!window) {
                const msg = "Scope " + scope + " contains invalid window";
                print(msg);
                assert(window, msg)
            }
        }
    }

    print("windows are valid");
}

function isStandardAspectRatio(geometry: QRect) {
    const ratio = geometry.width / geometry.height;
    const common = [16. / 9., 16. / 10., 4. / 3., 21. / 9.];
    return common.some(function (r) { return Math.abs(r - ratio) < 0.001 });
}

function clientSetFullscreenOn(client: KWin.AbstractClient, settings: AppSettings, index: number, secondaryCount: number) {
    let layout: Layout = workspace.numScreens === 1 ? settings.singleScreenLayout
        : secondaryCount === 1 ? settings.multiScreenSingleSecondaryLayout
            : settings.multiScreenMultiSecondaryLayout ?? settings.multiScreenSingleSecondaryLayout;

    // save old settings; failing to re-apply them breaks things (specifically Cemu)
    const [screen, otherScreen] = index === 0 || layout != 'separate'
        ? [primaryDisplay, secondaryDisplay]
        : [secondaryDisplay, primaryDisplay];

    print('setting client', client, 'on screen', screen, 'with layout', layout, 'index', index);

    const geometry = workspace.clientArea(KWin.ScreenArea, screen, workspace.currentDesktop);

    const otherGeometry = workspace.clientArea(KWin.ScreenArea, otherScreen, workspace.currentDesktop);
    const diff = workspace.workspaceHeight - geometry.height - otherGeometry.height;
    if (diff > 0.1 && !isStandardAspectRatio(geometry)) {
        print("adding", diff, "to height to compensate for safe area");
        geometry.height += diff;
    }

    let maxSecondaryWidth = geometry.width / 2;

    // swap layout engine where possible to simplify logic
    if (index > 0) {
        if (secondaryCount < 3) {
            if (layout === 'square-left') {
                layout = 'column-left';
            } else if (layout === 'square-right') {
                layout = 'column-right';
            }
        }
    } else if (secondaryCount === 0) {
        layout = 'separate';
    }

    print('layout set to', layout, 'after analysis');

    switch (layout) {
        case 'separate':
            if (index > 0) {
                const height = secondaryCount > 2
                    ? geometry.height / 2
                    : geometry.height
                const width = secondaryCount > 1
                    ? geometry.width / 2
                    : geometry.width;

                if (index % 2 === 0) {
                    geometry.x += width;
                }

                if (index === 3 && secondaryCount === 3) {
                    geometry.x += width / 2;
                }

                if (index > 2) {
                    geometry.y += height;
                }

                geometry.width = width;
                geometry.height = height;
            }
            break;
        case 'column-left':
        case 'column-right': {
            let secondaryHeight = geometry.height / secondaryCount;
            let secondaryWidth = settings.secondaryWindowAspectRatio * secondaryHeight;

            secondaryWidth = maxSecondaryWidth > secondaryWidth
                ? secondaryWidth
                : maxSecondaryWidth;
            secondaryHeight = (1 / settings.secondaryWindowAspectRatio) * secondaryWidth;

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

            let secondaryHeight = geometry.height / 2
            let secondaryWidth = settings.secondaryWindowAspectRatio * secondaryHeight;
            secondaryWidth = maxSecondaryWidth > secondaryWidth
                ? secondaryWidth
                : maxSecondaryWidth;
            secondaryHeight = (1 / settings.secondaryWindowAspectRatio) * secondaryWidth;

            if (index === 0) {
                if (layout === 'square-left') {
                    geometry.x += secondaryWidth * 2;
                }
                geometry.width -= secondaryWidth * 2;
            } else {
                if (index % 2 === 0) {
                    geometry.x += secondaryWidth;
                }

                if (index === 3 && secondaryCount === 3) {
                    geometry.x += secondaryWidth / 2;
                }

                if (index > 2) {
                    geometry.y += secondaryHeight;
                }

                if (layout === 'square-right') {
                    const primaryWidth = geometry.width - (secondaryWidth * 2);
                    geometry.x += primaryWidth;
                }

                geometry.width = secondaryWidth;
                geometry.height = secondaryHeight;
            }
            break;
        }
    };

    /// fullscreen settings
    if (index !== 0) {
        client.minimized = false;
        client.fullScreen = true;
    }

    if (keepAbove) {
        client.keepAbove = true;
    }
    client.frameGeometry = geometry;

    // Cemu (Proton) won't choose the correct screen without delay
    delay(10, () => {
        workspace.sendClientToScreen(client, screen);
    })
}

function resetPrimaryFullScreen(config: WindowConfig, windows: AppWindows) {
    if (config.type != 'primary') {
        const primary = windows['primary'][0];
        if (primary) {
            if (primary.fullScreen != primaryFullScreen) {
                print("resetting fullscreen to", primaryFullScreen);
                primary.fullScreen = primaryFullScreen;
            }
        }
    }
}

function calcNumWindows(windows: AppWindows): number {
    return windows['primary'].length
        + windows['secondary'].length
        + windows['other'].length;
}

function printWindows(app: string, len: number, windows: AppWindows): void {
    print("Setting", len, "windows for app: ", app, ":", windows);
}

function setClientWindows(config: WindowConfig, windows: AppWindows) {
    resetPrimaryFullScreen(config, windows);

    const app = config.app;
    const len = calcNumWindows(windows);

    if (len <= 1) {
        // no meaningful work to do, skipping
        return;
    }

    const primaries = windows['primary'];
    const secondaries = windows['secondary'];

    printWindows(app, len, windows);

    const primary = primaries[0];

    if (primary) {
        if (primaries.length > 1) {
            print("too many primary windows; using,", primary, "ignoring", primaries.slice(1).map((c) => c.caption));
        }

        if (primary.fullScreen) {
            clientSetFullscreenOn(primary, config.settings, 0, secondaries ? secondaries.length : 0);
        }
    }


    secondaries.sort((a, b) => a.caption < b.caption ? -1 : 1);

    for (const client of secondaries) {
        const index = secondaries.indexOf(client) + 1;

        if (index <= 4) { // max 4 secondary windows
            if (primaryFullScreen) {
                clientSetFullscreenOn(client, config.settings, index, secondaries.length);
                client.fullScreen = true; // if the region is Full, fullscreen won't get set, so we do it manually
            } else {
                resetClient(client); // reset the geometry
                client.fullScreen = false;
                client.keepAbove = false;
            }
        } else {
            print("too many secondary views; ignoring", client.caption);
        }
    }

    const other = windows['other'];

    for (const client of other) {
        print("handling other window:", client.caption);
        workspace.sendClientToScreen(client, secondaryDisplay);
        client.fullScreen = false;
        client.setMaximize(true, true);
        client.keepAbove = keepAbove && (!primaryFullScreen || (!secondaries && workspace.numScreens === 1));
    }
}

type WindowType = 'primary' | 'secondary' | 'other';

interface WindowConfig {
    app: string,
    type: WindowType,
    settings: AppSettings,
}

function getWindowConfig(client: KWin.AbstractClient): WindowConfig | null {
    const caption = client.caption;
    const windowClass = client.resourceClass.toString();

    for (const app in appConfigs) {
        const config = appConfigs[app];

        const matchesPrimary = config.primary.test(caption);
        const matchesSecondary = config.secondary.test(caption);
        const matches = config.classes.some((wc) => { return windowClass.includes(wc); })
        const blacklisted = config.settings.blacklist?.some((rxp) => rxp.test(windowClass))
        print('tmp: blacklist:', config.settings.blacklist);
        if (matches && !blacklisted) {
            const res: WindowConfig = {
                app: app,
                // 0 is primary window, 1 is secondary window, 2 is other
                type: matchesSecondary ? 'secondary'
                    : matchesPrimary ? 'primary'
                        : 'other',
                settings: config.settings
            };

            print("matched", caption, "with", res.app, "priority", res.type);
            return res;
        }
    }

    print(client.caption, 'with class', windowClass, 'not matched; ignoring')

    return null;
}


function handleClient(client: KWin.AbstractClient): void {
    const windowConfig = getWindowConfig(client);
    if (client.normalWindow && windowConfig) {
        if (!oldSettings[client.windowId]) {
            oldSettings[client.windowId] = {
                frameGeometry: client.frameGeometry,
                fullScreen: client.fullScreen,
                keepAbove: client.keepAbove,
            }
        }

        const app = windowConfig.app;

        if (windowConfig.type === 'primary') {
            print("attaching fullscreen listener to primary window");
            primaryFullScreen = client.fullScreen;
            oldPrimaryFullScreen = primaryFullScreen;

            client.fullScreenChanged.connect(() => {
                if (!client.fullScreen && inRemoveWindow(false) && primaryFullScreen) {
                    print("setting fullscreen to former value from fullscreen change");
                    client.fullScreen = primaryFullScreen;
                } else {
                    oldPrimaryFullScreen = primaryFullScreen;
                    primaryFullScreen = client.fullScreen;
                    print(client.caption, "now fullscreen:", client.fullScreen);
                    setClientWindows(windowConfig, normalClients[app]);
                }
            });
        }

        if (!normalClients[app]) {
            const windows: AppWindows = {
                'primary': [],
                'secondary': [],
                'other': []
            };
            windows[windowConfig.type] = [client];
            normalClients[app] = windows;
        } else {
            let windows = normalClients[app];
            let scope = windows[windowConfig.type];

            // print("current windows:", windows);

            windows[windowConfig.type] = scope ? [...scope, client] : [client];
            normalClients[app] = windows;
            // print(client.caption, "added:", windows);

            assertWindowsValid(windows);
            setClientWindows(windowConfig, windows);
        }
    }
}

let fullScreenTime = new Date("1969-12-29");
let removeTime = new Date("1969-12-29");

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

let removeId = 0;

workspace.clientAdded.connect(handleClient);
workspace.clientRemoved.connect((client) => {
    if (client.windowId in oldSettings) {
        // reset client; things will break otherwise
        resetClient(client);
        delete oldSettings[client.windowId];

        // reconfigure remaining windows
        const config = getWindowConfig(client);
        if (config === null) {
            return;
        }

        const name = config.app;
        const windows = normalClients[name];

        const primaries = windows['primary'];
        const thisRemove = ++removeId;
        if (primaries && primaries[0] && inRemoveWindow(true)) {
            const primary = primaries[0];
            delay(1000, () => {
                const currentWindows = normalClients[name];
                if (thisRemove == removeId && currentWindows && currentWindows['primary'] && currentWindows['primary'][0] == primary) {
                    print("setting fullscreen to former value from remove window change");
                    primary.fullScreen = oldPrimaryFullScreen;
                }
            });
        }

        // const primaries = windows[0];
        // if(primaries && primaries[0] && inRemoveWindow(true)) {
        //     print("setting fullscreen to former value from remove window change");
        //     primaries[0].fullScreen = oldPrimaryFullScreen;
        // }

        for (const scope of [windows['primary'], windows['secondary'], windows['other']].filter((f) => f)) {
            const index = scope.indexOf(client);
            if (index > -1) {
                scope.splice(index, 1);
            }
        }
        normalClients[name] = windows;
        // print(client.caption, "removed, remaining:", windows.map((s) => s.map((w) => w.caption)));
        assertWindowsValid(windows);
        setClientWindows(config, windows);
    }
})

workspace.numberScreensChanged.connect((count) => {
    delay(2000, () => setScreens(count));
});

workspace.screenResized.connect((screen) => {
    if (primaryDisplay === screen || secondaryDisplay === screen) {
        const screens = workspace.numScreens;

        delay(500, () => setScreens(screens));
    }
})

const screens = workspace.numScreens;
setScreens(screens);
