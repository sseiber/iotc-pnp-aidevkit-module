#!/bin/bash

if [ "$1" == "" ];
then
    echo
    echo missing model name
    echo usage: pushmodel modelname
    echo
else
   pushd ${1} > /dev/null

    echo "Pushing from ${1} to [device]/data/misc/camera"

    # shopt -s dotglob
    # setopt nullglob

    for filename in ./*.*; do
        # echo "  pushing ${filename}"
        adb push ${filename} "/data/misc/camera"
    done

   popd > /dev/null
fi
