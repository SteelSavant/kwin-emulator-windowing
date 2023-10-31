// Interactive console (for development): plasma-interactiveconsole --kwin
// View interactive console logs (since the ones in the application are broken on plasma): journalctl -g "js:" -f
print("!!!SCRIPT!!!");

// TODO::this script is fairly naive about which screen should be selected; it just picks the smallest and largest. Consider reading the screens (or screen parameters) from a config file.
// TODO::make covering the taskbar, keepAbove, window locations, appSets, and other functionality configurable.

const screens = workspace.numScreens;
assert(screens > 1, "Multi-Window Fullscreen requires multiple displays");

let primaryDisplay = 0;
let secondaryDisplay = 0;

// TODO::the selectors should probably be regex, and maybe account for more window rules, but this works for now
const appSets = {
    "Cemu": { primary: ["Cemu"], secondary: ["GamePad View"] },
    "Citra": { primary: ["Citra", "Primary"], secondary: ["Citra", "Secondary"] },
    "Dolphin": { primary: ["Dolphin ", " | "], secondary: ["GBA", " | "] },
};

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

print("primary display: ", primaryDisplay, ", geometry: ", workspace.clientArea(workspace.MaximizeArea, primaryDisplay, 1));
print("secondary display: ", secondaryDisplay, ", geometry: ", workspace.clientArea(workspace.MaximizeArea, secondaryDisplay, 1));

const Region = {
    Full: "full",
    LeftHalf: "left-half",
    RightHalf: "right-half",
    UpperHalf: "upper-half",
    LowerHalf: "lower-half",
    UpperLeft: "upper-left",
    UpperRight: "upper-right",
    LowerLeft: "lower-left",
    LowerRight: "lower-right",
}

const oldSettings = {};

function isStandardAspectRatio(geometry) {
    const ratio = geometry.width / geometry.height;
    const common = [16./9., 16./10., 4./3., 21./9.];
    return common.some(function(r) {return Math.abs(r - ratio) < 0.001});
}

function clientSetFullscreenOn(client, screen, region) {
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
    const otherGeometry =  workspace.clientArea(workspace.ScreenArea, otherScreen, workspace.currentDesktop);
    const diff = workspace.workspaceHeight - geometry.height - otherGeometry.height;
    if (diff > 0.1 && !isStandardAspectRatio(geometry)) {
        print("adding", diff, "to height to compensate for safe area");
        geometry.height += diff;
    }

    // If left/right view, halve width
    if (["left", "right"].some(function(r){ return region.includes(r);})) {
        geometry.width /= 2;
    }

    // if top/bottom view, halve height
    if (["upper", "lower"].some(function(r){ return region.includes(r);})) {
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
    // client.keepAbove = true;

    print("sent", client.caption, "to display", secondaryDisplay, region);
}

function setClientWindows(windows) {
    if(!windows || !windows.length) {
        // no windows to act on, return
        return;
    }

    clientSetFullscreenOn(windows[0], primaryDisplay, Region.Full);

    const secondaries = windows.slice(1);
    let regions = null;
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
            regions = [Region.UpperLeft, Region.UpperRight, Region.LowerHalf];
            break;
        default:
            regions = [Region.UpperLeft, Region.UpperRight, Region.LowerLeft, Region.LowerRight];
            break;
    }

    for (const window in secondaries) {
        const region = regions[window];
        if(region) {
            clientSetFullscreenOn(secondaries[window], secondaryDisplay,region);
        } else {
            print("too many secondary views; ignoring", secondaries[window].caption);
        }
    }
}

normalClients = {};

function getAppSet(client) {
    const caption = client.caption.toLowerCase();
    for(set in appSets) {
        const matchesPrimary = appSets[set].primary.every(function(str) { return caption.includes(str.toLowerCase()); });
        const matchesSecondary = appSets[set].secondary.every(function(str) { return caption.includes(str.toLowerCase()); });
        if (matchesPrimary || matchesSecondary) {
            return {
                app: set,
                isPrimary: !matchesSecondary
            }
        }
    }
    return null;
}

function handleClient(client) {
    const set = getAppSet(client);
    if(client.normalWindow && set) {
        const app = set.app;

        if (normalClients[app] == undefined || normalClients[app] == null) {
            normalClients[app] = [client];
        } else {
            let windows = normalClients[app];
            // Put primary windows first. This carries the implicit assumption that
            // a) there will be only one primary window, and
            // b) the primary window will always exist
            if (set.isPrimary) {
                windows = [client, ...windows];
            } else {
                windows = [...windows, client];
            }
            normalClients[app] = windows;

            if (windows.length > 1) {
                print("Setting windows for app: ", app);
                setClientWindows(windows);
            }
        }
    }
}

workspace.clientAdded.connect(handleClient);
workspace.clientRemoved.connect(function(client) {
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
        const index = windows.indexOf(client);
        if (index > -1) {
            windows.splice(index, 1);
        }
        normalClients[app] = windows;
        setClientWindows(normalClients[app]);
    }
})

const clients = workspace.clientList();
for(client of clients) {
    handleClient(client);
}


