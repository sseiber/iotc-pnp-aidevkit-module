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
