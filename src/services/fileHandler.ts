import { inject, service } from 'spryly';
import { Server } from 'hapi';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { IoTCentralService, DeviceEvent, DeviceProperty, MessageType } from '../services/iotcentral';
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
import { bind, forget, pjson } from '../utils';
import { HealthStates } from './serverTypes';

const defaultFileUploadFolder: string = 'storage';
const defaultUnzipCommand: string = 'unzip -d ###UNZIPDIR ###TARGET';
const defaultModelFolderPath: string = '/data/misc/camera';
const defaultStorageFolderPath: string = '/data/misc/storage';
const defaultDockerApiVersion: string = '1.37';
const defaultDockerSocket: string = '/var/run/docker.sock';
const defaultDockerImageName: string = 'peabody-local-service';

@service('fileHandler')
export class FileHandlerService {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    @inject('iotCentral')
    private iotCentral: IoTCentralService;

    private fileUploadFolder: string = defaultFileUploadFolder;
    private unzipCommand: string = defaultUnzipCommand;
    private modelFolderPath: string = defaultModelFolderPath;
    private storageFolderPath: string = defaultStorageFolderPath;
    private dockerApiVersion: string = defaultDockerApiVersion;
    private dockerSocket: string = defaultDockerSocket;
    private dockerImageName: string = defaultDockerImageName;
    private dockerImageVersion: string = '0.0.0';

    public get currentStorageFolderPath() {
        return this.storageFolderPath;
    }

    public get currentModelFolderPath() {
        return this.modelFolderPath;
    }

    public async init(): Promise<void> {
        this.logger.log(['FileHandler', 'info'], 'initialize');

        this.fileUploadFolder = this.config.get('fileUploadFolder') || defaultFileUploadFolder;
        this.unzipCommand = this.config.get('unzipCommand') || defaultUnzipCommand;
        this.storageFolderPath = pathJoin((this.server.settings.app as any).hostRootDirectory, this.fileUploadFolder);
        this.modelFolderPath = pathJoin((this.server.settings.app as any).hostRootDirectory, 'camera');
        this.dockerApiVersion = this.config.get('dockerApiVersion') || defaultDockerApiVersion;
        this.dockerSocket = this.config.get('dockerSocket') || defaultDockerSocket;
        this.dockerImageName = this.config.get('dockerImageName') || defaultDockerImageName;

        this.dockerImageVersion = _get(pjson(), 'version') || '0.0.0';

        this.server.method({
            name: 'fileHandler.provisionDockerImage',
            method: this.provisionDockerImage
        });
        this.server.method({
            name: 'fileHandler.signalRestart',
            method: this.signalRestart
        });
    }

    @bind
    public async provisionDockerImage(): Promise<void> {
        this.logger.log(['FileHandler', 'info'], `Provisioning docker imgage`);

        const versionFilePath = pathResolve(this.storageFolderPath, 'image.ver');

        try {
            const exists = await fse.exists(versionFilePath);
            if (exists) {
                const contents = fse.readFileSync(versionFilePath);
                if (contents) {
                    const versionData = JSON.parse(contents);

                    this.logger.log(['FileHandler', 'info'], `Found existing version file: ${versionData.version}, new image is: ${this.dockerImageVersion}`);

                    if (versionData.version < this.dockerImageVersion) {
                        this.logger.log(['FileHandler', 'info'], `Removing docker images < version ${this.dockerImageVersion}`);

                        await this.removeDockerImages();

                        fse.unlinkSync(versionFilePath);

                        this.logger.log(['FileHandler', 'info'], `Writing new version file: ${this.dockerImageVersion}`);

                        writeFileSync(versionFilePath, { version: this.dockerImageVersion });

                        await this.signalRestart('provisionDockerImage-newImage');
                    }
                    else {
                        forget(this.iotCentral.sendMeasurement, MessageType.Event, { [DeviceEvent.ImageProvisionComplete]: this.dockerImageVersion });

                        forget(this.iotCentral.updateDeviceProperties, { [DeviceProperty.ImageVersion]: this.dockerImageVersion });
                    }
                }
            }
            else {
                this.logger.log(['FileHandler', 'info'], `No previous version file found`);
                this.logger.log(['FileHandler', 'info'], `Writing new version file: ${this.dockerImageVersion}`);

                writeFileSync(versionFilePath, { version: this.dockerImageVersion });

                await this.signalRestart('provisionDockerImage-noFile');
            }
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error during docker image provisioning: ${ex.message}`);
        }
    }

    public async extractAndVerifyModelFiles(fileName: any): Promise<boolean> {
        const sourceFileName = fileName;
        const destFileName = sourceFileName;
        const destFilePath = `${this.storageFolderPath}/${destFileName}`;
        const destUnzipDir = destFilePath.slice(0, -4);

        try {
            if (fse.statSync(destFilePath).size <= 0) {
                this.logger.log(['FileHandler', 'error'], `Empty video model package detected - skipping`);
                return false;
            }

            this.logger.log(['FileHandler', 'info'], `Removing any existing target unzip dir: ${destUnzipDir}`);
            await promisify(exec)(`rm -rf ${destUnzipDir}`);

            const unzipCommand = this.unzipCommand.replace('###UNZIPDIR', destUnzipDir).replace('###TARGET', destFilePath);
            const { stdout } = await promisify(exec)(unzipCommand);
            this.logger.log(['FileHandler', 'info'], `Extracted files: ${stdout}`);

            this.logger.log(['FileHandler', 'info'], `Removing zip package: ${destFilePath}`);
            await promisify(exec)(`rm -f ${destFilePath}`);

            this.logger.log(['FileHandler', 'info'], `Done extracting in: ${destUnzipDir}`);
            const dlcFile = await this.ensureModelFilesExist(destUnzipDir);

            return dlcFile !== '';
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error extracting files: ${ex.message}`);
        }

        return false;
    }

    public async saveMultiPartFormModelPackage(file: any): Promise<string> {
        const sourceFileName = file.hapi.filename;
        const destFileName = sourceFileName;
        const destFilePath = `${this.storageFolderPath}/${destFileName}`;

        const contentType = _get(file, 'hapi.headers.content-type');
        if (contentType !== 'application/zip') {
            this.logger.log(['FileHandler', 'error'], `Expected application/zip type but got: ${contentType}`);
            return '';
        }

        this.logger.log(['FileHandler', 'info'], `Creating write stream for: ${destFilePath}`);
        const fileStream = fse.createWriteStream(destFilePath);

        return new Promise((resolve, reject) => {
            try {
                file.on('error', (error) => {
                    reject(error);
                });

                file.pipe(fileStream);

                file.on('end', (error) => {
                    if (error) {
                        this.logger.log(['FileHandler', 'error'], `File upload error: ${error}`);
                    }
                    else {
                        this.logger.log(['FileHandler', 'info'], `Finished writing file: ${destFilePath}`);
                    }

                    resolve(sourceFileName);
                });
            }
            catch (ex) {
                this.logger.log(['FileHandler', 'error'], `File upload error: ${ex.message}`);

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

            if (!fileName) {
                return '';
            }

            this.logger.log(['FileHandler', 'info'], `Downloading model package: ${fileName}`);

            result = await new Promise((resolve, reject) => {
                request
                    .get(fileUrl)
                    .on('error', (error) => {
                        this.logger.log(['FileHandler', 'error'], `Error downloading model package: ${error.message}`);
                        return reject(error);
                    })
                    .on('response', (data) => {
                        const totalBytes = parseInt(data.headers['content-length'], 10);
                        this.logger.log(['FileHandler', 'info'], `Downloading model package - total bytes: ${totalBytes}`);
                    })
                    .on('data', (chunk) => {
                        receivedBytes += chunk.length;

                        if (receivedBytes % 16384 === 0) {
                            this.logger.log(['FileHandler', 'info'], `Downloading model package - received bytes: ${receivedBytes}`);
                        }
                    })
                    .on('end', () => {
                        this.logger.log(['FileHandler', 'info'], `Finished downloading model package: ${fileName}`);
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
            this.logger.log(['FileHandler', 'error'], `Error downloading model package: ${ex.message}`);
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
            this.logger.log(['FileHandler', 'info'], `Cleaning models folder: ${this.modelFolderPath}`);
            await promisify(exec)(`rm -f ${this.modelFolderPath}/*`);

            this.logger.log(['FileHandler', 'info'], `Copying new model files from: ${destUnzipDir}`);
            await promisify(exec)(`cp -R ${destUnzipDir}/* ${this.modelFolderPath}`);

            this.logger.log(['FileHandler', 'info'], `Removing unzipped model folder: ${destUnzipDir}`);
            await promisify(exec)(`rm -rf ${destUnzipDir}`);

            return true;
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error extracting files: ${ex.message}`);
        }

        return false;
    }

    public async ensureModelFilesExist(modelFolder: string): Promise<string> {
        this.logger.log(['FileHandler', 'info'], `Ensure .dlc file exists in: ${modelFolder}`);

        let dlcFile = '';

        try {
            const modelFiles = await fse.readdir(modelFolder);
            if (modelFiles) {
                dlcFile = modelFiles.find(file => (file || '').slice(-4) === '.dlc');
            }

            return dlcFile;
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error enumerating model files: ${ex.message}`);
        }

        return dlcFile;
    }

    @bind
    public async signalRestart(fromService: string): Promise<void> {
        // wait here for 5 minues while we signal a reboot through crontab
        this.logger.log(['FileHandler', 'info'], `Signalling a restart - waiting 5 minutes...`);

        // // distribute large numbers of device reprovisioning requests over a 60sec window
        // this doesn't actually work because crontab is quantized to 1 minute intervals
        // await sleep(1000 * Math.floor(Math.random() * Math.floor(60)));

        forget(this.iotCentral.sendMeasurement, MessageType.Event, { [DeviceEvent.DeviceRestart]: fromService });

        writeFileSync(pathResolve(this.storageFolderPath, 'reboot.now'), { version: this.dockerImageVersion });

        await new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, (1000 * 60 * 5));
        });

        this.logger.log(['FileHandler', 'info'], `Failed to reboot after waiting 5 minutes.`);
    }

    public getHealth(): number {
        return HealthStates.Good;
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
                    this.logger.log(['AgentService', 'info', 'removeJigsawContainer'], `Removing (-f) container id: ${imageId}`);

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
                    this.logger.log(['FileHandler', 'error', 'dockerRequest'], `dockerRequest error: ${requestError.message}`);
                    return reject(requestError);
                }

                if (response.statusCode < 200 || response.statusCode > 299) {
                    this.logger.log(['FileHandler', 'error', 'dockerRequest'], `Response status code = ${response.statusCode}`);

                    const errorMessage = body.message || body || 'An error occurred';
                    return reject(new Error(`Error statusCode: ${response.statusCode}, ${errorMessage}`));
                }

                return resolve(body);
            });
        });
    }
}
