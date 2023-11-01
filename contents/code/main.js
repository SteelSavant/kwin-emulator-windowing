// Interactive console (for development): plasma-interactiveconsole --kwin
// View interactive console logs (since the ones in the application are broken on plasma): journalctl -g "js:" -f
print("!!!SCRIPT!!!");

// TODO::this script is fairly naive about which screen should be selected; it just picks the smallest and largest. 
// Consider reading the screens names (as reported by qdbus org.kde.KWin /KWin supportInformation), and using dbus queries to get the ids.

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
    Slot1: "slot1",
    Slot2: "slot2",
    Slot3: "slot3",
    Slot4: "slot4",
}

const MultiWindowPolicy = {
    AllOnPrimary: "primary",
    AllOnSecondary: "secondary",
}


// Configuration

/// Render primary window to smaller screen instead of larger one.
const swapScreens = false;

/// classes that should match with multi-window (3+) configuration.
const multiScreenWindowClasses = ["dolphin-emu"];
/// classes that should match with dual-window configuration.
const dualScreenWindowClasses = ["cemu", "citra"];

/// policy if a multi-window application has 1 secondary screen
const singleSecondaryPolicy = MultiWindowPolicy.AllOnSecondary;
/// policy if a multi-window application has 2+ secondary screens
const multiSecondaryPolicy = MultiWindowPolicy.AllOnPrimary;

// TODO::the selectors should probably be regex, and be configurable (primary vs secondary)
const appSets = {
    "Cemu": { classes: multiScreenWindowClasses, primary: ["Cemu"], secondary: ["GamePad View"] },
    "Citra": { classes: dualScreenWindowClasses, primary: ["Citra", "Primary"], secondary: ["Citra", "Secondary"] },
    "Dolphin": { classes: dualScreenWindowClasses, secondary: ["Dolphin ", " | "], secondary: ["GBA", " | "] },
};

/// Aspect ratio for space reserved for primary window when squished.
const squishedPrimaryAspectRatio = 4./3.;

// Script logic

const screens = workspace.numScreens;
assert(screens > 1, "Multi-Window Fullscreen requires multiple displays");

let primaryDisplay = 0;
let secondaryDisplay = 0;

for (let i = 0; i < screens; i++) {
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



const oldSettings = {};

function isStandardAspectRatio(geometry) {
    const ratio = geometry.width / geometry.height;
    const common = [16. / 9., 16. / 10., 4. / 3., 21. / 9.];
    return common.some(function (r) { return Math.abs(r - ratio) < 0.001 });
}

function clientSetFullscreenOn(client, screen, region, secondaryCount) {
    // save old settings; failing to re-apply them breaks things (specifically Cemu)
    const geometry = workspace.clientArea(workspace.ScreenArea, screen, workspace.currentDesktop);
    if (!oldSettings[client]) {
        oldSettings[client] = {
            geometry: geometry,
            fullScreen: client.fullScreen,
            keepAbove: client.keepAbove,
        }
    }

    // handle covering taskbar/safearea
    const otherScreen = screen === primaryDisplay ? secondaryDisplay : primaryDisplay;
    const otherGeometry = workspace.clientArea(workspace.ScreenArea, otherScreen, workspace.currentDesktop);
    const diff = workspace.workspaceHeight - geometry.height - otherGeometry.height;
    if (diff > 0.1 && !isStandardAspectRatio(geometry)) {
        print("adding", diff, "to height to compensate for safe area");
        geometry.height += diff;
    }

    // If left/right view, halve width
    if (["left", "right"].some(function (r) { return region.includes(r); })) {
        geometry.width /= 2;
    }

    // if top/bottom view, halve height
    if (["upper", "lower"].some(function (r) { return region.includes(r); })) {
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

    // fullscreen settings
    workspace.sendClientToScreen(client, screen);
    client.fullScreen = true;
    client.geometry = geometry;
    client.keepAbove = true;

    print("sent", client.caption, "to display", secondaryDisplay, region);
}

function allOnSecondaryRegions(secondaries) {
    switch (secondaries.length) {
        case 0:
            print("primary only; no regions");
            // We should only call this when removing a window, if ever.
            break;
        case 1:
            regions = [Region.Full];
            break;
        case 2:
            regions = [Region.LeftHalf, Region.RightHalf];
            break;
        case 3:
            regions = [Region.UpperLeft, Region.RightHalf, Region.LowerLeft];
            break;
        default:
            regions = [Region.UpperLeft, Region.UpperRight, Region.LowerLeft, Region.LowerRight];
            break;
    }
}

function allOnPrimaryRegions(secondaries) {
    return [Region.Slot1, Region.Slot2, Region.Slot3, Region.Slot4].slice(0, secondaries.length);
};

function setClientWindows(windows) {
    const len = windows.reduce((acc, value) => {
        acc + (value ? value : 0)
    });

    if (len <= 1) {
        // no meaningful work to do, skipping
        return;
    }

    print("Setting windows for app: ", app);


    const primaries = windows[0];

    const policy = secondaries.length > 2 ? multiSecondaryPolicy : singleSecondaryPolicy;

    const fullscreenRegion = function () {
        switch (policy) {
            case MultiWindowPolicy.AllOnPrimary:
                return Region.Squish;
            case MultiWindowPolicy.AllOnSecondary:
                return Region.Full;
        }
    }();

    const primary = primaries[0];
    if (primaries && primaries.length > 1) {
        print("too many primary windows; using,", primary, "ignoring", primaries.slice(1).map((c) => c.caption));
    }

    if(primary && primary.fullScreen) {
        clientSetFullscreenOn(primary, fullscreenRegion, secondaries.length);
    }

    const secondaries = windows[1];
    const regions = policy === MultiWindowPolicy.AllOnPrimary ? allOnPrimaryRegions(secondaries) : allOnSecondaryRegions(secondaries);

    for (const window in secondaries) {
        const region = regions[window];
        const client = secondaries[window];
        if (region) {
            if(primary && primary.fullScreen) {
                clientSetFullscreenOn(client, secondaryDisplay, region, secondaries.length);
            } else {
                client.fullScreen = false;
                client.keepAbove = false;
            }
        } else {
            print("too many secondary views; ignoring", client.caption);
        }
    }

    const other = windows[2];

    for (const client of other) {
        workspace.sendClientToScreen(client, secondaryDisplay);
        client.fullScreen = false;
        client.maximized = true;

        if(!secondaries || policy === MultiWindowPolicy.AllOnPrimary) {
            client.keepAbove = true;
        } else {
            client.keepAbove = false;
        }
    }
}

normalClients = {};

function getAppSet(client) {
    const caption = client.caption.toLowerCase();
    for (set in appSets) {
        const matchesPrimary = appSets[set].primary.every(function (str) { return caption.includes(str.toLowerCase()); });
        const matchesSecondary = appSets[set].secondary.every(function (str) { return caption.includes(str.toLowerCase()); });
        if (set.classes.some(function () { return client.resourceClass.toString(); })) {
            return {
                app: set,
                // 0 is primary window, 1 is secondary window, 2 is other
                priority: matchesSecondary ? 1 : matchesPrimary ? 0 : 2
            }
        }
    }
    return null;
}

function handleClient(client) {
    const set = getAppSet(client);
    if (client.normalWindow && set) {
        const app = set.app;

        if(app.priority === 0) {
            client.fullScreenChanged.connect(() =>{
                setClientWindows(normalClients[app]);
            });
        }

        if (!normalClients[app]) {
            const windows = [];
            windows[app.priority] = [client];
            normalClients[app] = windows;
        } else {
            let windows = normalClients[app];
            windows[set.priority] = [client, ...windows[set.priority]]
            normalClients[app] = windows;

            setClientWindows(windows);
        }
    }
}

workspace.clientAdded.connect(handleClient);
workspace.clientRemoved.connect(function (client) {
    if (client in oldSettings) {
        // reset client; things will break otherwise
        const oldClient = oldSettings[client];
        client.geometry = oldClient.geometry;
        client.fullScreen = oldClient.fullScreen;
        client.keepAbove = oldClient.keepAbove;
        delete oldSettings[client];

        // reconfigure remaining windows
        const app = getAppSet(client).app;
        const windows = normalClients[app];

        for(scope of windows) {
            const index = scope.indexOf(client);
            if (index > -1) {
                scope.splice(index, 1);
            }
        }
        normalClients[app] = windows;
        setClientWindows(windows);
    }
})

const clients = workspace.clientList();
for (client of clients) {
    handleClient(client);
}


