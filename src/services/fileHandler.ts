import { inject, service } from '@sseiber/sprightly';
import { Server } from 'hapi';
import { join as pathJoin } from 'path';
import * as fse from 'fs-extra';
import { promisify } from 'util';
import { exec } from 'child_process';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import * as _get from 'lodash.get';

const defaultFileUploadFolder: string = 'storage';
const defaultUnzipCommand: string = 'unzip -d ###UNZIPDIR ###TARGET';

@service('fileHandler')
export class FileHandlerService {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    private fileUploadFolder: string = defaultFileUploadFolder;
    private unzipCommand: string = defaultUnzipCommand;
    private storageFolderPath: string = '/data/misc/storage';
    private modelFolderPath: string = '/data/misc/camera';

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
        this.storageFolderPath = pathJoin((this.server.settings.app as any).peabodyDirectory, this.fileUploadFolder);
        this.modelFolderPath = pathJoin((this.server.settings.app as any).peabodyDirectory, 'camera');
    }

    public async uploadAndVerifyModelFiles(file: any): Promise<boolean> {
        let result = false;

        try {
            result = await this.saveModelPackage(file);

            if (result) {
                result = await this.extractAndVerifyModelFiles(file);
            }
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error uploading model files: ${ex.message}`);
            result = false;
        }

        return result;
    }

    public async changeModelFiles(file: any): Promise<boolean> {
        const sourceFileName = file.hapi.filename;
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

    public async ensureModelFilesExist(modelFolder: string): Promise<any> {
        this.logger.log(['FileHandler', 'info'], `Verifying .dlc file exists in: ${modelFolder}`);

        try {
            let dlcExists = false;
            let result = [];
            const modelFiles = await fse.readdir(modelFolder);
            if (modelFiles) {
                result = modelFiles.map((file) => {
                    if (file.slice(-4) === '.dlc') {
                        dlcExists = true;
                    }
                });
            }

            return {
                dlcExists,
                modelFiles: dlcExists ? result : []
            };
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error enumerating model files: ${ex.message}`);
        }

        return {
            dlcExists: false,
            modelFiles: []
        };
    }

    private async saveModelPackage(file: any): Promise<boolean> {
        const sourceFileName = file.hapi.filename;
        const destFileName = sourceFileName;
        const destFilePath = `${this.storageFolderPath}/${destFileName}`;

        const contentType = _get(file, 'hapi.headers.content-type');
        if (contentType !== 'application/zip') {
            this.logger.log(['FileHandler', 'error'], `Expected application/zip type but got: ${contentType}`);
            return false;
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

                    resolve(true);
                });
            }
            catch (ex) {
                this.logger.log(['FileHandler', 'error'], `File upload error: ${ex.message}`);

                reject(false);
            }
        });
    }

    private async extractAndVerifyModelFiles(file: any): Promise<boolean> {
        const sourceFileName = file.hapi.filename;
        const destFileName = sourceFileName;
        const destFilePath = `${this.storageFolderPath}/${destFileName}`;
        const destUnzipDir = destFilePath.slice(0, -4);

        try {
            if (fse.statSync(destFilePath).size <= 0) {
                return false;
            }

            this.logger.log(['FileHandler', 'info'], `Removing any existing target unzip dir: ${destUnzipDir}`);
            await promisify(exec)(`rm -rf ${destUnzipDir}`);

            const unzipCommand = this.unzipCommand.replace('###UNZIPDIR', destUnzipDir).replace('###TARGET', destFilePath);
            const { stdout } = await promisify(exec)(unzipCommand);
            this.logger.log(['FileHandler', 'info'], `Extracted files: ${stdout}`);

            this.logger.log(['FileHandler', 'info'], `Removing zip package: ${destFilePath}`);
            await promisify(exec)(`rm -f ${destFilePath}`);

            this.logger.log(['FileHandler', 'info'], `Verifying .dlc file exists in: ${destUnzipDir}`);
            const ensureResult = await this.ensureModelFilesExist(destUnzipDir);

            return ensureResult.dlcExists;
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error extracting files: ${ex.message}`);
        }

        return false;
    }
}
