#!/bin/bash

id="emulatorwindowing"
[[ -f "$id.kwinscript" ]] || {
    echo "No packaged script named '$id.kwinscript' found"
    exit 1
}

if kpackagetool5 --list | grep "^$id$" > /dev/null; then
    kpackagetool5 --type=KWin/Script -u "$id.kwinscript"
else
    kpackagetool5 --type=KWin/Script -i "$id.kwinscript"
fi
