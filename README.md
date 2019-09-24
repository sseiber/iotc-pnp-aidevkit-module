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
    * Follow the instructions to set it up via the WiFi Out-Of-Box-Experience (OOBE) and connect it to Azure IoT Edge
    * While you are following the setup sequence, note the ip address of your device on the local network.
    * If you missed it you can use the `adb` tool from the command line by running the following command:  
      ```
      adb shell ifconfig wlan0
      ```
## Remove any existing Vision AI Dev Kit modules
In order to run a new module on the Vision Ai Dev kit it is important to first remove any existing modules. This will prevent two modules from competing with each other trying to control the Qualcomm hardware at the same time.
* The instructions for Vision AI Dev Kit it will provision a sample module to be deployed to the device from Azure IoT Hub. The sample project described here will replace the module that came with Vision AI Dev Kit.
* Using the (Azure Portal)[www.portal.azure.com] online locate the Azure IoT Hub that was provisioned in your subscription during the Vision AI Dev Kit setup instructions.
* Select IoT Edge on the left pane, then select the IoT Edge Device tab.
* You should see your Vision AI Dev Kit device. Select the device then select Set Modules at the top of the screen. You can delete the sample module provisioned by Vision AI Dev Kit.
* Remember this screen when you want to configure a new module deployment later.

## There are a few ways to experiment with and develop code for Vision AI Dev Kit:
* Download the prebuilt Docker container
* Local development with code running in VSCode and controlling the camera over the network
* Publish your Docker container and deploy it with Azure IoT Edge
* Use the module with Azure IoT Central

### 1. Local development

#### &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Environment installation
  * Build the local web client and start the web dev server
    * `git clone https://github.com/sseiber/peabody-local-client`
    * `cd peabody-local-client`
    * `npm i`
    * `npm start`
  * Build local service
    * `clone https://github.com/sseiber/iotc-pnp-aidevkit-module`
    * `cd iotc-pnp-aidevkit-module`
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
    * You should see output that looks like this:
       ```
       [05:59:36 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 88%
       [05:59:37 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 94%
       [05:59:39 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 90%
       [05:59:41 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 89%
       [05:59:43 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 90%
       ```
    * You can also use the web client by navigating your browser to `http://<camera-ip-address>:9010/client`. You should see a web client that looks like this:

## Local development
* Build the local web client and start the web dev server
  * `git clone https://github.com/sseiber/peabody-local-client`
  * `cd peabody-local-client`
  * `npm i`
  * `npm start`
  * The `npm start` command will start a local developer web server on the localhost (your development PC) on port 9011. During local development of the Web client UI you can open a browser to:
     ```
     http://localhost:9011/client
     ```
  * In your browser you will the Web client UI served up by the local development web server. It is trying to connect to the service backend which is not running yet so you'll need to start the backend service. See the next section.

* Build local service
  * `clone https://github.com/sseiber/peabody-local-service`
  * `cd peabody-local-service`
  * `npm i`
  * Open VSCode on this folder. You can use the command:
    ```
    code .
    ```
  * Create a file in the `configs` folder e.g. `./configs/local.json` and add the following local environment variables:
    ```
    {
        "cameraIpAddress": "<your camera ip address>",
        "hostIpAddress": "localhost"
    }
    ```
    This will tell the code where it should find the camera on your local network. Make sure your computer and the camera are on the same network. Since the Vision AI DevKit interface is REST we can run the web client/server experience locally on a development machine and still control the camera over the network.
    <br />
    <br />
    *NOTE:* This is an important distinction in the local development scenario. In this scenario the **host** device is your development PC and in addition there is the **actual** camera device. In a production scenario the (e.g. Docker container module deployed to the camera device) the **host** device is the camera device itself.
  * For the majority of the development scenarios this is a better developent cycle than building a Docker container and deploying over and over.
  * In order for the camera to run a video models we need to copy a video model to it. The Vision AI Dev device should have already been provisioned with a video model if you followed the setup instructions. But just to be sure you can check that the `/data/misc/camera` folder on the camera itself. Use the following command in a terminal window:
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
  * You should see output that looks like this:
    ```
    [05:59:36 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 88%
    [05:59:37 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 94%
    [05:59:39 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 90%
    [05:59:41 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 89%
    [05:59:43 GMT-0700], [log,[InferenceProcessor, info]] data: Inference: id:2 "person" 90%
    ```
  * Go back to the browser you opened with the Web client UI and refresh it. You should see the Web client UI connected to the backend service.
  * Using the web client you can view inferences detected by the vision model running on the Vision AI Dev Kit. Also using the [Microsoft Custom Vision](https://azure.microsoft.com/en-us/services/cognitive-services/custom-vision-service/) service you can build and train your own vision model and export it directly to the Vision AI Dev Kit. Using the web client you can swap your video model with one that you exported from the [Microsoft Custom Vision](https://azure.microsoft.com/en-us/services/cognitive-services/custom-vision-service/) service.

## Build your own Docker container image
  * The package.json for this project contains a dockerbuild script command. This uses a build script in the `./scripts` directory along with the `Dockerfile` in the project. It also looks for a tag name in the `./configs/imageName.json` file.
    <br />
    <br />
    Open or create the `./configs/imageName.json` and update the imageName field to your own container registry and image name. For example:
    ```
    {
        "imageName": "<your-container-registry>/<your-docker-imagename>"
    }
    ```
    Before you build the peabody-local-service project you need to build the peabody-local-client and have it populate the project.  
    *NOTE:* There is a dendendency that the two projects are peers to each other in the file system.  
    * Switch to the peabody-local-client project
    * Run the command
    ```
    npm run build
    ```
    This will build the project using Webpack and copy the bundles to a directory named `client_dist` in the peabody-local-service prject.  
    Switch back to peabody-local-service project and run the command:
    ```
    npm version patch
    ```
  * This will build the image defined in the `./configs/imageName.json` file and bump the version number in the package.json file. In addition it will push the image to your docker container.
  * When the build completes it should have built the docker container and pushed it to your container registry.
  * Now switch to your Vision AI Dev Kit shell with `adb shell` and run the following commands on the device.
    ```
    docker login <your container registry> pw: <your container registry password>
    ```
    You will only need to so this once. The container registry address and password will be cached in Docker.
  * Run the following command to start the Docker image:
    ```
    docker run \
        -it \
        --rm \
        -e videoCaptureSource=rtsp \
        --network=host \
        -v /run/systemd:/run/systemd \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v /data/misc:/data/misc \
        -v /etc/version:/etc/version \
        -v /sys/class/power_supply:/sys/class/power_supply \
        <your-container-registry>/<your-docker-imagename>:<version-tag> \
        node ./dist/index.js
    ```
    *NOTE*: the \<version-tag\> will be the version in your package.json file. You should see the output from the `docker build` step that has the actual version tag that was pushed.

## Publish your Docker container and deploy it from IoT Edge
At this point you should be familiar with building the project and running the image on your Vision AI Dev Kit. This section will describe how to provision a deployment of your module through Azure IoT Hub.
  * Using the (Azure Portal)[www.portal.azure.com] online go to your Azure IoT Hub that was provisioned in your subscription during the Vision AI Dev Kit setup instructions. Feel free to create a new Azure IoT Hub if you wish.
  * *NOTE:* If you use a new Azure IoT Hub you will need to update the `device_connection_string` in the `/etc/iotedge/config.yaml` file to a new connection string and restart the Azure IoT Edge service on your device.
  * Select IoT Edge on the left pane, then select the IoT Edge Device tab.
  * You should see your Vision AI Dev Kit device. Select the device then select Set Modules at the top of the screen.
  * Add the details about you Docker container here:
    * Container Registry Settings
    * Under Deployment Modules slect +Add and select "IoT Edge Module"
    * On the right pain enter the following information:
      <br />
      - A descriptive name
      - The full Docker container image uri (e.g. container-registry/image-name:version-tag)
      - These environment variables:
        ```
        videoCaptureSource=rtsp
        ```
      - Container Create Options
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
                    "/run/systemd:/run/systemd",
                    "/var/run/docker.sock:/var/run/docker.sock",
                    "/data/misc:/data/misc",
                    "/etc/version:/etc/version",
                    "/sys/class/power_supply:/sys/class/power_supply:"
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
      - Click Save and Next, Next, Submit
      - In a few minutes your container should deploy to your Vision AI Dev Kit

## Azure IoT Central

This project includes support for connecting to [Azure IoT Central](https://azure.microsoft.com/en-us/services/iot-central/) and sending telemetry, state, events, and supports running commands sent from your IoT Central app.

  * Create an Azure IoT Central app
    * [Click on this link to create an IoT Central App for the Vision AI Dev Kit](https://apps.azureiotcentral.com/create?appTemplate=0098b855-6bbd-49db-9945-d72edfd907ce)  
      - *Note:* The link above contains a special `appTemplate` parameter that ensures your new IoT Central app is provisioned with the template for the Vision AI Dev Kit module.
    * You can create a Pay-As-You-Go instance or a Trial instance
  * Provision your camera with a Device Id and Device Key
    * This step requires you to create a Device SAS Key and you will need the primary access key from your Azure IoT Central app.  
      * Open your Azure IoT Central app
      * On the left side select Administration
      * Select Device Connection
      * Save the ScopeID (for use later)
      * Set the Auto Approve setting to Enabled
      * Set the Device Enrollment setting to Enabled
      * Save the Primary Key (for use with the dps-keygen tool)
        <img src="./assets/iotcadmin.png" width="600">
      * In order for your device to provision itself into your IoT Central app you need to create a device key.
      * Download the [dps-keygen](https://github.com/Azure/dps-keygen) tool and run the command:
        ```
        dps-keygen -mk:primarykey -di:deviceid
        ```
        The `primarykey` is the Primary Key from the Device Connection page above. The deviceid is something that you create. The output of this command will be the Device SAS key and will be associated with your Azure IoT Central application and your device (e.g. deviceid).
        <br />
        Example:
        ```
        dps-keygen -mk:uz9JSzB50klxXtxrPQkvIKQ0gzJXaoInRUmJzHGBzPFvrdhDfnk0vZ7Uo5pEtu5sTCGQK1XxMXH7TREqpPHY8t== -di:iotc-device1
        
        Azure IoT DPS Symetric Key Generator v0.3.1

        please find the device key below.
        DKzselcikgK+CP0ZdbL2XlCu4ebTUDocNAY0o3YMJje=
        ```
      * Edit the file in `./peabody/storage/state.json` and update the `deviceId` and `deviceKey` values with the values you created.
      * Copy this file to your Vision AI Dev Kit's filesystem at `/data/misc/storage`. Use the command:
        ```
        adb copy ./peabody/storage/state.json /data/misc/storage
        ```
      * Add the additional environment variables listed below to the Edge Module (for Azure IoT Hub deployments). Note that your `template-id` and your `template-version` can be retrieved from you Azure IoT Central app (Select Device Explorer and just below the title you will see the `templateid/templateversion` along with a copy button).
        ```
        enableIoTCentralProvisioning=1
        videoCaptureSource=rtsp
        iotCentralScopeId=your-scope-id
        iotCentralTemplateId=your-template-id
        iotCentralTemplateVersion=your-template-version
        ```
      Using the `adb tool` you can examine the logs to verify that it has correctly provisioned with your Azure IoT Central App. You should see something like this:
        ```
        [06:28:02 GMT+0000], [log,startup,info] data:  > Machine: linux, 4 core, freemem=1050mb, totalmem=1828mb
        [06:28:02 GMT+0000], [log,startup,info] data: 👨‍💻 Starting IoT Central provisioning
        [06:28:02 GMT+0000], [log,[IoTCentralService, info]] data: Enabling DPS provisioning through IoT Central: "enableIoTCentralProvisioning=1"
        [06:28:02 GMT+0000], [log,[IoTCentralService, info]] data: Starting IoT Central provisioning for device: peabody-home
        [06:28:04 GMT+0000], [log,[IoTCentralService, info]] data: IoT Central dps request succeeded - waiting for hub assignment
        [06:28:07 GMT+0000], [log,[IoTCentralService, info]] data: IoT Central dps request succeeded - waiting for hub assignment
        [06:28:08 GMT+0000], [log,[IoTCentralService, info]] data: IoT Central dps hub assignment: iotc-fde292d1-90e2-4564-a5b7-4bb558dde379.azure-devices.net
        [06:28:09 GMT+0000], [log,[CameraService, info]] data: Handle setting change for setting_hdmi_output: true
        [06:28:09 GMT+0000], [log,[IoTCentralService, info]] data: Device live properties updated
        [06:28:09 GMT+0000], [log,startup,info] data: 👩‍💻 Finished IoT Central provisioning
        [06:28:09 GMT+0000], [log,startup,info] data: 📁 Starting Docker image provisioning
        [06:28:09 GMT+0000], [log,[FileHandler, info]] data: Provisioning docker imgage
        [06:28:09 GMT+0000], [log,[IoTCentralService, info]] data: Device live properties updated
        [06:28:09 GMT+0000], [log,[InferenceProcessor, info]] data: Handle setting change for setting_inference_threshold: 80
        [06:28:09 GMT+0000], [log,[IoTCentralService, info]] data: Device live properties updated
        [06:28:09 GMT+0000], [log,[IoTCentralService, info]] data: Device live properties updated
        [06:28:09 GMT+0000], [log,[InferenceProcessor, info]] data: Handle setting change for setting_detect_class: person
        [06:28:09 GMT+0000], [log,[FileHandler, info]] data: Found existing version file: 1.0.127, new image is: 1.0.127
        [06:28:09 GMT+0000], [log,[IoTCentralService, info]] data: Device event message sent
        [06:28:09 GMT+0000], [log,[IoTCentralService, info]] data: Device live properties updated
        [06:28:09 GMT+0000], [log,[IoTCentralService, info]] data: Device live properties updated
        [06:28:09 GMT+0000], [log,startup,info] data: 📁 Finished Docker image provisioning
        ```
      Telemetry should look like this:
        ```
        [06:28:20 GMT+0000], [log,[InferenceProcessor, info]] data: Inference: id:1 "person" 88%
        [06:28:21 GMT+0000], [log,[InferenceProcessor, info]] data: Inference: id:1 "person" 85%
        [06:28:23 GMT+0000], [log,[InferenceProcessor, info]] data: Inference: id:1 "person" 94%
        [06:28:24 GMT+0000], [log,[InferenceProcessor, info]] data: Inference: id:1 "person" 66%
        [06:28:24 GMT+0000], [log,[IoTCentralService, info]] data: Device telemetry message sent
        [06:28:24 GMT+0000], [log,[IoTCentralService, info]] data: Device event message sent
        [06:28:26 GMT+0000], [log,[InferenceProcessor, info]] data: Inference: id:1 "person" 95%
        [06:28:26 GMT+0000], [log,[IoTCentralService, info]] data: Device telemetry message sent
        [06:28:26 GMT+0000], [log,[IoTCentralService, info]] data: Device event message sent
        ```
      In your Azure IoT Central App you should begin to see telemetry flowing in:
        <img src="./assets/iotcentral.png" width="800">

A Note about battery life. I have noticed that prolonged connections to the computer via the USB-C cable eventually will drain the battery on the Vision AI Dev Kit. After a development cycle it is good practice to plug the camera back into a dedicated power supply that is capable of delivering a minimum of 2.5A.
## Reset your device and go back to the shipping sample
If you want to revert back to the shipping sample module press the power button on the back of the device for 5-6 seconds. Next, follow the instructions online for the [Vision AI Dev Kit](https://www.visionaidevkit.com/)
