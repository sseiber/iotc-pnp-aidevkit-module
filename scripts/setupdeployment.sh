#!/bin/bash

echo "Setting up Peabody deployment"

adb push startcrond /etc/init.d
adb push crontabroot /var/spool/cron/crontabs/root

echo "Setting up Peabody deployment"
echo "  >> REMEMBER TO:"
echo "     RUN update-rc.d startcrond defaults"
echo "     RUN crond"
