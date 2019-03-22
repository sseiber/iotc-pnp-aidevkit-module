# AI Dev Kit local service
This is the service to run locally on device. This is a REST micro-service that interfaces with the Snapdragon SNPE IPCProvider on the backend and serves up a React web client for the user experience (see the companion project) on the front end.

## Dependencies
  * arm32v7/alpine:3.9 (base image)
  * NodeJS 10x (with NPM)
  * GStreamer

## Install and run locally on the device
  * Open a command window and use `adb shell` to connect to your AI Dev Kit
  * **[OPTIONAL IF YOU WANT TO PRECONFIGURE THE DEVICE]**
    * Place config file `<your-unique-hostname>-state.json` in a folder on the host named `/root/misc/storage` folder with the following data:  
        ```
        {
            "registration": {
                "systemName": "systemname",
                "systemId": "fff86194-5faf-44a4-a50a-4ffd9766af5e"
            }
        }
        ```
    * Run the following command to start the Docker image  
        ```
        docker run -it -e user=admin -e password=admin --network=host -v /data/misc:/data/misc iotccrscotts.azurecr.io/peabody-local-service:<latest-version> node ./dist/index.js
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
    `user=admin`  
    `password=admin`

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
