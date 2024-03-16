import { loadGeneralConfig, loadAppConfigs, loadSecondaryAppConfig, Layout, AppSettings } from "./config";
import { AppWindows, WindowConfig, WindowType } from "./types";
// Interactive console (for development): plasma-interactiveconsole --kwin
// View interactive console logs (since the ones in the application are broken on plasma): journalctl -g "js:" -f
print("!!!KWINSCRIPT!!!");

// TODO::this script is fairly naive about which screen should be selected; it just picks the smallest and largest.
// Consider reading the screens names (as reported by qdbus org.kde.KWin /KWin supportInformation, and possibly workspace.supportInformation()), and using dbus queries to get the ids.

// Types


// Globals

let screenCount = workspace.numScreens;

let primaryDisplay = 0;
let secondaryDisplay = 0;

let normalClients: { [k: string]: AppWindows } = {};
let secondaryAppClients: Set<KWin.AbstractClient> = new Set();
let unmanagedClients: Set<KWin.AbstractClient> = new Set();

const oldSettings: {
    [k: number]: {
        frameGeometry: QRect,
        fullScreen: boolean,
        keepAbove: boolean,
    }
} = {};

let primaryFullScreen = false;
let oldPrimaryFullScreen = false;

// Configuration

const generalConfig = loadGeneralConfig();
const appConfigs = loadAppConfigs();
const secondaryAppConfig = loadSecondaryAppConfig();

function setScreens() {
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

    if (generalConfig.swapScreens) {
        const tmp = primaryDisplay;
        primaryDisplay = secondaryDisplay;
        secondaryDisplay = tmp;
    }

    print("primary display: ", primaryDisplay, ", geometry: ", workspace.clientArea(KWin.MaximizeArea, primaryDisplay, 1));
    print("secondary display: ", secondaryDisplay, ", geometry: ", workspace.clientArea(KWin.MaximizeArea, secondaryDisplay, 1));

    normalClients = {};
    secondaryAppClients = new Set();
    unmanagedClients = new Set();

    const clients = workspace.clientList();
    for (const client of clients) {
        handleClient(client);
    }
}

setScreens();

// Script logic

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
}

function isStandardAspectRatio(geometry: QRect) {
    const ratio = geometry.width / geometry.height;
    const common = [16. / 9., 16. / 10., 4. / 3., 21. / 9.];
    return common.some(function (r) { return Math.abs(r - ratio) < 0.001 });
}

function clientSetFullscreenOn(client: KWin.AbstractClient, settings: AppSettings, index: number, secondaryCount: number) {
    let layout: Layout = screenCount === 1 ? settings.singleScreenLayout
        : secondaryCount === 1 ? settings.multiScreenSingleSecondaryLayout
            : settings.multiScreenMultiSecondaryLayout ?? settings.multiScreenSingleSecondaryLayout;

    // save old settings; failing to re-apply them breaks things (specifically Cemu)
    const [screen, otherScreen] = index === 0 || layout != 'separate'
        ? [primaryDisplay, secondaryDisplay]
        : [secondaryDisplay, primaryDisplay];
    print('setting client', client.caption, 'on screen', screen, 'with layout', layout, 'index', index);

    const geometry = workspace.clientArea(KWin.ScreenArea, screen, workspace.currentDesktop);

    const otherGeometry = workspace.clientArea(KWin.ScreenArea, otherScreen, workspace.currentDesktop);
    const diff = workspace.workspaceHeight - geometry.height - otherGeometry.height;
    if (diff > 0.1 && !isStandardAspectRatio(geometry)) {
        print("adding", diff, "to height to compensate for safe area");
        geometry.height += diff;
    }


    // swap layout engine where possible to simplify logic

    if (secondaryCount < 3) {
        layout = layout.replace('square', 'column') as Layout;
    }

    if (secondaryCount === 0) {
        layout = 'separate';
    }

    print('layout set to', layout, 'after analysis');

    switch (layout) {
        case 'separate':
            print("handling separate layout");

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
        case 'column-right': {
            const maxSecondaryWidth = geometry.width / 2;

            let secondaryHeight = geometry.height / secondaryCount;
            let secondaryWidth = settings.secondaryWindowAspectRatio * secondaryHeight;

            secondaryWidth = maxSecondaryWidth > secondaryWidth
                ? secondaryWidth
                : maxSecondaryWidth;
            if (secondaryCount > 1) {
                secondaryHeight = (1 / settings.secondaryWindowAspectRatio) * secondaryWidth;
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

            let secondaryHeight = geometry.height / 2
            let secondaryWidth = settings.secondaryWindowAspectRatio * secondaryHeight;
            secondaryWidth = maxSecondaryWidth > secondaryWidth
                ? secondaryWidth
                : maxSecondaryWidth;
            secondaryHeight = (1 / settings.secondaryWindowAspectRatio) * secondaryWidth;

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
                    const primaryWidth = geometry.width - (secondaryWidth * 2);
                    geometry.x += primaryWidth;
                }

                geometry.width = secondaryWidth;
                geometry.height = secondaryHeight;

                if (secondaryCount === 3) {
                    if (index === 3) {
                        geometry.width = secondaryWidth * 2;
                        geometry.height = secondaryHeight * 2;
                    }
                    geometry.y += (fullHeight - secondaryHeight * 3) / 2
                } else {
                    geometry.y += (fullHeight - secondaryHeight * 2) / 2
                }
            }
            break;

        }
        default:
            throw 'unhandled layout: ' + layout;
    };

    client.setMaximize(false, false);

    /// fullscreen settings
    if (index !== 0) {
        client.minimized = false;
        client.fullScreen = true;
    }

    if (generalConfig.keepAbove) {
        client.keepAbove = true;
    }

    client.frameGeometry = geometry;

    print("client final geometry: x:", geometry.x, "y:", geometry.y, "width:", geometry.width, "height:", geometry.height);

    if (settings.delayReconfigure) {
        delay(100, () => {
            workspace.sendClientToScreen(client, screen);
        });
    } else {
        workspace.sendClientToScreen(client, screen);
    }
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
        + windows['other'].length
        + secondaryAppClients.size;
}

function printWindows(app: string, windows: AppWindows): void {
    const len = calcNumWindows(windows);

    print("Setting", len, "windows for app: ", app, ":");

    print('primary:', windows['primary'].map((p) => p.caption));
    print('secondary:', windows['secondary'].map((p) => p.caption));
    print('other:', windows['other'].map((p) => p.caption));
    print('secondary app:', [...secondaryAppClients].map((p) => p.caption));

}

function setClientWindows(config: WindowConfig, windows: AppWindows) {
    resetPrimaryFullScreen(config, windows);

    const app = config.app;
    const len = calcNumWindows(windows);

    if (len <= 1) {
        // no meaningful work to do, skipping
        return;
    }

    const primaries = [...windows['primary']];
    const secondaries = [...windows['secondary']];
    const other = [...windows['other']];
    const secondaryApps = [...secondaryAppClients];

    secondaries.sort((a, b) => a.caption < b.caption ? -1 : 1);
    secondaryApps.sort((a, b) => a.caption < b.caption ? -1 : 1);

    printWindows(app, windows);

    const primary = primaries[0];

    const sharedPrimaries: KWin.AbstractClient[] = []; // secondary windows on primary screen
    const sharedSecondaries: KWin.AbstractClient[] = []; // secondary windows on secondary screen

    const primarySettings = { ...config.settings };
    const secondarySettings = { ...config.settings };

    if (screenCount < 2) {
        sharedPrimaries.push(...secondaries);
        sharedPrimaries.push(...secondaryApps);
    } else if (config.settings.multiScreenMultiSecondaryLayout === 'separate') {
        sharedSecondaries.push(...secondaries)
        if (secondaryApps.length > 0 && secondaryAppConfig?.windowing === 'PreferPrimary' && secondaries.length > 0) {
            sharedPrimaries.push(...secondaryApps)
            primarySettings.multiScreenMultiSecondaryLayout = 'column-right'
            primarySettings.multiScreenSingleSecondaryLayout = 'column-right'
        } else {
            sharedSecondaries.push(...secondaryApps)
        }
    } else {
        sharedPrimaries.push(...secondaries)
        sharedSecondaries.push(...secondaryApps)
        secondarySettings.multiScreenSingleSecondaryLayout = 'separate';
        secondarySettings.multiScreenMultiSecondaryLayout = 'separate';
    }

    if (primary) {
        if (primaries.length > 1) {
            primaries.sort((a, b) => a.caption.length > b.caption.length
                ? -1 : 1
            );

            const toOther = primaries.splice(1, primaries.length - 1);
            print("too many primary windows; using", primary.caption, ", ignoring", toOther.map((c) => c.caption));
            other.push(...toOther);
        }

        if (primary.fullScreen) {
            clientSetFullscreenOn(primary, primarySettings, 0, sharedPrimaries.length);
        }
    }

    for (const { settings, secondaries } of [
        { settings: primarySettings, secondaries: sharedPrimaries },
        { settings: secondarySettings, secondaries: sharedSecondaries }
    ]) {
        for (const client of secondaries) {
            const index = secondaries.indexOf(client) + 1;

            if (index <= 4) { // max 4 secondary windows
                if (primaryFullScreen) {
                    clientSetFullscreenOn(client, settings, index, secondaries.length);
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
    }

    for (const client of other) {
        print("handling other window:", client.caption);
        workspace.sendClientToScreen(client, secondaryDisplay);
        client.fullScreen = false;
        client.setMaximize(true, true);
        // client.keepAbove = keepAbove && (!primaryFullScreen || (!secondaries && screenCount === 1));
    }

    for (const client of unmanagedClients) {
        workspace.sendClientToScreen(client, secondaryDisplay);
    }
}

function getWindowConfig(client: KWin.AbstractClient): WindowConfig | null {
    const caption = client.caption;
    const windowClass = client.resourceClass.toString();
    if (secondaryAppConfig) {
        // test secondary app

        const matchesPrimary = secondaryAppConfig.primary.test(caption);
        const matches = secondaryAppConfig.classes.some((wc) => { return windowClass.includes(wc); });

        if (matches && matchesPrimary) {
            switch (secondaryAppConfig.windowing) {
                case 'Hidden':
                    client.fullScreen = false;
                    client.minimized = true;
                // explicit fallthrough
                case 'Unmanaged':
                    unmanagedClients.add(client);
                    return null;
                default:
                    secondaryAppClients.add(client)
                    return null;
            }
        }
    }

    for (const app in appConfigs) {
        const config = appConfigs[app];

        const matchesPrimary = config.primary.test(caption);
        const matchesSecondary = config.secondary.test(caption);
        const matches = config.classes.some((wc) => { return windowClass.includes(wc); });

        if (matches) {
            const blacklisted = config.settings.blacklist?.some((rxp) => rxp.test(caption));
            if (blacklisted) {
                client.fullScreen = false;
                client.minimized = true;

                print(caption, 'blacklisted by:', config.settings.blacklist);

                return null;
            }

            const res: WindowConfig = {
                app: app,
                type: matchesPrimary ? 'primary'
                    : matchesSecondary ? 'secondary'
                        : 'other',
                settings: config.settings
            };

            print("matched", caption, "with", res.app, "priority", res.type);
            return res;
        }
    }

    print(client.caption, 'with class', windowClass, 'not matched; ignoring');

    unmanagedClients.add(client);

    return null;
}


function handleClient(client: KWin.AbstractClient): void {
    const windowConfig = getWindowConfig(client);
    if (windowConfig?.settings.watchCaption) {
        client.captionChanged.disconnect(setScreens);
        client.captionChanged.connect(setScreens);
    }

    if (!oldSettings[client.windowId]) {
        oldSettings[client.windowId] = {
            frameGeometry: client.frameGeometry,
            fullScreen: client.fullScreen,
            keepAbove: client.keepAbove,
        }
    }

    if (client.normalWindow && windowConfig) {


        const app = windowConfig.app;

        if (windowConfig.type === 'primary') {
            print("attaching fullscreen listener to primary window");
            primaryFullScreen = client.fullScreen;
            oldPrimaryFullScreen = primaryFullScreen;

            client.fullScreenChanged.connect(() => {
                if (normalClients[app]?.primary.includes(client)) {
                    if (!client.fullScreen && inRemoveWindow(false) && primaryFullScreen) {
                        print("setting fullscreen to former value from fullscreen change");
                        client.fullScreen = primaryFullScreen;
                    } else {
                        oldPrimaryFullScreen = primaryFullScreen;
                        primaryFullScreen = client.fullScreen;
                        print(client.caption, "now fullscreen:", client.fullScreen);
                        setClientWindows(windowConfig, normalClients[app]);
                    }
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

function setScreensOnDelay(delays: number[]) {
    for (const delayTime of delays) {
        delay(delayTime, () => setScreens());
    }
}

workspace.numberScreensChanged.connect((count) => {
    screenCount = count;
    setScreensOnDelay([2000, 5000])
});

workspace.virtualScreenGeometryChanged.connect(() => {
    setScreensOnDelay([500, 1000])
});

setScreens();
