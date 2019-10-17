import { inject, service } from 'spryly';
import { Server } from '@hapi/hapi';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import {
    IoTCentralService,
    PeabodyModuleFieldIds,
    ProvisionStatus
} from './iotcentral';
import {
    join as pathJoin,
    resolve as pathResolve,
    parse as pathParse
} from 'path';
import * as fse from 'fs-extra';
import { promisify } from 'util';
import { exec } from 'child_process';
import { writeFileSync } from 'jsonfile';
import * as request from 'request';
import * as _get from 'lodash.get';
import * as compareVersions from 'compare-versions';
import { bind, pjson, sleep } from '../utils';
import { HealthState } from './health';

const defaultEdgeDeployment: string = '0';
const defaultFileUploadFolder: string = 'storage';
const defaultUnzipCommand: string = 'unzip -d ###UNZIPDIR ###TARGET';
const defaultModelFolderPath: string = '/data/misc/camera';
const defaultStorageFolderPath: string = '/data/misc/storage';
const defaultFirmwareVersionPath: string = '/etc/version';
const defaultBatteryLevelPath: string = '/sys/class/power_supply/battery/capacity';
const defaultDockerApiVersion: string = '1.37';
const defaultDockerSocket: string = '/var/run/docker.sock';
const defaultDockerImageName: string = 'iotc-pnp-aidevkit-module';

@service('device')
export class DeviceService {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private edgeDeployment: string = defaultEdgeDeployment;
    private fileUploadFolder: string = defaultFileUploadFolder;
    private unzipCommand: string = defaultUnzipCommand;
    private modelFolderPath: string = defaultModelFolderPath;
    private storageFolderPath: string = defaultStorageFolderPath;
    private firmwareVersionPath: string = defaultFirmwareVersionPath;
    private batteryLevelPath: string = defaultBatteryLevelPath;
    private dockerApiVersion: string = defaultDockerApiVersion;
    private dockerSocket: string = defaultDockerSocket;
    private dockerImageName: string = defaultDockerImageName;
    private dockerImageVersion: string = '0.0.0';

    public get currentModelFolderPath() {
        return this.modelFolderPath;
    }

    public async init(): Promise<void> {
        this.logger.log(['DeviceService', 'info'], 'initialize');

        this.server.method({ name: 'device.provisionDockerImage', method: this.provisionDockerImage });
        this.server.method({ name: 'device.restartDevice', method: this.restartDevice });
        this.server.method({ name: 'device.restartQmmfServices', method: this.restartQmmfServices });

        this.edgeDeployment = this.config.get('IOTEDGE_DEVICEID') || defaultEdgeDeployment;
        this.fileUploadFolder = this.config.get('fileUploadFolder') || defaultFileUploadFolder;
        this.unzipCommand = this.config.get('unzipCommand') || defaultUnzipCommand;
        this.storageFolderPath = pathJoin((this.server.settings.app as any).dataMiscRootDirectory, this.fileUploadFolder);
        this.modelFolderPath = pathJoin((this.server.settings.app as any).dataMiscRootDirectory, 'camera');
        this.dockerApiVersion = this.config.get('dockerApiVersion') || defaultDockerApiVersion;
        this.dockerSocket = this.config.get('dockerSocket') || defaultDockerSocket;
        this.dockerImageName = this.config.get('dockerImageName') || defaultDockerImageName;

        this.dockerImageVersion = _get(pjson(), 'version') || '0.0.0';
    }

    @bind
    public async provisionDockerImage(): Promise<void> {
        this.logger.log(['DeviceService', 'info'], `Provisioning docker imgage`);

        await this.iotCentral.updateDeviceProperties({ [PeabodyModuleFieldIds.Property.ImageStatus]: ProvisionStatus.Installing });

        const imageVersionFilePath = pathResolve(this.storageFolderPath, 'image.ver');

        try {
            const firmwareProperties = await this.getFirmwareProperties();
            const versionData = await this.getContainerImageVersion();

            if (this.edgeDeployment !== defaultEdgeDeployment && _get(versionData, 'version') !== 'Unknown') {
                this.logger.log(['DeviceService', 'info'], `Found existing version file: ${versionData.version}, new image is: ${this.dockerImageVersion}`);

                if (compareVersions(versionData.version, this.dockerImageVersion) < 0) {
                    this.logger.log(['DeviceService', 'info'], `Removing docker images < version ${this.dockerImageVersion}`);

                    await this.removeDockerImages();

                    fse.unlinkSync(imageVersionFilePath);

                    this.logger.log(['DeviceService', 'info'], `Writing new version file: ${this.dockerImageVersion}`);

                    writeFileSync(imageVersionFilePath, { version: this.dockerImageVersion });

                    await this.iotCentral.updateDeviceProperties({
                        [PeabodyModuleFieldIds.Property.ImageVersion]: this.dockerImageVersion,
                        [PeabodyModuleFieldIds.Property.ImageStatus]: ProvisionStatus.Pending,
                        [PeabodyModuleFieldIds.Property.FirmwareVersion]: firmwareProperties.firmwareVersion,
                        [PeabodyModuleFieldIds.Property.BatteryLevel]: firmwareProperties.batteryLevel
                    });

                    // await this.restartDevice('DeviceService:provisionDockerImage:newImage');
                    // // await this.restartQmmfServices('DeviceService:provisionDockerImage:newImage');
                }
                else {
                    await this.iotCentral.sendMeasurement({ [PeabodyModuleFieldIds.Event.ImageProvisionComplete]: this.dockerImageVersion });

                    await this.iotCentral.updateDeviceProperties({
                        [PeabodyModuleFieldIds.Property.ImageVersion]: this.dockerImageVersion,
                        [PeabodyModuleFieldIds.Property.ImageStatus]: ProvisionStatus.Completed,
                        [PeabodyModuleFieldIds.Property.FirmwareVersion]: firmwareProperties.firmwareVersion,
                        [PeabodyModuleFieldIds.Property.BatteryLevel]: firmwareProperties.batteryLevel
                    });
                }
            }
            else {
                this.logger.log(['DeviceService', 'info'], `No previous version file found`);
                this.logger.log(['DeviceService', 'info'], `Writing new version file: ${this.dockerImageVersion}`);

                writeFileSync(imageVersionFilePath, { version: this.dockerImageVersion });

                await this.iotCentral.updateDeviceProperties({
                    [PeabodyModuleFieldIds.Property.ImageVersion]: this.dockerImageVersion,
                    [PeabodyModuleFieldIds.Property.ImageStatus]: ProvisionStatus.Pending,
                    [PeabodyModuleFieldIds.Property.FirmwareVersion]: firmwareProperties.firmwareVersion,
                    [PeabodyModuleFieldIds.Property.BatteryLevel]: firmwareProperties.batteryLevel
                });

                // if (this.edgeDeployment !== defaultEdgeDeployment) {
                //     await this.restartDevice('DeviceService:provisionDockerImage:noFile');
                //     // await this.restartQmmfServices('DeviceService:provisionDockerImage:noFile');
                // }
            }
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Error during docker image provisioning: ${ex.message}`);
        }
    }

    public async extractAndVerifyModelFiles(fileName: any): Promise<boolean> {
        const sourceFileName = fileName;
        const destFileName = sourceFileName;
        const destFilePath = `${this.storageFolderPath}/${destFileName}`;
        const destUnzipDir = destFilePath.slice(0, -4);

        try {
            if (fse.statSync(destFilePath).size <= 0) {
                this.logger.log(['DeviceService', 'error'], `Empty video model package detected - skipping`);
                return false;
            }

            this.logger.log(['DeviceService', 'info'], `Removing any existing target unzip dir: ${destUnzipDir}`);
            await promisify(exec)(`rm -rf ${destUnzipDir}`);

            const unzipCommand = this.unzipCommand.replace('###UNZIPDIR', destUnzipDir).replace('###TARGET', destFilePath);
            const { stdout } = await promisify(exec)(unzipCommand);
            this.logger.log(['DeviceService', 'info'], `Extracted files: ${stdout}`);

            this.logger.log(['DeviceService', 'info'], `Removing zip package: ${destFilePath}`);
            await promisify(exec)(`rm -f ${destFilePath}`);

            this.logger.log(['DeviceService', 'info'], `Done extracting in: ${destUnzipDir}`);
            const dlcFile = await this.ensureModelFilesExist(destUnzipDir);

            return dlcFile !== '';
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Error extracting files: ${ex.message}`);
        }

        return false;
    }

    public async saveMultiPartFormModelPackage(file: any): Promise<string> {
        const sourceFileName = file.hapi.filename;
        const destFileName = sourceFileName;
        const destFilePath = `${this.storageFolderPath}/${destFileName}`;

        const contentType = _get(file, 'hapi.headers.content-type');
        if (contentType !== 'application/zip' && contentType !== 'application/x-zip-compressed') {
            this.logger.log(['DeviceService', 'error'], `Expected application/zip type but got: ${contentType}`);
            return '';
        }

        this.logger.log(['DeviceService', 'info'], `Creating write stream for: ${destFilePath}`);
        const fileStream = fse.createWriteStream(destFilePath);

        return new Promise((resolve, reject) => {
            try {
                file.on('error', (error) => {
                    reject(error);
                });

                file.pipe(fileStream);

                file.on('end', (error) => {
                    if (error) {
                        this.logger.log(['DeviceService', 'error'], `File upload error: ${error}`);
                    }
                    else {
                        this.logger.log(['DeviceService', 'info'], `Finished writing file: ${destFilePath}`);
                    }

                    resolve(sourceFileName);
                });
            }
            catch (ex) {
                this.logger.log(['DeviceService', 'error'], `File upload error: ${ex.message}`);

                reject(false);
            }
        });
    }

    public async saveUrlModelPackage(fileUrl: string): Promise<any> {
        let result = '';

        try {
            const fileParse = pathParse(fileUrl);
            const fileName = _get(fileParse, 'base') || '';
            let receivedBytes = 0;
            let progressChunk = 0;
            let progressTotal = 0;

            if (!fileName) {
                return '';
            }

            this.logger.log(['DeviceService', 'info'], `Downloading model package: ${fileName}`);

            result = await new Promise((resolve, reject) => {
                request
                    .get(fileUrl)
                    .on('error', (error) => {
                        this.logger.log(['DeviceService', 'error'], `Error downloading model package: ${error.message}`);
                        return reject(error);
                    })
                    .on('response', (data) => {
                        const totalBytes = parseInt(data.headers['content-length'], 10) || 1;
                        progressChunk = Math.floor(totalBytes / 10);

                        this.logger.log(['DeviceService', 'info'], `Downloading model package - total bytes: ${totalBytes}`);
                    })
                    .on('data', (chunk) => {
                        receivedBytes += chunk.length;

                        if (receivedBytes > (progressTotal + progressChunk)) {
                            progressTotal += progressChunk;

                            this.logger.log(['DeviceService', 'info'], `Downloading model package - received bytes: ${receivedBytes}`);
                        }
                    })
                    .on('end', () => {
                        this.logger.log(['DeviceService', 'info'], `Finished downloading model package: ${fileName}`);
                        return resolve(fileName);
                    })
                    .pipe(fse.createWriteStream(pathResolve(this.storageFolderPath, fileName)))
                    .on('error', (error) => {
                        return reject(error);
                    })
                    .on('close', () => {
                        return resolve(fileName);
                    });
            });
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Error downloading model package: ${ex.message}`);
            result = '';
        }

        return result;
    }

    public async switchVisionAiModelFiles(fileName: any): Promise<boolean> {
        const sourceFileName = fileName;
        const destFileName = sourceFileName;
        const destFilePath = `${this.storageFolderPath}/${destFileName}`;
        const destUnzipDir = destFilePath.slice(0, -4);

        try {
            this.logger.log(['DeviceService', 'info'], `Cleaning models folder: ${this.modelFolderPath}`);
            await promisify(exec)(`rm -f ${this.modelFolderPath}/*`);

            this.logger.log(['DeviceService', 'info'], `Copying new model files from: ${destUnzipDir}`);
            await promisify(exec)(`cp -R ${destUnzipDir}/* ${this.modelFolderPath}`);

            this.logger.log(['DeviceService', 'info'], `Removing unzipped model folder: ${destUnzipDir}`);
            await promisify(exec)(`rm -rf ${destUnzipDir}`);

            return true;
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Error extracting files: ${ex.message}`);
        }

        return false;
    }

    public async ensureModelFilesExist(modelFolder: string): Promise<string> {
        this.logger.log(['DeviceService', 'info'], `Ensure .dlc file exists in: ${modelFolder}`);

        let dlcFile = '';

        try {
            const modelFiles = await fse.readdir(modelFolder);
            if (modelFiles) {
                dlcFile = modelFiles.find(file => (file || '').slice(-4) === '.dlc');
            }

            return dlcFile;
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Error enumerating model files: ${ex.message}`);
        }

        return dlcFile;
    }

    public async getHealth(): Promise<number> {
        const firmwareProperties = await this.getFirmwareProperties();

        await this.iotCentral.sendMeasurement({ [PeabodyModuleFieldIds.Telemetry.BatteryLevel]: firmwareProperties.batteryLevel });
        await this.iotCentral.updateDeviceProperties({ [PeabodyModuleFieldIds.Property.BatteryLevel]: firmwareProperties.batteryLevel });

        return HealthState.Good;
    }

    private async getFirmwareProperties(): Promise<any> {
        if (_get(process.env, 'LOCAL_DEBUG') === '1') {
            return {
                firmwareVersion: '0.0.0',
                batteryLevel: '100'
            };
        }

        const result = {
            firmwareVersion: 'Unknown',
            batteryLevel: 'Unknown'
        };

        try {
            const { stdout } = await promisify(exec)(`cat ${this.firmwareVersionPath}`);
            if (stdout) {
                result.firmwareVersion = (stdout || '').trim();
            }
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Error retrieving firmware version: ${ex.message}`);
        }

        try {
            const { stdout } = await promisify(exec)(`cat ${this.batteryLevelPath}`);
            if (stdout) {
                result.batteryLevel = (stdout || '').trim();
            }
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Error retrieving device battery level: ${ex.message}`);
        }

        return result;
    }

    private async getContainerImageVersion(): Promise<any> {
        let result = { version: 'Unknown' };

        try {
            const imageVersionFilePath = pathResolve(this.storageFolderPath, 'image.ver');

            const exists = await fse.exists(imageVersionFilePath);
            if (exists) {
                const contents = fse.readFileSync(imageVersionFilePath);
                if (contents) {
                    result = JSON.parse(contents);
                }
            }
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Error looking for firmware version file: ${ex.message}`);
        }

        return result;
    }

    @bind
    private async restartQmmfServices(fromService: string): Promise<void> {
        if (_get(process.env, 'LOCAL_DEBUG') === '1') {
            return;
        }

        this.logger.log(['DeviceService', 'info'], `Restarting Qmmf services...`);

        try {
            await this.iotCentral.sendMeasurement({ [PeabodyModuleFieldIds.Event.QmmfRestart]: fromService });

            await promisify(exec)(`systemctl restart qmmf-webserver`);
            await promisify(exec)(`systemctl restart ipc-webserver`);

            await sleep(2000);
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Failed to auto-restart qmmf services - will exit container now: ${ex.message}`);
        }
    }

    @bind
    private async restartDevice(fromService: string): Promise<void> {
        if (_get(process.env, 'LOCAL_DEBUG') === '1') {
            return;
        }

        // wait here for 5 minutes while we signal a reboot
        this.logger.log(['DeviceService', 'info'], `Scheduling a restart in 30 seconds...`);

        try {
            await this.iotCentral.sendMeasurement({ [PeabodyModuleFieldIds.Event.DeviceRestart]: fromService });
            await this.iotCentral.updateDeviceProperties({ [PeabodyModuleFieldIds.Property.ImageStatus]: ProvisionStatus.Restarting });

            await promisify(exec)(`reboot --reboot`);

            await new Promise((resolve) => {
                setTimeout(() => {
                    resolve();
                }, (1000 * 30));
            });

            this.logger.log(['DeviceService', 'info'], `Failed to auto-restart after 30 seconds... Container will restart now.`);
        }
        catch (ex) {
            this.logger.log(['DeviceService', 'error'], `Failed to auto-restart device - will exit container now: ${ex.message}`);
        }

        // let Docker restart our container
        process.exit(1);
    }

    private async removeDockerImages(): Promise<void> {
        if (_get(process.env, 'LOCAL_DEBUG') === '1') {
            return;
        }

        const images = await this.getDockerImages();
        if (Array.isArray(images) && images.length > 0) {
            for (const image of images) {
                const imageId = image.Id;
                const imageName = image.RepoTags[0];
                const imageVersion = imageName.split(':')[1];

                if (imageVersion < this.dockerImageVersion) {
                    this.logger.log(['DeviceService', 'info'], `Removing (-f) container id: ${imageId}`);

                    const options = {
                        method: 'DELETE',
                        socketPath: this.dockerSocket,
                        uri: `http://v${this.dockerApiVersion}/images/${imageId}?force=1`,
                        json: true
                    };

                    await this.dockerRequest(options);
                }
            }
        }
    }

    private async getDockerImages(): Promise<any> {
        const filter = {
            reference: [`*\/${this.dockerImageName}*:*`]
        };

        const filterStringEncoded = encodeURIComponent(JSON.stringify(filter));
        const options = {
            method: 'GET',
            socketPath: this.dockerSocket,
            uri: `http://v${this.dockerApiVersion}/images/json?all=1&filters=${filterStringEncoded}`,
            json: true
        };

        return this.dockerRequest(options);
    }

    private dockerRequest(options: any): Promise<any> {
        return new Promise((resolve, reject) => {
            request(options, (requestError, response, body) => {
                if (requestError) {
                    this.logger.log(['DeviceService', 'error', 'dockerRequest'], `dockerRequest error: ${requestError.message}`);
                    return reject(requestError);
                }

                if (response.statusCode < 200 || response.statusCode > 299) {
                    this.logger.log(['DeviceService', 'error', 'dockerRequest'], `Response status code = ${response.statusCode}`);

                    const errorMessage = body.message || body || 'An error occurred';
                    return reject(new Error(`Error statusCode: ${response.statusCode}, ${errorMessage}`));
                }

                return resolve(body);
            });
        });
    }
}
