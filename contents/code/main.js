
// Interactive console (for development): plasma-interactiveconsole --kwin
// View interactive console logs (since the ones in the application are broken on plasma): journalctl -g "js:" -f
print("!!!KWINSCRIPT!!!");

// TODO::this script is fairly naive about which screen should be selected; it just picks the smallest and largest.
// Consider reading the screens names (as reported by qdbus org.kde.KWin /KWin supportInformation, and possibly workspace.supportInformation()), and using dbus queries to get the ids.

// Constants

const Region = {
    // fullscreen
    Full: "full",
    // Multi-window on secondary
    LeftHalf: "left-half",
    RightHalf: "right-half",
    UpperHalf: "upper-half",
    LowerHalf: "lower-half",
    UpperLeft: "upper-left",
    UpperRight: "upper-right",
    LowerLeft: "lower-left",
    LowerRight: "lower-right",
    // Multi-window on primary
    Squish: "squish", // primary view fullscreen, squished to allow secondaries next to it
    Slot0: "slot0",
    Slot1: "slot1",
    Slot2: "slot2",
    Slot3: "slot3",
}

const MultiWindowPolicy = {
    AllOnPrimary: "primary",
    AllOnSecondary: "secondary",
}


// TODO::the selectors should probably be regex, and be configurable (primary vs secondary)
const appSets = {
    "Cemu": {
        classes: ["cemu", "cemu_relwithdebinfo"],
        primary: /^Cemu/,
        secondary: /^GamePad View/,
    },
    "Cemu (Proton)": {
        classes: ["steam_app_"],
        primary: /^Cemu/,
        secondary: /^GamePad View/,
    },
    "Citra": {
        classes: ["citra", "citra-qt"],
        primary: /^Citra((?!Secondary).)*/,
        secondary: /^Citra.*Secondary/
    },
    "Dolphin": {
        classes: ["dolphin-emu"],
        primary: /^Dolphin$|^(Dolphin.*\|)/,
        secondary: /^GBA\d+/,
    },
};


// Configuration

/// Render primary window to smaller screen instead of larger one.
const swapScreens = false;

/// Keep app windows above other windows
const keepAbove = true;

/// policy if a multi-window application has 1 secondary screen
const singleSecondaryPolicyOption = MultiWindowPolicy.AllOnSecondary;
/// policy if a multi-window application has 2+ secondary screens
const multiSecondaryPolicyOption = MultiWindowPolicy.AllOnPrimary;

/// Number of secondary windows expected in multi-window applications (used for tiling)
const expectedMultiWindowCount = 4;
const secondaryWindowAspectRatio = 3 / 2;

// Script logic

/// policy if a multi-window application has 1 secondary screen
let singleSecondaryPolicy = singleSecondaryPolicyOption;
/// policy if a multi-window application has 2+ secondary screens
let multiSecondaryPolicy = multiSecondaryPolicyOption;
let primaryDisplay = 0;
let secondaryDisplay = 0;

function setScreens(screenCount) {
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

        const currentDimensions = workspace.clientArea(workspace.MaximizeArea, currentScreen, 1);
        const primaryDimensions = workspace.clientArea(workspace.MaximizeArea, primaryDisplay, 1);
        const secondaryDimensions = workspace.clientArea(workspace.MaximizeArea, secondaryDisplay, 1);

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

    print("primary display: ", primaryDisplay, ", geometry: ", workspace.clientArea(workspace.MaximizeArea, primaryDisplay, 1));
    print("secondary display: ", secondaryDisplay, ", geometry: ", workspace.clientArea(workspace.MaximizeArea, secondaryDisplay, 1));

    normalClients = {};
    const clients = workspace.clientList();
    for (client of clients) {
        print('handling client', client.caption, 'with class', client.resourceClass.toString())
        handleClient(client);
    }
}

const oldSettings = {};

let primaryFullScreen = false;
let oldPrimaryFullScreen = false;

function resetClient(client) {
    const oldClient = oldSettings[client];
    client.geometry = oldClient.geometry;
    client.fullScreen = oldClient.fullScreen;
    client.keepAbove = oldClient.keepAbove;
}

function assertWindowsValid(windows) {
    for (scope in windows) {
        for (window of windows[scope]) {
            if (!window) {
                const msg = "Scope " + scope + " contains invalid window";
                print(msg);
                assert(window, msg)
            }
        }
    }

    print("windows are valid");
}

function isStandardAspectRatio(geometry) {
    const ratio = geometry.width / geometry.height;
    const common = [16. / 9., 16. / 10., 4. / 3., 21. / 9.];
    return common.some(function (r) { return Math.abs(r - ratio) < 0.001 });
}

function clientSetFullscreenOn(client, screen, region, secondaryCount) {
    print("sending", client.caption, "to display", screen, region);

    // save old settings; failing to re-apply them breaks things (specifically Cemu)
    const geometry = workspace.clientArea(workspace.ScreenArea, screen, workspace.currentDesktop);

    // handle covering taskbar/safearea
    const otherScreen = screen === primaryDisplay ? secondaryDisplay : primaryDisplay;
    const otherGeometry = workspace.clientArea(workspace.ScreenArea, otherScreen, workspace.currentDesktop);
    const diff = workspace.workspaceHeight - geometry.height - otherGeometry.height;
    if (diff > 0.1 && !isStandardAspectRatio(geometry)) {
        print("adding", diff, "to height to compensate for safe area");
        geometry.height += diff;
    }

    // If left/right view, halve width
    if (["left", "right"].some((r) => { return region.includes(r); })) {
        geometry.width /= 2;
    }

    // if top/bottom view, halve height
    if (["upper", "lower"].some((r) => { return region.includes(r); })) {
        geometry.height /= 2;
    }

    // move left boundary if necessary
    if (region.includes("right")) {
        geometry.x += geometry.width;
    }

    // move top boundary if necessary
    if (region.includes("lower")) {
        geometry.y += geometry.height;
    }


    const slotHeight = geometry.height / 4;
    const slotWidth = secondaryWindowAspectRatio * slotHeight;
    const squishedWidth = geometry.width - slotWidth;

    // handle slots if squished
    if (region.includes("slot")) {
        geometry.x += squishedWidth;
        geometry.width = slotWidth;

        geometry.height = slotHeight;

        const slot = parseInt(region[4]);
        geometry.y += slot * geometry.height;
    }

    if (region === Region.Squish) {
        geometry.width = squishedWidth;
    }

    /// fullscreen settings

    if (![Region.Full, Region.Squish].some((r) => r === region)) {
        client.fullScreen = true;
    }

    if (keepAbove) {
        client.keepAbove = true;
    }
    client.geometry = geometry;

    // Cemu (Proton) won't choose the correct screen without delay
    delay(10, () => {
        workspace.sendClientToScreen(client, screen);
    })
}

function allOnSecondaryRegions(secondaries) {
    switch (secondaries.length) {
        case 0:
            print("primary only; no regions");
            // We should only call this when removing a window, if ever.
            break;

        case 1:
            return [Region.Full];

        case 2:
            return [Region.LeftHalf, Region.RightHalf];

        case 3:
            return [Region.UpperLeft, Region.RightHalf, Region.LowerLeft];

        default:
            return [Region.UpperLeft, Region.UpperRight, Region.LowerLeft, Region.LowerRight];
    }
}

function allOnPrimaryRegions(secondaries) {
    return [Region.Slot0, Region.Slot1, Region.Slot2, Region.Slot3].slice(0, secondaries.length);
};

function resetPrimaryFullScreen(set, windows) {
    if (set.priority != 0) {
        if (windows[0] && windows[0][0]) {
            const primary = windows[0][0];
            if (primary.fullScreen != primaryFullScreen) {
                print("resetting fullscreen to", primaryFullScreen);
                primary.fullScreen = primaryFullScreen;
            }
        }
    }
}

function setWindowPolicy() {
    const screens = workspace.numScreens;
    print('setting window policy with ', screens, 'screens.');

    if (screens === 1) {
        singleSecondaryPolicy = MultiWindowPolicy.AllOnPrimary;
        multiSecondaryPolicy = MultiWindowPolicy.AllOnPrimary
    } else {
        singleSecondaryPolicy = singleSecondaryPolicyOption;
        multiSecondaryPolicy = multiSecondaryPolicyOption;
    }

    print('single:', singleSecondaryPolicy, 'multiple:', multiSecondaryPolicy);
}

function setClientWindows(set, windows) {
    setWindowPolicy();
    resetPrimaryFullScreen(set, windows);

    const app = set.app;
    const len = windows.reduce((acc, value) => {
        return acc + (value ? value.length : 0);
    }, 0);

    if (len <= 1) {
        // no meaningful work to do, skipping
        return;
    }

    const primaries = windows[0];
    const secondaries = windows[1];
    const policy = (secondaries && secondaries.length >= 2) ? multiSecondaryPolicy : singleSecondaryPolicy;

    print("Setting", len, "windows for app: ", app, ":", windows.map(
        (s) => s ? s.map((c) => c.caption)
            : ""), "with policy", policy);

    const fullscreenRegion = function () {
        switch (policy) {
            case MultiWindowPolicy.AllOnPrimary:
                return Region.Squish;
            case MultiWindowPolicy.AllOnSecondary:
                return Region.Full;
        }
    }();

    if (primaries && primaries[0]) {
        const primary = primaries[0];

        if (primaries.length > 1) {
            print("too many primary windows; using,", primary, "ignoring", primaries.slice(1).map((c) => c.caption));
        }

        if (primary.fullScreen) {
            clientSetFullscreenOn(primary, primaryDisplay, fullscreenRegion, secondaries ? secondaries.length : 0);
        }
    }

    if (secondaries) {
        secondaries.sort((a, b) => a.caption < b.caption ? -1 : 1);

        const regions = policy === MultiWindowPolicy.AllOnPrimary ? allOnPrimaryRegions(secondaries) : allOnSecondaryRegions(secondaries);

        for (const window in secondaries) {
            const region = regions[window];
            const client = secondaries[window];
            if (region) {
                const display = function () {
                    switch (policy) {
                        case MultiWindowPolicy.AllOnPrimary:
                            return primaryDisplay;
                        case MultiWindowPolicy.AllOnSecondary:
                            return secondaryDisplay;
                    }
                }();
                if (primaryFullScreen) {
                    clientSetFullscreenOn(client, display, region, secondaries.length);
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

    const other = windows[2];
    if (other) {
        for (const client of other) {
            print("handling other window:", client.caption);
            workspace.sendClientToScreen(client, secondaryDisplay);
            client.fullScreen = false;
            client.setMaximize(true, true);
            client.keepAbove = keepAbove && (!primaryFullScreen || !secondaries || policy === MultiWindowPolicy.AllOnPrimary);
        }
    }
}

normalClients = {};

function getAppSet(client) {
    const caption = client.caption;
    const windowClass = client.resourceClass.toString();

    for (set in appSets) {
        const matchesPrimary = appSets[set].primary.test(caption);
        const matchesSecondary = appSets[set].secondary.test(caption);
        if (appSets[set].classes.some((wc) => { return windowClass.includes(wc); })) {
            const res = {
                app: set,
                // 0 is primary window, 1 is secondary window, 2 is other
                priority: matchesSecondary ? 1 : matchesPrimary ? 0 : 2
            };

            print("matched", caption, "with", res.app, "priority", res.priority);
            return res;
        }
    }

    print(client.caption, 'with class', windowClass, 'not matched; ignoring')

    return null;
}


function handleClient(client) {
    const set = getAppSet(client);
    if (client.normalWindow && set) {
        if (!oldSettings[client]) {
            oldSettings[client] = {
                geometry: client.geometry,
                fullScreen: client.fullScreen,
                keepAbove: client.keepAbove,
            }
        }

        const app = set.app;

        if (set.priority === 0) {
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
                    setClientWindows(set, normalClients[app]);
                }
            });
        }

        if (!normalClients[app]) {
            const windows = [];
            windows[set.priority] = [client];
            normalClients[app] = windows;
        } else {
            let windows = normalClients[app];
            let scope = windows[set.priority];

            // print("current windows:", windows);

            windows[set.priority] = scope ? [...scope, client] : [client];
            normalClients[app] = windows;
            // print(client.caption, "added:", windows);

            assertWindowsValid(windows);

            setClientWindows(set, windows);
        }
    }
}

let fullScreenTime = new Date("1969-12-29");
let removeTime = new Date("1969-12-29");

function inRemoveWindow(forRemove) {
    const now = new Date();
    if (forRemove) {
        removeTime = now;
    } else {
        fullScreenTime = now;
    }

    const diff = Math.abs(fullScreenTime - removeTime);
    const tooClose = diff < 100;

    return tooClose;
}

// taken from https://github.com/wsdfhjxc/kwin-scripts/blob/master/experimental/experimental.js
function delay(milliseconds, callbackFunc) {
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
    if (client in oldSettings) {
        // reset client; things will break otherwise
        resetClient(client);
        delete oldSettings[client];

        // reconfigure remaining windows
        const app = getAppSet(client);
        const name = app.app;
        const windows = normalClients[name];

        const primaries = windows[0];
        const thisRemove = ++removeId;
        if (primaries && primaries[0] && inRemoveWindow(true)) {
            const primary = primaries[0];
            delay(1000, () => {
                const currentWindows = normalClients[name];
                if (thisRemove == removeId && currentWindows && currentWindows[0] && currentWindows[0][0] == primary) {
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

        for (scope of windows.filter((f) => f)) {
            const index = scope.indexOf(client);
            if (index > -1) {
                scope.splice(index, 1);
            }
        }
        normalClients[name] = windows;
        // print(client.caption, "removed, remaining:", windows.map((s) => s.map((w) => w.caption)));
        assertWindowsValid(windows);
        setClientWindows(set, windows);
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
