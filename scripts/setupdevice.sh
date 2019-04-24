#!/bin/bash

echo "Setting up Peabody device"

sudo update-rc.d startcrond defaults
crond
