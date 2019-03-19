import { ConfigService } from '../services/config';
import { LoggingService } from '../services/logging';
import { service, inject } from '@sseiber/sprightly';
import { Server } from 'hapi';
import * as request from 'request';
import { EventEmitter } from 'events';
import * as _get from 'lodash.get';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as fse from 'fs-extra';
import { join as pathJoin } from 'path';
import { platform as osPlatform } from 'os';

const defaultResolutionSel: number = 1;
const defaultEncoderSel: number = 1;
const defaultBitRateSel: number = 3;
const defaultFrameRatesSel: number = 1;

@service('camera')
export class CameraService extends EventEmitter {
    @inject('$server')
    private server: Server;

    @inject('config')
    private config: ConfigService;

    @inject('logger')
    private logger: LoggingService;

    private ipAddress: string = '';
    private sessionToken: string = '';
    private port: string = '1080';
    private rtspUrl: string = '';
    private vamUrl: string = '';
    private resolutions: string[] = [];
    private encoders: string[] = [];
    private bitRates: string[] = [];
    private frameRates: number[] = [];

    public get resolutionSelections() {
        return this.resolutions;
    }

    public get encoderSelections() {
        return this.encoders;
    }

    public get bitRateSelections() {
        return this.bitRates;
    }

    public get frameRateSelections() {
        return this.frameRates;
    }

    public async init() {
        this.logger.log(['CameraService', 'info'], 'initialize');

        await this.login();
    }

    public async login(): Promise<boolean> {
        try {
            if (this.sessionToken) {
                await this.ipcPostRequest('/logout');
            }

            this.ipAddress = this.config.get('ipAddress') || await this.getWlanIp();

            let result = await this.ipcLogin();
            if (result === true) {
                const response = await this.getConfiguration();
                result = response.status;
            }

            if (result === true) {
                result = await this.initializeCamera();
            }

            if (result === false && this.sessionToken) {
                this.logger.log(['CameraService', 'error'], `Error during initialization, logging out`);

                await this.logout();
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    public async logout(): Promise<boolean> {
        try {
            await this.ipcPostRequest('/logout');

            this.sessionToken = '';

            return true;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    public async getConfiguration(): Promise<any> {
        try {
            const response = JSON.parse(await this.ipcGetRequest('/video'));

            if (response.status === true) {
                this.resolutions = [...response.resolution];
                this.encoders = [...response.encodeMode];
                this.bitRates = [...response.bitRate];
                this.frameRates = [...response.fps];

                return {
                    ...response,
                    sessionToken: this.sessionToken,
                    ipAddress: await this.getWlanIp(),
                    rtspUrl: this.rtspUrl,
                    vamUrl: this.vamUrl,
                    modelFiles: await this.retrieveModelFiles()
                };
            }

            return {
                status: response.status
            };
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return {
                status: false
            };
        }
    }

    public async resetCameraServices(): Promise<void> {
        try {
            if (osPlatform() === 'darwin') {
                await promisify(exec)(`adb shell pkill /usr/bin/ipc-webserver`);
                await promisify(exec)(`adb shell pkill /usr/bin/qmmf-server`);
            }
            else {
                await promisify(exec)(`pkill /usr/bin/ipc-webserver`);
                await promisify(exec)(`pkill /usr/bin/qmmf-server`);
            }

            await this.sleep(5000);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], `Failed to reset system services: ${ex.message}`);
        }
    }

    public async rebootCamera(): Promise<void> {
        try {
            if (osPlatform() === 'darwin') {
                await promisify(exec)(`adb shell reboot`);
            }
            else {
                await promisify(exec)(`reboot`);
            }

            await this.sleep(5000);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], `Failed to reset system services: ${ex.message}`);
        }
    }

    public async togglePreview(status: boolean): Promise<boolean> {
        try {
            let result = await this.uninitializeCamera();

            if (result && status === true) {
                result = await this.ipcPostRequest('/preview', { switchStatus: status });
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    public async toggleVam(status: boolean): Promise<boolean> {
        const payload = {
            switchStatus: status,
            vamconfig: 'MD'
        };

        try {
            return this.ipcPostRequest('/vam', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async initializeCamera(): Promise<boolean> {
        try {
            let result = await this.ipcPostRequest('/preview', { switchStatus: false });

            if (result === true) {
                result = await this.configurePreview(defaultResolutionSel, defaultEncoderSel, defaultBitRateSel, defaultFrameRatesSel, 0);
            }

            if (result === true) {
                result = await this.ipcPostRequest('/preview', { switchStatus: true });
            }

            if (result === true) {
                result = await this.getRtspVideoUrl();
            }

            if (result === true) {
                result = await await this.ipcPostRequest('/preview', { switchStatus: false });
            }

            if (result === true) {
                result = await this.configurePreview(defaultResolutionSel, defaultEncoderSel, defaultBitRateSel, defaultFrameRatesSel, 1);
            }

            if (result === true) {
                result = await await this.ipcPostRequest('/preview', { switchStatus: true });
            }

            if (result === true) {
                result = await this.ipcPostRequest('/vam', { switchStatus: true, vamconfig: 'MD' });
            }

            if (result === true) {
                result = await this.getRtspVamUrl();
            }

            if (result === true) {
                result = await this.configureOverlay('inference');
            }

            if (result === true) {
                result = await this.ipcPostRequest('/overlay', { switchStatus: true });
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], `Failed during initSession: ${ex.message}`);

            return false;
        }
    }

    private async uninitializeCamera(): Promise<boolean> {
        try {
            let result = await this.ipcPostRequest('/overlay', { switchStatus: false });

            if (result === true) {
                result = await this.ipcPostRequest('/vam', { switchStatus: false, vamconfig: 'MD' });
            }

            if (result === true) {
                result = await this.ipcPostRequest('/preview', { switchStatus: false });
            }

            return result;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], `Failed during initSession: ${ex.message}`);

            return false;
        }
    }

    private async configurePreview(resolution: number, encoder: number, bitRate: number, frameRate: number, displayOut: number): Promise<boolean> {
        const payload = {
            resolutionSelectVal: (resolution < this.resolutions.length) ? resolution : defaultResolutionSel,
            encodeModeSelectVal: (encoder < this.encoders.length) ? encoder : defaultEncoderSel,
            bitRateSelectVal: (bitRate < this.bitRates.length) ? bitRate : defaultBitRateSel,
            fpsSelectVal: (frameRate < this.frameRates.length) ? frameRate : defaultFrameRatesSel,
            displayOut
        };

        try {
            return this.ipcPostRequest('/video', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private configureOverlay(type: string, text?: string): Promise<boolean> {
        if (type === 'inference') {
            return this.configureInferenceOverlay();
        }
        else if (type === 'text') {
            return this.configureTextOverlay(text);
        }

        this.logger.log(['CameraService', 'error'], 'Invalid overlay type use (inference/text)');
        return Promise.resolve(false);
    }

    // private async toggleOverlay(status): Promise<boolean> {
    //     try {
    //         return this.ipcPostRequest('/overlay', { switchStatus: status });
    //     }
    //     catch (ex) {
    //         this.logger.log(['CameraService', 'error'], ex.message);

    //         return false;
    //     }
    // }

    private async configureInferenceOverlay(): Promise<boolean> {
        const payload = {
            ov_type_SelectVal: 5,
            ov_position_SelectVal: 0,
            ov_color: '869007615',
            ov_usertext: 'Text',
            ov_start_x: 0,
            ov_start_y: 0,
            ov_width: 0,
            ov_height: 0
        };

        try {
            return this.ipcPostRequest('/overlayconfig', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async configureTextOverlay(text: string): Promise<boolean> {
        const payload = {
            ov_type_SelectVal: 0,
            ov_position_SelectVal: 0,
            ov_color: '869007615',
            ov_usertext: text,
            ov_start_x: 0,
            ov_start_y: 0,
            ov_width: 0,
            ov_height: 0
        };

        try {
            return this.ipcPostRequest('overlayconfig', payload);
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async getRtspVamUrl(): Promise<boolean> {
        try {
            const response = JSON.parse(await this.ipcGetRequest('/vam'));

            this.vamUrl = response.url || '';

            return response.status;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async getRtspVideoUrl(): Promise<boolean> {
        try {
            const response = JSON.parse(await this.ipcGetRequest('/preview'));

            this.rtspUrl = response.url || '';

            return response.status;
        }
        catch (ex) {
            this.logger.log(['CameraService', 'error'], ex.message);

            return false;
        }
    }

    private async ipcLogin(): Promise<boolean> {
        try {
            const options = {
                method: 'POST',
                url: `http://${this.ipAddress}:${this.port}/login`,
                json: true,
                body: {
                    username: this.config.get('peabodyUsername'),
                    userpwd: this.config.get('peabodyPassword')
                }
            };

            this.logger.log(['ipcProvider', 'info'], `LOGIN API: ${options.url}`);

            const result = await this.makeRequest(options);

            this.logger.log(['ipcProvider', 'info'], `RESPONSE BODY: ${_get(result, 'body.status')}`);

            if (result.body.status === true) {
                this.logger.log(['ipcProvider', 'info'], `RESPONSE COOKIE: ${_get(result, 'response.headers[set-cookie][0]')}`);

                this.sessionToken = _get(result, 'response.headers[set-cookie][0]');
            }

            return _get(result, 'body.status');
        }
        catch (ex) {
            this.logger.log(['ipcProvider', 'error'], ex.message);

            throw new Error(ex.message);
        }
    }

    private async ipcGetRequest(path: string, params?: string): Promise<any> {
        return this.ipcRequest('GET', path, params);
    }

    private async ipcPostRequest(path: string, payload?: any, params?: string): Promise<boolean> {
        return this.ipcRequest('POST', path, params, payload);
    }

    private async ipcRequest(method: string, path: string, params: string, payload?: any): Promise<any> {
        if (!this.sessionToken) {
            throw new Error('No valid login session available');
        }

        try {
            const url = params ? `${path}?${params}` : path;
            const options = {
                method,
                url: `http://${this.ipAddress}:${this.port}${url}`,
                headers: {
                    Cookie: this.sessionToken
                }
            };

            if (method === 'POST' && payload) {
                Object.assign(options, {
                    json: true,
                    body: payload
                });
            }

            this.logger.log(['ipcProvider', 'info'], `${method} API: ${options.url}`);

            const result = await this.makeRequest(options);

            await this.sleep(250);

            this.logger.log(['ipcProvider', 'info'], `RESPONSE: ${JSON.stringify(_get(result, 'body'))}`);

            return (method === 'POST') ? _get(result, 'body.status') : _get(result, 'body');
        }
        catch (ex) {
            this.logger.log(['ipcProvider', 'error'], ex.message);

            throw new Error(ex.message);
        }
    }

    private async makeRequest(options): Promise<any> {
        return new Promise((resolve, reject) => {
            request(options, (requestError, response, body) => {
                if (requestError) {
                    this.logger.log(['ipcProvider', 'error'], `makeRequest: ${requestError.message}`);
                    return reject(requestError);
                }

                if (response.statusCode < 200 || response.statusCode > 299) {
                    this.logger.log(['ipcProvider', 'error'], `Response status code = ${response.statusCode}`);

                    const errorMessage = body.message || body || 'An error occurred';
                    return reject(new Error(`Error statusCode: ${response.statusCode}, ${errorMessage}`));
                }

                return resolve({
                    response,
                    body
                });
            });
        });
    }

    private async sleep(milliseconds: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(() => {
                return resolve();
            }, milliseconds);
        });
    }

    private async getWlanIp() {
        const ifConfigFilter = `ip addr show wlan0 | grep 'inet ' | awk '{print $2}' | cut -f1 -d'/'`;
        const { stdout } = await promisify(exec)(ifConfigFilter, { encoding: 'utf8' });

        return (stdout || '127.0.0.1').trim();
    }

    private async retrieveModelFiles() {
        const storageDirectory = pathJoin((this.server.settings.app as any).peabodyDirectory, 'camera');
        return fse.readdir(storageDirectory);
    }
}
