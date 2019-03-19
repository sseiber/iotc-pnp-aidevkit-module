# Peabody local service
Peabody service to run locally on device. This is a REST micro-service that interfaces with
the Snapdragon SNPE IPCProvider on the backend and is intended to integrate with a React web 
client (see the companion project) on the front end.

## Dependencies
  * arm32v7/alpine:3.9 (base image)
  * NodeJS 10x (with NPM)
  * GStreamer

## Install
  * Create directory /data/misc/storage  
  * **[OPTIONAL IF YOU WANT TO PRECONFIGURE THE DEVICE]**
    * Pass environment variable `systemName=hostname`
    * Place config file (hostname-state.json) in the host's `/root/misc/storage` folder with the following data:  
    ```
    {
        "setupToken": "1C27B699",
        "hostName": "hostname",
        "registration": {
            "systemName": "systemname",
            "systemId": "fff86194-5faf-44a4-a50a-4ffd9766af5e"
        }
    }
    ```
  * Download image (final name TBD)
  * Dock

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
