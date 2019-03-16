# Peabody local service
Peabody service to run locally on device. This is a REST micro-service that interfaces with
the Snapdragon SNPE IPCProvider on the backend and serves up the React web client (see the
companion project) on the front end.

## Dependencies
  * Node
  * NPM
  * Docker

## Install
  * Clone this repository
  * npm i
  * create ./configs and place environment variables in a local.json file
  * Run (F5)

## Development
  * **test:**  
  `npm run test`  

  * **lint:**  
  `npm run tslint`  

  * **build a new version:**  
  `npm version [major|minor|patch] [--force]`  
  *this assumes access to the container registry for the image being built*
