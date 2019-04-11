# AI Dev Kit local service
This project is the *local service* compontent of a web client interface for the AI Vision Dev Kit. See the companion *[peabody-local-client](https://github.com/sseiber/peabody-local-client)* project for the web client source code.

This component is a REST micro-service that runs locally on device. It interfaces with the Snapdragon SNPE IPCProvider on the backend and serves up a React web client for the user experience on the frontend.

The project includes a Dockerfile and scripts used to build the docker container.

## Dependencies
  * Visual Studio Code (not exactly but you should really be using this excellent IDE)
  * NodeJS 10x (with NPM)
  * GStreamer (if you want to test locally without deploying to the camera - recommended)

## Environment installation
  * Clone this repository
  * `npm i`
  * Open VSCode on this folder

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
