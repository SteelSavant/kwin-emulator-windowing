
// Interactive console (for development): plasma-interactiveconsole --kwin
// View interactive console logs (since the ones in the application are broken on plasma): journalctl -g "js:" -f
print("!!!KWINSCRIPT!!!");

// TODO::this script is fairly naive about which screen should be selected; it just picks the smallest and largest.
// Consider reading the screens names (as reported by qdbus org.kde.KWin /KWin supportInformation, and possibly workspace.supportInformation()), and using dbus queries to get the ids.

// Constants

const Layout = {
    Separate: 'separate', // primary fullscreen, secondaries on secondary screen,
    SquareLeft: 'square-left', // secondaries in a square left of primary
    SquareRight: 'square-right', // secondaries in a square right of primary
    ColumnLeft: 'column-left', // secondaries in a column left of primary
    ColumnRight: 'column-right', // secondaries in a column right of primary
}

const appSets = {
    "Cemu": {
        classes: ["cemu", "cemu_relwithdebinfo"],
        primary: /^Cemu/,
        secondary: /^GamePad View/,
        settings: {
            secondaryWindowAspectRatio: 16 / 9,
            singleScreenLayout: Layout.ColumnRight,
            multiScreenLayout: Layout.Separate,
        }
    },
    "Cemu (Proton)": {
        classes: ["steam_app_"],
        primary: /^Cemu/,
        secondary: /^GamePad View/,
        settings: {
            secondaryWindowAspectRatio: 16 / 9,
            singleScreenLayout: Layout.ColumnRight,
            multiScreenLayout: Layout.Separate,
        }
    },
    "Citra": {
        classes: ["citra", "citra-qt"],
        primary: /^Citra((?!Secondary).)*|((?!Secondary).)*/,
        secondary: /^Citra.*Secondary/,
        settings: {
            secondaryWindowAspectRatio: 4 / 3,
            singleScreenLayout: Layout.ColumnRight,
            multiScreenLayout: Layout.Separate,
        }
    },
    "Dolphin": {
        classes: ["dolphin-emu"],
        primary: /^Dolphin$|^(Dolphin.*\|)/,
        secondary: /^GBA\d+/,
        settings: {
            secondaryWindowAspectRatio: 3 / 2,
            singleScreenLayout: Layout.SquareRight,
            multiScreenLayout: Layout.Separate,
        }
    },
};


// Configuration

/// Render primary window to smaller screen instead of larger one.
const swapScreens = false;

/// Keep app windows above other windows
const keepAbove = true;


// Script logic

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

function clientSetFullscreenOn(client, settings, index, secondaryCount) {
    const layout = workspace.numScreens === 1
        ? settings.singleScreenLayout
        : settings.multiScreenLayout;

    // save old settings; failing to re-apply them breaks things (specifically Cemu)
    const [screen, otherScreen] = index === 0 || layout != Layout.Separate
        ? [primaryDisplay, secondaryDisplay]
        : [secondaryDisplay, primaryDisplay];

    const geometry = workspace.clientArea(workspace.ScreenArea, screen, workspace.currentDesktop);

    const otherGeometry = workspace.clientArea(workspace.ScreenArea, otherScreen, workspace.currentDesktop);
    const diff = workspace.workspaceHeight - geometry.height - otherGeometry.height;
    if (diff > 0.1 && !isStandardAspectRatio(geometry)) {
        print("adding", diff, "to height to compensate for safe area");
        geometry.height += diff;
    }

    let maxSecondaryWidth = geometry.width / 2;

    // swap layout engine where possible to simplify logic
    if (index > 0) {
        if (secondaryCount < 3) {
            if (layout === Layout.SquareLeft) {
                layout = Layout.ColumnLeft;
            } else if (layout === Layout.SquareRight) {
                layout = Layout.ColumnRight;
            }
        }
    } else if (secondaryCount === 0) {
        layout = Layout.Separate;
    }

    switch (layout) {
        case Layout.Separate:
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
        case Layout.ColumnLeft:
        case Layout.ColumnRight: {
            let secondaryHeight = geometry.height / secondaryCount;
            let secondaryWidth = settings.secondaryWindowAspectRatio * secondaryHeight;
            secondaryWidth = Math.min(maxSecondaryWidth, secondaryWidth);
            secondaryHeight = (1 / settings.secondaryWindowAspectRatio) * secondaryWidth;

            if (index === 0) {
                if (layout === Layout.ColumnLeft) {
                    geometry.x += secondaryWidth;
                }
                geometry.width -= secondaryWidth;

            } else if (index > 0) {
                if (layout === Layout.ColumnRight) {
                    geometry.x += geometry.width - secondaryWidth;
                }
                const slot = index - 1;
                geometry.y += slot * secondaryHeight;

                geometry.width = secondaryWidth;
                geometry.height = secondaryHeight;
            }
        }
            break;
        case Layout.SquareLeft:
        case Layout.SquareRight: {
            // guaranteed to have at least 3, since we demote layout to column otherwise

            const secondaryHeight = geometry.height / 2
            const secondaryWidth = settings.secondaryWindowAspectRatio * secondaryHeight;
            secondaryWidth = Math.min(maxSecondaryWidth, secondaryWidth);
            secondaryHeight = (1 / settings.secondaryWindowAspectRatio) * secondaryWidth;

            if (index === 0) {
                if (layout === Layout.ColumnLeft) {
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

                if (layout === Layout.ColumnRight) {
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

function setClientWindows(set, windows) {
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

    print("Setting", len, "windows for app: ", app, ":", windows.map(
        (s) => s ? s.map((c) => c.caption)
            : ""));

    if (primaries?.[0]) {
        const primary = primaries[0];

        if (primaries.length > 1) {
            print("too many primary windows; using,", primary, "ignoring", primaries.slice(1).map((c) => c.caption));
        }

        if (primary.fullScreen) {
            clientSetFullscreenOn(primary, set.settings, 0, secondaries ? secondaries.length : 0);
        }
    }

    if (secondaries) {
        secondaries.sort((a, b) => a.caption < b.caption ? -1 : 1);

        for (const window in secondaries) {
            const client = secondaries[window];
            if (index <= 4) { // max 4 secondary windows
                if (primaryFullScreen) {
                    clientSetFullscreenOn(client, set.settings, window, secondaries.length);
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
            client.keepAbove = keepAbove && (!primaryFullScreen || (!secondaries && workspace.numScreens === 1));
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
        const appSet = appSets[set];
        if (appSet.classes.some((wc) => { return windowClass.includes(wc); })) {
            const res = {
                app: set,
                // 0 is primary window, 1 is secondary window, 2 is other
                priority: matchesSecondary ? 1 : matchesPrimary ? 0 : 2,
                settings: appSet.settings
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
