# Vision AI DevKit Sample
## NOTE: INSTRUCTIONS ARE STILL DRAFT - PLEASE COMMENT OR BETTER YET CREATE A PR
This project is an example implementation for the Microsoft Vision AI Dev Kit built to be an Azure IoT Central module. It includes a full implementation of how a device participates with the Azure IoT Central platform includeing telemetry, state, events, properites, and custom commands. You can even update your AI vision model from your IoT Central app. See the full documentation overview of Azure IoT Central here: [Azure IoT Central Documentation](https://docs.microsoft.com/en-us/azure/iot-central/).

This project is implemented as a NodeJS micro service and React Web client. The web client allows the user to interact directly with the device to control it as well as experiment with Custom Vision AI models. A static version of the web client bundle is included in the `./client_dist` folder.

The project includes a Dockerfile and scripts used to build the docker container.

## Dependencies
  * [Visual Studio Code](https://code.visualstudio.com/download)
    * Not exactly but you should really be using this excellent IDE
  * [NodeJS 10x+ (with NPM)](https://nodejs.org/en/download/)
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
## Get the source code
* `clone https://github.com/sseiber/iotc-pnp-aidevkit-module`
* `cd iotc-pnp-aidevkit-module`
* `npm i`
* Open VSCode on this folder. You can use the command:
    ```
    code .
    ```
* In order for the camera to run a video models we need to copy a video model to it. The Vision AI Dev device should already have been provisioned with a video model if you followed the setup instructions that came with the camera. But just to be sure you can check on the camera device that the `/data/misc/camera` folder contains a vision model. Use the following command in a terminal window:
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
## Build the Docker container image
  * The package.json for this project contains a dockerbuild script command. This uses a build script in the `./scripts` directory along with the `Dockerfile` in the project. It also looks for a tag name in the `./configs/imageName.json` file.
    <br />
    <br />
    Open or create the `./configs/imageName.json` and update the imageName field to your own container registry and image name. For example:
    ```
    {
        "imageName": "myregistry.azurecr.io/aidevkit-module"
    }
    ```
    To build the Docker image (using your image name configured the imageName.json config file) run the command:
    ```
    npm version patch
    ```
    Note: if you have files checked out in your project you will need to add `--force` to the end of the command e.g.: `npm version patch --force`

  * This will build the image defined in the `./configs/imageName.json` file and bump the version number in the package.json file. When the build completes it should have built the docker container and pushed it to your container registry.

## Create a new IoT Central app with a module template
This section describes how to create a new IoT Central app and provision the device capability model (DCM) for the Microsoft Vision AI Dev Kit.

### Create the IoT Central app
* Create a new IoT Central App (https://apps.azureiotcentral.com)
* Pay-as-you-go or Trial

### Import the device template from this project
* Add a new template (Device Templates view)
* Selet Azure IoT Edge, then Next: Customize
* Select Skip: Create, then Create
* Change the default name at the top (Azure IoT Edge Device Template xxxx)
* Select to Import a Capability Model
  *  Use the capability model in this project's `./setup` folder (VisionAIDevKitDcm.json)
* At this point you should see the module "VisionAIDevKit Module" along with interfaces "Settings", "Module information", and "Device information".

### Add the module deployment manifest
* Select Replace Manifest (from the top bar) with your own based on the one in this project's `./setup` folder.
  * Note: you need to update manifest the image name and tag for your container and the Container Registry name and credentials.

### Publish the template
* From the top bar select Publish
* Now your device template (DCM) is ready for devices to associate with it and send telemetry and properties, as well as respond to settings changes and respond to commands.

## Configure the IoT Edge runtime on the camera device
This section will describe how to configure the IoT Edge runtime for use with IoT Central.
  * You will need to update the Azure IoT Edge runtime provisioning method in the `/etc/iotedge/config.yaml` file to connect to your Azure IoT Central app. This will use the DPS symmetric key provisioning method in the `config.yaml` file.
  * Create a symmetric key to use for your device provisioning
    * In your Azure IoT app select the Devices view and then select the template you just created
    * Select the "+ New" option and give your new device a `Device ID` and `Device Name` (these can be the same and human readable), then click on the Create button.
    * When you see the new device in the list, click on it, then select the Connect option on the top bar.
    * In the Device Connection window, copy the `ID Scope`, `Device ID`, and `Primary Key`, you will copy these to the device.

  * Upate the Azure IoT Edge runtime `config.yaml` file.
    * From a command line use the `adb` tool mentioned above.
    * Run the command:
       ```
       adb shell
       ```
    * This should create a connetion to your camera device's Yacto Linux operating system.
    * Change the current working directory to the Azure IoT Edge runtime configuration directory.
      ```
      cd /etc/iotedge/
      ```
    * You will need to make the file editable before you edit. The Yocto Linux installation on this device only includes the `vi` editor. Start the `vi` editor on the `config.yaml` file.
      ```
      chmod +w config.yaml
      vi config.yaml
      ```
    * Comment out the "Manual provisioning configuration" section so it looks like this:
      ```
      # Manual provisioning configuration
      #provisioning:
      #  source: "manual"
      #  device_connection_string: ""      
      ```
    * Now uncomment the "DPS symmetric keyi provisioning configuration" and add your IoT Central app's scope id, and the symmetric key you created above along with your unique device id:
      ```
      # DPS symmetric key provisioning configuration
      provisioning:
        source: "dps"
        global_endpoint: "https://global.azure-devices-provisioning.net"
        scope_id: "<ID Scope>"
        attestation:
          method: "symmetric_key"
          registration_id: "<Device ID>"
          symmetric_key: "<Primary Key>"
      ```
    * Save and exit your editor

  * Provision the `state.json` file on your device
    * This module uses a file in the devices native file system to provision manufacturer device properties. The file is read from the `/data/misc/storage` directory in the device's file system.
    * Provision the storage directory on the device:
      ```
      mkdir -p /data/misc/storage
      chmod -R 777 /data
      ```
    * Copy the state.json file from the project's `./setup` folder to the device. Use a shell window on your PC, not the ADB shell:
      ```
      adb push ./setup/state.json /data/misc/storage
      ```

  * Now Restart the Azure IoT Edge runtime with the following command:
    ```
    systemctl restart iotedge
    ```
  * After a few moments the Edge runtime should restart and use the new DPS provisioning method you configured. When that happens successfully you will see a new device in your Azure IoT app under the Devices section.
  * Follow the instructions in the [Azure IoT Central Documentation](https://docs.microsoft.com/en-us/azure/iot-central/) to add a dashboard view to your template to visualize the telemetry.
  
