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
    private fileUploadPath: string = '/data/misc/storage';
    private modelFilesDirectory: string = '/data/misc/camera';

    public async init(): Promise<void> {
        this.logger.log(['FileHandler', 'info'], 'initialize');

        this.fileUploadFolder = this.config.get('fileUploadFolder') || defaultFileUploadFolder;
        this.unzipCommand = this.config.get('unzipCommand') || defaultUnzipCommand;
        this.fileUploadPath = pathJoin((this.server.settings.app as any).peabodyDirectory, this.fileUploadFolder);
        this.modelFilesDirectory = pathJoin((this.server.settings.app as any).peabodyDirectory, 'camera');
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
        const destFilePath = `${this.fileUploadPath}/${destFileName}`;
        const destUnzipDir = destFilePath.slice(0, -4);

        try {
            this.logger.log(['FileHandler', 'info'], `Cleaning models directory: ${this.modelFilesDirectory}`);
            await promisify(exec)(`rm -f ${this.modelFilesDirectory}/*`);

            this.logger.log(['FileHandler', 'info'], `Copying new model files from: ${destUnzipDir}`);
            await promisify(exec)(`cp -R ${destUnzipDir}/* ${this.modelFilesDirectory}`);

            this.logger.log(['FileHandler', 'info'], `Removing unzipped model directory: ${destUnzipDir}`);
            await promisify(exec)(`rm -rf ${destUnzipDir}`);

            return true;
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error extracting files: ${ex.message}`);
        }

        return false;
    }

    public async retrieveModelFiles() {
        try {
            const cameraDirectory = pathJoin((this.server.settings.app as any).peabodyDirectory, 'camera');

            this.logger.log(['FileHandler', 'info'], `Looking for model files in: ${cameraDirectory}`);

            return fse.readdir(cameraDirectory);
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error enumerating model files: ${ex.message}`);

            return ['\u00a0', '\u00a0', '\u00a0', '\u00a0'];
        }
    }

    private async saveModelPackage(file: any): Promise<boolean> {
        const sourceFileName = file.hapi.filename;
        const destFileName = sourceFileName;
        const destFilePath = `${this.fileUploadPath}/${destFileName}`;

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
        const destFilePath = `${this.fileUploadPath}/${destFileName}`;
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
            let dlcExists = false;
            const unzipFiles = await fse.readdir(destUnzipDir);
            for (const unzipFile of unzipFiles) {
                if (unzipFile.slice(-4) === '.dlc') {
                    dlcExists = true;
                    break;
                }
            }

            return dlcExists;
        }
        catch (ex) {
            this.logger.log(['FileHandler', 'error'], `Error extracting files: ${ex.message}`);
        }

        return false;
    }
}
