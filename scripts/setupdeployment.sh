#!/bin/bash

if [ "$1" == "" -o "$2" == "" ];
then
    echo
    echo missing state.json and/or video model
    echo
    echo usage:
    echo     setupdeployment.sh "../foo/mystate.json" "../bar/mahesh-coco-ssd"
    echo
else
    adb push setupdevice.sh /data/misc/storage/setupdevice.sh
    adb push startcrond /etc/init.d
    adb push crontabroot /var/spool/cron/crontabs/root
    adb push "${1}" /data/misc/storage/state.json
    ./pushmodel.sh "${2}"

    echo "Setting up Peabody deployment"
    echo "  >> REMEMBER TO RUN setupdevice.sh"
fi
