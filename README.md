# AI Dev Kit local service
This project is an example container service for the AI Dev Kit device.

This project is hybrid of a container sample with features to enable the AI Dev Kit camera device as well as a REST api service to enable the features of a React Web client that the user can access from the device running on a local network. The companion React web client project can be found here *[peabody-local-client](https://github.com/sseiber/peabody-local-client)*.

In addition this project includes an implementation of how a device provisions itself with Azure IoT Central and also includes a full implementation of how a device participates with the Azure IoT Central platform includeing telementry, state, events, and settings, properites, and custom commands. See the full documentation overview of Azure IoT Central here: [Azure IoT Central Documentation](https://docs.microsoft.com/en-us/azure/iot-central/).

The project includes a Dockerfile and scripts used to build the docker container.

## Dependencies
  * [Visual Studio Code](https://code.visualstudio.com/download)
    * Not exactly but you should really be using this excellent IDE
  * [NodeJS 10x (with NPM)](https://nodejs.org/en/download/)
    * This is the official link but it's probably easier to get it from your package manager like Brew, Chocolatey, etc.
  * [Android Device Bridge tools (ADB)](https://developer.android.com/studio/command-line/adb)
    * This is the Android Device Bridge tool. It lets you physicaly connect to the device over a USB cable to manage, copy files, debug, etc. If you are familiar with Android mobile development you know about this tool. The AI Dev Kit hardware architecture has some roots in Android and Qualcomm which is related to the use of this tool for the development cycle. You can install this tool separately or if you already installed Android Studio for Android mobile development you already have this tool.
  * Get a [AI Dev Kit camera device](https://azure.github.io/Vision-AI-DevKit-Pages/)
    * Follow the instructions to set it up via the WiFi Out-Of-Box-Experience and connect it to Azure IoT Edge
    * While you are setting up the device, note the ip address of your device on the local network. Using your adb tool from the command line run:  
      ```
      adb shell ifconfig wlan0
      ```

## There are 3 ways to run this device:
1. ### Local developent cycle
1. ### Run the container manually and experiment
1. ### Develop your own container and manage the deployment with Azure IoT Edge)

### 1. Local development cycle

#### &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Environment installation
  * Clone [the companion React Web client repository](https://github.com/sseiber/peabody-local-client)
    * `npm i`
    * `npm start`
  * Clone [this repository](https://github.com/sseiber/peabody-local-service)
    * `npm i`
    * Open VSCode on this folder
    * Create a folder under the project root called `configs`
      * Create a file in the `./configs` folder called `local.json`
      * In the `local.json` file include the following info (using your own camera's IP address):  
        ```
        {
            "cameraIpAddress": "192.168.83.22",
            "hostIpAddress": "localhost"
        }
        ```
      * This will tell the code that where it should find the camera on your local network. Make sure your computer and the camera are on the same network.
    * Create a folder named `peabody/camera`
    * Press F5 (to start and debug)

## Prepare for debugging with VSCode
### Since the AI Vision Dev Kit interface is REST we can run the web client/server experience locally on a development machine and still control the camera. This is a better developent cycle than building a Docker container and deploying over and over. In order to do what we have to make sure the local environment is configured properly.
  * Create a folder named `client` in your project's root. This folder simulates the root folder on the device that parents the vision model folder.
  * Open a command window and use `adb shell` to connect to your AI Dev Kit
  * **[OPTIONAL IF YOU WANT TO PRECONFIGURE THE DEVICE]**
    * Place config file `<your-unique-hostname>-state.json` in a folder on the host named `/root/misc/storage` folder with the following data:  
        ```
        {
            "system": {
                "systemName": "systemname",
                "systemId": "fff86194-5faf-44a4-a50a-4ffd9766af5e"
            }
        }
        ```
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
