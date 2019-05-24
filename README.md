# Vision AI DevKit Sample
This project is an example module for the Vision AI DevKit device. With this sample you will be able to experiment with Custom Vision AI models without writing any code.

This project is also an example implementation of how a device provisions itself with Azure IoT Central and also includes a full implementation of how a device participates with the Azure IoT Central platform includeing telementry, state, events, and settings, properites, and custom commands. You can even update your AI vision model from your IoT Central app. See the full documentation overview of Azure IoT Central here: [Azure IoT Central Documentation](https://docs.microsoft.com/en-us/azure/iot-central/). This integration with Azure IoT Central is optional and controlled by an environment variable.

This project is implemented as a NodeJS micro service and React Web client. The web client allows the user to interact directly with the device to control it as well as experiment with Custom Vision AI models. The companion React web client project can be found here *[peabody-local-client](https://github.com/sseiber/peabody-local-client)*. A static version of the web client bundle is included in the `./client_dist` folder.

The project includes a Dockerfile and scripts used to build the docker container.

## Dependencies
  * [Visual Studio Code](https://code.visualstudio.com/download)
    * Not exactly but you should really be using this excellent IDE
  * [NodeJS 10x (with NPM)](https://nodejs.org/en/download/)
    * This is the official link but it's probably easier to get it from your package manager like Brew, Chocolatey, etc.
  * [Android Device Bridge tools (ADB)](https://developer.android.com/studio/command-line/adb)
    * This is the Android Device Bridge tool. It lets you physicaly connect to the device over a USB cable to manage, copy files, debug, etc. If you are familiar with Android mobile development you know about this tool. The Vision AI DevKit hardware architecture has some roots in Android and Qualcomm which is related to the use of this tool for the development cycle. You can install this tool separately or if you already installed Android Studio for Android mobile development you already have this tool.
    * This is only a dependency for inspecting/managing the camera directly in development scenarios.
  * Get a [Vision AI DevKit camera device](https://azure.github.io/Vision-AI-DevKit-Pages/)
    * Follow the instructions to set it up via the WiFi Out-Of-Box-Experience and connect it to Azure IoT Edge
    * While you are following the setup sequence, note the ip address of your device on the local network.
    * If you missed it you can use the `adb` tool from the command line by running the following command:  
      ```
      adb shell ifconfig wlan0
      ```
  * Remove the sample module configuration in the Azure Portal
    * When follow the setup instructions for the AI Dev Kit it will configure a sample module to be deployed to the device from Azure IoT Edge. The project below is meant to replace that module.
    * Using the (Azure Port)[www.portal.azure.com] locate the Azure IoT Hub and find the Edge Device you configured for the Vision AI Dev Kit device.
    * Remove the module deployment for that device.

## There are 3 ways to experiment with and develop code for Vision AI Dev Kit:
1. ### Local development with code running in VSCode and controlling the camera over the network
1. ### Run your Docker container manually right on the device
1. ### Publish your Docker container and deploy it with Azure IoT Edge

### 1. Local development

#### &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Environment installation
  * Build the local web client and start the web dev server
    * `git clone https://github.com/sseiber/peabody-local-client`
    * `cd peabody-local-client`
    * `npm i`
    * `npm start`
  * Build local service
    * `clone https://github.com/sseiber/peabody-local-service`
    * `cd peabody-local-service`
    * `npm i`
    * Open VSCode on this folder. You can use the command:
        ```
        code .
        ```
    * In the `./configs/local.json` file update the `cameraIpAddress` field using your own camera's IP address:  
        ```
        {
            "cameraIpAddress": "<your camera ip address>",
            "hostIpAddress": "localhost"
        }
        ```
        * This will tell the code where it should find the camera on your local network. Make sure your computer and the camera are on the same network. Since the Vision AI DevKit interface is REST we can run the web client/server experience locally on a development machine and still control the camera over the network. This is a better developent cycle than building a Docker container and deploying over and over.
    * In order for the camera to run a video models we need to copy a video model to it. The Vision AI Dev device should already have been provisioned with a video model if you followed the setup instructions. But just to be sure you can check that the `/data/misc/camera` folder on the camera itself. Use the following command in a terminal window:
        ```
        adb shell ls /data/misc/camera
        ```
        You should see files that look something like this:
        ```
        aecWarmStartCamera_0.txt
        labels.txt
        model.dlc
        va-snpe-engine-library_config.json
        ```
    * Press F5 (to start with the debugger)
    * You should see:
        ![alt text](https://raw.githubusercontent.com/username/projectname/branch/path/to/img.png)
    * Run the following command to start the Docker image  
        ```
        docker run -it --network=host -v /data/misc:/data/misc iotccrscotts.azurecr.io/peabody-local-service:<latest-version> node ./dist/index.js
        ```
## To deploy from IoT Edge
  * From the Azure Port configure your IoT Edge module with the following configuration  
    * Name:  
    `peabody-camera (Use your own unique name here)`
    * Image URI:  
    `iotccrscotts.azurecr.io/peabody-local-service:<latest-version>`
    * Container Create Options:  
        ```
        {
            "HostConfig": {
                "PortBindings": {
                    "9010/tcp": [
                        {
                            "HostPort": "9010"
                        }
                    ]
                },
                "Binds": [
                    "/data/misc:/data/misc"
                ],
                "NetworkMode": "host"
            },
            "NetworkingConfig": {
                "EndpointsConfig": {
                    "host": {}
                }
            }
        }
        ```
    * Environment Variables:  

    * Select `Configure advanced Edge Runtime settings`  
    In `Create Options` for the Edge Hub (the first section) add:  
        ```
        "User": "root",
        ```
      To the top (just above `HostConfig`)  
    * Click through Next, Review, Submit. Your module should be deployed in a few minutes.


## Development
  * **test:**  
  `npm run test`  

  * **lint:**  
  `npm run tslint`

  * **docker image name:**  
  The build script uses the `config` section in the `package.json` file to define the docker image name.

  * **build a new version:**  
  `npm version [major|minor|patch] [--force]`  
  *this assumes access to the container registry for the image being built*
