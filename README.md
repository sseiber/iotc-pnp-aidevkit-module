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
* In order for the camera to run a video models we need to copy a video model to it. The Vision AI Dev device should already have been provisioned with a video model if you followed the setup instructions. But just to be sure you can check on the camera device that the `/data/misc/camera` folder contains a vision model. Use the following command in a terminal window:
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
        "imageName": "<your-container-registry>/<your-docker-imagename>"
    }
    ```
    To build the Docker image (using your image name configured the imageName.json config file) run the command:
    ```
    npm version patch
    ```
    Note: if you have files checked out in your project you will need to add `--force` to the end of the command e.g.: `npm version patch --force`
  * This will build the image defined in the `./configs/imageName.json` file and bump the version number in the package.json file. * When the build completes it should have built the docker container and pushed it to your container registry.
## Create a new IoT Central app with a module template
This section describes how to create a new IoT Central pnp app and create the module template (dcm) for the Microsoft Vision AI Dev Kit.
### Create the IoT Central app
* Create a new IoT Central App (https://apps.azureiotcentral.com)
* Pay-as-you-go or Trial
### Import the device template from this project
* Add a new template
* Edge template (may need to add `?flights=iotEdge` to the url)
* Select IoT Edge
* Skip adding the deployment manifest
* Select to Import a Capability Model
  *  Use the capability model in this project's `./dcm` folder
### Add the module deployment manifest
* Replace manifest with the one in this project  
  * Note: you need to update manifest the image name and tag for your container and the Container Registry name and credentials.

## Configure the IoT Edge runtime on the camera device
This section will describe how to configure the IoT Edge runtime for use with IoT Central.
  * You will need to update the Azure IoT Edge runtime provisioning method in the `/etc/iotedge/config.yaml` file to connect to your Azure IoT Central app. This will use the DPS symmetric key provisioning method in the `config.yaml` file.
  * Create a sysmmetric key to use for your device provisioning
    * In your Azure IoT App go to the Administration section (left pane) and select Device Connection.
    * First, copy the `ID Scope` at the top of the screen - you'll use this later.
    * Under "Authentication Methods" you should see two tabs/titles "Devices" and "Azure Edge Devices". Select "Azure Edge Devices"  
      NOTE: You may need to add the `?flights=iotEdge` to the end of the url in your browser.
    * Click on the "View Keys" link just below
    * This will show you the Primary and Secondary keys for the Shared Access Signature (master key) for the Azure Edge Devices enrollment group. Copy the Primary or Secondary key.
    * Using the [dps-keygen tool](https://github.com/Azure/dps-keygen) use the following command to create a symmetric key for device provisioning
      ```
      dps-keygen -mk:<say key from IoT Central app> -di:<unique device name>

      Example:
      dps-keygen -mk fgQBCaxXSY2omT9NkYTALgOCebpD1/RRkCycDqGruBlxeiA7IBLtJe2uvrEJT7y8HhjWVlPcy8A0zPe7Nlfh7vW== -di:test-device
      ```
    * The result of the command will be a symmetric key like this:
      ```
      Azure IoT DPS Symetric Key Generator v0.3.1

      please find the device key below.
      GbTbdKj/b8p32WK2W8tFbn8WcQpxrBKScfkhpmzuD7I=
      ```
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
      sudo chmod +r config.yaml
      vi config.yaml
      ```
    * Comment out the "Manual provisioning configuration" section so it looks like this
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
        scope_id: "<YOUR APP'S SCOPE ID FROM ABOVE>"
        attestation:
          method: "symmetric_key"
          registration_id: "<YOUR UNIQUE DEVICE ID>"
          symmetric_key: "<THE DEVICE SYMMETRIC KEY YOU CREATED ABOVE>"
      ```
    * Save and exit your editor
    * Now Restart the Azure IoT Edge runtime with the following command:
      ```
      sudo systemctl restart iotedge
      ```
    * After a few moments the Edge runtime should restart and use the new DPS provisioning method you configured. When that happens successfully you will see a new device in your Azure IoT app under the Devices section.

## Connect your new IoT Edge device to the Microsoft Vision AI Dev Kit template
This section now to connect the Azure IoT Edge device you created above to the Microsoft Vision AI Dev Kit template you imported into your Azure IoT App.
* Go to the Device section in your app (left pane).
* You should see your new `test-device` running and with a device status as `Unassociated`
* Select the device using the radio button on the left side, then select the "Migrate" option.
* You should see a list of possible template to choose from. Select the template you imported above when you created the IoT Central app.
* The device will be migrated to the selected template.
* When you select the device you will now be taken to the views using that template
* At this point you should be able to use the various tabs in the view (e.g. "About", "Overview", "Modules", "Manage", etc.) to see real time telemetry and device information.
