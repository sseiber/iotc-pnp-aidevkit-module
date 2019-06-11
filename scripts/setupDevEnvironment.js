// tslint:disable:no-console
const os = require('os');
const path = require('path');
const fse = require('fs-extra');
const uuid = require('uuid');

const processArgs = require('commander')
    .option('-r, --workspace-root <workspaceRoot>', 'Workspace root folder path')
    .parse(process.argv);

const osType = os.type();
const workspaceRootFolder = processArgs.workspaceRoot || process.cwd();

async function createEnvironmentConfiguration(rootFolder) {
    const configFilePath = path.resolve(rootFolder, `configs/local.json`);

    if (!fse.pathExistsSync(configFilePath)) {
        console.log(`Creating environment configuration: ./${configFilePath}`);
        await fse.ensureFile(configFilePath);

        await fse.writeJson(configFilePath, {
            cameraIpAddress: 'your-camera-ip-address',
            hostIpAddress: 'localhost'
        }, { spaces: 4 });
    }

    const imageConfigFilePath = path.resolve(rootFolder, `configs/imageConfig.json`);

    if (!fse.pathExistsSync(imageConfigFilePath)) {
        console.log(`Creating docker image configuration: ./${imageConfigFilePath}`);
        await fse.ensureFile(imageConfigFilePath);

        await fse.writeJson(imageConfigFilePath, {
            imageName: 'container-registry/image-name'
        }, { spaces: 4 });
    }
}

async function createCameraConfiguration(rootFolder) {
    const modelFilePath = path.resolve(rootFolder, `peabody/camera/model.dlc`);

    if (!fse.pathExistsSync(modelFilePath)) {
        console.log(`Creating camera configuration: ./${modelFilePath}`);
        await fse.ensureFileSync(modelFilePath);
    }
}

async function createStateConfiguration(rootFolder) {
    const stateFilePath = path.resolve(rootFolder, `peabody/storage/state.json`);

    if (!fse.pathExistsSync(stateFilePath)) {
        console.log(`Creating storage configuration: ./${stateFilePath}`);
        await fse.ensureFile(stateFilePath);

        await fse.writeJson(stateFilePath, {
            system: {
                systemName: uuid.v4(),
                systemId: uuid.v4()
            },
            iotCentral: {
                deviceId: "<device-id>",
                deviceKey: "<device-key>",
                properties: {
                    prop_main_board: "Vision AI Development Kit",
                    prop_os: "Yocto Linux",
                    prop_soc: "Qualcomm QCS603",
                    prop_wifi_bluetooth: "WCN3980 (1x1)/ Bluetooth low energy 5",
                    prop_camera: "8MP/4K UHD",
                    prop_emmc: "16GB",
                    prop_system_memory: "4GB LPDDR4x",
                    prop_speaker_mic: "Line in / out / 4x Mic / Speaker",
                    prop_ethernet: "Via USB-C with adapter",
                    prop_power: "Rechargeable battery / PoE / USB-C",
                    prop_storage: "SD slot for microSD card",
                    prop_indicator: "3x LED",
                    prop_usb: "USB Type C",
                    prop_hdmi: "HDMI A"
                }
            }
        }, { spaces: 4 });
    }
}

async function start() {
    console.log(`Creating workspace environment: ${workspaceRootFolder}`);
    console.log(`Platform: ${osType}`);

    let setupFailed = false;

    try {
        if (!workspaceRootFolder) {
            throw '';
        }

        await createEnvironmentConfiguration(workspaceRootFolder);
        await createCameraConfiguration(workspaceRootFolder);
        await createStateConfiguration(workspaceRootFolder);
    } catch (e) {
        setupFailed = true;
    } finally {
        if (!setupFailed) {
            console.log(`Operation complete`);
        }
    }

    if (setupFailed) {
        console.log(`Operation failed, see errors above`);
        process.exit(-1);
    }
}

start();
// tslint:enable:no-console
